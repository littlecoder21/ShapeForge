/* Procedural gradient model.
 *
 * One ProceduralConfig lives on a shader layer (`layer.shader.procedural`). It never replaces the manual gradient:
 * the layer's stops / mesh points stay untouched, so switching the engine off (or removing the config) restores the
 * original gradient exactly. Everything here is plain JSON so it serialises into projects, presets and exports.
 *
 * This file has no dependency on the renderer or on React. The runtime that turns a config into animated GPU data is
 * `proceduralRuntime.js` (plain JavaScript, so exports can embed it verbatim). */

/** Generated colour centres (seed → points) stay under the original uniform budget: 12 centres + 3 distortion stages. */
export const PROC_MAX_POINTS = 12;
export const PROC_MAX_STAGES = 3;
/** Pinned centres (a mesh layer's points) may go further: the shader loop is compiled for the smallest tier that holds them. */
export const PROC_POINT_TIERS = [12, 24, 48, 96, 128] as const;
export const PROC_MAX_MESH_POINTS = 128;
/** Uniform vectors the rest of the shader needs (palette, ripples, rig rules, trail, stages …). Kept deliberately generous. */
export const PROC_UNIFORM_RESERVE = 176;

export const PROC_MODES = ['hybrid', 'full'] as const;
export type ProceduralMode = typeof PROC_MODES[number];

export const POINT_DISTRIBUTIONS = ['random', 'grid', 'circular', 'organic', 'cluster'] as const;
export type PointDistribution = typeof POINT_DISTRIBUTIONS[number];

/** Appended-only, like FIELD_METHODS. spring / elastic / float / magnetic are new: spring and elastic travel between random targets
 *  (a damped spring and an overshooting curve), float is a slow multi-sine bob, magnetic is pulled around by a virtual magnet. */
export const MOTION_TYPES = ['static', 'orbit', 'circle', 'figure8', 'sine', 'drift', 'noise', 'flow', 'wander', 'follow', 'spring', 'elastic', 'float', 'magnetic'] as const;
export type MotionType = typeof MOTION_TYPES[number];

/** Curve of the segment-based motions (wander, elastic). `smooth` is the original smoothstep, so old projects look the same;
 *  `custom` is a CSS-style cubic-bezier given by `motion.curve`. */
export const MOTION_EASINGS = ['smooth', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic', 'spring', 'elastic', 'custom'] as const;
export type MotionEasing = typeof MOTION_EASINGS[number];

/** The order is the shader index (`uProcA.z`): new methods are only ever appended, so saved projects keep their meaning. */
export const FIELD_METHODS = [
  'idw', 'gaussian', 'smooth', 'radial', 'smin', 'soft', 'inverse-multiquadric', 'wendland-c2',
  'smooth-voronoi', 'power-diagram', 'natural-neighbor', 'custom-weighted',
  'rbf-gaussian', 'rbf-multiquadric', 'thin-plate', 'harmonic',
] as const;
export type FieldMethod = typeof FIELD_METHODS[number];

/** How a method reaches the screen. kernel: one weight per point, blended in one loop (the original methods).
 *  cells: the nearest-cell geometry of the points (needs the smallest distance before it can weight anything).
 *  rbf: exact interpolation through every point; the linear system is solved on the CPU, the shader only sums the kernels. */
export const FIELD_FAMILIES = ['kernel', 'cells', 'rbf'] as const;
export type FieldFamily = typeof FIELD_FAMILIES[number];
const FIELD_FAMILY_OF: Record<FieldMethod, FieldFamily> = {
  idw: 'kernel', gaussian: 'kernel', smooth: 'kernel', radial: 'kernel', smin: 'kernel', soft: 'kernel',
  'inverse-multiquadric': 'kernel', 'wendland-c2': 'kernel', 'custom-weighted': 'kernel',
  'smooth-voronoi': 'cells', 'power-diagram': 'cells', 'natural-neighbor': 'cells',
  'rbf-gaussian': 'rbf', 'rbf-multiquadric': 'rbf', 'thin-plate': 'rbf', harmonic: 'rbf',
};
export const fieldFamily = (method: FieldMethod): FieldFamily => FIELD_FAMILY_OF[method] ?? 'kernel';

export const DISTORTION_TYPES = ['none', 'fbm', 'warp', 'multiwarp', 'turbulence', 'curl', 'polar', 'radial', 'wave', 'flow', 'rotate', 'scale'] as const;
export type DistortionType = typeof DISTORTION_TYPES[number];

/** What a distortion stage moves. layer: the sampling position of the whole shader (the field AND the manual gradient move
 *  together; the original behaviour). field: only the position the procedural field is sampled at. color: nothing moves; the
 *  stage's displacement drives a hue / exposure offset of the finished colour. points: the colour centres themselves are moved
 *  before each one's reach is measured (one stage evaluation per point per pixel, so it costs the most). */
export const STAGE_TARGETS = ['layer', 'field', 'points', 'color'] as const;
export type StageTarget = typeof STAGE_TARGETS[number];

/** Shape of one point's reach. The metric changes where `field.radius × point radius` lies; the kernel is unchanged. */
export const INFLUENCE_SHAPES = ['circle', 'ellipse', 'rounded-rect', 'diamond', 'directional', 'polygon'] as const;
export type InfluenceShape = typeof INFLUENCE_SHAPES[number];

/** How the hue is routed between two colours when blending in OKLCH. */
export const HUE_DIRECTIONS = ['shorter', 'longer', 'increasing', 'decreasing'] as const;
export type HueDirection = typeof HUE_DIRECTIONS[number];

export const FORCE_TYPES = ['none', 'attract', 'repel', 'swirl', 'vortex', 'push', 'pull', 'ripple', 'wave', 'fluid', 'magnetic', 'drag', 'disturb'] as const;
export type ForceType = typeof FORCE_TYPES[number];

export const COLOR_SPACES = ['srgb', 'linear', 'oklab', 'oklch'] as const;
export type ProceduralColorSpace = typeof COLOR_SPACES[number];

export const COLOR_SOURCES = ['layer', 'custom'] as const;
export type ProceduralColorSource = typeof COLOR_SOURCES[number];

export const FALLOFFS = ['soft', 'linear', 'sharp', 'gaussian'] as const;
export type ProceduralFalloff = typeof FALLOFFS[number];

export const NOISE_KINDS = ['gradient', 'value'] as const;
export type NoiseKind = typeof NOISE_KINDS[number];

/** How the centres are drawn. css-compatible = the stacked radial gradients of the CSS mesh, composited in one pass;
 *  unified-field = every centre feeds one continuous field (the `field.method` blend). */
export const MESH_RENDER_MODES = ['css-compatible', 'unified-field'] as const;
export type MeshRenderMode = typeof MESH_RENDER_MODES[number];

/** css-compatible stacking model. background = the `background-image` list of mesh.ts (flat / exported CSS, source-over);
 *  layered = the studio preview (one element per point, screen-blended, linear ramp). */
export const MESH_COMPOSITES = ['background', 'layered'] as const;
export type MeshComposite = typeof MESH_COMPOSITES[number];

/** snapshot = use the stored anchors · layer = re-read the layer's live mesh points every time (the mesh stays the source of truth). */
export const MESH_SOURCES = ['snapshot', 'layer'] as const;
export type MeshSource = typeof MESH_SOURCES[number];

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
  /** what the stage moves; absent in old projects = 'layer' (the original behaviour) */
  target: StageTarget;
}

