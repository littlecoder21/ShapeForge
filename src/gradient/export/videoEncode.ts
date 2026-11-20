import { muxMp4 } from './mp4';
import { muxWebm } from './webm';
import type { EncodedSample, VideoTrackInfo } from './muxTypes';

/* WebCodecs encoding session. Frames are pushed one by one (so the render loop controls timing), encoded chunks are collected and
 * muxed into MP4 (H.264) or WebM (VP9 / VP8 / AV1) when the session ends. */

export type VideoCodecId = 'avc' | 'vp9' | 'vp8' | 'av1';
export type HardwarePreference = 'no-preference' | 'prefer-hardware' | 'prefer-software';

export interface VideoEncodeConfig {
  codec: VideoCodecId;
  width: number;
  height: number;
  fps: number;
  /** bits per second */
  bitrate: number;
  bitrateMode: 'variable' | 'constant';
  /** a key frame at least every N frames */
  keyEvery: number;
  hardware: HardwarePreference;
}

export const CODEC_LABEL: Record<VideoCodecId, string> = { avc: 'H.264', vp9: 'VP9', vp8: 'VP8', av1: 'AV1' };
export const CODEC_CONTAINER: Record<VideoCodecId, 'mp4' | 'webm'> = { avc: 'mp4', vp9: 'webm', vp8: 'webm', av1: 'webm' };

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** H.264 level for the frame size and rate (macroblock limits of the standard). */
function avcLevel(width: number, height: number, fps: number): number {
  const frameMbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = frameMbs * fps;
  const levels: [number, number, number][] = [[31, 3600, 108000], [32, 5120, 216000], [40, 8192, 245760], [42, 8704, 522240], [50, 22080, 589824], [51, 36864, 983040], [52, 36864, 2073600]];
  for (const [level, maxFrame, maxRate] of levels) if (frameMbs <= maxFrame && rate <= maxRate) return level;
  return 52;
}

/** Candidate codec strings, most conservative first. */
export function codecStrings(codec: VideoCodecId, width: number, height: number, fps: number): string[] {
  const pixels = width * height;
  if (codec === 'avc') {
    const level = avcLevel(width, height, fps);
    return [`avc1.6400${hex2(level)}`, `avc1.4d00${hex2(level)}`, 'avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.4d0028', 'avc1.42001f'];
  }
  if (codec === 'vp9') {
    const level = pixels > 4096 * 2176 ? '62' : pixels > 2560 * 1440 ? '51' : pixels > 1920 * 1088 ? '50' : pixels > 1280 * 720 ? '40' : '31';
    return [`vp09.00.${level}.08`, 'vp09.00.51.08', 'vp09.00.61.08', 'vp09.00.10.08', 'vp9'];
  }
  if (codec === 'av1') {
    const level = pixels > 3840 * 2160 ? '16' : pixels > 1920 * 1088 ? '12' : pixels > 1280 * 720 ? '09' : '08';
    return [`av01.0.${level}M.08`, 'av01.0.12M.08', 'av01.0.16M.08', 'av01.0.08M.08', 'av01.0.04M.08', 'av01.0.00M.08'];
  }
  return ['vp8'];
}

export const webCodecsAvailable = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

function configFor(config: VideoEncodeConfig, codec: string): VideoEncoderConfig {
  const base: VideoEncoderConfig = {
    codec,
    width: config.width,
    height: config.height,
    bitrate: Math.round(config.bitrate),
    framerate: config.fps,
    bitrateMode: config.bitrateMode,
    latencyMode: 'quality',
    hardwareAcceleration: config.hardware,
  };
  if (config.codec === 'avc') (base as VideoEncoderConfig & { avc?: { format: 'avc' | 'annexb' } }).avc = { format: 'avc' };
  return base;
}

export interface ResolvedEncoder { codecString: string; config: VideoEncoderConfig }

