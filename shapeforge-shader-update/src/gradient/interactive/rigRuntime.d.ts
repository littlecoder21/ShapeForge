export const RIG_MAX_RULES: 8;
export const RIG_TRAIL_POINTS: 12;
export const RIG_MAX_CLICKS: 8;

export type PointerKind = 'mouse' | 'touch' | 'pen';

export interface PointerEngineOptions {
  touchEnabled: boolean;
  ripplesEnabled: boolean;
  maximumRipples: number;
  /** smoothing delay in ms for the "smooth" physics mode */
  delay: number;
  physics: 'smooth' | 'spring';
  stiffness: number;
  damping: number;
  trailLife: number;
  pressAttack: number;
  pressRelease: number;
  holdTime: number;
}

export interface PointerFrame {
  x: number; y: number; vx: number; vy: number;
  active: number; down: number;
  press: number; speed: number; hold: number; sinceClick: number; clock: number; trailLife: number;
  t2x: number; t2y: number; t2active: number; pinch: number; twist: number;
}

export interface PointerClick { x: number; y: number; t: number; s: number }
export interface PointerTrailPoint { x: number; y: number; t: number }

export interface PointerEngine {
  setOptions(next: Partial<PointerEngineOptions>): void;
  move(id: number, x: number, y: number, kind: PointerKind | string): void;
  down(id: number, x: number, y: number, kind: PointerKind | string): void;
  up(id: number): void;
  leave(id: number, kind: PointerKind | string): void;
  reset(): void;
  hasActivity(): boolean;
  getClicks(): PointerClick[];
  getTrail(): PointerTrailPoint[];
  advance(deltaSeconds: number, nowSeconds: number): PointerFrame;
}

export interface RigBuffers {
  b: Float32Array; c: Float32Array; d: Float32Array; e: Float32Array; trail: Float32Array; count: number;
}

export interface RigEvalRule {
  enabled: boolean;
  source: string;
  amount: number;
  radius: number;
  p: readonly number[];
  aspect: number;
  rotation: number;
  edge: number;
  shapeN: number;
  sp1: number;
  sp2: number;
  color: string;
  drives: readonly { source: string; target: string; mode: string; depth: number; curve: string; rate: number }[];
}

export interface RigEvalInput { gain: number; rules: readonly RigEvalRule[] }

export function pointerSmoothingFactor(deltaSeconds: number, delayMs: number): number;
export function idleMotionPoint(path: string, clock: number, speed: number, size: number): { x: number; y: number };
export function createPointerEngine(initial?: Partial<PointerEngineOptions>): PointerEngine;
export function createRigBuffers(): RigBuffers;
export function evaluateRig(rig: RigEvalInput, frame: PointerFrame, buffers: RigBuffers, options?: { radiusScale?: number; reaction?: number; enabled?: boolean }): RigBuffers;
export function packTrail(engine: PointerEngine, frame: PointerFrame, buffers: RigBuffers, enabled: boolean): number;
