import type { MotionConfig, MotionQuality } from './types';

export const MOTION_MAX_SOURCES: number;
export const MOTION_MAX_PATHS: number;
export const MOTION_PATH_SAMPLES: number;
export const MOTION_PTR_SLOTS: number;
export const MOTION_VEL: number;
export const MOTION_UNIFORM_NAMES: readonly string[];

export function randomAt(seed: number, index: number): number;
export function smoothNoise1(seed: number, x: number): number;
export function modulatorShape(mod: Pick<MotionConfig['modulators'][number], 'shape' | 'speed' | 'frequency' | 'phase' | 'smoothness' | 'seed' | 'curve'>, t: number): number;
export function modulatorValue(mod: MotionConfig['modulators'][number], t: number): number;

export interface Dynamics { x: number; v: number; from: number; to: number; t: number; init: boolean }
export function createDynamics(value?: number): Dynamics;
export function springParameters(phys: MotionConfig['physics'], coasting: boolean): { w: number; z: number };
export function stepDynamics(d: Dynamics, target: number, dt: number, phys: MotionConfig['physics'], wrapAngle?: boolean): number;

export interface PathSlot { dense: Float32Array; denseCount: number; cum: Float32Array; length: number; used: boolean; [key: string]: unknown }
export function pathPointAt(slot: PathSlot, s: number, out: Float32Array | number[]): Float32Array | number[];

/** Pointer data the engine reads each frame (uv coordinates, y up). */
export interface MotionFrame {
  x: number; y: number; active: number; down?: number; sinceClick?: number;
  t2x: number; t2y: number; t2active: number;
}
export interface MotionStepOptions {
  aspect: number; shaderDt?: number; animate?: boolean; timeScale?: number; projectQuality?: string; octaveCap?: number; dual?: boolean; clock?: number;
}
export interface MotionState {
  seedKey: string; time: number; timeAcc: number; tau: number; modTime: number; clock: number; count: number; tKind: number;
  flowActive: boolean; animating: boolean;
  mods: Map<string, number>;
  a: Float32Array; b: Float32Array; c: Float32Array; d: Float32Array; e: Float32Array; f: Float32Array;
  g0: Float32Array; g1: Float32Array; g2: Float32Array; phase: Float32Array; pal: Float32Array; q: Float32Array;
  o0: Float32Array; o1: Float32Array; o2: Float32Array; t0: Float32Array; t1: Float32Array; t2: Float32Array; t3: Float32Array;
  i0: Float32Array; i1: Float32Array; ptrP: Float32Array; ptrQ: Float32Array; path: Float32Array; pathI: Float32Array;
  pathSlots: PathSlot[];
  legacy: { distortion: number; rotation: number; zoom: number; breath: number; timeOffset: number; color: number };
  stats: { sources: number; paths: number; modulators: number; phases: number; flowSpeed: number };
  [key: string]: unknown;
}
export function createMotionState(): MotionState;
export function resetMotionState(state: MotionState): void;
export function effectiveMotionQuality(quality: MotionQuality, coarsePointer: boolean, interactionEnabled: boolean): MotionQuality;
export function qualityOctaves(quality: string, projectQuality: string): number;
export function qualityDualPhase(quality: string, projectQuality: string): boolean;
export function stepMotion(state: MotionState, cfg: MotionConfig, frame: MotionFrame | null | undefined, dt: number, opts: MotionStepOptions): MotionState;
export function isMotionAnimating(state: MotionState): boolean;
export function uploadMotionUniforms(gl: WebGLRenderingContext | WebGL2RenderingContext, loc: Record<string, WebGLUniformLocation | null | undefined>, state: MotionState): void;