/** A colour centre fixed by a conversion (for example a mesh point). Anchors replace the first generated points.
 *  Mesh anchors also carry the point's own alpha / core / size, so nothing of the mesh point is lost in the round trip. */
export interface ProceduralAnchor {
  x: number;
  y: number;
  color: string;
  radius: number;
  weight: number;
  /** point alpha 0…1 (mesh anchors) */
  alpha?: number;
  /** core 0…100: how long the point holds its colour (mesh anchors) */
  core?: number;
  /** radius as a percentage of the canvas WIDTH, exactly like MeshPoint.size (mesh anchors) */
  size?: number;
  /** optional per-point influence overrides; a point without them uses `config.influence` */
  shape?: InfluenceShape;
  /** degrees */
  rotation?: number;
  anisotropy?: number;
  inner?: number;
}

export interface ProceduralMeshConfig {
  source: MeshSource;
  render: MeshRenderMode;
  composite: MeshComposite;
  /** solid colour under the points ('' = none), like MeshData.base */
  base: string;
  /** default core for points that have none, like MeshData.core */
  core: number;
  /** layer opacity applied inside the shader (the preview applies layer opacity on the canvas, so this is 1 there) */
  opacity: number;
}

/** How a secondary field is composited over what is already drawn (the primary field, then field 1, 2, 3 in order). */
export const FIELD_BLEND_OPS = ['mix', 'add', 'multiply', 'screen', 'overlay', 'soft-light', 'difference', 'max', 'min', 'weighted'] as const;
export type FieldBlendOp = typeof FIELD_BLEND_OPS[number];

/** Kernels a secondary field can use. They are chosen by a uniform, so changing one never recompiles. */
export const LAYER_KERNELS = ['gaussian', 'soft', 'smooth', 'radial', 'idw', 'wendland-c2', 'inverse-multiquadric'] as const;
export type LayerKernel = typeof LAYER_KERNELS[number];

export const PROC_MAX_FIELDS = 3;
export const PROC_MAX_FIELD_POINTS = 4;

/** One extra field of colour centres composited over the primary field in the same shader pass. Fields share the point
 *  uniform arrays (their centres are stored after the primary ones) and the motion, pointer-force and distortion settings. */
export interface ProceduralFieldLayer {
  enabled: boolean;
  /** weight kernel of this field */
  kernel: LayerKernel;
  blend: FieldBlendOp;
  /** 0…1: how much of the blended result shows */
  opacity: number;
  /** weight multiplier (the `weighted` operation also reads it as the layer's mass) */
  strength: number;
  /** reach multiplier on top of the points' own radius */
  radius: number;
  /** kernel shape: 0 soft … 1 sharp */
  falloff: number;
  /** generated centres of this field (1…4) */
  count: number;
  distribution: PointDistribution;
  /** base radius of its centres in canvas-height units */
  pointRadius: number;
  spread: number;
  /** one to four colours; centres take them in turn */
  colors: string[];
  /** false = this field ignores the `field` / `points` distortion targets and samples the undistorted canvas */
  distort: boolean;
}

/** Optional lighting stage after the colour field. Everything is derived from the field itself (its lightness acts as a height
 *  map), so no colour is added that the palette does not contain except light itself. Off by default. */
export interface ProceduralMaterial {
  enabled: boolean;
  /** sampling distance of the effects, 0…1 (maps to 0.4 %–6 % of the canvas height) */
  radius: number;
  glow: number;
  bloom: number;
  bloomThreshold: number;
  innerGlow: number;
  edgeGlow: number;
  ambient: number;
  light: number;
  /** degrees, direction the light comes from */
  lightAngle: number;
  /** 0 (grazing) … 1 (overhead) */
  lightElevation: number;
  specular: number;
  shininess: number;
  /** how strongly lightness is read as height */
  depth: number;
  shadow: number;
  scatter: number;
}

/** Current schema version. Version 1 files are valid version 2 files (every addition is optional), so loading one is a
 *  default-fill; `normalizeProcedural` always writes the current version. See `validateProcedural` for the issue report. */
export const PROCEDURAL_VERSION = 2;

