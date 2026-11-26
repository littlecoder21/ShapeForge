/* Motion engine — configuration model.
 *
 * One serialisable object (`MotionConfig`) describes every motion system: flow sources, composition, physics, organic
 * drift, turbulence, modulation, pointer interaction, paths and time. It is additive and optional inside the project's
 * shader settings (`InteractiveSettings.motion`): a project without it renders exactly as before.
 *
 * Everything here is plain data. The maths that gives the data meaning lives in two places that must agree:
 *   motionRuntime.js  – time, physics, modulation, interaction state and uniform packing (also embedded in exports)
 *   glsl.ts           – the GPU field evaluation (generated only for the features a config uses)
 * and motionField.js is the CPU twin of the GPU field (editor overlay + tests).
 *
 * `normalizeMotion` never throws: unknown keys are dropped, bad values fall back to the defaults, and old versions are
 * migrated, so a damaged preset or project file cannot crash the studio. */

export const MOTION_VERSION = 1;
export const MOTION_FORMAT = 'shapeforge-motion';

export const MOTION_LIMITS = { sources: 8, modulators: 6, paths: 2, pathPoints: 8, curvePoints: 8, userProfiles: 24 } as const;

export const FLOW_TYPES = ['directional', 'curved', 'vortex', 'spiral', 'radial', 'wave', 'noise', 'curl', 'magnetic', 'path'] as const;
export type FlowType = typeof FLOW_TYPES[number];
export const FLOW_TYPE_ID: Record<FlowType, number> = { directional: 0, curved: 1, vortex: 2, spiral: 3, radial: 4, wave: 5, noise: 6, curl: 7, magnetic: 8, path: 9 };
export const FLOW_TYPE_LABEL: Record<FlowType, string> = {
  directional: 'Directional', curved: 'Curved', vortex: 'Vortex', spiral: 'Spiral', radial: 'Radial', wave: 'Wave', noise: 'Noise', curl: 'Curl', magnetic: 'Magnetic', path: 'Path',
};

export const FALLOFFS = ['hard', 'linear', 'smooth', 'gauss', 'inverse', 'ring'] as const;
export type Falloff = typeof FALLOFFS[number];
export const FALLOFF_ID: Record<Falloff, number> = { hard: 0, linear: 1, smooth: 2, gauss: 3, inverse: 4, ring: 5 };

export const BLENDS = ['add', 'screen', 'difference', 'override', 'max'] as const;
export type Blend = typeof BLENDS[number];
export const BLEND_ID: Record<Blend, number> = { add: 0, screen: 1, difference: 2, override: 3, max: 4 };

export const COMPOSITIONS = ['additive', 'weighted', 'average', 'normalized', 'maximum', 'dominant', 'soft', 'priority'] as const;
export type Composition = typeof COMPOSITIONS[number];
export const COMPOSITION_LABEL: Record<Composition, string> = {
  additive: 'Additive', weighted: 'Weighted', average: 'Average', normalized: 'Normalized', maximum: 'Maximum influence', dominant: 'Dominant source', soft: 'Soft blend', priority: 'Priority',
};

export const WAVE_PATTERNS = ['Horizontal', 'Vertical', 'Diagonal', 'Circular', 'Radial', 'Traveling', 'Interference'] as const;

export const PHYSICS_MODELS = ['linear', 'smooth', 'ease-in', 'ease-out', 'ease-in-out', 'spring', 'elastic', 'inertial', 'damped', 'momentum', 'viscous', 'fluid', 'heavy', 'light', 'custom'] as const;
export type PhysicsModel = typeof PHYSICS_MODELS[number];

export const TURBULENCE_KINDS = ['simple', 'fractal', 'warped', 'multiscale', 'directional', 'aligned', 'animated'] as const;
export type TurbulenceKind = typeof TURBULENCE_KINDS[number];
export const TURBULENCE_KIND_ID: Record<TurbulenceKind, number> = { simple: 0, fractal: 1, warped: 2, multiscale: 3, directional: 4, aligned: 5, animated: 6 };

export const MOD_SHAPES = ['sine', 'cosine', 'triangle', 'sawtooth', 'pulse', 'smooth-pulse', 'noise', 'random-smooth', 'random-stepped', 'envelope', 'curve', 'circular', 'ping-pong', 'beat'] as const;
export type ModShape = typeof MOD_SHAPES[number];
export const MOD_BLENDS = ['add', 'multiply', 'replace', 'clamp', 'min', 'max', 'smooth'] as const;
export type ModBlend = typeof MOD_BLENDS[number];

export const INTERACTION_RESPONSES = ['attract', 'repel', 'vortex', 'orbit', 'flow', 'direction', 'turbulence', 'distortion', 'warp', 'displacement', 'ripple', 'push', 'pull', 'stir', 'magnetic', 'follow', 'trail', 'wake'] as const;
export type InteractionResponse = typeof INTERACTION_RESPONSES[number];
export const INTERACTION_RESPONSE_ID: Record<InteractionResponse, number> = Object.fromEntries(INTERACTION_RESPONSES.map((id, index) => [id, index])) as Record<InteractionResponse, number>;
export const INTERACTION_PROFILES = ['gentle', 'fluid', 'magnetic', 'vortex', 'elastic', 'repulsive', 'heavy', 'liquid', 'energetic', 'custom'] as const;
export type InteractionProfile = typeof INTERACTION_PROFILES[number];

export const QUALITY_MODES = ['auto', 'performance', 'balanced', 'high', 'ultra'] as const;
export type MotionQuality = typeof QUALITY_MODES[number];

