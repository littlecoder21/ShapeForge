/* Transition and ramp maths shared by every renderer.
 *
 * Everything here works on unit-range floats and is pure, so the CSS exporter, the SVG / canvas / PNG renderers, the WebGL palette
 * LUT and the scene builders all evaluate the *same* curve. A transition is shaped in two independent steps, in this order:
 *
 *   1. an easing (a named curve, or a cubic-bezier) reshapes how quickly the mix moves from one colour to the next
 *   2. a midpoint bias moves the 50 % mix to a chosen position (0.5 = no bias)
 *
 * Ramp *shaping* (distribution, soft edge, light falloff, conic seam) lives here too: each function maps a ramp position `u` in 0…1
 * so a baked ramp can apply them without any renderer needing to know about them.
 */
import { clamp01, decodeColor, encodeColor, hexToUnit, mixHue, type FieldSpace, type Vec3 } from './colorScience';

/* ───────────────────────────── easings ───────────────────────────── */

export const EASINGS = [
  'linear', 'ease-in', 'ease-out', 'ease-in-out', 'smoothstep', 'smootherstep',
  'sine-in', 'sine-out', 'sine-in-out', 'quad-in', 'quad-out', 'cubic-in', 'cubic-out', 'cubic-in-out',
  'expo-in', 'expo-out', 'circ-in', 'circ-out',
] as const;
export type EasingName = (typeof EASINGS)[number];

export const EASING_LABEL: Record<EasingName, string> = {
  linear: 'Linear', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in / out',
  smoothstep: 'Smoothstep', smootherstep: 'Smootherstep',
  'sine-in': 'Sine in', 'sine-out': 'Sine out', 'sine-in-out': 'Sine in / out',
  'quad-in': 'Quad in', 'quad-out': 'Quad out', 'cubic-in': 'Cubic in', 'cubic-out': 'Cubic out', 'cubic-in-out': 'Cubic in / out',
  'expo-in': 'Expo in', 'expo-out': 'Expo out', 'circ-in': 'Circ in', 'circ-out': 'Circ out',
};

export const isEasing = (value: unknown): value is EasingName => typeof value === 'string' && (EASINGS as readonly string[]).includes(value);

/** A CSS-compatible cubic-bezier easing, solved with Newton–Raphson and a bisection fallback (the method browsers use). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(s) - x;
      if (Math.abs(error) < 1e-7) return sampleY(s);
      const slope = slopeX(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let lo = 0, hi = 1;
    s = x;
    for (let i = 0; i < 40; i++) {
      const error = sampleX(s) - x;
      if (Math.abs(error) < 1e-7) break;
      if (error < 0) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

const easeIn = cubicBezier(0.42, 0, 1, 1), easeOut = cubicBezier(0, 0, 0.58, 1), easeInOut = cubicBezier(0.42, 0, 0.58, 1);
const EXPO_SPAN = 1 - 2 ** -10;

/** A named easing: 0 at 0, 1 at 1, never leaves 0…1 (no overshoot, so a ramp can never invert a colour). */
export function ease(name: EasingName, input: number): number {
  const t = clamp01(input);
  switch (name) {
    case 'linear': return t;
    case 'ease-in': return easeIn(t);
    case 'ease-out': return easeOut(t);
    case 'ease-in-out': return easeInOut(t);
    case 'smoothstep': return t * t * (3 - 2 * t);
    case 'smootherstep': return t * t * t * (t * (t * 6 - 15) + 10);
    case 'sine-in': return 1 - Math.cos((t * Math.PI) / 2);
    case 'sine-out': return Math.sin((t * Math.PI) / 2);
    case 'sine-in-out': return (1 - Math.cos(Math.PI * t)) / 2;
    case 'quad-in': return t * t;
    case 'quad-out': return t * (2 - t);
    case 'cubic-in': return t * t * t;
    case 'cubic-out': return 1 - (1 - t) ** 3;
    case 'cubic-in-out': return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    case 'expo-in': return (2 ** (10 * t) - 1) / (2 ** 10 - 1);
    case 'expo-out': return (1 - 2 ** (-10 * t)) / EXPO_SPAN;
    case 'circ-in': return 1 - Math.sqrt(1 - t * t);
    case 'circ-out': return Math.sqrt(1 - (t - 1) * (t - 1));
    default: return t;
  }
}