export interface ProceduralConfig {
  version: typeof PROCEDURAL_VERSION;
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
    /** smooth-min blend width */
    softness: number;
    /** influence exponent (inverse-distance power, radial power) */
    exponent: number;
    /** 0 = nearest point dominates, 1 = points blend freely */
    overlap: number;
    /** colour shown where no point reaches ('' = the average of the point colours) */
    base: string;
    /** 0 = the base colour shows where no point reaches · 1 = the field fills the whole canvas. Applies to every method. */
    global: number;
    /** `custom-weighted` only: the mix of three kernels, each 0…1, normalised by their sum */
    custom: { gaussian: number; compact: number; inverse: number };
  };
  /** extra fields composited over the primary one; empty = single field (the default) */
  fields: ProceduralFieldLayer[];
  /** lighting stage; `enabled: false` (default) skips it entirely */
  material: ProceduralMaterial;
  /** Default reach shape for every point (a point may override it through its anchor). Defaults change nothing. */
  influence: {
    shape: InfluenceShape;
    /** degrees; for `directional` it is the direction the reach extends in */
    rotation: number;
    /** 1 = round; > 1 stretches the reach along `rotation`, < 1 squeezes it (area is kept roughly constant) */
    anisotropy: number;
    /** 0…0.95: fraction of the reach that holds full strength before the falloff starts (a flat core) */
    inner: number;
    /** 0…2: extra weight in the centre of every point */
    core: number;
    /** `polygon` only: number of sides, 3…8 */
    sides: number;
    /** `polygon` only: 0 = straight edges … 1 = round */
    rounding: number;
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
    /** curve of wander / elastic travel between targets */
    easing: MotionEasing;
    /** `custom` easing: cubic-bezier control points [x1, y1, x2, y2] */
    curve: [number, number, number, number];
    /** `spring`: 0 = bouncy … 1 = settles without overshoot */
    damping: number;
    /** seconds; > 0 makes the motion repeat seamlessly (the last 20 % cross-fades into the start). 0 = never repeats */
    loop: number;
    /** seconds of stagger: later points (or groups) start moving this much later, easing in */
    delay: number;
    /** 0 = every point has its own phase / speed (the default look) … 1 = all points move in perfect synchronisation */
    sync: number;
    /** 0 = no groups; n > 0 = points are dealt into n animation groups that share phase, speed, amplitude and seed */
    groups: number;
  };
  distortion: ProceduralStage[];
  color: {
    source: ProceduralColorSource;
    /** used when source is 'custom' */
    colors: string[];
    interpolation: ProceduralColorSpace;
    /** OKLCH only: which way the hue travels between colours */
    hueDirection: HueDirection;
    /** 0…1, OKLab / OKLCH: pulls the blended chroma back toward the weighted average of the source chromas, so a blend of
     *  two saturated colours does not collapse toward grey */
    chromaPreserve: number;
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
    /** degrees: the force direction is rotated by this much (0 = unchanged) */
    direction: number;
    /** 0…2: how much pointer speed adds to the force */
    velocity: number;
    /** 0…2: how much pressing (mouse button / touch) adds to the force (0.6 = the original behaviour) */
    pressure: number;
    /** 0…1: how long the reaction lingers after the pointer leaves (0 = it releases at `response` speed) */
    persistence: number;
    /** what the force drives, each 0…1. `position` is the original behaviour; the others are driven by the same falloff weight
     *  and never touch the saved point positions: they are applied on top while the pointer is near. */
    affect: { position: number; radius: number; strength: number; saturation: number; hue: number; speed: number };
  };
  /** how a mesh (or any pinned set of centres) is drawn; absent in old projects → defaults that change nothing */
  mesh: ProceduralMeshConfig;
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
    global: { min: 0, max: 1 }, custom: { min: 0, max: 1 },
  },
  influence: {
    rotation: { min: -180, max: 180 }, anisotropy: { min: 0.25, max: 4 }, inner: { min: 0, max: 0.95 }, core: { min: 0, max: 2 },
    sides: { min: 3, max: 8 }, rounding: { min: 0, max: 1 },
  },
  motion: {
    speed: { min: 0, max: 3 }, phase: { min: 0, max: 360 }, amplitude: { min: 0, max: 0.5 }, frequency: { min: 0.1, max: 4 },
    smoothness: { min: 0, max: 1 }, randomness: { min: 0, max: 1 }, influence: { min: 0, max: 1 },
    damping: { min: 0, max: 1 }, loop: { min: 0, max: 60 }, delay: { min: 0, max: 10 }, sync: { min: 0, max: 1 }, groups: { min: 0, max: 6 },
    curve: { x: { min: 0, max: 1 }, y: { min: -1, max: 2 } },
  },
  stage: {
    scale: { min: 0.2, max: 8 }, intensity: { min: 0, max: 2 }, octaves: { min: 1, max: 6 },
    lacunarity: { min: 1.2, max: 3.5 }, persistence: { min: 0.2, max: 0.9 }, frequency: { min: 0.2, max: 12 },
    turbulence: { min: 0, max: 1 }, speed: { min: 0, max: 2 }, direction: { min: -180, max: 180 },
  },
  color: {
    cycleSpeed: { min: -2, max: 2 }, variance: { min: 0, max: 1 }, hue: { min: -180, max: 180 },
    saturation: { min: 0, max: 2 }, exposure: { min: -2, max: 2 }, contrast: { min: 0.4, max: 2 }, temperature: { min: -1, max: 1 },
    chromaPreserve: { min: 0, max: 1 },
  },
  interaction: {
    radius: { min: 0.05, max: 0.8 }, strength: { min: 0, max: 2 }, response: { min: 0.5, max: 20 },
    direction: { min: -180, max: 180 }, velocity: { min: 0, max: 2 }, pressure: { min: 0, max: 2 }, persistence: { min: 0, max: 1 },
    affect: { min: 0, max: 1 },
  },
  mesh: { core: { min: 0, max: 100 }, opacity: { min: 0, max: 1 } },
  layer: {
    opacity: { min: 0, max: 1 }, strength: { min: 0.1, max: 3 }, radius: { min: 0.2, max: 3 }, falloff: { min: 0, max: 1 },
    count: { min: 1, max: PROC_MAX_FIELD_POINTS }, pointRadius: { min: 0.05, max: 0.9 }, spread: { min: 0.2, max: 1.3 },
  },
  material: {
    radius: { min: 0, max: 1 }, glow: { min: 0, max: 1.5 }, bloom: { min: 0, max: 1.5 }, bloomThreshold: { min: 0, max: 1 },
    innerGlow: { min: 0, max: 1.5 }, edgeGlow: { min: 0, max: 1.5 }, ambient: { min: 0, max: 1 }, light: { min: 0, max: 2 },
    lightAngle: { min: -180, max: 180 }, lightElevation: { min: 0, max: 1 }, specular: { min: 0, max: 2 }, shininess: { min: 2, max: 96 },
    depth: { min: 0, max: 3 }, shadow: { min: 0, max: 1 }, scatter: { min: 0, max: 1 },
  },
} as const;

export const DEFAULT_PROCEDURAL_STAGE: Readonly<ProceduralStage> = Object.freeze({
  type: 'none', enabled: true, noise: 'gradient', scale: 1.6, intensity: 0.35, octaves: 3, lacunarity: 2, persistence: 0.5,
  frequency: 3, turbulence: 0.3, speed: 0.4, direction: 0, target: 'layer',
});

export const DEFAULT_FIELD_LAYER: Readonly<ProceduralFieldLayer> = Object.freeze({
  enabled: true, kernel: 'gaussian', blend: 'screen', opacity: 0.8, strength: 1, radius: 0.7, falloff: 0.5, count: 2,
  distribution: 'random', pointRadius: 0.22, spread: 0.8, colors: ['#ffd9a0'], distort: true,
}) as Readonly<ProceduralFieldLayer>;