export const PATH_KINDS = ['catmull', 'bezier', 'polyline'] as const;
export type PathKind = typeof PATH_KINDS[number];
export const LOOP_MODES = ['none', 'loop', 'pingpong'] as const;
export type LoopMode = typeof LOOP_MODES[number];

/** How the modulation targets are applied. 'mul' targets are scaled by (1 + m); 'add' targets receive m × `range`. */
export interface ModTarget { id: string; label: string; kind: 'mul' | 'add'; range?: number }
export const MOD_TARGETS: ModTarget[] = [
  { id: 'flow.strength', label: 'Flow strength', kind: 'mul' },
  { id: 'flow.direction', label: 'Flow direction', kind: 'add', range: 180 },
  { id: 'flow.speed', label: 'Flow speed', kind: 'mul' },
  { id: 'flow.curvature', label: 'Curvature', kind: 'mul' },
  { id: 'flow.vortex', label: 'Vortex strength', kind: 'mul' },
  { id: 'flow.radial', label: 'Radial strength', kind: 'mul' },
  { id: 'flow.radius', label: 'Field radius', kind: 'mul' },
  { id: 'flow.scale', label: 'Field scale', kind: 'mul' },
  { id: 'turbulence.strength', label: 'Turbulence', kind: 'mul' },
  { id: 'turbulence.warp', label: 'Warp', kind: 'mul' },
  { id: 'organic.intensity', label: 'Organic motion', kind: 'mul' },
  { id: 'distortion', label: 'Distortion', kind: 'mul' },
  { id: 'rotation', label: 'Rotation', kind: 'add', range: 0.3 },
  { id: 'zoom', label: 'Zoom', kind: 'mul' },
  { id: 'breathing', label: 'Breathing', kind: 'mul' },
  { id: 'layerOffset', label: 'Layer offset (time)', kind: 'add', range: 20 },
  { id: 'interaction.strength', label: 'Interaction strength', kind: 'mul' },
  { id: 'color', label: 'Color evolution', kind: 'add', range: 0.5 },
  { id: 'intensity', label: 'Motion intensity', kind: 'mul' },
];
export const MOD_TARGET_IDS = new Set(MOD_TARGETS.map(target => target.id));
/** Per-source targets look like `src:<sourceId>:<prop>`. */
export const SOURCE_MOD_PROPS = ['strength', 'angle', 'radius', 'scale', 'rotation', 'phase'] as const;
export type SourceModProp = typeof SOURCE_MOD_PROPS[number];
export const SOURCE_MOD_KIND: Record<SourceModProp, ModTarget> = {
  strength: { id: 'strength', label: 'Strength', kind: 'mul' },
  angle: { id: 'angle', label: 'Direction', kind: 'add', range: 180 },
  radius: { id: 'radius', label: 'Radius', kind: 'mul' },
  scale: { id: 'scale', label: 'Scale', kind: 'mul' },
  rotation: { id: 'rotation', label: 'Rotation', kind: 'add', range: 180 },
  phase: { id: 'phase', label: 'Phase', kind: 'add', range: 180 },
};

/* ───────────── ranges (shared by the validator and the sliders) ───────────── */

export type Range = readonly [number, number];
export const MOTION_RANGE = {
  global: { intensity: [0, 2], speed: [0, 4], direction: [-180, 180], flow: [0, 2], organic: [0, 2], turbulence: [0, 2], interaction: [0, 2], seed: [0, 9999] },
  composition: { maxVelocity: [0.02, 3], smoothing: [0, 1], balance: [0, 1], strength: [0, 2], cycle: [1, 60] },
  physics: { mass: [0.1, 8], stiffness: [0.05, 6], damping: [0, 4], friction: [0, 4], drag: [0, 4], elasticity: [0, 1], inertia: [0, 1], resistance: [0, 4], maxSpeed: [0.05, 8], minSpeed: [0, 2], persistence: [0, 4], impulse: [0, 2], directionInertia: [0, 1] },
  organic: { intensity: [0, 1], scale: [0.2, 6], speed: [0, 3], drift: [0, 1], variation: [0, 1], smoothness: [0, 1], phase: [0, 360], spatial: [0, 1], evolution: [0, 2], randomness: [0, 1], persistence: [0.1, 0.9], seed: [0, 9999] },
  turbulence: { strength: [0, 1], scale: [0.2, 8], speed: [0, 3], detail: [1, 6], persistence: [0.15, 0.9], lacunarity: [1.4, 3.2], warp: [0, 1], warpScale: [0.2, 6], warpDirection: [-180, 180], rotation: [-180, 180], evolution: [0, 2], influence: [0, 1], angle: [-180, 180], localX: [0, 1], localY: [0, 1], localRadius: [0, 1.5] },
  interaction: { radius: [0.04, 0.9], strength: [0, 1.5], speed: [0, 3], velocitySensitivity: [0, 2], accelerationSensitivity: [0, 2], smoothing: [0, 1], inertia: [0, 1], drag: [0, 4], persistence: [0, 4], lag: [0, 1], directionResponse: [0, 1], maxDisplacement: [0.02, 1], frequency: [0.2, 8] },
  time: { scale: [0, 4], offset: [0, 600], duration: [2, 600] },
  source: { x: [-0.25, 1.25], y: [-0.25, 1.25], angle: [-180, 180], strength: [0, 2], speed: [0, 4], radius: [0.03, 2.5], scale: [0.1, 8], rotation: [-180, 180], offsetX: [-4, 4], offsetY: [-4, 4], phase: [0, 360], evolution: [0, 2], timeScale: [0, 4], influence: [0, 1], weight: [0, 2], priority: [-8, 8] },
  modulator: { speed: [0, 4], frequency: [0.01, 8], amplitude: [0, 2], phase: [0, 360], offset: [-1, 1], min: [-2, 0], max: [0, 2], smoothness: [0, 1], seed: [0, 9999] },
} as const satisfies Record<string, Record<string, Range>>;
/** With "unlock limits" the stability caps are relaxed for intentionally extreme motion. */
export const UNLOCKED_RANGE = { maxVelocity: [0.02, 12] as Range, strength: [0, 6] as Range };

