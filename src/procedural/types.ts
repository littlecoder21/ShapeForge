/* Procedural gradient model.
 *
 * One ProceduralConfig lives on a shader layer (`layer.shader.procedural`). It never replaces the manual gradient:
 * the layer's stops / mesh points stay untouched, so switching the engine off (or removing the config) restores the
 * original gradient exactly. Everything here is plain JSON so it serialises into projects, presets and exports.
 *
 * This file has no dependency on the renderer or on React. The runtime that turns a config into animated GPU data is
 * `proceduralRuntime.js` (plain JavaScript, so exports can embed it verbatim). */

/** Uniform budget: 12 colour centres + 3 distortion stages keep the whole shader under ~200 uniform vectors. */
export const PROC_MAX_POINTS = 12;
export const PROC_MAX_STAGES = 3;

export const PROC_MODES = ['hybrid', 'full'] as const;
export type ProceduralMode = typeof PROC_MODES[number];

export const POINT_DISTRIBUTIONS = ['random', 'grid', 'circular', 'organic', 'cluster'] as const;
export type PointDistribution = typeof POINT_DISTRIBUTIONS[number];

export const MOTION_TYPES = ['static', 'orbit', 'circle', 'figure8', 'sine', 'drift', 'noise', 'flow', 'wander', 'follow'] as const;
export type MotionType = typeof MOTION_TYPES[number];

export const FIELD_METHODS = ['idw', 'gaussian', 'smooth', 'radial', 'smin', 'soft'] as const;
export type FieldMethod = typeof FIELD_METHODS[number];

export const DISTORTION_TYPES = ['none', 'fbm', 'warp', 'multiwarp', 'turbulence', 'curl', 'polar', 'radial', 'wave', 'flow', 'rotate', 'scale'] as const;
export type DistortionType = typeof DISTORTION_TYPES[number];

export const FORCE_TYPES = ['none', 'attract', 'repel', 'swirl', 'vortex', 'push', 'pull', 'ripple', 'wave', 'fluid'] as const;
export type ForceType = typeof FORCE_TYPES[number];

export const COLOR_SPACES = ['srgb', 'linear', 'oklab'] as const;
export type ProceduralColorSpace = typeof COLOR_SPACES[number];

export const COLOR_SOURCES = ['layer', 'custom'] as const;
export type ProceduralColorSource = typeof COLOR_SOURCES[number];

export const FALLOFFS = ['soft', 'linear', 'sharp', 'gaussian'] as const;
export type ProceduralFalloff = typeof FALLOFFS[number];

export const NOISE_KINDS = ['gradient', 'value'] as const;
export type NoiseKind = typeof NOISE_KINDS[number];

export interface ProceduralStage {
  type: DistortionType;
  enabled: boolean;
  noise: NoiseKind;
  /** noise scale */
  scale: number;
  /** warp strength / noise intensity */
  intensity: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  /** warp frequency (waves, polar twist, radial ripples) */
  frequency: number;
  /** turbulence amount (blends smooth noise with ridged noise) */
  turbulence: number;
  /** flow speed, relative to the layer's animation speed */
  speed: number;
  /** distortion direction in degrees */
  direction: number;
}

/** A colour centre fixed by a conversion (for example a mesh point). Anchors replace the first generated points. */
export interface ProceduralAnchor {
  x: number;
  y: number;
  color: string;
  radius: number;
  weight: number;
}

