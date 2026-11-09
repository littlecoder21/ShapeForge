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
  motion: { type: string; speed: number; phase: number; amplitude: number; frequency: number; seed: number };
  response: number;
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
export function motionPosition(point: ProceduralPoint, time: number, motion: Pick<ProceduralConfig['motion'], 'direction' | 'smoothness' | 'influence'>): [number, number];
export function forceDisplacement(type: string, dx: number, dy: number, dist: number, w: number, vx: number, vy: number, clock: number): [number, number];
export function createProceduralState(initial: ProceduralConfig, options?: { lut?: Uint8Array | null; octaveCap?: number }): ProceduralState;
export function uploadProceduralUniforms(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  loc: Record<string, WebGLUniformLocation | null | undefined>,
  buffers: ProceduralBuffers,
): void;