/* ───────────── model ───────────── */

export interface ParamMeta { key: 'p1' | 'p2' | 'p3' | 'p4'; label: string; min: number; max: number; step: number; hint?: string; options?: string[] }

export interface PathNode { x: number; y: number; /** bezier handles, as offsets from the node */ ix: number; iy: number; ox: number; oy: number }
export interface MotionPath {
  id: string; name: string; kind: PathKind; closed: boolean; reversed: boolean;
  points: PathNode[];
  /** 0..1 smoothing of the sampled curve */
  smoothing: number;
  /** wobble of the control points over time (screen fraction) and its rate */
  evolve: number; evolveSpeed: number;
  offsetX: number; offsetY: number;
}
export interface SourceFollow {
  enabled: boolean; pathId: string; speed: number; acceleration: number; offset: number;
  mode: 'loop' | 'pingpong'; orient: 'none' | 'tangent' | 'normal';
}
export interface FlowSource {
  id: string; name: string; type: FlowType; enabled: boolean;
  x: number; y: number; angle: number; reverse: boolean;
  strength: number; speed: number; radius: number; global: boolean; falloff: Falloff;
  scale: number; rotation: number; offsetX: number; offsetY: number;
  phase: number; evolution: number; timeScale: number;
  influence: number; weight: number; priority: number; blend: Blend;
  params: [number, number, number, number];
  follow: SourceFollow;
}
export interface Modulator {
  id: string; name: string; enabled: boolean; shape: ModShape; target: string; blend: ModBlend;
  speed: number; frequency: number; amplitude: number; phase: number; offset: number; min: number; max: number; smoothness: number; seed: number;
  /** custom curve (eight values 0..1, interpolated smoothly) used by the 'curve' shape */
  curve: number[];
}
export interface MotionConfig {
  version: number;
  enabled: boolean;
  /** the profile last applied (informational: the config itself is the truth) */
  profile: string;
  global: { intensity: number; speed: number; direction: number; flow: number; organic: number; turbulence: number; interaction: number; seed: number };
  composition: { mode: Composition; normalize: boolean; maxVelocity: number; smoothing: number; balance: number; strength: number; cycle: number; unlockLimits: boolean };
  sources: FlowSource[];
  paths: MotionPath[];
  physics: {
    model: PhysicsModel; mass: number; stiffness: number; damping: number; friction: number; drag: number; elasticity: number; inertia: number;
    resistance: number; maxSpeed: number; minSpeed: number; persistence: number; impulse: number; directionInertia: number;
  };
  organic: { enabled: boolean; intensity: number; scale: number; speed: number; drift: number; variation: number; smoothness: number; phase: number; spatial: number; evolution: number; randomness: number; persistence: number; seed: number };
  turbulence: {
    enabled: boolean; kind: TurbulenceKind; strength: number; scale: number; speed: number; detail: number; persistence: number; lacunarity: number;
    warp: number; warpScale: number; warpDirection: number; rotation: number; evolution: number; influence: number; angle: number;
    localX: number; localY: number; localRadius: number;
  };
  modulators: Modulator[];
  interaction: {
    enabled: boolean; profile: InteractionProfile; response: InteractionResponse; falloff: Falloff;
    radius: number; strength: number; speed: number; velocitySensitivity: number; accelerationSensitivity: number; smoothing: number; inertia: number;
    drag: number; persistence: number; lag: number; directionResponse: number; maxDisplacement: number; frequency: number;
    clickImpulse: boolean; trail: boolean;
  };
  time: { scale: number; offset: number; loop: LoopMode; duration: number; reverse: boolean; freeze: boolean };
  performance: { quality: MotionQuality };
}

/* ───────────── defaults ───────────── */