/** Gamma-style bias that moves the 50 % mix to `mid` (0…1): `biasMid(m, m) === 0.5`. */
export function biasMid(mid: number, input: number): number {
  const t = clamp01(input);
  if (t <= 0) return 0;
  const m = Math.min(0.995, Math.max(0.005, mid));
  return t ** (Math.log(0.5) / Math.log(m));
}

export interface TransitionShape {
  easing?: EasingName;
  bezier?: { x1: number; y1: number; x2: number; y2: number };
  /** where the 50 % mix happens, 0…1 (0.5 = unbiased) */
  mid?: number;
}

const bezierCache = new Map<string, (t: number) => number>();
function bezierFor(b: NonNullable<TransitionShape['bezier']>) {
  const key = `${b.x1},${b.y1},${b.x2},${b.y2}`;
  let f = bezierCache.get(key);
  if (!f) {
    if (bezierCache.size > 96) bezierCache.clear();
    f = cubicBezier(clamp01(b.x1), b.y1, clamp01(b.x2), b.y2);
    bezierCache.set(key, f);
  }
  return f;
}

/** Applies the easing (or bezier), then the midpoint bias. `undefined` leaves the mix linear. */
export function shapeTransition(progress: number, shape?: TransitionShape): number {
  let v = clamp01(progress);
  if (!shape) return v;
  if (shape.bezier) v = bezierFor(shape.bezier)(v);
  else if (shape.easing && shape.easing !== 'linear') v = ease(shape.easing, v);
  if (shape.mid !== undefined && Math.abs(shape.mid - 0.5) > 0.005) v = biasMid(shape.mid, v);
  return v;
}

/* ───────────────────────────── ramp LUT ───────────────────────────── */

export interface RampStopInput {
  /** 0…1 along the ramp */
  pos: number;
  color: string;
  alpha?: number;
  /** hold this colour until the next stop, then switch */
  hard?: boolean;
  /** how the transition from this stop to the next is shaped */
  shape?: TransitionShape;
}

export interface RampLut {
  size: number;
  /** straight (non-premultiplied) RGBA, unit range, `size * 4` floats */
  data: Float32Array;
  /** writes the RGBA colour at `t` (0…1) into `out` */
  sample(t: number, out: Float32Array | number[]): void;
}

/** Bakes a ramp into a LUT. Colour mixing happens in `space`, weighted by alpha (so a colour that fades to transparent keeps its hue
 *  instead of darkening), and out-of-gamut results are chroma-reduced rather than clipped. */
export function buildRampLut(stops: RampStopInput[], space: FieldSpace = 'oklab', size = 256): RampLut {
  const count = Math.max(2, Math.floor(size));
  const sorted = [...stops].filter(s => Number.isFinite(s.pos)).sort((a, b) => a.pos - b.pos);
  const list = sorted.length ? sorted : [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }];
  const encoded = list.map(s => encodeColor(hexToUnit(s.color), space));
  const alphas = list.map(s => clamp01(s.alpha ?? 1));
  const data = new Float32Array(count * 4);
  const last = list.length - 1;
  const write = (i: number, rgb: Vec3, a: number) => { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = a; };
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    if (t <= list[0].pos) { write(i, decodeColor(encoded[0], space), alphas[0]); continue; }
    if (t >= list[last].pos) { write(i, decodeColor(encoded[last], space), alphas[last]); continue; }
    let k = 0;
    while (k < last - 1 && list[k + 1].pos <= t) k++;
    const a = list[k], b = list[k + 1];
    if (a.hard) { write(i, decodeColor(encoded[k], space), alphas[k]); continue; }
    const f = shapeTransition((t - a.pos) / Math.max(1e-9, b.pos - a.pos), a.shape);
    const w1 = alphas[k] * (1 - f), w2 = alphas[k + 1] * f, sum = w1 + w2;
    const q = sum > 1e-9 ? w2 / sum : f;           // alpha-weighted mix factor
    const e1 = encoded[k], e2 = encoded[k + 1];
    const mixed: Vec3 = space === 'oklch'
      ? [e1[0] + (e2[0] - e1[0]) * q, e1[1] + (e2[1] - e1[1]) * q, mixHue(e1[2], e1[1], e2[2], e2[1], q)]
      : [e1[0] + (e2[0] - e1[0]) * q, e1[1] + (e2[1] - e1[1]) * q, e1[2] + (e2[2] - e1[2]) * q];
    write(i, decodeColor(mixed, space), alphas[k] + (alphas[k + 1] - alphas[k]) * f);
  }
  return {
    size: count,
    data,
    sample(input, out) {
      const x = clamp01(input) * (count - 1), i0 = Math.floor(x), i1 = Math.min(count - 1, i0 + 1), f = x - i0;
      for (let c = 0; c < 4; c++) out[c] = data[i0 * 4 + c] + (data[i1 * 4 + c] - data[i0 * 4 + c]) * f;
    },
  };
}