export const DEFAULT_PROCEDURAL_MATERIAL: Readonly<ProceduralMaterial> = Object.freeze({
  enabled: false, radius: 0.4, glow: 0, bloom: 0, bloomThreshold: 0.6, innerGlow: 0, edgeGlow: 0, ambient: 0.55, light: 0,
  lightAngle: 135, lightElevation: 0.6, specular: 0, shininess: 28, depth: 1, shadow: 0, scatter: 0,
}) as Readonly<ProceduralMaterial>;

export const DEFAULT_PROCEDURAL_MESH: Readonly<ProceduralMeshConfig> = Object.freeze({
  source: 'snapshot', render: 'unified-field', composite: 'background', base: '', core: 40, opacity: 1,
});

export const DEFAULT_PROCEDURAL: Readonly<ProceduralConfig> = Object.freeze({
  version: PROCEDURAL_VERSION,
  enabled: false,
  mode: 'full',
  seed: 1337,
  mix: 1,
  points: { min: 5, max: 8, density: 0.5, distribution: 'organic', spacing: 0.35, spread: 0.9, influence: 1, radius: 0.42, weight: 1, variance: 0.35 },
  field: {
    method: 'gaussian', radius: 1, strength: 1, falloff: 0.45, softness: 0.5, exponent: 2, overlap: 0.7, base: '', global: 0,
    custom: { gaussian: 0.6, compact: 0.3, inverse: 0.1 },
  },
  fields: [],
  material: { ...DEFAULT_PROCEDURAL_MATERIAL },
  influence: { shape: 'circle', rotation: 0, anisotropy: 1, inner: 0, core: 0, sides: 6, rounding: 0.2 },
  motion: {
    type: 'drift', mixed: false, speed: 0.6, direction: 1, phase: 0, amplitude: 0.1, frequency: 1, smoothness: 0.6, randomness: 0.4, influence: 1,
    easing: 'smooth', curve: [0.42, 0, 0.58, 1] as [number, number, number, number], damping: 0.5, loop: 0, delay: 0, sync: 0, groups: 0,
  },
  distortion: [
    { ...DEFAULT_PROCEDURAL_STAGE, type: 'warp' },
    { ...DEFAULT_PROCEDURAL_STAGE },
    { ...DEFAULT_PROCEDURAL_STAGE },
  ],
  color: {
    source: 'layer', colors: ['#7c5cff', '#22d3ee', '#f472b6', '#fbbf24'], interpolation: 'oklab', hueDirection: 'shorter', chromaPreserve: 0,
    cycleSpeed: 0, shuffle: false, variance: 0.15,
    hue: 0, saturation: 1, exposure: 0, contrast: 1, temperature: 0,
  },
  interaction: {
    force: 'swirl', radius: 0.32, strength: 0.7, falloff: 'soft', response: 6,
    direction: 0, velocity: 0, pressure: 0.6, persistence: 0,
    affect: { position: 1, radius: 0, strength: 0, saturation: 0, hue: 0, speed: 0 },
  },
  mesh: { ...DEFAULT_PROCEDURAL_MESH },
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
    target: normalizeTarget(pick(value.target, STAGE_TARGETS, fallback.target), pick(value.type, DISTORTION_TYPES, fallback.type)),
  };
}

/** A colour-target stage reads the stage's displacement as a colour offset. Rotate and scale displace linearly with the
 *  distance from the centre (a huge, meaningless offset), so they fall back to moving the field instead. */
function normalizeTarget(target: StageTarget, type: DistortionType): StageTarget {
  return target === 'color' && (type === 'rotate' || type === 'scale') ? 'field' : target;
}

function normalizeAnchor(anchor: Record<string, unknown>): ProceduralAnchor {
  const out: ProceduralAnchor = {
    x: num(anchor.x, -0.5, 1.5, 0.5),
    y: num(anchor.y, -0.5, 1.5, 0.5),
    color: hex(anchor.color, '#ffffff'),
    radius: num(anchor.radius, 0.05, 1.5, 0.35),
    weight: num(anchor.weight, 0, 3, 1),
  };
  // mesh data is written only when present, so an anchor from an old project round-trips unchanged
  if (anchor.alpha !== undefined) out.alpha = num(anchor.alpha, 0, 1, 1);
  if (anchor.core !== undefined) out.core = num(anchor.core, 0, 100, 40);
  if (anchor.size !== undefined) out.size = num(anchor.size, 0.5, 200, 48);
  // influence overrides are written only when present, so an anchor from an old project round-trips unchanged
  if (anchor.shape !== undefined) out.shape = pick(anchor.shape, INFLUENCE_SHAPES, 'circle');
  if (anchor.rotation !== undefined) out.rotation = num(anchor.rotation, PROC_RANGES.influence.rotation.min, PROC_RANGES.influence.rotation.max, 0);
  if (anchor.anisotropy !== undefined) out.anisotropy = num(anchor.anisotropy, PROC_RANGES.influence.anisotropy.min, PROC_RANGES.influence.anisotropy.max, 1);
  if (anchor.inner !== undefined) out.inner = num(anchor.inner, PROC_RANGES.influence.inner.min, PROC_RANGES.influence.inner.max, 0);
  return out;
}

function normalizeMesh(raw: unknown, base: Readonly<ProceduralMeshConfig>): ProceduralMeshConfig {
  const value = isRecord(raw) ? raw : {};
  const R = PROC_RANGES.mesh;
  return {
    source: pick(value.source, MESH_SOURCES, base.source),
    render: pick(value.render, MESH_RENDER_MODES, base.render),
    composite: pick(value.composite, MESH_COMPOSITES, base.composite),
    base: value.base === '' ? '' : hex(value.base, base.base),
    core: num(value.core, R.core.min, R.core.max, base.core),
    opacity: num(value.opacity, R.opacity.min, R.opacity.max, base.opacity),
  };
}