interface SourceDefault { name: string; angle?: number; strength: number; radius: number; global: boolean; falloff: Falloff; scale: number; evolution: number; params: [number, number, number, number]; x?: number; y?: number }
const SRC_DEFAULT: Record<FlowType, SourceDefault> = {
  directional: { name: 'Directional flow', angle: 25, strength: 0.45, radius: 1.2, global: true, falloff: 'smooth', scale: 1, evolution: 0.3, params: [0.2, 0, 0, 0] },
  curved: { name: 'Curved flow', angle: 10, strength: 0.5, radius: 1.1, global: false, falloff: 'smooth', scale: 1, evolution: 0.25, params: [1.2, 0.1, 0, 0.3] },
  vortex: { name: 'Vortex', strength: 0.7, radius: 0.55, global: false, falloff: 'smooth', scale: 1, evolution: 0.3, params: [0.18, 0, 0, 1], x: 0.5, y: 0.5 },
  spiral: { name: 'Spiral', strength: 0.6, radius: 0.7, global: false, falloff: 'smooth', scale: 1, evolution: 0.2, params: [0.6, 0.05, 0.5, 1], x: 0.5, y: 0.5 },
  radial: { name: 'Radial flow', strength: 0.55, radius: 0.75, global: false, falloff: 'smooth', scale: 1, evolution: 0, params: [0, 0, 0.05, 1], x: 0.5, y: 0.5 },
  wave: { name: 'Wave flow', angle: 0, strength: 0.4, radius: 1.5, global: true, falloff: 'smooth', scale: 1, evolution: 0.25, params: [3, 5, 0.3, 0.1] },
  noise: { name: 'Noise flow', angle: 0, strength: 0.45, radius: 1.5, global: true, falloff: 'smooth', scale: 1.2, evolution: 0.4, params: [3, 0.5, 0.3, 0] },
  curl: { name: 'Curl flow', angle: 0, strength: 0.6, radius: 1.5, global: true, falloff: 'smooth', scale: 1.2, evolution: 0.35, params: [3, 0.5, 0.2, 0] },
  magnetic: { name: 'Magnetic pole', strength: 0.6, radius: 0.6, global: false, falloff: 'smooth', scale: 1, evolution: 0.2, params: [0.35, 1, 0.12, 1.5], x: 0.5, y: 0.5 },
  path: { name: 'Path flow', strength: 0.6, radius: 0.35, global: false, falloff: 'smooth', scale: 1, evolution: 0, params: [0, 0.6, 1, 0] },
};
export const FLOW_PARAMS: Record<FlowType, ParamMeta[]> = {
  directional: [
    { key: 'p1', label: 'Curvature', min: -3, max: 3, step: 0.01, hint: 'Bends the streamlines sideways across the field.' },
    { key: 'p2', label: 'Direction variation', min: 0, max: 1, step: 0.01, hint: 'Lets the direction wander from place to place.' },
    { key: 'p3', label: 'Spread', min: 0, max: 1, step: 0.01, hint: 'Varies the speed across the field.' },
  ],
  curved: [
    { key: 'p1', label: 'Curvature', min: -4, max: 4, step: 0.01 },
    { key: 'p2', label: 'Curve variation', min: 0, max: 1, step: 0.01 },
    { key: 'p3', label: 'Curve breathing', min: 0, max: 1, step: 0.01, hint: 'Pulses the curvature over time.' },
    { key: 'p4', label: 'Center bias', min: 0, max: 1, step: 0.01, hint: '0 bends sideways, 1 bends around the source.' },
  ],
  vortex: [
    { key: 'p1', label: 'Core size', min: 0.02, max: 1, step: 0.01, hint: 'The velocity peaks at this distance; nothing blows up at the center.' },
    { key: 'p2', label: 'Radial component', min: -1, max: 1, step: 0.01, hint: 'Positive pushes outward, negative pulls in.' },
    { key: 'p3', label: 'Spiral amount', min: -1.5, max: 1.5, step: 0.01 },
    { key: 'p4', label: 'Rotation (− clockwise, + counter)', min: -1, max: 1, step: 0.01 },
  ],
  spiral: [
    { key: 'p1', label: 'Tightness', min: 0, max: 1, step: 0.01, hint: '0 is purely radial, 1 purely rotational.' },
    { key: 'p2', label: 'Inner radius', min: 0, max: 1, step: 0.01 },
    { key: 'p3', label: 'Expansion (− contracts)', min: -1, max: 1, step: 0.01 },
    { key: 'p4', label: 'Rotation (− clockwise, + counter)', min: -1, max: 1, step: 0.01 },
  ],
  radial: [
    { key: 'p1', label: 'Pulse frequency', min: 0, max: 4, step: 0.01, hint: 'Cycles per second.' },
    { key: 'p2', label: 'Pulse amplitude', min: 0, max: 1, step: 0.01 },
    { key: 'p3', label: 'Core size', min: 0, max: 1, step: 0.01 },
    { key: 'p4', label: 'Direction (+ outward, − inward)', min: -1, max: 1, step: 0.01 },
  ],
  wave: [
    { key: 'p1', label: 'Frequency', min: 0.2, max: 12, step: 0.01 },
    { key: 'p2', label: 'Wave pattern', min: 0, max: 6, step: 1, options: [...WAVE_PATTERNS] },
    { key: 'p3', label: 'Secondary wave', min: 0, max: 1, step: 0.01 },
    { key: 'p4', label: 'Wave distortion', min: 0, max: 1, step: 0.01 },
  ],
  noise: [
    { key: 'p1', label: 'Octaves', min: 1, max: 6, step: 1 },
    { key: 'p2', label: 'Persistence', min: 0.2, max: 0.9, step: 0.01 },
    { key: 'p3', label: 'Domain warp', min: 0, max: 1, step: 0.01 },
    { key: 'p4', label: 'Noise type', min: 0, max: 2, step: 1, options: ['Gradient', 'Billow', 'Ridged'] },
  ],
  curl: [
    { key: 'p1', label: 'Octaves', min: 1, max: 6, step: 1 },
    { key: 'p2', label: 'Smoothness', min: 0.2, max: 1, step: 0.01 },
    { key: 'p3', label: 'Organic variation', min: 0, max: 1, step: 0.01 },
  ],
  magnetic: [
    { key: 'p1', label: 'Orbit', min: -1, max: 1, step: 0.01, hint: 'Tangential share: orbiting around the pole.' },
    { key: 'p2', label: 'Polarity (+ attract, − repel)', min: -1, max: 1, step: 0.01 },
    { key: 'p3', label: 'Core size', min: 0.02, max: 1, step: 0.01 },
    { key: 'p4', label: 'Distance response', min: 0.5, max: 4, step: 0.01, hint: 'How quickly the pull fades with distance.' },
  ],
  path: [
    { key: 'p1', label: 'Path', min: 0, max: 1, step: 1, options: ['Path 1', 'Path 2'] },
    { key: 'p2', label: 'Path attraction', min: 0, max: 2, step: 0.01, hint: 'Pull toward the nearest point of the path.' },
    { key: 'p3', label: 'Tangent flow', min: -2, max: 2, step: 0.01, hint: 'Flow along the path (negative reverses it).' },
    { key: 'p4', label: 'Normal flow', min: -1, max: 1, step: 0.01, hint: 'Flow sideways, away from the path.' },
  ],
};