/** The first codec string the browser can really encode with, or null. */
export async function resolveEncoder(config: VideoEncodeConfig): Promise<ResolvedEncoder | null> {
  if (!webCodecsAvailable()) return null;
  for (const codec of codecStrings(config.codec, config.width, config.height, config.fps)) {
    for (const hardware of config.hardware === 'no-preference' ? ['no-preference' as const] : [config.hardware, 'no-preference' as const]) {
      try {
        const candidate = configFor({ ...config, hardware }, codec);
        const result = await VideoEncoder.isConfigSupported(candidate);
        if (result.supported) return { codecString: codec, config: { ...candidate, ...(result.config ?? {}) } as VideoEncoderConfig };
      } catch { /* try the next candidate */ }
    }
  }
  return null;
}

/** Which codecs this browser can encode at the given size (for disabling choices in the panel). */
export async function probeCodecs(width: number, height: number, fps: number): Promise<Record<VideoCodecId, boolean>> {
  const result: Record<VideoCodecId, boolean> = { avc: false, vp9: false, vp8: false, av1: false };
  if (!webCodecsAvailable()) return result;
  await Promise.all((Object.keys(result) as VideoCodecId[]).map(async codec => {
    result[codec] = !!(await resolveEncoder({ codec, width, height, fps, bitrate: 4_000_000, bitrateMode: 'variable', keyEvery: 60, hardware: 'no-preference' }));
  }));
  return result;
}

export class VideoEncodeSession {
  private readonly encoder: VideoEncoder;
  private readonly samples: EncodedSample[] = [];
  private description: Uint8Array | undefined;
  private failure: Error | null = null;
  private count = 0;
  private readonly frameUs: number;

  private constructor(private readonly config: VideoEncodeConfig, private readonly resolved: ResolvedEncoder) {
    this.frameUs = 1e6 / config.fps;
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const description = metadata?.decoderConfig?.description;
        if (description && !this.description) this.description = new Uint8Array(description instanceof ArrayBuffer ? description : (description as ArrayBufferView).buffer.slice((description as ArrayBufferView).byteOffset, (description as ArrayBufferView).byteOffset + (description as ArrayBufferView).byteLength));
        this.samples.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? this.frameUs, key: chunk.type === 'key' });
      },
      error: error => { this.failure = error instanceof Error ? error : new Error(String(error)); },
    });
    this.encoder.configure(resolved.config);
  }

  static async create(config: VideoEncodeConfig): Promise<VideoEncodeSession> {
    const resolved = await resolveEncoder(config);
    if (!resolved) throw new Error(`This browser cannot encode ${CODEC_LABEL[config.codec]} video at ${config.width}×${config.height}. Pick another format or a smaller size.`);
    return new VideoEncodeSession(config, resolved);
  }

  get codecString() { return this.resolved.codecString; }
  get frames() { return this.count; }

  private check() { if (this.failure) throw this.failure; }

  /** Encodes the current content of `source` as the next frame. */
  async addFrame(source: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
    this.check();
    while (this.encoder.encodeQueueSize > 8) { await new Promise(resolve => setTimeout(resolve, 4)); this.check(); }
    const frame = new VideoFrame(source as CanvasImageSource, { timestamp: Math.round(this.count * this.frameUs), duration: Math.round(this.frameUs) });
    try {
      this.encoder.encode(frame, { keyFrame: this.count % Math.max(1, this.config.keyEvery) === 0 });
    } finally {
      frame.close();
    }
    this.count++;
    this.check();
  }

  /** Flushes the encoder and returns the finished file. */
  async finish(): Promise<Blob> {
    await this.encoder.flush();
    this.check();
    this.encoder.close();
    const track: VideoTrackInfo = { width: this.config.width, height: this.config.height, description: this.description };
    if (this.config.codec === 'avc') return muxMp4(this.samples, { track });
    return muxWebm(this.samples, { codec: this.config.codec as 'vp8' | 'vp9' | 'av1', track });
  }

  abort() {
    try { if (this.encoder.state !== 'closed') this.encoder.close(); } catch { /* already closed */ }
  }
}
