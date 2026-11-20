import type { FitMode } from './domRasterizer';
import type { GifDither } from './gif';
import type { HardwarePreference } from './videoEncode';

/* Settings of the Image and Video export panels, their defaults, validation and persistence (localStorage, best effort). */

export type { FitMode };
export type SizeMode = 'scale' | 'preset' | 'custom';
export interface SizeSettings {
  mode: SizeMode;
  /** canvas multipliers (the Image panel can export several at once, the Video panel uses the first) */
  scales: number[];
  /** long edge in pixels for the preset sizes */
  longEdge: number;
  width: number;
  height: number;
  lock: boolean;
  fit: FitMode;
}

export type BackgroundMode = 'project' | 'transparent' | 'color';
export interface BackgroundSettings { mode: BackgroundMode; color: string }

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'svg';
export interface ImageSettings {
  format: ImageFormat;
  size: SizeSettings;
  background: BackgroundSettings;
  /** 1…100, JPEG and WebP */
  quality: number;
  /** seconds into the animation (animated and shader projects only) */
  time: number;
  /** empty = the project's download name */
  fileName: string;
}

export type VideoFormat = 'mp4' | 'webm' | 'gif' | 'frames';
export type WebmCodec = 'vp9' | 'vp8' | 'av1';
export type FrameSequenceType = 'png' | 'jpeg' | 'webp';
export type QualityPreset = 'low' | 'medium' | 'high' | 'max' | 'custom';
export interface VideoSettings {
  format: VideoFormat;
  webmCodec: WebmCodec;
  framesType: FrameSequenceType;
  size: SizeSettings;
  background: BackgroundSettings;
  fps: number;
  durationMode: 'auto' | 'custom';
  /** seconds, used when durationMode is custom */
  duration: number;
  /** seconds skipped at the start (the animation is fast-forwarded to this point) */
  start: number;
  speed: number;
  qualityPreset: QualityPreset;
  bitrateMbps: number;
  bitrateMode: 'variable' | 'constant';
  keyframeSeconds: number;
  hardware: HardwarePreference;
  gifColors: number;
  gifDither: GifDither;
  /** 0 = loop forever */
  gifPlays: number;
  /** 1…100, JPEG / WebP frame sequences */
  imageQuality: number;
  digits: number;
  fadeIn: number;
  fadeOut: number;
  fileName: string;
}

export const MAX_IMAGE_SIDE = 16384;
export const MAX_VIDEO_SIDE = 8192;

const DEFAULT_SIZE: SizeSettings = { mode: 'scale', scales: [1], longEdge: 1920, width: 1920, height: 1080, lock: true, fit: 'contain' };
const DEFAULT_BACKGROUND: BackgroundSettings = { mode: 'project', color: '#000000' };

export const DEFAULT_IMAGE: ImageSettings = {
  format: 'png', size: { ...DEFAULT_SIZE, scales: [1, 2] }, background: { ...DEFAULT_BACKGROUND, color: '#ffffff' }, quality: 92, time: 0, fileName: '',
};

export const DEFAULT_VIDEO: VideoSettings = {
  format: 'mp4', webmCodec: 'vp9', framesType: 'png', size: { ...DEFAULT_SIZE }, background: { ...DEFAULT_BACKGROUND },
  fps: 30, durationMode: 'auto', duration: 6, start: 0, speed: 1,
  qualityPreset: 'high', bitrateMbps: 12, bitrateMode: 'variable', keyframeSeconds: 2, hardware: 'no-preference',
  gifColors: 256, gifDither: 'ordered', gifPlays: 0, imageQuality: 92, digits: 4, fadeIn: 0, fadeOut: 0, fileName: '',
};

const num = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed as readonly unknown[]).includes(value) ? value as T : fallback;
const hex = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

function sanitizeSize(raw: Partial<SizeSettings> | undefined, base: SizeSettings, maxSide: number): SizeSettings {
  const scales = Array.isArray(raw?.scales) ? [...new Set(raw!.scales.map(Number).filter(s => [0.5, 1, 1.5, 2, 3, 4].includes(s)))].sort((a, b) => a - b) : base.scales;
  return {
    mode: pick(raw?.mode, ['scale', 'preset', 'custom'] as const, base.mode),
    scales: scales.length ? scales : base.scales,
    longEdge: [1280, 1920, 2560, 3840].includes(Number(raw?.longEdge)) ? Number(raw?.longEdge) : base.longEdge,
    width: Math.round(num(raw?.width, base.width, 16, maxSide)),
    height: Math.round(num(raw?.height, base.height, 16, maxSide)),
    lock: typeof raw?.lock === 'boolean' ? raw.lock : base.lock,
    fit: pick(raw?.fit, ['contain', 'cover', 'stretch'] as const, base.fit),
  };
}