export interface ProceduralConfig {
  version: 1;
  enabled: boolean;
  /** hybrid: keep the manual gradient and add procedural behaviour · full: the field replaces the gradient colours */
  mode: ProceduralMode;
  /** every generated value (positions, colours, motion phases) is reproducible from this seed */
  seed: number;
  /** hybrid strength: how much the procedural colour field covers the manual gradient */
  mix: number;
  points: {
    min: number;
    max: number;
    /** 0…1: where between min and max the count lands */
    density: number;
    distribution: PointDistribution;
    /** minimum separation (relaxation) */
    spacing: number;
    /** how much of the canvas the points occupy */
    spread: number;
    /** reach multiplier for every point */
    influence: number;
    /** base radius, in canvas-height units */
    radius: number;
    /** base weight (amplitude) */
    weight: number;
    /** random per-point variation of radius / weight / influence */
    variance: number;
  };
  field: {
    method: FieldMethod;
    radius: number;
    strength: number;
    /** curve shape: 0 wide & soft, 1 tight & sharp */
    falloff: number;
    /** blend softness (smooth-min width, softmax temperature) */
    softness: number;
    /** influence exponent (inverse-distance power, radial power) */
    exponent: number;
    /** 0 = nearest point dominates, 1 = points blend freely */
    overlap: number;
    /** colour shown where no point reaches ('' = the average of the point colours) */
    base: string;
  };
  motion: {
    type: MotionType;
    /** give every point its own motion type */
    mixed: boolean;
    speed: number;
    /** 1 or -1 */
    direction: number;
    /** global phase offset in degrees (each point still gets its own random phase on top) */
    phase: number;
    amplitude: number;
    frequency: number;
    /** 0 jittery · 1 very smooth */
    smoothness: number;
    /** random per-point variation of speed / phase / amplitude */
    randomness: number;
    /** 0 = points stay home, 1 = full motion */
    influence: number;
  };
  distortion: ProceduralStage[];
  color: {
    source: ProceduralColorSource;
    /** used when source is 'custom' */
    colors: string[];
    interpolation: ProceduralColorSpace;
    /** palette cycling speed, in palettes per ~20 s */
    cycleSpeed: number;
    shuffle: boolean;
    /** random per-point colour offset along the palette */
    variance: number;
    /** degrees */
    hue: number;
    saturation: number;
    exposure: number;
    contrast: number;
    temperature: number;
  };
  interaction: {
    force: ForceType;
    radius: number;
    strength: number;
    falloff: ProceduralFalloff;
    /** how quickly points follow the force (1/s) */
    response: number;
  };
  anchors: ProceduralAnchor[];
  /** where this config came from (a conversion records its approximation here) */
  origin: { from: string; note: string } | null;
  /** property paths (`motion.speed`) or groups (`motion`) that randomise / presets must not change */
  locks: string[];
}

/** Ranges used by the normaliser, the randomiser and the panel sliders. */
export const PROC_RANGES = {
  seed: { min: 0, max: 999999 },
  mix: { min: 0, max: 1 },
  points: {
    min: { min: 1, max: PROC_MAX_POINTS }, max: { min: 1, max: PROC_MAX_POINTS }, density: { min: 0, max: 1 },
    spacing: { min: 0, max: 1 }, spread: { min: 0.2, max: 1.3 }, influence: { min: 0.3, max: 2 },
    radius: { min: 0.08, max: 0.9 }, weight: { min: 0.2, max: 2 }, variance: { min: 0, max: 1 },
  },
  field: {
    radius: { min: 0.2, max: 3 }, strength: { min: 0.2, max: 3 }, falloff: { min: 0, max: 1 },
    softness: { min: 0, max: 1 }, exponent: { min: 0.5, max: 6 }, overlap: { min: 0, max: 1 },
  },
  motion: {
    speed: { min: 0, max: 3 }, phase: { min: 0, max: 360 }, amplitude: { min: 0, max: 0.5 }, frequency: { min: 0.1, max: 4 },
    smoothness: { min: 0, max: 1 }, randomness: { min: 0, max: 1 }, influence: { min: 0, max: 1 },
  },
  stage: {
    scale: { min: 0.2, max: 8 }, intensity: { min: 0, max: 2 }, octaves: { min: 1, max: 6 },
    lacunarity: { min: 1.2, max: 3.5 }, persistence: { min: 0.2, max: 0.9 }, frequency: { min: 0.2, max: 12 },
    turbulence: { min: 0, max: 1 }, speed: { min: 0, max: 2 }, direction: { min: -180, max: 180 },
  },
  color: {
    cycleSpeed: { min: -2, max: 2 }, variance: { min: 0, max: 1 }, hue: { min: -180, max: 180 },
    saturation: { min: 0, max: 2 }, exposure: { min: -2, max: 2 }, contrast: { min: 0.4, max: 2 }, temperature: { min: -1, max: 1 },
  },
  interaction: { radius: { min: 0.05, max: 0.8 }, strength: { min: 0, max: 2 }, response: { min: 0.5, max: 20 } },
} as const;

