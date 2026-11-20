import type { GradientProject } from '../engine/model';
import { assertSize, canvasToBlob, EXTENSION, MIME } from './download';
import { animationInfo, bitrateFor, exportSlug, resolveBackground, resolveSizes, videoTiming, type VideoTiming } from './exportPlan';
import { MAX_VIDEO_SIDE, type VideoSettings } from './exportTypes';
import { abortError, openFrameSource } from './frameCapture';
import { GifEncoder } from './gif';
import { VideoEncodeSession, webCodecsAvailable, type VideoCodecId } from './videoEncode';
import { ZipWriter } from './zip';

export interface VideoProgress {
  phase: 'preparing' | 'rendering' | 'finishing';
  frame: number;
  total: number;
  elapsedMs: number;
  /** estimated milliseconds left, null until a few frames have been measured */
  etaMs: number | null;
  message: string;
}

export interface VideoExportResult {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  frames: number;
  seconds: number;
  /** codec string actually used, for video files */
  codec?: string;
  notes: string[];
}

interface Hooks { signal?: AbortSignal; onProgress?: (progress: VideoProgress) => void }

const MAX_FRAMES = 36000;

/** 0…1 opacity of the fade at output frame `index` (1 = fully visible). */
export function fadeAmount(index: number, timing: VideoTiming, fadeInMs: number, fadeOutMs: number): number {
  const at = index * timing.frameMs, total = timing.frames * timing.frameMs;
  let amount = 1;
  if (fadeInMs > 0) amount = Math.min(amount, at / fadeInMs);
  if (fadeOutMs > 0) amount = Math.min(amount, (total - at - timing.frameMs) / fadeOutMs);
  return Math.max(0, Math.min(1, amount));
}

function applyFade(ctx: CanvasRenderingContext2D, width: number, height: number, amount: number, background: string) {
  if (amount >= 0.999) return;
  ctx.save();
  ctx.globalAlpha = 1 - amount;
  if (background) {
    // opaque output fades through black
    ctx.fillStyle = '#000000';
  } else {
    // transparent output fades out its own alpha
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000000';
  }
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export async function runVideoExport(project: GradientProject, settings: VideoSettings, hooks: Hooks = {}): Promise<VideoExportResult> {
  const { signal, onProgress } = hooks;
  const started = performance.now();
  const info = animationInfo(project);
  const video = settings.format === 'mp4' || settings.format === 'webm';
  const alpha = settings.format === 'gif' || (settings.format === 'frames' && settings.framesType !== 'jpeg');
  const background = resolveBackground(project, settings.background, alpha);
  const size = resolveSizes(project.canvas, settings.size, { even: video, maxSide: MAX_VIDEO_SIDE, single: true })[0];
  assertSize(size.width, size.height);
  const timing = videoTiming(settings, info);
  // a project that does not move needs a single picture for GIF and frame sequences
  const frames = !info.dynamic && !video ? 1 : timing.frames;
  if (frames > MAX_FRAMES) throw new Error(`${frames} frames is too many. Lower the frame rate or the duration (limit ${MAX_FRAMES}).`);
  const slug = exportSlug(project, settings.fileName);
  const progress = (phase: VideoProgress['phase'], frame: number, message: string) => {
    const elapsedMs = performance.now() - started;
    onProgress?.({ phase, frame, total: frames, elapsedMs, etaMs: frame >= 3 && phase === 'rendering' ? (elapsedMs / frame) * (frames - frame) : null, message });
  };

  progress('preparing', 0, 'Preparing…');
  let encoder: VideoEncodeSession | null = null;
  let codec: VideoCodecId = 'avc';
  if (video) {
    if (!webCodecsAvailable()) throw new Error('This browser has no video encoder (WebCodecs). Use Chrome, Edge, Safari 16.4+ or Firefox 130+, or export a GIF or a frame sequence.');
    codec = settings.format === 'mp4' ? 'avc' : settings.webmCodec;
    encoder = await VideoEncodeSession.create({
      codec, width: size.width, height: size.height, fps: timing.fps,
      bitrate: bitrateFor(size.width, size.height, timing.fps, settings.qualityPreset, settings.bitrateMbps),
      bitrateMode: settings.bitrateMode, keyEvery: Math.max(1, Math.round(settings.keyframeSeconds * timing.fps)), hardware: settings.hardware,
    });
  }
  const gif = settings.format === 'gif' ? new GifEncoder({ width: size.width, height: size.height, colors: settings.gifColors, dither: settings.gifDither, plays: info.dynamic ? settings.gifPlays : 1, transparent: !background }) : null;
  const zip = settings.format === 'frames' ? new ZipWriter() : null;
  const source = await openFrameSource({ project, background, signal, onStatus: message => progress('preparing', 0, message) });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d', { alpha, willReadFrequently: !!gif })!;
    const key = settings.framesType;
    // fast-forward to the start offset
    if (source.dynamic && timing.sceneStartMs > 0) { progress('preparing', 0, 'Skipping to the start…'); await source.advanceTo(timing.sceneStartMs, 1); }
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw abortError();
      if (source.dynamic && i > 0) await source.advanceTo(timing.sceneStartMs + i * timing.frameMs * timing.speed, timing.speed);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, size.width, size.height);
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, size.width, size.height); }
      await source.render(ctx, { width: size.width, height: size.height, fit: size.fit });
      applyFade(ctx, size.width, size.height, fadeAmount(i, timing, settings.fadeIn, settings.fadeOut), background);
      if (encoder) await encoder.addFrame(canvas);
      else if (gif) gif.addFrame(ctx.getImageData(0, 0, size.width, size.height).data, info.dynamic ? timing.frameMs : Math.max(20, timing.seconds * 1000));
      else if (zip) await zip.add(`${slug}/${slug}_${String(i + 1).padStart(settings.digits, '0')}.${EXTENSION[key]}`, await canvasToBlob(canvas, MIME[key], key === 'png' ? undefined : settings.imageQuality / 100));
      progress('rendering', i + 1, `Frame ${i + 1} of ${frames}`);
      if (i % 4 === 3) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    progress('finishing', frames, video ? 'Finishing the file…' : 'Packing…');
    let blob: Blob;
    let fileName: string;
    if (encoder) {
      blob = await encoder.finish();
      fileName = `${slug}${size.suffix}.${settings.format === 'mp4' ? 'mp4' : 'webm'}`;
    } else if (gif) {
      blob = gif.finish();
      fileName = `${slug}${size.suffix}.gif`;
    } else {
      blob = zip!.finish();
      fileName = `${slug}-frames${size.suffix}.zip`;
    }
    return { blob, fileName, width: size.width, height: size.height, frames, seconds: frames / timing.fps, codec: encoder?.codecString, notes: [...new Set(source.notes)] };
  } catch (error) {
    encoder?.abort();
    throw error;
  } finally {
    source.dispose();
  }
}
