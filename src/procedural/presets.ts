import { createRng } from './proceduralRuntime';
import {
  DEFAULT_PROCEDURAL, DISTORTION_TYPES, FIELD_METHODS, MOTION_TYPES, POINT_DISTRIBUTIONS, normalizeProcedural,
  type DistortionType, type FieldMethod, type MotionType, type ProceduralConfig,
} from './types';

/* Presets, the randomiser and preset files.
 *
 * A preset is a partial config: whatever it leaves out comes from DEFAULT_PROCEDURAL. Applying a preset or randomising
 * never touches what the user locked (`config.locks`): a lock is a group name (`motion`) or one property (`motion.speed`).
 * Randomising is seeded, so the same seed always produces the same result (and "undo" is simply re-applying the old config). */

type Deep<T> = T extends readonly (infer U)[] ? readonly Deep<U>[] : T extends object ? { [K in keyof T]?: Deep<T[K]> } : T;
export type ProceduralPresetConfig = Deep<ProceduralConfig>;

export interface ProceduralPreset {
  id: string;
  name: string;
  description: string;
  config: ProceduralPresetConfig;
}

const stage = (type: DistortionType, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const none = () => stage('none');

export const PROCEDURAL_PRESETS: readonly ProceduralPreset[] = [
  {
    id: 'soft-aurora', name: 'Soft Aurora', description: 'Slow green–violet curtains that breathe.',
    config: {
      points: { min: 5, max: 7, distribution: 'organic', spread: 1 },
      field: { method: 'soft', radius: 1.1, softness: 0.6 },
      motion: { type: 'drift', speed: 0.45, amplitude: 0.12, smoothness: 0.8 },
      distortion: [stage('warp', { scale: 1.2, intensity: 0.45, octaves: 3, speed: 0.3 }), none(), none()],
      color: { source: 'custom', colors: ['#0f2a44', '#2dd4bf', '#a78bfa', '#34d399', '#38bdf8'], interpolation: 'oklab' },
    },
  },
  {
    id: 'liquid-glass', name: 'Liquid Glass', description: 'Pale, translucent blobs that merge like droplets.',
    config: {
      points: { min: 4, max: 6, distribution: 'circular', radius: 0.38 },
      field: { method: 'smin', softness: 0.7, radius: 1 },
      motion: { type: 'circle', speed: 0.5, amplitude: 0.09, smoothness: 0.85 },
      distortion: [stage('curl', { scale: 1.4, intensity: 0.5, speed: 0.35 }), none(), none()],
      color: { source: 'custom', colors: ['#e0f2fe', '#a5b4fc', '#f0abfc', '#67e8f9'], interpolation: 'oklab', saturation: 0.9, contrast: 0.95 },
    },
  },
  {
    id: 'neon-flow', name: 'Neon Flow', description: 'Saturated magenta and cyan streams that race along a field.',
    config: {
      points: { min: 6, max: 9, distribution: 'random', spacing: 0.5 },
      field: { method: 'gaussian', falloff: 0.6, radius: 0.9, overlap: 0.6 },
      motion: { type: 'flow', speed: 1, amplitude: 0.16, frequency: 1.3 },
      distortion: [stage('fbm', { scale: 1.8, intensity: 0.5, speed: 0.6 }), stage('wave', { frequency: 3, intensity: 0.35, direction: 35 }), none()],
      color: { source: 'custom', colors: ['#ff2bd6', '#00e5ff', '#7c3aed', '#ff8a00'], interpolation: 'oklab', saturation: 1.3, contrast: 1.15 },
    },
  },
  {
    id: 'pastel-drift', name: 'Pastel Drift', description: 'Gentle, milky colour wandering at a snail\'s pace.',
    config: {
      points: { min: 5, max: 8, distribution: 'organic', variance: 0.5 },
      field: { method: 'soft', radius: 1.3, softness: 0.8 },
      motion: { type: 'noise', speed: 0.35, amplitude: 0.1, smoothness: 0.9 },
      distortion: [stage('warp', { intensity: 0.2, scale: 1, speed: 0.2 }), none(), none()],
      color: { source: 'custom', colors: ['#fde2e4', '#cddafd', '#e2f0cb', '#fff1c1', '#d0f4de'], interpolation: 'oklab', exposure: 0.1, saturation: 0.95 },
    },
  },
  {
    id: 'dark-nebula', name: 'Dark Nebula', description: 'Deep space with hot magenta cores and heavy domain warping.',
    config: {
      points: { min: 6, max: 8, distribution: 'cluster', radius: 0.4 },
      field: { method: 'gaussian', falloff: 0.5, radius: 0.9 },
      motion: { type: 'wander', speed: 0.5, amplitude: 0.14, smoothness: 0.75 },
      distortion: [stage('multiwarp', { scale: 1.3, intensity: 0.8, octaves: 4, speed: 0.3 }), none(), none()],
      color: { source: 'custom', colors: ['#05010f', '#2b0a4f', '#7a1fa2', '#ff3d81', '#1b1464'], interpolation: 'oklab', exposure: -0.2, contrast: 1.2 },
    },
  },
  {
    id: 'molten-metal', name: 'Molten Metal', description: 'Glowing orange rivers over dark iron, with ridged turbulence.',
    config: {
      points: { min: 6, max: 8, distribution: 'random' },
      field: { method: 'idw', exponent: 2.5, radius: 1 },
      motion: { type: 'flow', speed: 0.7, amplitude: 0.14 },
      distortion: [stage('turbulence', { scale: 1.6, intensity: 0.6, turbulence: 0.7, octaves: 4, speed: 0.5 }), none(), none()],
      color: { source: 'custom', colors: ['#1a0f0a', '#ff6a00', '#ffd166', '#c1121f', '#3d1c0f'], interpolation: 'linear', contrast: 1.25, temperature: 0.3 },
    },
  },
  {
    id: 'ocean-blur', name: 'Ocean Blur', description: 'Layered blues swaying on long swells.',
    config: {
      points: { min: 5, max: 7, distribution: 'grid', spacing: 0.4 },
      field: { method: 'gaussian', falloff: 0.35, radius: 1.2, softness: 0.6 },
      motion: { type: 'sine', speed: 0.6, amplitude: 0.1, smoothness: 0.8 },
      distortion: [stage('wave', { frequency: 2.2, intensity: 0.5, speed: 0.5, direction: 90 }), stage('warp', { intensity: 0.25, scale: 1.1 }), none()],
      color: { source: 'custom', colors: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8'], interpolation: 'oklab' },
    },
  },
  {
    id: 'cyber-gradient', name: 'Cyber Gradient', description: 'Violet and cyan discs orbiting a dark core.',
    config: {
      points: { min: 5, max: 7, distribution: 'circular', radius: 0.36 },
      field: { method: 'radial', exponent: 2, radius: 1 },
      motion: { type: 'orbit', speed: 0.8, amplitude: 0.1 },
      distortion: [stage('polar', { intensity: 0.5, frequency: 3, speed: 0.4 }), none(), none()],
      color: { source: 'custom', colors: ['#0b0f2b', '#6d28d9', '#06b6d4', '#f43f5e'], interpolation: 'oklab', saturation: 1.2 },
    },
  },
  {
    id: 'silk-waves', name: 'Silk Waves', description: 'Satin folds in rose and cream.',
    config: {
      points: { min: 5, max: 7, distribution: 'organic' },
      field: { method: 'smooth', falloff: 0.4, radius: 1.2 },
      motion: { type: 'sine', speed: 0.45, amplitude: 0.1, smoothness: 0.9 },
      distortion: [stage('wave', { frequency: 2.5, intensity: 0.8, speed: 0.4, direction: 20 }), stage('warp', { intensity: 0.2 }), none()],
      color: { source: 'custom', colors: ['#2d1b3d', '#b5528a', '#f4b6c2', '#fff0f5'], interpolation: 'oklab', contrast: 1.05 },
    },
  },
  {
    id: 'organic-cells', name: 'Organic Cells', description: 'Clustered green–amber cells with value-noise texture.',
    config: {
      points: { min: 8, max: 11, distribution: 'cluster', radius: 0.28, variance: 0.5 },
      field: { method: 'radial', exponent: 1.6, radius: 0.85, overlap: 0.4 },
      motion: { type: 'circle', speed: 0.6, amplitude: 0.06, randomness: 0.7 },
      distortion: [stage('turbulence', { noise: 'value', scale: 2.2, intensity: 0.35, octaves: 3 }), none(), none()],
      color: { source: 'custom', colors: ['#14532d', '#84cc16', '#facc15', '#f97316', '#fef3c7'], interpolation: 'oklab', shuffle: true },
    },
  },
  {
    id: 'sunset-flow', name: 'Sunset Flow', description: 'Indigo to amber, sliding sideways like cloud cover.',
    config: {
      points: { min: 5, max: 7, distribution: 'organic' },
      field: { method: 'soft', radius: 1.2, softness: 0.65 },
      motion: { type: 'drift', speed: 0.5, amplitude: 0.11 },
      distortion: [stage('flow', { scale: 1.3, intensity: 0.6, direction: 20, speed: 0.5 }), none(), none()],
      color: { source: 'custom', colors: ['#2b1055', '#7597de', '#ff6f61', '#ffb347', '#ffe29a'], interpolation: 'oklab', temperature: 0.15 },
    },
  },
  {
    id: 'minimal-mesh', name: 'Minimal Mesh', description: 'Four quiet grey–blue centres; barely moving.',
    config: {
      points: { min: 4, max: 5, distribution: 'grid', variance: 0.2, radius: 0.5 },
      field: { method: 'gaussian', falloff: 0.3, radius: 1.2, softness: 0.7 },
      motion: { type: 'drift', speed: 0.3, amplitude: 0.05, smoothness: 0.95 },
      distortion: [none(), none(), none()],
      color: { source: 'custom', colors: ['#f8fafc', '#e2e8f0', '#94a3b8', '#cbd5e1'], interpolation: 'oklab' },
    },
  },
  {
    id: 'glacier-light', name: 'Glacier Light', description: 'Cool glassy blues with slow, translucent folds.',
    config: {
      points: { min: 4, max: 7, distribution: 'circular', radius: 0.42, spread: 0.9 },
      field: { method: 'gaussian', radius: 1.15, softness: 0.75, overlap: 0.75 },
      motion: { type: 'orbit', speed: 0.35, amplitude: 0.08, smoothness: 0.95 },
      distortion: [stage('warp', { scale: 1.15, intensity: 0.28, octaves: 3, speed: 0.2 }), none(), none()],
      color: { source: 'custom', colors: ['#071a35', '#1d4ed8', '#67e8f9', '#e0f2fe'], interpolation: 'oklab', exposure: 0.12, saturation: 0.85 },
    },
  },
  {
    id: 'candy-pulse', name: 'Candy Pulse', description: 'Bright pink and citrus colours with lively rounded motion.',
    config: {
      points: { min: 5, max: 8, distribution: 'organic', spacing: 0.38, variance: 0.45 },
      field: { method: 'soft', radius: 1.1, softness: 0.65, overlap: 0.8 },
      motion: { type: 'figure8', speed: 0.75, amplitude: 0.12, smoothness: 0.8 },
      distortion: [stage('wave', { frequency: 2.4, intensity: 0.35, speed: 0.45 }), none(), none()],
      color: { source: 'custom', colors: ['#fb7185', '#f472b6', '#facc15', '#a3e635', '#67e8f9'], interpolation: 'oklab', saturation: 1.15, contrast: 1.05 },
    },
  },
  {
    id: 'forest-mist', name: 'Forest Mist', description: 'Deep evergreen tones drifting through soft mist.',
    config: {
      points: { min: 6, max: 9, distribution: 'cluster', radius: 0.4, spread: 0.95 },
      field: { method: 'smooth', radius: 1.2, falloff: 0.4, softness: 0.75 },
      motion: { type: 'drift', speed: 0.3, amplitude: 0.09, randomness: 0.35 },
      distortion: [stage('curl', { scale: 1.2, intensity: 0.32, speed: 0.18 }), none(), none()],
      color: { source: 'custom', colors: ['#031b12', '#14532d', '#4d7c0f', '#a3b18a', '#d9ed92'], interpolation: 'oklab', exposure: -0.08, saturation: 0.9 },
    },
  },
  {
    id: 'electric-dream', name: 'Electric Dream', description: 'High-contrast neon ribbons with layered warp.',
    config: {
      points: { min: 7, max: 10, distribution: 'random', spacing: 0.32, spread: 1.05 },
      field: { method: 'smin', radius: 0.95, softness: 0.62, exponent: 2.2 },
      motion: { type: 'flow', speed: 0.85, amplitude: 0.15, frequency: 1.2, smoothness: 0.72 },
      distortion: [stage('multiwarp', { scale: 1.4, intensity: 0.55, octaves: 3, speed: 0.42 }), stage('wave', { frequency: 3.2, intensity: 0.25, direction: 35, speed: 0.55 }), none()],
      color: { source: 'custom', colors: ['#09021f', '#4c1d95', '#c026d3', '#22d3ee', '#f8fafc'], interpolation: 'oklab', saturation: 1.25, contrast: 1.18 },
    },
  },
];

export const PRESET_FORMAT = 'shapeforge-procedural-preset';

/* ─────────────── locks ─────────────── */

/** True when `path` ('motion.speed') or its group ('motion') is in the lock list. */
export function isLocked(locks: readonly string[], path: string): boolean {
  if (locks.includes(path)) return true;
  const group = path.split('.')[0];
  return locks.includes(group);
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Copies every locked property from `original` back into `next`. */
export function restoreLocked(next: ProceduralConfig, original: ProceduralConfig): ProceduralConfig {
  const out = clone(next) as unknown as Record<string, unknown>;
  const source = original as unknown as Record<string, unknown>;
  for (const lock of original.locks) {
    const [group, key] = lock.split('.');
    if (!(group in source)) continue;
    if (!key) { out[group] = clone(source[group]); continue; }
    const from = source[group];
    if (from && typeof from === 'object' && !Array.isArray(from) && key in (from as object)) {
      const target = out[group];
      if (target && typeof target === 'object') (target as Record<string, unknown>)[key] = clone((from as Record<string, unknown>)[key]);
    }
  }
  out.locks = [...original.locks];
  return normalizeProcedural(out);
}

/* ─────────────── presets ─────────────── */

/** Applies a preset on top of the defaults. Keeps `enabled`, `mode`, `mix` and the locks; clears conversion anchors. */
export function applyPreset(current: ProceduralConfig, preset: ProceduralPreset | ProceduralPresetConfig): ProceduralConfig {
  const partial = 'config' in preset && 'id' in preset ? preset.config : preset;
  const fresh = normalizeProcedural({ ...(partial as object), enabled: current.enabled, mode: current.mode, mix: current.mix, seed: current.seed, anchors: [], origin: null, locks: current.locks }, DEFAULT_PROCEDURAL);
  return restoreLocked(fresh, current);
}

/* ─────────────── randomiser ─────────────── */

export type RandomizeScope = 'all' | 'points' | 'field' | 'motion' | 'distortion' | 'color';

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

function randomPalette(rng: () => number): string[] {
  const base = rng() * 360;
  const scheme = Math.floor(rng() * 4);
  const offsets = scheme === 0 ? [0, 25, 50, 75] : scheme === 1 ? [0, 120, 240, 60] : scheme === 2 ? [0, 150, 210, 30] : [0, 180, 20, 200];
  const count = 4 + Math.floor(rng() * 2);
  return Array.from({ length: count }, (_, index) => {
    const hue = (base + (offsets[index % offsets.length] ?? index * 40) + (rng() - 0.5) * 16 + 360) % 360;
    const lightness = 0.28 + rng() * 0.5;
    return hslToHex(hue, 0.55 + rng() * 0.35, lightness);
  });
}

const range = (rng: () => number, lo: number, hi: number) => lo + (hi - lo) * rng();
const choose = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)];

/**
 * Re-rolls the chosen group(s) with a seeded generator. Values stay inside tasteful ranges (not the full slider range),
 * and anything locked is restored afterwards. Same config + same seed → same result.
 */
export function randomizeProcedural(current: ProceduralConfig, scope: RandomizeScope = 'all', rollSeed = 1): ProceduralConfig {
  const rng = createRng(rollSeed * 2654435761 + 97) as () => number;
  const draft = clone(current);
  const all = scope === 'all';
  if (all || scope === 'points') {
    const min = 3 + Math.floor(rng() * 4);
    draft.points = {
      ...draft.points, min, max: Math.min(12, min + 1 + Math.floor(rng() * 5)), density: rng(),
      distribution: choose(rng, POINT_DISTRIBUTIONS), spacing: range(rng, 0.2, 0.6), spread: range(rng, 0.7, 1.1),
      variance: range(rng, 0.2, 0.6), radius: range(rng, 0.3, 0.55),
    };
    draft.anchors = [];
    draft.origin = null;
  }
  if (all || scope === 'field') {
    const methods: FieldMethod[] = ['gaussian', 'gaussian', 'soft', 'soft', 'smooth', 'smin', 'radial', 'idw'];
    draft.field = {
      ...draft.field, method: choose(rng, methods.filter(method => (FIELD_METHODS as readonly string[]).includes(method))),
      radius: range(rng, 0.8, 1.4), strength: range(rng, 0.8, 1.4), falloff: range(rng, 0.2, 0.7),
      softness: range(rng, 0.3, 0.8), exponent: range(rng, 1.5, 3.5), overlap: range(rng, 0.5, 0.9),
    };
  }
  if (all || scope === 'motion') {
    const types: MotionType[] = MOTION_TYPES.filter(type => type !== 'static' && type !== 'follow');
    draft.motion = {
      ...draft.motion, type: choose(rng, types), mixed: rng() < 0.2, speed: range(rng, 0.3, 1.2), amplitude: range(rng, 0.05, 0.18),
      frequency: range(rng, 0.6, 1.8), smoothness: range(rng, 0.4, 0.9), randomness: range(rng, 0.2, 0.7), direction: rng() < 0.25 ? -1 : 1,
    };
  }
  if (all || scope === 'distortion') {
    const kinds: DistortionType[] = DISTORTION_TYPES.filter(type => ['warp', 'fbm', 'multiwarp', 'curl', 'turbulence', 'flow', 'wave'].includes(type));
    const make = (type: DistortionType) => ({
      ...draft.distortion[0], type, enabled: true, noise: rng() < 0.2 ? 'value' as const : 'gradient' as const,
      scale: range(rng, 0.8, 3), intensity: range(rng, 0.15, 0.7), octaves: 2 + Math.floor(rng() * 3), frequency: range(rng, 1.5, 4),
      turbulence: range(rng, 0.1, 0.6), speed: range(rng, 0.2, 0.8), direction: Math.round(range(rng, -90, 90)),
    });
    draft.distortion = [make(choose(rng, kinds)), rng() < 0.5 ? { ...draft.distortion[1], type: 'none' } : make(choose(rng, kinds)), { ...draft.distortion[2], type: 'none' }];
  }
  if (all || scope === 'color') {
    draft.color = {
      ...draft.color, source: 'custom', colors: randomPalette(rng), interpolation: rng() < 0.7 ? 'oklab' : 'srgb',
      saturation: range(rng, 0.9, 1.25), contrast: range(rng, 0.95, 1.2), shuffle: rng() < 0.3, variance: range(rng, 0.05, 0.3),
    };
  }
  if (all) draft.seed = Math.floor(rng() * 999999);
  return restoreLocked(normalizeProcedural(draft), current);
}

/** Convenience for the panel's reseed button: only the seed changes (positions, colours and phases re-roll). */
export function reseed(current: ProceduralConfig, seed: number): ProceduralConfig {
  return restoreLocked(normalizeProcedural({ ...current, seed }), current);
}

/* ─────────────── preset files (user presets, share / import) ─────────────── */

export function serializePresetFile(name: string, config: ProceduralConfig): string {
  const { enabled: _enabled, locks: _locks, anchors: _anchors, origin: _origin, ...portable } = normalizeProcedural(config);
  return JSON.stringify({ format: PRESET_FORMAT, version: 1, name: name.slice(0, 60) || 'Untitled', config: portable }, null, 2);
}

export function parsePresetFile(text: string): { name: string; config: ProceduralPresetConfig } | null {
  try {
    const parsed = JSON.parse(text) as { format?: unknown; name?: unknown; config?: unknown };
    if (parsed.format !== PRESET_FORMAT || !parsed.config || typeof parsed.config !== 'object') return null;
    const normalized = normalizeProcedural(parsed.config);
    return { name: typeof parsed.name === 'string' ? parsed.name.slice(0, 60) : 'Imported preset', config: normalized as unknown as ProceduralPresetConfig };
  } catch {
    return null;
  }
}