const DEFAULT_FOLLOW: SourceFollow = { enabled: false, pathId: '', speed: 0.12, acceleration: 0, offset: 0, mode: 'loop', orient: 'none' };

export function newId(prefix: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (let index = 1; index < 1000; index++) {
    const id = `${prefix}${index}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Math.random().toString(36).slice(2, 7)}`;
}

export function newFlowSource(type: FlowType, patch: Partial<FlowSource> = {}, taken: Iterable<string> = []): FlowSource {
  const d = SRC_DEFAULT[type];
  const source: FlowSource = {
    id: newId('s', taken), name: d.name, type, enabled: true,
    x: d.x ?? 0.5, y: d.y ?? 0.5, angle: d.angle ?? 0, reverse: false,
    strength: d.strength, speed: 1, radius: d.radius, global: d.global, falloff: d.falloff,
    scale: d.scale, rotation: 0, offsetX: 0, offsetY: 0, phase: 0, evolution: d.evolution, timeScale: 1,
    influence: 1, weight: 1, priority: 0, blend: 'add', params: [...d.params], follow: { ...DEFAULT_FOLLOW },
  };
  return { ...source, ...patch, params: patch.params ? [...patch.params] as FlowSource['params'] : source.params, follow: { ...source.follow, ...patch.follow } };
}

export function newPath(patch: Partial<MotionPath> = {}, taken: Iterable<string> = []): MotionPath {
  const node = (x: number, y: number, ox = 0.12, oy = 0): PathNode => ({ x, y, ix: -ox, iy: -oy, ox, oy });
  return {
    id: newId('p', taken), name: 'Path', kind: 'catmull', closed: false, reversed: false,
    points: [node(0.15, 0.7), node(0.4, 0.3), node(0.65, 0.7), node(0.88, 0.32)],
    smoothing: 0, evolve: 0, evolveSpeed: 0.3, offsetX: 0, offsetY: 0, ...patch,
  };
}

export function newModulator(patch: Partial<Modulator> = {}, taken: Iterable<string> = []): Modulator {
  return {
    id: newId('m', taken), name: 'Modulator', enabled: true, shape: 'sine', target: 'flow.strength', blend: 'add',
    speed: 1, frequency: 0.2, amplitude: 0.5, phase: 0, offset: 0, min: -1, max: 1, smoothness: 0, seed: 1,
    curve: [0, 0.4, 1, 0.6, 0.2, 0.8, 0.3, 0], ...patch,
  };
}

export function defaultMotion(): MotionConfig {
  return {
    version: MOTION_VERSION, enabled: false, profile: 'custom',
    global: { intensity: 1, speed: 1, direction: 0, flow: 0, organic: 1, turbulence: 1, interaction: 1, seed: 7 },
    composition: { mode: 'normalized', normalize: true, maxVelocity: 0.6, smoothing: 0.6, balance: 0.5, strength: 1, cycle: 9, unlockLimits: false },
    sources: [], paths: [],
    physics: { model: 'fluid', mass: 1, stiffness: 1, damping: 1, friction: 0.4, drag: 0.2, elasticity: 0, inertia: 0.2, resistance: 0, maxSpeed: 3, minSpeed: 0, persistence: 0.6, impulse: 0.5, directionInertia: 0.5 },
    organic: { enabled: false, intensity: 0.4, scale: 1.2, speed: 0.5, drift: 0.4, variation: 0.5, smoothness: 0.7, phase: 0, spatial: 0.6, evolution: 0.5, randomness: 0.3, persistence: 0.5, seed: 11 },
    turbulence: {
      enabled: false, kind: 'fractal', strength: 0.25, scale: 1.8, speed: 0.5, detail: 3, persistence: 0.5, lacunarity: 2, warp: 0.4, warpScale: 1.2, warpDirection: 0,
      rotation: 0, evolution: 0.5, influence: 1, angle: 0, localX: 0.5, localY: 0.5, localRadius: 0,
    },
    modulators: [],
    interaction: {
      enabled: false, profile: 'fluid', response: 'stir', falloff: 'smooth', radius: 0.3, strength: 0.6, speed: 1, velocitySensitivity: 0.8, accelerationSensitivity: 0.3, smoothing: 0.4, inertia: 0.4,
      drag: 1, persistence: 1.2, lag: 0.1, directionResponse: 0.6, maxDisplacement: 0.25, frequency: 3, clickImpulse: true, trail: true,
    },
    time: { scale: 1, offset: 0, loop: 'none', duration: 60, reverse: false, freeze: false },
    performance: { quality: 'auto' },
  };
}

/* ───────────── validation ───────────── */

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value);
export interface NormalizeReport { warnings: string[] }
const note = (report: NormalizeReport | undefined, message: string) => { if (report && report.warnings.length < 40) report.warnings.push(message); };