export const DEFAULT_PROCEDURAL_STAGE: Readonly<ProceduralStage> = Object.freeze({
  type: 'none', enabled: true, noise: 'gradient', scale: 1.6, intensity: 0.35, octaves: 3, lacunarity: 2, persistence: 0.5,
  frequency: 3, turbulence: 0.3, speed: 0.4, direction: 0,
});

export const DEFAULT_PROCEDURAL: Readonly<ProceduralConfig> = Object.freeze({
  version: 1,
  enabled: false,
  mode: 'full',
  seed: 1337,
  mix: 1,
  points: { min: 5, max: 8, density: 0.5, distribution: 'organic', spacing: 0.35, spread: 0.9, influence: 1, radius: 0.42, weight: 1, variance: 0.35 },
  field: { method: 'gaussian', radius: 1, strength: 1, falloff: 0.45, softness: 0.5, exponent: 2, overlap: 0.7, base: '' },
  motion: { type: 'drift', mixed: false, speed: 0.6, direction: 1, phase: 0, amplitude: 0.1, frequency: 1, smoothness: 0.6, randomness: 0.4, influence: 1 },
  distortion: [
    { ...DEFAULT_PROCEDURAL_STAGE, type: 'warp' },
    { ...DEFAULT_PROCEDURAL_STAGE },
    { ...DEFAULT_PROCEDURAL_STAGE },
  ],
  color: {
    source: 'layer', colors: ['#7c5cff', '#22d3ee', '#f472b6', '#fbbf24'], interpolation: 'oklab', cycleSpeed: 0, shuffle: false, variance: 0.15,
    hue: 0, saturation: 1, exposure: 0, contrast: 1, temperature: 0,
  },
  interaction: { force: 'swirl', radius: 0.32, strength: 0.7, falloff: 'soft', response: 6 },
  anchors: [],
  origin: null,
  locks: [],
}) as Readonly<ProceduralConfig>;

const HEX = /^#[0-9a-f]{6}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const num = (value: unknown, min: number, max: number, fallback: number) => {
  const candidate = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(candidate) ? Math.min(max, Math.max(min, candidate)) : fallback;
};
const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : fallback;
const hex = (value: unknown, fallback: string) => typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;

export function normalizeStage(raw: unknown, fallback: ProceduralStage = { ...DEFAULT_PROCEDURAL_STAGE }): ProceduralStage {
  const value = isRecord(raw) ? raw : {};
  const r = PROC_RANGES.stage;
  return {
    type: pick(value.type, DISTORTION_TYPES, fallback.type),
    enabled: value.enabled === undefined ? fallback.enabled : value.enabled !== false,
    noise: pick(value.noise, NOISE_KINDS, fallback.noise),
    scale: num(value.scale, r.scale.min, r.scale.max, fallback.scale),
    intensity: num(value.intensity, r.intensity.min, r.intensity.max, fallback.intensity),
    octaves: Math.round(num(value.octaves, r.octaves.min, r.octaves.max, fallback.octaves)),
    lacunarity: num(value.lacunarity, r.lacunarity.min, r.lacunarity.max, fallback.lacunarity),
    persistence: num(value.persistence, r.persistence.min, r.persistence.max, fallback.persistence),
    frequency: num(value.frequency, r.frequency.min, r.frequency.max, fallback.frequency),
    turbulence: num(value.turbulence, r.turbulence.min, r.turbulence.max, fallback.turbulence),
    speed: num(value.speed, r.speed.min, r.speed.max, fallback.speed),
    direction: num(value.direction, r.direction.min, r.direction.max, fallback.direction),
  };
}

