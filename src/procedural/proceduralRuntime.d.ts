import type { ProceduralConfig } from './types';

export const PROC_MAX_POINTS: 12;
export const PROC_MAX_STAGES: 3;
export const PROC_MAX_MESH_POINTS: 128;
export const PROC_POINT_TIERS: readonly number[];
export const PROC_LUT_SIZE: 512;

export type Rng = () => number;

/** One generated colour centre with every per-point property. Positions are canvas uv (0…1, y up). */
export interface ProceduralPoint {
  x: number;
  y: number;
  /** sRGB 0–255 */
  color: [number, number, number];
  /** position along the palette; −1 for a fixed anchor colour */
  t: number;
  radius: number;
  influence: number;
  weight: number;
  motion: { type: string; speed: number; phase: number; amplitude: number; frequency: number; seed: number; /** seconds the point waits before it starts moving */ delay?: number };
  response: number;
  /** reach shape of this point (an anchor override, else `config.influence`); rotation in degrees */
  shape: string;
  rotation: number;
  anisotropy: number;
  inner: number;
  /** mesh anchors only: radius as a percentage of the canvas width, alpha 0…1 and core 0…100, exactly like a MeshPoint */
  size?: number;
  alpha?: number;
  core?: number;
}

export interface ProceduralPointerFrame {
  x: number; y: number; vx: number; vy: number; active: number; down: number;
  t2x: number; t2y: number; t2active: number;
}

export interface ProceduralBuffers {
  /** capacity × vec4: x, y, radius, weight (CSS-compatible mesh: x, y, radius in height units, alpha) */
  points: Float32Array;
  /** capacity × vec4: encoded rgb, (CSS-compatible mesh: hint exponent) */
  colors: Float32Array;
  a: Float32Array; b: Float32Array; c: Float32Array;
  /** d.x = hue shift in radians, d.y = procedural animation time */
  grade: Float32Array; d: Float32Array; base: Float32Array;
  /** e.x = CSS-compatible mesh on, e.y = layered compositing, e.z = ellipse ratio */
  e: Float32Array;
  warpA: Float32Array; warpB: Float32Array; warpC: Float32Array;
  /** f = hue direction, chroma preservation, global influence, core intensity */
  f: Float32Array;
  /** g = custom-weighted kernel mix: gaussian, compact, inverse */
  g: Float32Array;
  /** h = RBF scale, RBF kernel parameter */
  h: Float32Array;
  /** capacity × vec4: shape id, rotation (rad), anisotropy, inner fraction */
  shape: Float32Array;
  /** capacity × vec4: exact-RBF coefficients (re-solved on the CPU when points or colours move) */
  rbf: Float32Array;
  /** 3 × vec4: RBF polynomial terms (constant, x, y) */
  rbfP: Float32Array;
  /** 2 × vec4: allowed per-channel range of an exact RBF fit (min, then max) */
  rbfR: Float32Array;
  /** extra fields (3 × vec4 each) and the material stage (4 × vec4) */
  fieldA: Float32Array; fieldB: Float32Array; fieldC: Float32Array;
  m0: Float32Array; m1: Float32Array; m2: Float32Array; m3: Float32Array;
  count: number;
  /** compiled loop size these buffers were allocated for */
  capacity: number;
}

export interface ProceduralState {
  readonly buffers: ProceduralBuffers;
  getConfig(): ProceduralConfig;
  getPoints(): ProceduralPoint[];
  getCapacity(): number;
  getPositions(): [number, number][];
  setConfig(next: ProceduralConfig): void;
  setPaletteLut(lut: Uint8Array | null): void;
  setQuality(quality: { octaveCap: number }): void;
  isAnimated(): boolean;
  isSettling(): boolean;
  step(dt: number, frame: ProceduralPointerFrame | null | undefined, aspect: number, motionScale: number): ProceduralBuffers;
}

export function createRng(seed: number): Rng;
export function bakeColorLut(colors: readonly string[], size?: number): Uint8Array;
export function tierFor(count: number): number;
export function pinnedOnly(config: Pick<ProceduralConfig, 'anchors' | 'mesh'> | null | undefined): boolean;
export function proceduralNeed(config: Pick<ProceduralConfig, 'points' | 'anchors' | 'mesh'> | null | undefined): number;
export function proceduralCapacity(config: Pick<ProceduralConfig, 'points' | 'anchors' | 'mesh'> | null | undefined): number;
export function cssHintExponent(core: number): number;
export function pointCount(config: Pick<ProceduralConfig, 'points'>): number;
export function generatePoints(config: ProceduralConfig, lut?: Uint8Array | null): ProceduralPoint[];
export type ProceduralMotionInput = Pick<ProceduralConfig['motion'], 'direction' | 'smoothness' | 'influence'>
  & Partial<Pick<ProceduralConfig['motion'], 'speed' | 'frequency' | 'easing' | 'curve' | 'damping' | 'loop'>>;
export function motionPosition(point: ProceduralPoint, time: number, motion: ProceduralMotionInput): [number, number];
/** Damped-spring step response over one travel segment, f = 0…1 (lands exactly on 1). damping 0 = bouncy … 1 = no overshoot. */
export function springStep(f: number, damping: number): number;
/** CSS-style cubic-bezier(x1, y1, x2, y2) evaluated at progress f. */
export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number, f: number): number;
/** The easing value a motion applies at progress f (`elastic` motion defaults to the elastic curve). */
export function easeValue(motion: Partial<Pick<ProceduralConfig['motion'], 'easing' | 'curve'>> | null | undefined, type: string, f: number): number;
export function forceDisplacement(type: string, dx: number, dy: number, dist: number, w: number, vx: number, vy: number, clock: number): [number, number];
export function createProceduralState(initial: ProceduralConfig, options?: { lut?: Uint8Array | null; octaveCap?: number }): ProceduralState;
export function uploadProceduralUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  loc: Record<string, WebGLUniformLocation | null | undefined>,
  buffers: ProceduralBuffers,
): void;

export function hueDelta(h: number, ref: number, direction: number): number;
export function activeFieldLayers<T extends { enabled: boolean }>(config: { fields?: readonly T[]; mesh?: { render: string } } | null | undefined): T[];
export type RbfMethod = 'rbf-gaussian' | 'rbf-multiquadric' | 'thin-plate' | 'harmonic';
export function rbfKernelParameter(method: string, falloff: number): number;
export function rbfKernel(method: string, x: number, k: number): number;
export function rbfRegularization(softness: number): number;
export function solveRbf(
  px: readonly number[], py: readonly number[], colors: ArrayLike<number>,
  options: { method: string; scale: number; k: number; lambda: number },
  coef: Float32Array, poly: Float32Array,
): boolean;
export function evaluateRbf(
  method: string, px: readonly number[], py: readonly number[], coef: ArrayLike<number>, poly: ArrayLike<number>,
  scale: number, k: number, x: number, y: number,
): [number, number, number];