export function normalizeFieldLayer(raw: unknown, fallback: Readonly<ProceduralFieldLayer> = DEFAULT_FIELD_LAYER): ProceduralFieldLayer {
  const value = isRecord(raw) ? raw : {};
  const R = PROC_RANGES.layer;
  const colors = Array.isArray(value.colors)
    ? value.colors.filter((item): item is string => typeof item === 'string' && HEX.test(item)).slice(0, 4).map(item => item.toLowerCase())
    : [];
  return {
    enabled: value.enabled === undefined ? fallback.enabled : value.enabled !== false,
    kernel: pick(value.kernel, LAYER_KERNELS, fallback.kernel),
    blend: pick(value.blend, FIELD_BLEND_OPS, fallback.blend),
    opacity: num(value.opacity, R.opacity.min, R.opacity.max, fallback.opacity),
    strength: num(value.strength, R.strength.min, R.strength.max, fallback.strength),
    radius: num(value.radius, R.radius.min, R.radius.max, fallback.radius),
    falloff: num(value.falloff, R.falloff.min, R.falloff.max, fallback.falloff),
    count: Math.round(num(value.count, R.count.min, R.count.max, fallback.count)),
    distribution: pick(value.distribution, POINT_DISTRIBUTIONS, fallback.distribution),
    pointRadius: num(value.pointRadius, R.pointRadius.min, R.pointRadius.max, fallback.pointRadius),
    spread: num(value.spread, R.spread.min, R.spread.max, fallback.spread),
    colors: colors.length ? colors : [...fallback.colors],
    distort: value.distort === undefined ? fallback.distort : value.distort !== false,
  };
}

export function normalizeMaterial(raw: unknown, base: Readonly<ProceduralMaterial> = DEFAULT_PROCEDURAL_MATERIAL): ProceduralMaterial {
  const value = isRecord(raw) ? raw : {};
  const R = PROC_RANGES.material;
  const n = (key: keyof typeof R) => num(value[key], R[key].min, R[key].max, base[key] as number);
  return {
    enabled: value.enabled === undefined ? base.enabled : value.enabled === true,
    radius: n('radius'), glow: n('glow'), bloom: n('bloom'), bloomThreshold: n('bloomThreshold'), innerGlow: n('innerGlow'),
    edgeGlow: n('edgeGlow'), ambient: n('ambient'), light: n('light'), lightAngle: n('lightAngle'), lightElevation: n('lightElevation'),
    specular: n('specular'), shininess: n('shininess'), depth: n('depth'), shadow: n('shadow'), scatter: n('scatter'),
  };
}

/** Validates / repairs any input (an old project, an imported preset, a half-filled patch). Never throws. */
export function normalizeProcedural(raw: unknown, base: Readonly<ProceduralConfig> = DEFAULT_PROCEDURAL): ProceduralConfig {
  const value = isRecord(raw) ? raw : {};
  const points = isRecord(value.points) ? value.points : {};
  const field = isRecord(value.field) ? value.field : {};
  const custom = isRecord(field.custom) ? field.custom : {};
  const influence = isRecord(value.influence) ? value.influence : {};
  const motion = isRecord(value.motion) ? value.motion : {};
  const color = isRecord(value.color) ? value.color : {};
  const interaction = isRecord(value.interaction) ? value.interaction : {};
  const affect = isRecord(interaction.affect) ? interaction.affect : {};
  const curve = Array.isArray(motion.curve) ? motion.curve : [];
  const R = PROC_RANGES;
  const bp = base.points, bf = base.field, bm = base.motion, bc = base.color, bi = base.interaction;
  const bmc = bm.curve ?? DEFAULT_PROCEDURAL.motion.curve;
  const ba = bi.affect ?? DEFAULT_PROCEDURAL.interaction.affect;
  const bn = base.influence ?? DEFAULT_PROCEDURAL.influence;

  const min = Math.round(num(points.min, R.points.min.min, R.points.min.max, bp.min));
  const max = Math.max(min, Math.round(num(points.max, R.points.max.min, R.points.max.max, bp.max)));
  const stagesRaw = Array.isArray(value.distortion) ? value.distortion : [];
  const distortion = Array.from({ length: PROC_MAX_STAGES }, (_, index) => normalizeStage(stagesRaw[index], base.distortion[index] ?? { ...DEFAULT_PROCEDURAL_STAGE }));
  const customColors = Array.isArray(color.colors)
    ? color.colors.filter((item): item is string => typeof item === 'string' && HEX.test(item)).slice(0, 8).map(item => item.toLowerCase())
    : [];
  const anchors = Array.isArray(value.anchors)
    ? value.anchors.filter(isRecord).slice(0, PROC_MAX_MESH_POINTS).map(normalizeAnchor)
    : base.anchors.map(anchor => ({ ...anchor }));
  const origin = isRecord(value.origin) && typeof value.origin.from === 'string'
    ? { from: value.origin.from.slice(0, 60), note: typeof value.origin.note === 'string' ? value.origin.note.slice(0, 400) : '' }
    : value.origin === null ? null : base.origin ? { ...base.origin } : null;
  const locks = Array.isArray(value.locks)
    ? [...new Set(value.locks.filter((item): item is string => typeof item === 'string' && /^[a-z]+(\.[a-zA-Z]+)?$/.test(item)))].slice(0, 64)
    : [...base.locks];

  return {
    version: PROCEDURAL_VERSION,
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
      global: num(field.global, R.field.global.min, R.field.global.max, bf.global ?? 0),
      custom: {
        gaussian: num(custom.gaussian, R.field.custom.min, R.field.custom.max, bf.custom?.gaussian ?? 0.6),
        compact: num(custom.compact, R.field.custom.min, R.field.custom.max, bf.custom?.compact ?? 0.3),
        inverse: num(custom.inverse, R.field.custom.min, R.field.custom.max, bf.custom?.inverse ?? 0.1),
      },
    },
    influence: {
      shape: pick(influence.shape, INFLUENCE_SHAPES, bn.shape),
      rotation: num(influence.rotation, R.influence.rotation.min, R.influence.rotation.max, bn.rotation),
      anisotropy: num(influence.anisotropy, R.influence.anisotropy.min, R.influence.anisotropy.max, bn.anisotropy),
      inner: num(influence.inner, R.influence.inner.min, R.influence.inner.max, bn.inner),
      core: num(influence.core, R.influence.core.min, R.influence.core.max, bn.core),
      sides: Math.round(num(influence.sides, R.influence.sides.min, R.influence.sides.max, bn.sides ?? 6)),
      rounding: num(influence.rounding, R.influence.rounding.min, R.influence.rounding.max, bn.rounding ?? 0.2),
    },
    fields: Array.isArray(value.fields)
      ? value.fields.filter(isRecord).slice(0, PROC_MAX_FIELDS).map(item => normalizeFieldLayer(item))
      : (base.fields ?? []).map(item => normalizeFieldLayer(item)),
    material: normalizeMaterial(value.material, base.material ?? DEFAULT_PROCEDURAL_MATERIAL),
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
      easing: pick(motion.easing, MOTION_EASINGS, bm.easing ?? 'smooth'),
      curve: [
        num(curve[0], R.motion.curve.x.min, R.motion.curve.x.max, bmc[0]),
        num(curve[1], R.motion.curve.y.min, R.motion.curve.y.max, bmc[1]),
        num(curve[2], R.motion.curve.x.min, R.motion.curve.x.max, bmc[2]),
        num(curve[3], R.motion.curve.y.min, R.motion.curve.y.max, bmc[3]),
      ],
      damping: num(motion.damping, R.motion.damping.min, R.motion.damping.max, bm.damping ?? 0.5),
      loop: num(motion.loop, R.motion.loop.min, R.motion.loop.max, bm.loop ?? 0),
      delay: num(motion.delay, R.motion.delay.min, R.motion.delay.max, bm.delay ?? 0),
      sync: num(motion.sync, R.motion.sync.min, R.motion.sync.max, bm.sync ?? 0),
      groups: Math.round(num(motion.groups, R.motion.groups.min, R.motion.groups.max, bm.groups ?? 0)),
    },
    distortion,
    color: {
      source: pick(color.source, COLOR_SOURCES, bc.source),
      colors: customColors.length ? customColors : [...bc.colors],
      interpolation: pick(color.interpolation, COLOR_SPACES, bc.interpolation),
      hueDirection: pick(color.hueDirection, HUE_DIRECTIONS, bc.hueDirection ?? 'shorter'),
      chromaPreserve: num(color.chromaPreserve, R.color.chromaPreserve.min, R.color.chromaPreserve.max, bc.chromaPreserve ?? 0),
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
      direction: num(interaction.direction, R.interaction.direction.min, R.interaction.direction.max, bi.direction ?? 0),
      velocity: num(interaction.velocity, R.interaction.velocity.min, R.interaction.velocity.max, bi.velocity ?? 0),
      pressure: num(interaction.pressure, R.interaction.pressure.min, R.interaction.pressure.max, bi.pressure ?? 0.6),
      persistence: num(interaction.persistence, R.interaction.persistence.min, R.interaction.persistence.max, bi.persistence ?? 0),
      affect: {
        position: num(affect.position, R.interaction.affect.min, R.interaction.affect.max, ba.position),
        radius: num(affect.radius, R.interaction.affect.min, R.interaction.affect.max, ba.radius),
        strength: num(affect.strength, R.interaction.affect.min, R.interaction.affect.max, ba.strength),
        saturation: num(affect.saturation, R.interaction.affect.min, R.interaction.affect.max, ba.saturation),
        hue: num(affect.hue, R.interaction.affect.min, R.interaction.affect.max, ba.hue),
        speed: num(affect.speed, R.interaction.affect.min, R.interaction.affect.max, ba.speed),
      },
    },
    mesh: normalizeMesh(value.mesh, base.mesh ?? DEFAULT_PROCEDURAL_MESH),
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

