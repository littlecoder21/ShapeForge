import type { FalloffMode, TextureParams } from './textureControls';

/* ═══════════════════════════ Texture maths ═══════════════════════════
 * Everything here is deterministic and tile-periodic:
 *  • randomness is a STATELESS hash of (seed, element, channel) — never a sequential generator — so every property
 *    of an element has its own stream. Turning "position jitter" up cannot reshuffle sizes, and adding elements
 *    does not move the ones that already exist.
 *  • noise, warp and falloff are periodic over the 64-unit tile, so they never create a seam.
 */

export const TILE = 64;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const wrap = (v: number) => ((v % TILE) + TILE) % TILE;
export const smoothstep = (t: number) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
/** Shortest signed distance on a unit torus, in [-0.5, 0.5]. */
export const wrapDelta = (d: number) => d - Math.round(d);

export function hash(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35) ^ Math.imul(d | 0, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Independent random streams. */
export const CH = {
  x: 1, y: 2, size: 3, angle: 4, opacity: 5, cover: 6, fall: 7, jx: 8, jy: 9, sizeBase: 10, opBase: 11, angBase: 12,
  curve: 13, len: 14, width: 15, detailX: 16, detailY: 17, detailR: 18, detailO: 19, phase: 20, cut: 21, wobble: 22, misc: 23,
} as const;

export type Rand = (i: number, j: number, channel: number) => number;
export const makeRand = (seed: number): Rand => (i, j, channel) => hash(seed, i, j, channel);

/* ───────────── seamless value noise ───────────── */

const latticeValue = (seed: number, ix: number, iy: number, n: number, ch: number) =>
  hash(seed, ((ix % n) + n) % n, ((iy % n) + n) % n, ch) * 2 - 1;

/** Value noise in [-1, 1] with `n` integer cells across the tile — exactly periodic with period 1 in u and v. */
export function noise2(seed: number, u: number, v: number, n: number, ch = 0): number {
  const x = u * n, y = v * n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = latticeValue(seed, x0, y0, n, ch), b = latticeValue(seed, x0 + 1, y0, n, ch);
  const c = latticeValue(seed, x0, y0 + 1, n, ch), d = latticeValue(seed, x0 + 1, y0 + 1, n, ch);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbm(seed: number, u: number, v: number, n: number, octaves: number, ch = 0): number {
  let amp = 1, sum = 0, norm = 0, cells = Math.max(1, Math.round(n));
  for (let o = 0; o < octaves; o++) { sum += amp * noise2(seed, u, v, cells, ch + o * 7); norm += amp; amp *= 0.5; cells *= 2; }
  return sum / norm;
}

/* ───────────── domain warp ───────────── */

export type WarpFn = (x: number, y: number, strength?: number) => [number, number];

/**
 *  x' = x + amountX · noise(x, y)      y' = y + amountY · noise(x, y)
 * Returns null when distortion is off, so callers keep their exact straight geometry.
 */
export function makeWarp(P: Pick<TextureParams, 'warpAmount' | 'warpFrequency' | 'warpX' | 'warpY' | 'warpOctaves'>, seed: number): WarpFn | null {
  if (P.warpAmount <= 0 || (P.warpX <= 0 && P.warpY <= 0)) return null;
  const amount = (P.warpAmount / 100) * 14, ax = P.warpX / 100, ay = P.warpY / 100;
  const cells = Math.max(1, Math.round(P.warpFrequency)), octaves = clamp(Math.round(P.warpOctaves), 1, 3);
  return (x, y, strength = 1) => {
    if (strength <= 0) return [0, 0];
    const u = x / TILE, v = y / TILE, s = amount * strength;
    return [s * ax * fbm(seed + 101, u, v, cells, octaves, 3), s * ay * fbm(seed + 202, u, v, cells, octaves, 5)];
  };
}

/** Smooth flow direction (radians) used by the "flow" distribution and for flow-aligned strokes. */
export const flowAngle = (seed: number) => (x: number, y: number) => fbm(seed + 307, x / TILE, y / TILE, 2, 2, 9) * Math.PI * 1.25;

/* ───────────── spatial falloff ───────────── */

type FalloffParams = Pick<TextureParams, 'falloff' | 'falloffCenterX' | 'falloffCenterY' | 'falloffRadius' | 'falloffAngle'>;

/**
 * 1 at the falloff centre → 0 far away. Works in normalised tile coordinates (0…1), so it is independent of the tile scale
 * and of offsets, and it is periodic: radial profiles use the shortest wrapped distance, the linear profile is a triangle
 * wave along a 45°-snapped axis. Neither can create a seam where tiles meet.
 */
export function falloffAt(P: FalloffParams, x: number, y: number): number {
  const mode: FalloffMode = P.falloff;
  if (mode === 'none') return 1;
  const u = x / TILE, v = y / TILE, cx = P.falloffCenterX / 100, cy = P.falloffCenterY / 100, radius = Math.max(0.02, P.falloffRadius / 100);
  if (mode === 'linear') {
    const angle = (Math.round(P.falloffAngle / 45) * 45 * Math.PI) / 180;
    const k1 = Math.round(Math.cos(angle)), k2 = Math.round(Math.sin(angle));
    const s = k1 * (u - cx) + k2 * (v - cy);
    return clamp01(1 - Math.abs(s - Math.round(s)) / (0.5 * radius));
  }
  const d = Math.hypot(wrapDelta(u - cx), wrapDelta(v - cy)) / radius;
  if (mode === 'radial') return clamp01(1 - d);
  if (mode === 'smooth') return smoothstep(1 - d);
  return smoothstep(d); // edge: 0 at the centre, 1 beyond the radius
}

/* ───────────── distributions ───────────── */

export type Dist = 'grid' | 'staggered' | 'random' | 'radial' | 'poisson' | 'flow';
export interface Pt { x: number; y: number; i: number }

export interface DistOptions {
  seed: number;
  cols: number; rows: number;
  count: number;
  /** pattern shift, as a fraction of one pitch */
  phase: number;
  cx: number; cy: number;
  burst: number;
  minDist: number;
  flow: (x: number, y: number) => number;
  step: number;
}

export function distribute(mode: Dist, o: DistOptions): Pt[] {
  const pts: Pt[] = [];
  if (mode === 'grid' || mode === 'staggered') {
    const px = TILE / o.cols, py = TILE / o.rows;
    for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
      const shift = mode === 'staggered' && r % 2 ? 0.5 : 0;
      pts.push({ x: wrap((c + 0.5 + shift + o.phase) * px), y: wrap((r + 0.5 + o.phase) * py), i: r * o.cols + c });
    }
    return pts;
  }
  const n = Math.max(0, Math.round(o.count));
  if (mode === 'random') {
    for (let i = 0; i < n; i++) pts.push({ x: hash(o.seed, i, 0, CH.x) * TILE, y: hash(o.seed, i, 0, CH.y) * TILE, i });
    return pts;
  }
  if (mode === 'radial') {
    const spin = hash(o.seed, 0, 0, CH.angBase) * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const radius = 29 * Math.pow((i + 0.5) / n, 0.5 * o.burst), angle = i * 2.399963 + spin;
      pts.push({ x: wrap(o.cx + Math.cos(angle) * radius), y: wrap(o.cy + Math.sin(angle) * radius), i });
    }
    return pts;
  }
  if (mode === 'poisson') return poisson(o.seed, n, o.minDist);
  // flow: short streamlines of a periodic flow field, one element per step
  const steps = 7, seeds = Math.max(1, Math.ceil(n / steps));
  for (let s = 0; s < seeds && pts.length < n; s++) {
    let x = hash(o.seed, s, 0, CH.x) * TILE, y = hash(o.seed, s, 0, CH.y) * TILE;
    for (let k = 0; k < steps && pts.length < n; k++) {
      pts.push({ x: wrap(x), y: wrap(y), i: pts.length });
      const a = o.flow(x, y);
      x += Math.cos(a) * o.step; y += Math.sin(a) * o.step;
    }
  }
  return pts;
}

