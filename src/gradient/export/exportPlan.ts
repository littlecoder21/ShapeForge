import { previewDurationMs } from '../engine/animation';
import type { GradientProject } from '../engine/model';
import { outputOf } from '../engine/model';
import type { BackgroundSettings, FitMode, QualityPreset, SizeSettings, VideoSettings } from './exportTypes';

/* Pure planning helpers shared by the Image and Video panels and the export runners: output sizes, timing, bitrate, estimates. */

export interface AnimationInfo {
  /** at least one visible layer has CSS animation tracks */
  cssAnimated: boolean;
  /** at least one visible layer is drawn by a shader */
  shader: boolean;
  /** milliseconds until every finite animation has ended, null when something loops forever or nothing moves */
  finiteMs: number | null;
  /** the longest loop (one full there-and-back cycle) among the endless animations, null when none */
  loopMs: number | null;
  /** anything that changes over time */
  dynamic: boolean;
}

export function animationInfo(project: GradientProject): AnimationInfo {
  let cssAnimated = false;
  let loopMs: number | null = null;
  for (const layer of project.layers) {
    const animation = layer.anim;
    if (!layer.visible || !animation.enabled || !animation.tracks.length) continue;
    cssAnimated = true;
    if ((animation.iterations ?? 'infinite') !== 'infinite') continue;
    for (const track of animation.tracks) {
      const perPoint = (track.prop === 'meshX' || track.prop === 'meshY') && track.stopId;
      const duration = (perPoint ? track.duration ?? animation.duration : animation.duration) * 1000;
      const direction = track.direction ?? animation.direction;
      const cycle = duration * (direction.startsWith('alternate') ? 2 : 1);
      loopMs = Math.max(loopMs ?? 0, cycle);
    }
  }
  const shader = !!project.shader?.enabled && project.layers.some(layer => layer.visible && !!layer.shader?.enabled);
  return { cssAnimated, shader, finiteMs: cssAnimated ? previewDurationMs(project) : null, loopMs, dynamic: cssAnimated || shader };
}

/** A good default length in seconds: the finite animation, one full loop, or a short clip for shader-only motion. */
export function suggestedDuration(info: AnimationInfo): number {
  const seconds = info.finiteMs !== null ? info.finiteMs / 1000 : info.loopMs !== null ? info.loopMs / 1000 : info.shader ? 6 : 3;
  return Math.min(60, Math.max(1, Math.round(seconds * 10) / 10));
}

export interface OutputSize { width: number; height: number; label: string; suffix: string; fit: FitMode }

export const LONG_EDGES: { value: number; label: string }[] = [
  { value: 1280, label: 'HD 1280' }, { value: 1920, label: 'FHD 1920' }, { value: 2560, label: 'QHD 2560' }, { value: 3840, label: '4K 3840' },
];

/** The pixel sizes an export produces. `even` rounds to even numbers (video codecs need them). */
export function resolveSizes(canvas: { w: number; h: number }, size: SizeSettings, options: { even: boolean; maxSide: number; single?: boolean }): OutputSize[] {
  const round = (value: number) => {
    const bounded = Math.min(options.maxSide, Math.max(options.even ? 2 : 1, value));
    return options.even ? Math.max(2, Math.round(bounded / 2) * 2) : Math.round(bounded);
  };
  const aspect = canvas.w / canvas.h;
  if (size.mode === 'scale') {
    const scales = options.single ? size.scales.slice(0, 1) : size.scales;
    return scales.map(scale => ({
      width: round(canvas.w * scale), height: round(canvas.h * scale), label: `${scale}×`, suffix: scale === 1 ? '' : `@${scale}x`, fit: 'stretch' as const,
    }));
  }
  if (size.mode === 'preset') {
    const width = aspect >= 1 ? round(size.longEdge) : round(size.longEdge * aspect);
    const height = aspect >= 1 ? round(size.longEdge / aspect) : round(size.longEdge);
    return [{ width, height, label: `${width}×${height}`, suffix: `-${width}x${height}`, fit: 'stretch' as const }];
  }
  const width = round(size.width), height = round(size.height);
  return [{ width, height, label: `${width}×${height}`, suffix: `-${width}x${height}`, fit: size.fit }];
}

/** The colour (CSS) painted behind the artwork; '' means transparent. Formats without alpha never get '' . */
export function resolveBackground(project: GradientProject, background: BackgroundSettings, alpha: boolean): string {
  let value = background.mode === 'color' ? background.color : background.mode === 'transparent' ? '' : project.background || '';
  if (!value && !alpha) value = background.color || '#000000';
  return value;
}

export function exportSlug(project: GradientProject, override = ''): string {
  const configured = override.trim() || outputOf(project).downloadName.trim();
  const slug = (configured || project.name || 'gradient').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug || 'gradient';
}

/** Destination rectangle of a `width × height` source inside `out` for the fit mode (used by still-image sources). */
export function fitRect(source: { width: number; height: number }, out: { width: number; height: number }, fit: FitMode) {
  if (fit === 'stretch') return { x: 0, y: 0, width: out.width, height: out.height };
  const k = fit === 'cover' ? Math.max(out.width / source.width, out.height / source.height) : Math.min(out.width / source.width, out.height / source.height);
  const width = source.width * k, height = source.height * k;
  return { x: (out.width - width) / 2, y: (out.height - height) / 2, width, height };
}

const BITS_PER_PIXEL: Record<Exclude<QualityPreset, 'custom'>, number> = { low: 0.05, medium: 0.09, high: 0.16, max: 0.3 };

/** bits per second for the preset (gradients band easily, so the presets are generous) */
export function bitrateFor(width: number, height: number, fps: number, preset: QualityPreset, customMbps: number): number {
  if (preset === 'custom') return Math.round(customMbps * 1e6);
  return Math.round(Math.min(120e6, Math.max(400e3, width * height * fps * BITS_PER_PIXEL[preset])));
}

export interface VideoTiming {
  fps: number;
  frameMs: number;
  frames: number;
  /** seconds of output */
  seconds: number;
  /** scene milliseconds where the first frame sits */
  sceneStartMs: number;
  speed: number;
}

export function videoTiming(settings: VideoSettings, info: AnimationInfo): VideoTiming {
  const seconds = settings.durationMode === 'auto' ? suggestedDuration(info) : settings.duration;
  const fps = settings.fps;
  return {
    fps, frameMs: 1000 / fps, frames: Math.max(1, Math.round(seconds * fps)), seconds, sceneStartMs: info.dynamic ? settings.start * 1000 : 0, speed: settings.speed,
  };
}

export function estimateBytes(settings: VideoSettings, size: { width: number; height: number }, timing: VideoTiming, dynamic: boolean): number {
  const pixels = size.width * size.height;
  const frames = dynamic ? timing.frames : 1;
  switch (settings.format) {
    case 'mp4': case 'webm': return (bitrateFor(size.width, size.height, timing.fps, settings.qualityPreset, settings.bitrateMbps) / 8) * timing.seconds * (dynamic ? 1 : 0.2);
    case 'gif': return pixels * frames * (settings.gifDither === 'none' ? 0.1 : 0.2) * (settings.gifColors / 256 * 0.5 + 0.5);
    default: return pixels * timing.frames * (settings.framesType === 'png' ? 0.45 : settings.framesType === 'webp' ? 0.1 : 0.12);
  }
}

export const formatBytes = (bytes: number): string => bytes < 1024 ? `${Math.round(bytes)} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`;
export const formatSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return '–';
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