function num(value: unknown, range: Range, fallback: number, report?: NormalizeReport, label = ''): number {
  if (value === undefined) return fallback;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) { note(report, `${label || 'a number'} was not valid and was reset.`); return fallback; }
  const clamped = Math.min(range[1], Math.max(range[0], n));
  if (clamped !== n) note(report, `${label || 'a number'} was out of range and was limited.`);
  return clamped;
}
const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
function pick<T extends string>(value: unknown, list: readonly T[], fallback: T, report?: NormalizeReport, label = ''): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
  note(report, `${label || 'an option'} "${String(value).slice(0, 24)}" is unknown and was reset.`);
  return fallback;
}
const text = (value: unknown, fallback: string, max = 40) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
const safeId = (value: unknown, fallback: string) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(value) ? value : fallback;
function ranged<T extends Record<string, number>>(raw: unknown, defaults: T, ranges: Record<string, Range>, report: NormalizeReport | undefined, label: string): T {
  const source = isObject(raw) ? raw : {};
  const out: Record<string, number> = {};
  // only the numeric keys that have a range are validated here; flags and choices are handled by the caller
  for (const key of Object.keys(ranges)) if (key in defaults) out[key] = num(source[key], ranges[key]!, defaults[key] as number, report, `${label}.${key}`);
  return out as T;
}
function uniqueIds<T extends { id: string }>(list: T[], prefix: string): T[] {
  const seen = new Set<string>();
  return list.map(item => {
    if (!seen.has(item.id)) { seen.add(item.id); return item; }
    const id = newId(prefix, seen);
    seen.add(id);
    return { ...item, id };
  });
}

function normalizeSource(raw: unknown, report: NormalizeReport | undefined, index: number): FlowSource | null {
  if (!isObject(raw)) return null;
  const type = pick(raw.type, FLOW_TYPES, 'directional', report, `source ${index + 1} type`);
  const d = newFlowSource(type);
  const R = MOTION_RANGE.source;
  const label = `source ${index + 1}`;
  const params = Array.isArray(raw.params) ? raw.params : [];
  const meta = FLOW_PARAMS[type];
  const follow = isObject(raw.follow) ? raw.follow : {};
  return {
    id: safeId(raw.id, `s${index + 1}`), name: text(raw.name, d.name), type, enabled: bool(raw.enabled, true),
    x: num(raw.x, R.x, d.x, report, `${label}.x`), y: num(raw.y, R.y, d.y, report, `${label}.y`),
    angle: num(raw.angle, R.angle, d.angle, report, `${label}.angle`), reverse: bool(raw.reverse, false),
    strength: num(raw.strength, R.strength, d.strength, report, `${label}.strength`), speed: num(raw.speed, R.speed, 1, report, `${label}.speed`),
    radius: num(raw.radius, R.radius, d.radius, report, `${label}.radius`), global: bool(raw.global, d.global), falloff: pick(raw.falloff, FALLOFFS, d.falloff, report, `${label}.falloff`),
    scale: num(raw.scale, R.scale, d.scale, report, `${label}.scale`), rotation: num(raw.rotation, R.rotation, 0, report, `${label}.rotation`),
    offsetX: num(raw.offsetX, R.offsetX, 0, report), offsetY: num(raw.offsetY, R.offsetY, 0, report),
    phase: num(raw.phase, R.phase, 0, report), evolution: num(raw.evolution, R.evolution, d.evolution, report), timeScale: num(raw.timeScale, R.timeScale, 1, report),
    influence: num(raw.influence, R.influence, 1, report), weight: num(raw.weight, R.weight, 1, report), priority: Math.round(num(raw.priority, R.priority, 0, report)),
    blend: pick(raw.blend, BLENDS, 'add', report, `${label}.blend`),
    params: [0, 1, 2, 3].map(slot => {
      const m = meta[slot];
      const fallback = d.params[slot] ?? 0;
      return m ? num(params[slot], [m.min, m.max], fallback, report, `${label}.${m.label}`) : fallback;
    }) as FlowSource['params'],
    follow: {
      enabled: bool(follow.enabled, false), pathId: typeof follow.pathId === 'string' ? follow.pathId.slice(0, 24) : '',
      speed: num(follow.speed, [-2, 2], DEFAULT_FOLLOW.speed, report), acceleration: num(follow.acceleration, [-1, 1], 0, report), offset: num(follow.offset, [0, 1], 0, report),
      mode: pick(follow.mode, ['loop', 'pingpong'] as const, 'loop', report), orient: pick(follow.orient, ['none', 'tangent', 'normal'] as const, 'none', report),
    },
  };
}

function normalizePath(raw: unknown, report: NormalizeReport | undefined, index: number): MotionPath | null {
  if (!isObject(raw)) return null;
  const d = newPath();
  const pts = Array.isArray(raw.points) ? raw.points.slice(0, MOTION_LIMITS.pathPoints) : [];
  const points = pts.filter(isObject).map((p): PathNode => {
    const x = num(p.x, [-0.5, 1.5], 0.5, report), y = num(p.y, [-0.5, 1.5], 0.5, report);
    const ox = num(p.ox, [-1, 1], 0.1, report), oy = num(p.oy, [-1, 1], 0, report);
    return { x, y, ix: num(p.ix, [-1, 1], -ox, report), iy: num(p.iy, [-1, 1], -oy, report), ox, oy };
  });
  if (points.length < 2) { note(report, `path ${index + 1} needs at least two points; the default path was used.`); return { ...d, id: safeId(raw.id, `p${index + 1}`) }; }
  return {
    id: safeId(raw.id, `p${index + 1}`), name: text(raw.name, d.name), kind: pick(raw.kind, PATH_KINDS, 'catmull', report), closed: bool(raw.closed, false), reversed: bool(raw.reversed, false),
    points, smoothing: num(raw.smoothing, [0, 1], 0, report), evolve: num(raw.evolve, [0, 0.4], 0, report), evolveSpeed: num(raw.evolveSpeed, [0, 3], 0.3, report),
    offsetX: num(raw.offsetX, [-1, 1], 0, report), offsetY: num(raw.offsetY, [-1, 1], 0, report),
  };
}