/* ───────────────────────────── ramp shaping ───────────────────────────── */

export const FALLOFFS = ['none', 'gaussian', 'inverse-square', 'exponential', 'smooth'] as const;
export type FalloffKind = (typeof FALLOFFS)[number];
export const FALLOFF_LABEL: Record<FalloffKind, string> = {
  none: 'Off', gaussian: 'Gaussian', 'inverse-square': 'Inverse square', exponential: 'Exponential', smooth: 'Smooth',
};
export const isFalloff = (value: unknown): value is FalloffKind => typeof value === 'string' && (FALLOFFS as readonly string[]).includes(value);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smootherstep = (t: number) => { const x = clamp01(t); return x * x * x * (x * (x * 6 - 15) + 10); };

/** Light-like intensity falloff over a radius: 1 at the centre, exactly 0 at the edge (`u` = 0…1), never increasing.
 *  `strength` 0…1 tightens the core. Each kind is normalised so the edge always reaches zero — no hard boundary. */
export function falloff(kind: FalloffKind, u: number, strength = 0.5): number {
  if (kind === 'none') return 1;
  const x = clamp01(u), s = clamp01(strength);
  let g: (v: number) => number;
  if (kind === 'gaussian') { const sigma = lerp(0.9, 0.28, s); g = v => Math.exp(-((v / sigma) ** 2)); }
  else if (kind === 'inverse-square') { const k = lerp(2, 14, s); g = v => 1 / (1 + (k * v) ** 2); }
  else if (kind === 'exponential') { const k = lerp(1.5, 7, s); g = v => Math.exp(-k * v); }
  else { const p = lerp(1, 3, s); g = v => (1 - smootherstep(v)) ** p; }
  const edge = g(1), centre = g(0);
  return Math.max(0, Math.min(1, (g(x) - edge) / (centre - edge || 1)));
}

/** Soft outer edge: 1 until `1 - width`, then a smootherstep fade to 0 at the end of the ramp. `width` is 0…1. */
export function edgeFade(u: number, width: number): number {
  if (width <= 0) return 1;
  const w = Math.min(1, width), x = clamp01(u);
  return x <= 1 - w ? 1 : 1 - smootherstep((x - (1 - w)) / w);
}

/** Colour distribution bias, −100…100. Positive keeps the first colours for longer; negative brings the last colours in earlier.
 *  Returns the ramp position to read for output position `u`. */
export function distributionWarp(u: number, bias: number): number {
  const x = clamp01(u);
  if (!bias) return x;
  return x ** (2 ** (Math.max(-100, Math.min(100, bias)) / 50));
}

/** Weight (0…1) of the *first* colour blended back in at ramp position `u` so a conic gradient closes without a seam.
 *  `width` is the share of the turn used for the blend (0…1). */
export function seamWeight(u: number, width: number): number {
  if (width <= 0) return 0;
  const w = Math.min(1, width), x = clamp01(u);
  return x <= 1 - w ? 0 : smootherstep((x - (1 - w)) / w);
}