/** Validates / repairs any input (an old project, an imported preset, a half-filled patch). Never throws. */
export function normalizeProcedural(raw: unknown, base: Readonly<ProceduralConfig> = DEFAULT_PROCEDURAL): ProceduralConfig {
  const value = isRecord(raw) ? raw : {};
  const points = isRecord(value.points) ? value.points : {};
  const field = isRecord(value.field) ? value.field : {};
  const motion = isRecord(value.motion) ? value.motion : {};
  const color = isRecord(value.color) ? value.color : {};
  const interaction = isRecord(value.interaction) ? value.interaction : {};
  const R = PROC_RANGES;
  const bp = base.points, bf = base.field, bm = base.motion, bc = base.color, bi = base.interaction;

  const min = Math.round(num(points.min, R.points.min.min, R.points.min.max, bp.min));
  const max = Math.max(min, Math.round(num(points.max, R.points.max.min, R.points.max.max, bp.max)));
  const stagesRaw = Array.isArray(value.distortion) ? value.distortion : [];
  const distortion = Array.from({ length: PROC_MAX_STAGES }, (_, index) => normalizeStage(stagesRaw[index], base.distortion[index] ?? { ...DEFAULT_PROCEDURAL_STAGE }));
  const customColors = Array.isArray(color.colors)
    ? color.colors.filter((item): item is string => typeof item === 'string' && HEX.test(item)).slice(0, 8).map(item => item.toLowerCase())
    : [];
  const anchors = Array.isArray(value.anchors)
    ? value.anchors.filter(isRecord).slice(0, PROC_MAX_POINTS).map(anchor => ({
      x: num(anchor.x, -0.5, 1.5, 0.5),
      y: num(anchor.y, -0.5, 1.5, 0.5),
      color: hex(anchor.color, '#ffffff'),
      radius: num(anchor.radius, 0.05, 1.5, 0.35),
      weight: num(anchor.weight, 0.1, 3, 1),
    }))
    : base.anchors.map(anchor => ({ ...anchor }));
  const origin = isRecord(value.origin) && typeof value.origin.from === 'string'
    ? { from: value.origin.from.slice(0, 60), note: typeof value.origin.note === 'string' ? value.origin.note.slice(0, 400) : '' }
    : value.origin === null ? null : base.origin ? { ...base.origin } : null;
  const locks = Array.isArray(value.locks)
    ? [...new Set(value.locks.filter((item): item is string => typeof item === 'string' && /^[a-z]+(\.[a-zA-Z]+)?$/.test(item)))].slice(0, 64)
    : [...base.locks];

  return {
    version: 1,
    enabled: value.enabled === undefined ? base.enabled : value.enabled === true,
    mode: pick(value.mode, PROC_MODES, base.mode),
    seed: Math.round(num(value.seed, R.seed.min, R.seed.max, base.seed)),
    mix: num(value.mix, R.mix.min, R.mix.max, base.mix),
    points: {
      min,
      max,
      density: num(points.density, R.points.density.min, R.points.density.max, bp.density),
      distribution: pick(points.distribution, POINT_DISTRIBUTIONS, bp.distribution),
      spacing: num(points.spacing, R.points.spacing.min, R.points.spacing.max, bp.spacing),
      spread: num(points.spread, R.points.spread.min, R.points.spread.max, bp.spread),
      influence: num(points.influence, R.points.influence.min, R.points.influence.max, bp.influence),
      radius: num(points.radius, R.points.radius.min, R.points.radius.max, bp.radius),
      weight: num(points.weight, R.points.weight.min, R.points.weight.max, bp.weight),
      variance: num(points.variance, R.points.variance.min, R.points.variance.max, bp.variance),
    },
    field: {
      method: pick(field.method, FIELD_METHODS, bf.method),
      radius: num(field.radius, R.field.radius.min, R.field.radius.max, bf.radius),
      strength: num(field.strength, R.field.strength.min, R.field.strength.max, bf.strength),
      falloff: num(field.falloff, R.field.falloff.min, R.field.falloff.max, bf.falloff),
      softness: num(field.softness, R.field.softness.min, R.field.softness.max, bf.softness),
      exponent: num(field.exponent, R.field.exponent.min, R.field.exponent.max, bf.exponent),
      overlap: num(field.overlap, R.field.overlap.min, R.field.overlap.max, bf.overlap),
      base: field.base === '' ? '' : hex(field.base, bf.base),
    },
    motion: {
      type: pick(motion.type, MOTION_TYPES, bm.type),
      mixed: motion.mixed === undefined ? bm.mixed : motion.mixed === true,
      speed: num(motion.speed, R.motion.speed.min, R.motion.speed.max, bm.speed),
      direction: num(motion.direction, -1, 1, bm.direction) < 0 ? -1 : 1,
      phase: num(motion.phase, R.motion.phase.min, R.motion.phase.max, bm.phase),
      amplitude: num(motion.amplitude, R.motion.amplitude.min, R.motion.amplitude.max, bm.amplitude),
      frequency: num(motion.frequency, R.motion.frequency.min, R.motion.frequency.max, bm.frequency),
      smoothness: num(motion.smoothness, R.motion.smoothness.min, R.motion.smoothness.max, bm.smoothness),
      randomness: num(motion.randomness, R.motion.randomness.min, R.motion.randomness.max, bm.randomness),
      influence: num(motion.influence, R.motion.influence.min, R.motion.influence.max, bm.influence),
    },
    distortion,
    color: {
      source: pick(color.source, COLOR_SOURCES, bc.source),
      colors: customColors.length ? customColors : [...bc.colors],
      interpolation: pick(color.interpolation, COLOR_SPACES, bc.interpolation),
      cycleSpeed: num(color.cycleSpeed, R.color.cycleSpeed.min, R.color.cycleSpeed.max, bc.cycleSpeed),
      shuffle: color.shuffle === undefined ? bc.shuffle : color.shuffle === true,
      variance: num(color.variance, R.color.variance.min, R.color.variance.max, bc.variance),
      hue: num(color.hue, R.color.hue.min, R.color.hue.max, bc.hue),
      saturation: num(color.saturation, R.color.saturation.min, R.color.saturation.max, bc.saturation),
      exposure: num(color.exposure, R.color.exposure.min, R.color.exposure.max, bc.exposure),
      contrast: num(color.contrast, R.color.contrast.min, R.color.contrast.max, bc.contrast),
      temperature: num(color.temperature, R.color.temperature.min, R.color.temperature.max, bc.temperature),
    },
    interaction: {
      force: pick(interaction.force, FORCE_TYPES, bi.force),
      radius: num(interaction.radius, R.interaction.radius.min, R.interaction.radius.max, bi.radius),
      strength: num(interaction.strength, R.interaction.strength.min, R.interaction.strength.max, bi.strength),
      falloff: pick(interaction.falloff, FALLOFFS, bi.falloff),
      response: num(interaction.response, R.interaction.response.min, R.interaction.response.max, bi.response),
    },
    anchors,
    origin,
    locks,
  };
}