function normalizeModulator(raw: unknown, report: NormalizeReport | undefined, index: number, sourceIds: Set<string>): Modulator | null {
  if (!isObject(raw)) return null;
  const d = newModulator();
  const R = MOTION_RANGE.modulator;
  let target = typeof raw.target === 'string' ? raw.target : d.target;
  const sourceTarget = /^src:([A-Za-z0-9_-]{1,24}):(\w+)$/.exec(target);
  const targetOk = MOD_TARGET_IDS.has(target) || (!!sourceTarget && sourceIds.has(sourceTarget[1]!) && (SOURCE_MOD_PROPS as readonly string[]).includes(sourceTarget[2]!));
  if (!targetOk) { note(report, `modulator ${index + 1} targets "${target.slice(0, 24)}", which does not exist; it was reset.`); target = d.target; }
  const curve = Array.isArray(raw.curve) ? raw.curve.slice(0, MOTION_LIMITS.curvePoints).map(v => num(v, [0, 1], 0.5)) : [];
  while (curve.length < MOTION_LIMITS.curvePoints) curve.push(d.curve[curve.length]!);
  return {
    id: safeId(raw.id, `m${index + 1}`), name: text(raw.name, d.name), enabled: bool(raw.enabled, true), shape: pick(raw.shape, MOD_SHAPES, 'sine', report, `modulator ${index + 1} shape`),
    target, blend: pick(raw.blend, MOD_BLENDS, 'add', report, `modulator ${index + 1} blend`),
    speed: num(raw.speed, R.speed, 1, report), frequency: num(raw.frequency, R.frequency, d.frequency, report), amplitude: num(raw.amplitude, R.amplitude, d.amplitude, report),
    phase: num(raw.phase, R.phase, 0, report), offset: num(raw.offset, R.offset, 0, report), min: num(raw.min, R.min, -1, report), max: num(raw.max, R.max, 1, report),
    smoothness: num(raw.smoothness, R.smoothness, 0, report), seed: Math.round(num(raw.seed, R.seed, 1, report)), curve,
  };
}

/** Repairs any value into a complete, valid config. Returns undefined for "no motion config" (undefined / null / not an object). */
export function normalizeMotion(raw: unknown, report?: NormalizeReport): MotionConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) { note(report, 'The motion settings were not an object and were ignored.'); return undefined; }
  const migrated = migrateMotion(raw, report);
  const d = defaultMotion();
  const R = MOTION_RANGE;
  const unlock = bool(isObject(migrated.composition) ? migrated.composition.unlockLimits : undefined, false);
  const comp = isObject(migrated.composition) ? migrated.composition : {};
  const rawSources = Array.isArray(migrated.sources) ? migrated.sources.slice(0, MOTION_LIMITS.sources) : [];
  if (Array.isArray(migrated.sources) && migrated.sources.length > MOTION_LIMITS.sources) note(report, `Only ${MOTION_LIMITS.sources} flow sources are supported; the rest were dropped.`);
  const sources = uniqueIds(rawSources.map((entry, index) => normalizeSource(entry, report, index)).filter((s): s is FlowSource => !!s), 's');
  const paths = uniqueIds((Array.isArray(migrated.paths) ? migrated.paths.slice(0, MOTION_LIMITS.paths) : []).map((entry, index) => normalizePath(entry, report, index)).filter((p): p is MotionPath => !!p), 'p');
  const sourceIds = new Set(sources.map(s => s.id));
  const modulators = uniqueIds((Array.isArray(migrated.modulators) ? migrated.modulators.slice(0, MOTION_LIMITS.modulators) : []).map((entry, index) => normalizeModulator(entry, report, index, sourceIds)).filter((m): m is Modulator => !!m), 'm');
  const g = ranged(migrated.global, d.global, R.global, report, 'global');
  const phys = isObject(migrated.physics) ? migrated.physics : {};
  const org = isObject(migrated.organic) ? migrated.organic : {};
  const tur = isObject(migrated.turbulence) ? migrated.turbulence : {};
  const inter = isObject(migrated.interaction) ? migrated.interaction : {};
  const time = isObject(migrated.time) ? migrated.time : {};
  const perf = isObject(migrated.performance) ? migrated.performance : {};
  const maxVelocityRange = unlock ? UNLOCKED_RANGE.maxVelocity : R.composition.maxVelocity;
  const strengthRange = unlock ? UNLOCKED_RANGE.strength : R.composition.strength;
  const profile = typeof migrated.profile === 'string' ? migrated.profile.slice(0, 40) : d.profile;
  return {
    version: MOTION_VERSION,
    enabled: bool(migrated.enabled, false),
    profile,
    global: g,
    composition: {
      mode: pick(comp.mode, COMPOSITIONS, d.composition.mode, report, 'composition mode'), normalize: bool(comp.normalize, d.composition.normalize),
      maxVelocity: num(comp.maxVelocity, maxVelocityRange, d.composition.maxVelocity, report, 'composition.maxVelocity'),
      smoothing: num(comp.smoothing, R.composition.smoothing, d.composition.smoothing, report), balance: num(comp.balance, R.composition.balance, d.composition.balance, report),
      strength: num(comp.strength, strengthRange, d.composition.strength, report),
      cycle: num(comp.cycle, R.composition.cycle, d.composition.cycle, report), unlockLimits: unlock,
    },
    sources, paths,
    physics: { ...ranged(phys, d.physics as unknown as Record<string, number>, R.physics, report, 'physics'), model: pick(phys.model, PHYSICS_MODELS, d.physics.model, report, 'physics model') } as unknown as MotionConfig['physics'],
    organic: { ...ranged(org, d.organic as unknown as Record<string, number>, R.organic, report, 'organic'), enabled: bool(org.enabled, d.organic.enabled), seed: Math.round(num(org.seed, R.organic.seed, d.organic.seed, report)) } as unknown as MotionConfig['organic'],
    turbulence: {
      ...ranged(tur, d.turbulence as unknown as Record<string, number>, R.turbulence, report, 'turbulence'),
      enabled: bool(tur.enabled, d.turbulence.enabled), kind: pick(tur.kind, TURBULENCE_KINDS, d.turbulence.kind, report, 'turbulence type'),
      detail: Math.round(num(tur.detail, R.turbulence.detail, d.turbulence.detail, report)),
    } as unknown as MotionConfig['turbulence'],
    modulators,
    interaction: {
      ...ranged(inter, d.interaction as unknown as Record<string, number>, R.interaction, report, 'interaction'),
      enabled: bool(inter.enabled, d.interaction.enabled), profile: pick(inter.profile, INTERACTION_PROFILES, d.interaction.profile, report, 'interaction profile'),
      response: pick(inter.response, INTERACTION_RESPONSES, d.interaction.response, report, 'interaction response'), falloff: pick(inter.falloff, FALLOFFS, d.interaction.falloff, report, 'interaction falloff'),
      clickImpulse: bool(inter.clickImpulse, true), trail: bool(inter.trail, true),
    } as unknown as MotionConfig['interaction'],
    time: { ...ranged(time, { scale: d.time.scale, offset: d.time.offset, duration: d.time.duration }, R.time, report, 'time'), loop: pick(time.loop, LOOP_MODES, 'none', report, 'loop mode'), reverse: bool(time.reverse, false), freeze: bool(time.freeze, false) },
    performance: { quality: pick(perf.quality, QUALITY_MODES, 'auto', report, 'quality') },
  };
}