/* ─────────────── validation, unknown fields, version migration ─────────────── */

export interface ProceduralIssue {
  /** property path, for example `field.exponent` or `distortion[1].type` ('' = the whole document) */
  path: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ProceduralValidation {
  /** always usable: invalid or missing values were repaired with their defaults */
  config: ProceduralConfig;
  issues: ProceduralIssue[];
  /** the version the input declared when it was older than the current one (null = already current or not a config) */
  migratedFrom: number | null;
}

const sameValue = (raw: unknown, repaired: unknown): boolean => {
  if (typeof repaired === 'number') {
    const asNumber = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    return Number.isFinite(asNumber) && Math.abs(asNumber - repaired) < 1e-9;
  }
  if (typeof repaired === 'string') return typeof raw === 'string' && raw.toLowerCase() === repaired.toLowerCase();
  if (typeof repaired === 'boolean') return raw === repaired;
  return true;
};

function compareNodes(raw: unknown, repaired: unknown, path: string, out: ProceduralIssue[]): void {
  if (isRecord(repaired)) {
    if (!isRecord(raw)) { out.push({ path, severity: 'warning', message: `${path || 'The document'} should be an object; the defaults were used.` }); return; }
    for (const key of Object.keys(raw)) {
      const child = path ? `${path}.${key}` : key;
      if (!(key in repaired)) {
        if (!(path === '' && (key === 'version' || key === 'format' || key === 'name'))) out.push({ path: child, severity: 'warning', message: `Unknown option “${child}” was ignored.` });
        continue;
      }
      if (key === 'origin' || key === 'locks' || (path === '' && key === 'version')) continue;
      compareNodes(raw[key], repaired[key], child, out);
    }
    return;
  }
  if (Array.isArray(repaired)) {
    if (!Array.isArray(raw)) { if (raw !== undefined) out.push({ path, severity: 'warning', message: `${path} should be a list; the default list was used.` }); return; }
    if (path === 'distortion' || path === 'anchors' || path === 'fields') {
      raw.forEach((item, index) => { if (index < repaired.length) compareNodes(item, repaired[index], `${path}[${index}]`, out); });
      if (raw.length > repaired.length && path === 'distortion') out.push({ path, severity: 'warning', message: `Only ${repaired.length} distortion stages exist; the extra ones were ignored.` });
      if (raw.length > PROC_MAX_FIELDS && path === 'fields') out.push({ path, severity: 'warning', message: `Only ${PROC_MAX_FIELDS} extra fields exist; the extra ones were ignored.` });
    } else if (path === 'color.colors' && raw.some(item => typeof item !== 'string' || !HEX.test(item))) {
      out.push({ path, severity: 'warning', message: 'Colours must be #rrggbb; invalid entries were dropped.' });
    }
    return;
  }
  if (raw !== undefined && !sameValue(raw, repaired)) {
    out.push({ path, severity: 'warning', message: `${path}: ${JSON.stringify(raw)} is not valid here; using ${JSON.stringify(repaired)}.` });
  }
}

/** Validates any input and explains what was repaired. Never throws; the returned config is always safe to render.
 *  Unknown options are reported and dropped; a missing or older `version` is migrated by filling the new options with defaults. */
export function validateProcedural(raw: unknown): ProceduralValidation {
  const issues: ProceduralIssue[] = [];
  if (!isRecord(raw)) {
    issues.push({ path: '', severity: 'error', message: 'Expected a JSON object with the procedural settings; the defaults were used.' });
    return { config: normalizeProcedural(null), issues, migratedFrom: null };
  }
  const declared = raw.version;
  let migratedFrom: number | null = null;
  if (declared === undefined || declared === 1) {
    migratedFrom = 1;
    issues.push({ path: 'version', severity: 'info', message: `Upgraded from version 1 to ${PROCEDURAL_VERSION}: the new options (influence shapes, new field methods, OKLCH, distortion targets) take their defaults, so the look is unchanged.` });
  } else if (typeof declared === 'number' && declared > PROCEDURAL_VERSION) {
    issues.push({ path: 'version', severity: 'warning', message: `This configuration was written by a newer version (${declared}); options this version does not know were ignored.` });
  } else if (declared !== PROCEDURAL_VERSION) {
    issues.push({ path: 'version', severity: 'warning', message: `Unrecognised version ${JSON.stringify(declared)}; it was read as version ${PROCEDURAL_VERSION}.` });
  }
  const config = normalizeProcedural(raw);
  compareNodes(raw, config, '', issues);
  return { config, issues, migratedFrom };
}

/** `parseProcedural` with the issue report; a syntax error is reported as an error issue instead of returning null. */
export function parseProceduralDetailed(json: string): ProceduralValidation {
  try {
    return validateProcedural(JSON.parse(json) as unknown);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unreadable text';
    return { config: normalizeProcedural(null), migratedFrom: null, issues: [{ path: '', severity: 'error', message: `Not valid JSON (${reason}); the defaults were used.` }] };
  }
}

/* ─────────────── point capacity ─────────────── */

/** The smallest compiled tier that holds `count` centres (never below the original 12, never above the mesh maximum). */
export function tierFor(count: number): number {
  const wanted = Math.max(1, Math.ceil(Number.isFinite(count) ? count : 1));
  return PROC_POINT_TIERS.find(tier => tier >= wanted) ?? PROC_POINT_TIERS[PROC_POINT_TIERS.length - 1];
}

type CapacityInput = {
  points?: { min: number; max: number; density: number };
  anchors?: readonly unknown[];
  mesh?: { source: string; render: string };
  fields?: readonly { enabled: boolean; count: number }[];
};

/** The extra fields that are drawn: enabled ones, at most PROC_MAX_FIELDS, never in the CSS-compatible mesh (it has its own sampler). */
export function activeFieldLayers<T extends { enabled: boolean }>(config: { fields?: readonly T[]; mesh?: { render: string } } | null | undefined): T[] {
  if (!config?.fields?.length || config.mesh?.render === 'css-compatible') return [];
  return config.fields.slice(0, PROC_MAX_FIELDS).filter(layer => layer.enabled);
}

/** How many centres a config needs: generated ones (min…max by density) or its pinned anchors, whichever is more. */
export function proceduralNeed(config: CapacityInput | null | undefined): number {
  if (!config) return 1;
  const extra = activeFieldLayers(config).reduce((sum, layer) => sum + Math.min(PROC_MAX_FIELD_POINTS, Math.max(1, Math.round(layer.count))), 0);
  if (config.anchors?.length && config.mesh && (config.mesh.source === 'layer' || config.mesh.render === 'css-compatible')) return config.anchors.length + extra;
  const p = config.points;
  const generated = p ? Math.min(PROC_MAX_POINTS, Math.max(1, Math.round(p.min + (p.max - p.min) * Math.min(1, Math.max(0, p.density))))) : 1;
  return Math.max(generated, config.anchors?.length ?? 0) + extra;
}

/** The loop size the shader is compiled with for this config. */
export const proceduralCapacity = (config: CapacityInput | null | undefined): number => tierFor(proceduralNeed(config));

export interface CapacityPlan {
  /** centres the config wants to draw */
  requested: number;
  /** the compiled tier needed for them */
  capacity: number;
  /** the largest tier this GPU can hold next to the rest of the shader */
  supported: number;
  /** true when `requested` does not fit: the layer must fall back to the CSS mesh (nothing is deleted) */
  overflow: boolean;
  message: string;
}

/** Chooses a point-storage strategy from the GPU's fragment-uniform limit. Uniform arrays are used (two vec4 per centre),
 *  in tiers, so changing the number of points inside a tier never recompiles. 0 / unknown = assume a desktop-class limit. */
export function planPointCapacity(requested: number, maxFragmentUniformVectors: number, vectorsPerPoint = 2): CapacityPlan {
  const limit = maxFragmentUniformVectors > 0 ? maxFragmentUniformVectors : 1024;
  const room = Math.max(0, limit - PROC_UNIFORM_RESERVE);
  const perPoint = Math.max(2, Math.round(vectorsPerPoint));
  const fits = PROC_POINT_TIERS.filter(tier => tier * perPoint <= room);
  const supported = fits.length ? fits[fits.length - 1] : PROC_POINT_TIERS[0];
  const want = Math.max(1, Math.round(requested));
  const capacity = tierFor(want);
  const overflow = want > supported;
  return {
    requested: want, capacity, supported, overflow,
    message: overflow
      ? `This device can draw ${supported} mesh points in WebGL${perPoint > 2 ? ' with these settings' : ''} and this mesh has ${want}. Showing the CSS mesh instead; all ${want} points are kept.`
      : '',
  };
}

type InfluenceInput = { influence?: ProceduralConfig['influence']; anchors?: readonly { shape?: string }[] };
type FeatureInput = InfluenceInput & {
  mesh?: { render: string };
  fields?: readonly { enabled: boolean; count: number }[];
  material?: ProceduralMaterial;
  field?: Pick<ProceduralConfig['field'], 'method'>;
  color?: Pick<ProceduralConfig['color'], 'interpolation'> & Partial<Pick<ProceduralConfig['color'], 'chromaPreserve'>>;
};
type SignatureInput = Pick<ProceduralConfig, 'enabled' | 'distortion'> & CapacityInput & FeatureInput;

/** True when the unified field is what draws (the CSS-compatible mesh has its own sampler and uses none of the options below). */
const drawsUnifiedField = (config: { mesh?: { render: string } }) => config.mesh?.render !== 'css-compatible';

/** True when some point's reach is not the default round one, or the reach has a flat core / extra core weight. Only then does the
 *  shader carry the shaped-distance code and the per-point shape uniform. */
export function usesInfluence(config: (InfluenceInput & { mesh?: { render: string } }) | null | undefined): boolean {
  if (!config || !drawsUnifiedField(config)) return false;
  const base = config.influence;
  const baseShaped = !!base && (base.shape !== 'circle' || base.inner > 0 || base.core > 0);
  const anchorShaped = !!config.anchors?.some(anchor => anchor.shape !== undefined && anchor.shape !== 'circle');
  return baseShaped || anchorShaped;
}

/** The parts of the field shader that are compiled in only when a config needs them. */
export interface FieldFeatures {
  /** the one interpolation method this shader contains (switching method rebuilds; moving a slider never does) */
  method: FieldMethod;
  family: FieldFamily;
  /** shaped influence: the per-point shape uniform and the shaped-distance code */
  shaped: boolean;
  /** OKLCH blending with a hue reference pass (not for exact RBF, which interpolates numbers, not angles) */
  lch: boolean;
  /** chroma preservation after an OKLab blend */
  chroma: boolean;
  /** extra fields composited over the primary one (0…3) */
  layers: number;
  /** the lighting / glow stage (its taps re-sample the whole field, so it is compiled in only when an effect is on) */
  material: boolean;
}

/** True when the material stage would change the picture. A material that is enabled but has every effect at 0 compiles nothing. */
export function materialActive(config: { material?: ProceduralMaterial; mesh?: { render: string } } | null | undefined): boolean {
  const m = config?.material;
  if (!m || !m.enabled || config?.mesh?.render === 'css-compatible') return false;
  return m.glow > 0 || m.bloom > 0 || m.innerGlow > 0 || m.edgeGlow > 0 || m.light > 0 || m.specular > 0 || m.shadow > 0 || m.scatter > 0;
}

export function fieldFeatures(config: FeatureInput | null | undefined): FieldFeatures {
  const unified = !!config && drawsUnifiedField(config);
  const method: FieldMethod = unified && config?.field ? config.field.method : 'gaussian';
  const family = fieldFamily(method);
  const space = unified ? config?.color?.interpolation : undefined;
  return {
    method,
    family,
    shaped: unified && family !== 'rbf' && usesInfluence(config),
    lch: unified && family !== 'rbf' && space === 'oklch',
    chroma: unified && family !== 'rbf' && space === 'oklab' && (config?.color?.chromaPreserve ?? 0) > 0,
    layers: activeFieldLayers(config).length,
    material: materialActive(config),
  };
}

/** Vec4 uniforms each colour centre costs: position, colour, plus one for a shape record and one for an RBF coefficient. */
export function proceduralVectorsPerPoint(config: FeatureInput | null | undefined): number {
  const f = fieldFeatures(config);
  return 2 + (f.shaped ? 1 : 0) + (f.family === 'rbf' ? 1 : 0);
}

/** Rough relative cost of the compiled field, for the panel's performance readout (1 = the original single Gaussian field). */
export function estimateProceduralCost(config: (FeatureInput & Pick<ProceduralConfig, 'distortion'> & CapacityInput) | null | undefined): { score: number; level: 'low' | 'medium' | 'high' | 'extreme' } {
  if (!config) return { score: 0, level: 'low' };
  const f = fieldFeatures(config);
  const points = proceduralNeed(config);
  let perPoint = 1;
  if (f.family === 'cells') perPoint = 2.2;
  if (f.family === 'rbf') perPoint = 1.2;
  if (f.shaped) perPoint += 0.5;
  if (config.field?.method === 'smin') perPoint = 2;
  let score = (points / 8) * perPoint;
  if (f.lch) score *= 1.15;
  const stages = config.distortion.filter(stage => stage.type !== 'none' && stage.enabled);
  score += stages.reduce((sum, stage) => sum + (stage.type === 'multiwarp' ? 1.5 : stage.type === 'warp' || stage.type === 'curl' ? 0.9 : 0.4)
    * (stage.target === 'points' ? Math.max(1, points / 2) : 1), 0);
  score *= 1 + 0.55 * f.layers;
  if (f.material) score *= 4.2;
  const level = score < 2.5 ? 'low' : score < 6 ? 'medium' : score < 14 ? 'high' : 'extreme';
  return { score: Math.round(score * 10) / 10, level };
}

/** The compiled shader depends on which distortion types (and targets) are present — their numbers are uniforms — on the point
 *  tier, and on optional feature blocks compiled in only when used: the chosen interpolation method (the default Gaussian adds
 *  nothing to the key), shaped influence, the OKLCH hue path and chroma preservation. Moving any slider, toggling a stage on / off
 *  or changing a value inside a feature never recompiles. */
export function proceduralSignature(config: SignatureInput | null | undefined): string {
  if (!config || !config.enabled) return 'off';
  const capacity = proceduralCapacity(config);
  const stages = config.distortion.slice(0, PROC_MAX_STAGES)
    .map(stage => `${stage.type}${stage.type !== 'none' && stage.target && stage.target !== 'layer' ? `@${stage.target[0]}` : ''}`).join(',');
  const flags: string[] = [];
  if (capacity > PROC_MAX_POINTS) flags.push(`p${capacity}`);
  const f = fieldFeatures(config);
  if (f.method !== 'gaussian') flags.push(`m${f.method}`);
  if (f.shaped) flags.push('shape');
  if (f.lch) flags.push('lch');
  if (f.chroma) flags.push('cp');
  if (f.layers) flags.push(`fx${f.layers}`);
  if (f.material) flags.push('mat');
  return `on:${stages}${flags.length ? `|${flags.join('|')}` : ''}`;
}

export const isProceduralActive = (config: Pick<ProceduralConfig, 'enabled'> | null | undefined): boolean => !!config && config.enabled === true;

/** True when the centres come from a mesh (live link or a converted snapshot). */
export const isMeshSourced = (config: Pick<ProceduralConfig, 'mesh' | 'origin'> | null | undefined): boolean =>
  !!config && (config.mesh.source === 'layer' || config.origin?.from === 'mesh');

/** Uniform names the procedural shader code declares (arrays as `name[0]`). Listed here, not in glsl.ts, so the shared
 *  uniform list can include them without importing the GLSL generator. */
export const PROCEDURAL_UNIFORM_NAMES = [
  'uProcPoints[0]', 'uProcColors[0]', 'uProcA', 'uProcB', 'uProcC', 'uProcGrade', 'uProcD', 'uProcBase', 'uProcE',
  'uProcWarpA[0]', 'uProcWarpB[0]', 'uProcWarpC[0]',
  'uProcF', 'uProcG', 'uProcH', 'uProcShape[0]', 'uProcRbf[0]', 'uProcRbfP[0]', 'uProcRbfR[0]',
  'uProcFieldA[0]', 'uProcFieldB[0]', 'uProcFieldC[0]', 'uProcM0', 'uProcM1', 'uProcM2', 'uProcM3',
] as const;
