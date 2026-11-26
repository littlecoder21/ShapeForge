import type { MotionState } from './motionRuntime';
import type { TurbulenceKind } from './types';

export function gradientNoise(x: number, y: number): number;
export function fbm(x: number, y: number, octaves: number, persistence: number, lacunarity: number, kind: number): number;
export function falloff(distance: number, radius: number, kind: number): number;
export function softLimit(value: number, limit: number): number;
/** One source's direction at q (screen heights, centred, y up): writes [vx, vy, distanceUsedForFalloff]. */
export function evaluateSource(state: MotionState, index: number, qx: number, qy: number, aspect: number, out: number[] | Float32Array): number[] | Float32Array;
/** The composed flow velocity at q. */
export function evaluateFlow(state: MotionState, qx: number, qy: number, aspect: number, out: number[] | Float32Array, extraX?: number, extraY?: number): number[] | Float32Array;
export function evaluateTurbulence(state: MotionState, kind: TurbulenceKind, qx: number, qy: number, aspect: number, out: number[] | Float32Array): number[] | Float32Array;
export function evaluateOrganic(state: MotionState, qx: number, qy: number, out: number[] | Float32Array): number[] | Float32Array;
export function displacementAt(state: MotionState, kind: TurbulenceKind, qx: number, qy: number, aspect: number, phase: number, out: number[] | Float32Array): number[] | Float32Array;