/** Dart-throwing Poisson-disc sampling on the torus (grid accelerated, bounded work). */
function poisson(seed: number, n: number, minDist: number): Pt[] {
  const pts: Pt[] = [];
  if (n <= 0) return pts;
  const dist = Math.max(0.5, minDist), cell = dist / Math.SQRT2, g = Math.max(1, Math.ceil(TILE / cell)), cs = TILE / g;
  const grid = new Int32Array(g * g).fill(-1), limit = n * 14;
  for (let k = 0; pts.length < n && k < limit; k++) {
    const x = hash(seed, k, 1, CH.x) * TILE, y = hash(seed, k, 1, CH.y) * TILE;
    const gx = Math.min(g - 1, Math.floor(x / cs)), gy = Math.min(g - 1, Math.floor(y / cs));
    let ok = true;
    for (let oy = -2; oy <= 2 && ok; oy++) for (let ox = -2; ox <= 2; ox++) {
      const index = grid[((gy + oy + g * 4) % g) * g + ((gx + ox + g * 4) % g)];
      if (index < 0) continue;
      const p = pts[index];
      let dx = Math.abs(p.x - x), dy = Math.abs(p.y - y);
      dx = Math.min(dx, TILE - dx); dy = Math.min(dy, TILE - dy);
      if (dx * dx + dy * dy < dist * dist) { ok = false; break; }
    }
    if (ok) { grid[gy * g + gx] = pts.length; pts.push({ x, y, i: pts.length }); }
  }
  return pts;
}

/**
 * Nearest direction that tiles seamlessly: lines `b·x − a·y = c` repeat on the 64-unit tile only for integer (a, b).
 * Returns the best small-integer pair for an angle in degrees (measured like CSS rotate: 0° = horizontal, 90° = vertical).
 */
export function tileableSlope(angleDeg: number, max = 16): [number, number] {
  const target = ((angleDeg % 180) + 180) % 180;
  let best: [number, number] = [0, 1], bestErr = Infinity;
  for (let a = 0; a <= max; a++) for (let b = -max; b <= max; b++) {
    if (a === 0 && b === 0) continue;
    if (gcd(Math.abs(a), Math.abs(b)) !== 1) continue;
    // direction of the line is (a, b) → angle of the line
    const ang = (((Math.atan2(b, a) * 180) / Math.PI) % 180 + 180) % 180;
    let err = Math.abs(ang - target); err = Math.min(err, 180 - err);
    // prefer simpler pairs on ties
    if (err < bestErr - 1e-9 || (Math.abs(err - bestErr) < 1e-9 && Math.abs(a) + Math.abs(b) < Math.abs(best[0]) + Math.abs(best[1]))) { best = [a, b]; bestErr = err; }
  }
  return best;
}
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