/** Brings an older (or unversioned) object up to the current version. Pure: the input is not modified. */
export function migrateMotion(raw: Raw, report?: NormalizeReport): Raw {
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > MOTION_VERSION) note(report, `This motion setup was made by a newer version (v${version}); unknown parts are ignored.`);
  let out: Raw = { ...raw };
  if (version < 1) {
    // v0 (pre-release shape): flat `flowSources`, `sources` of plain numbers; accept the obvious aliases
    if (!Array.isArray(out.sources) && Array.isArray(out.flowSources)) out.sources = out.flowSources;
    if (!isObject(out.composition) && isObject(out.blend)) out.composition = out.blend;
    note(report, 'An older motion format was upgraded.');
    out = { ...out, version: 1 };
  }
  return out;
}

export const isMotionEnabled = (motion: MotionConfig | undefined): motion is MotionConfig => !!motion && motion.enabled;

/* ───────────── JSON ───────────── */

export function serializeMotion(config: MotionConfig): string {
  return JSON.stringify({ format: MOTION_FORMAT, version: MOTION_VERSION, config }, null, 2);
}
export type ParseResult = { ok: true; config: MotionConfig; warnings: string[] } | { ok: false; error: string };
/** Reads a motion JSON file (or a bare config). Never throws. */
export function parseMotion(textValue: string): ParseResult {
  if (typeof textValue !== 'string' || !textValue.trim()) return { ok: false, error: 'The file is empty.' };
  if (textValue.length > 2_000_000) return { ok: false, error: 'The file is too large to be a motion setup.' };
  let data: unknown;
  try { data = JSON.parse(textValue); } catch (error) { return { ok: false, error: `This is not valid JSON (${error instanceof Error ? error.message.slice(0, 80) : 'parse error'}).` }; }
  const body = isObject(data) && isObject(data.config) ? data.config : data;
  if (isObject(data) && typeof data.format === 'string' && data.format !== MOTION_FORMAT) return { ok: false, error: `This file is "${data.format.slice(0, 30)}", not a ShapeForge motion setup.` };
  if (!isObject(body)) return { ok: false, error: 'The file does not contain a motion setup.' };
  const report: NormalizeReport = { warnings: [] };
  const config = normalizeMotion(body, report);
  if (!config) return { ok: false, error: 'The file does not contain a motion setup.' };
  const known = new Set(Object.keys(defaultMotion()));
  const unknown = Object.keys(body).filter(key => !known.has(key) && key !== 'flowSources' && key !== 'blend');
  if (unknown.length) report.warnings.push(`Ignored unknown fields: ${unknown.slice(0, 5).join(', ')}.`);
  return { ok: true, config, warnings: report.warnings };
}

/** A copy of the config that is safe to edit (the config is plain JSON, so this is a structured clone). */
export const cloneMotion = (config: MotionConfig): MotionConfig => JSON.parse(JSON.stringify(config)) as MotionConfig;