function sanitizeBackground(raw: Partial<BackgroundSettings> | undefined, base: BackgroundSettings): BackgroundSettings {
  return { mode: pick(raw?.mode, ['project', 'transparent', 'color'] as const, base.mode), color: hex(raw?.color, base.color) };
}

export function sanitizeImage(raw: Partial<ImageSettings> | undefined): ImageSettings {
  const base = DEFAULT_IMAGE;
  return {
    format: pick(raw?.format, ['png', 'jpeg', 'webp', 'svg'] as const, base.format),
    size: sanitizeSize(raw?.size, base.size, MAX_IMAGE_SIDE),
    background: sanitizeBackground(raw?.background, base.background),
    quality: Math.round(num(raw?.quality, base.quality, 1, 100)),
    time: num(raw?.time, base.time, 0, 3600),
    fileName: typeof raw?.fileName === 'string' ? raw.fileName.slice(0, 80) : '',
  };
}

export function sanitizeVideo(raw: Partial<VideoSettings> | undefined): VideoSettings {
  const base = DEFAULT_VIDEO;
  return {
    format: pick(raw?.format, ['mp4', 'webm', 'gif', 'frames'] as const, base.format),
    webmCodec: pick(raw?.webmCodec, ['vp9', 'vp8', 'av1'] as const, base.webmCodec),
    framesType: pick(raw?.framesType, ['png', 'jpeg', 'webp'] as const, base.framesType),
    size: sanitizeSize(raw?.size, base.size, MAX_VIDEO_SIDE),
    background: sanitizeBackground(raw?.background, base.background),
    fps: Math.round(num(raw?.fps, base.fps, 1, 120)),
    durationMode: pick(raw?.durationMode, ['auto', 'custom'] as const, base.durationMode),
    duration: num(raw?.duration, base.duration, 0.1, 600),
    start: num(raw?.start, base.start, 0, 600),
    speed: num(raw?.speed, base.speed, 0.1, 8),
    qualityPreset: pick(raw?.qualityPreset, ['low', 'medium', 'high', 'max', 'custom'] as const, base.qualityPreset),
    bitrateMbps: num(raw?.bitrateMbps, base.bitrateMbps, 0.25, 200),
    bitrateMode: pick(raw?.bitrateMode, ['variable', 'constant'] as const, base.bitrateMode),
    keyframeSeconds: num(raw?.keyframeSeconds, base.keyframeSeconds, 0.1, 30),
    hardware: pick(raw?.hardware, ['no-preference', 'prefer-hardware', 'prefer-software'] as const, base.hardware),
    gifColors: Math.round(num(raw?.gifColors, base.gifColors, 4, 256)),
    gifDither: pick(raw?.gifDither, ['none', 'ordered', 'floyd'] as const, base.gifDither),
    gifPlays: Math.round(num(raw?.gifPlays, base.gifPlays, 0, 100)),
    imageQuality: Math.round(num(raw?.imageQuality, base.imageQuality, 1, 100)),
    digits: Math.round(num(raw?.digits, base.digits, 1, 8)),
    fadeIn: Math.round(num(raw?.fadeIn, base.fadeIn, 0, 10000)),
    fadeOut: Math.round(num(raw?.fadeOut, base.fadeOut, 0, 10000)),
    fileName: typeof raw?.fileName === 'string' ? raw.fileName.slice(0, 80) : '',
  };
}

const IMAGE_KEY = 'shapeforge.gradient.export.image';
const VIDEO_KEY = 'shapeforge.gradient.export.video';

function read(key: string): unknown {
  try { const text = localStorage.getItem(key); return text ? JSON.parse(text) : undefined; } catch { return undefined; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable or full */ }
}

export const loadImageSettings = (): ImageSettings => sanitizeImage(read(IMAGE_KEY) as Partial<ImageSettings> | undefined);
export const saveImageSettings = (settings: ImageSettings) => write(IMAGE_KEY, settings);
export const loadVideoSettings = (): VideoSettings => sanitizeVideo(read(VIDEO_KEY) as Partial<VideoSettings> | undefined);
export const saveVideoSettings = (settings: VideoSettings) => write(VIDEO_KEY, settings);