export const newProcedural = (patch: unknown = {}): ProceduralConfig => normalizeProcedural(patch);

/** Order of keys is fixed, so equal configs always serialise to the same string (project files, presets, exports). */
export function serializeProcedural(config: ProceduralConfig): string {
  return JSON.stringify(normalizeProcedural(config));
}

export function parseProcedural(json: string): ProceduralConfig | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? normalizeProcedural(parsed) : null;
  } catch {
    return null;
  }
}

/** The compiled shader depends only on which distortion types are present (their numbers are uniforms), and on nothing
 *  else in the config. Toggling a stage on / off, or moving any slider, never recompiles. */
export function proceduralSignature(config: Pick<ProceduralConfig, 'enabled' | 'distortion'> | null | undefined): string {
  if (!config || !config.enabled) return 'off';
  return `on:${config.distortion.slice(0, PROC_MAX_STAGES).map(stage => stage.type).join(',')}`;
}

export const isProceduralActive = (config: Pick<ProceduralConfig, 'enabled'> | null | undefined): boolean => !!config && config.enabled === true;

/** Uniform names the procedural shader code declares (arrays as `name[0]`). Listed here, not in glsl.ts, so the shared
 *  uniform list can include them without importing the GLSL generator. */
export const PROCEDURAL_UNIFORM_NAMES = [
  'uProcPoints[0]', 'uProcColors[0]', 'uProcA', 'uProcB', 'uProcC', 'uProcGrade', 'uProcD', 'uProcBase',
  'uProcWarpA[0]', 'uProcWarpB[0]', 'uProcWarpC[0]',
] as const;
