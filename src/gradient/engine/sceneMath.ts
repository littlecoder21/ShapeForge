/* Shared maths for the scene builders (Fluid, Light, Ink & Smoke, Halftone, Prism, Metallic, Glass, Holographic, Atmosphere).
 *
 * The builders only assemble ordinary, editable layer stacks. Everything they need that is *not* a layer — colour mixing in a
 * perceptual space, a light-like glow, a flow line through a curl-noise field, soft colour bands — lives here so every builder
 * shares one implementation. All of it is pure and deterministic: the same inputs always give the same layers. */
import { clamp01, hexToUnit, mixRgb, unitToHex, type FieldSpace } from './colorScience';
import { newEffect } from './effects';
import { curl as curlNoise } from './fieldNoise';
import { newLayer, stop, type BlendMode, type ColorStop, type GradientLayer } from './model';
import { FALLOFFS, type EasingName, type FalloffKind } from './transitions';

export const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** Picks one of `list` (a string option from a builder config), or the fallback when the value is missing or unknown. */
export const pick = <T extends string>(value: unknown, list: readonly T[], fallback: T): T =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? value as T : fallback;
export const pickFalloff = (value: unknown, fallback: FalloffKind): FalloffKind => pick(value, FALLOFFS, fallback);

/* ───────────────────────────── colour ───────────────────────────── */

/** Mixes two hex colours in a perceptual space (OKLab by default), so mid-tones keep their lightness instead of going muddy. */
export const mixHex = (a: string, b: string, t: number, space: FieldSpace = 'oklab') =>
  unitToHex(mixRgb(hexToUnit(a), hexToUnit(b), clamp01(t), space));
export const lighten = (hex: string, amount: number) => mixHex(hex, '#ffffff', amount);
export const darken = (hex: string, amount: number) => mixHex(hex, '#000000', amount);

/** The colour at `t` (0…1) along a palette, interpolated between neighbouring palette colours. */
export function paletteAt(colors: string[], t: number, space: FieldSpace = 'oklab'): string {
  if (colors.length === 1) return colors[0];
  const x = clamp01(t) * (colors.length - 1), i = Math.min(colors.length - 2, Math.floor(x));
  return mixHex(colors[i], colors[i + 1], x - i, space);
}
export const paletteRamp = (colors: string[], count: number, space: FieldSpace = 'oklab') =>
  Array.from({ length: Math.max(1, count) }, (_, i) => paletteAt(colors, count <= 1 ? 0 : i / (count - 1), space));

/* ───────────────────────────── stops ───────────────────────────── */

/** Gives every stop but the last a smootherstep transition, so a ramp has no visible kink where two stops meet. */
export function softenStops(stops: ColorStop[], ease: EasingName = 'smootherstep'): ColorStop[] {
  return stops.map((s, i) => (i < stops.length - 1 && !s.hard && !s.ease && !s.curve ? { ...s, ease } : s));
}

/** A ramp that is transparent everywhere except one soft band: rises to `alpha` at `centre` and falls back, with no hard edges.
 *  `centre` and `half` are ramp positions (0…100). */
export function bandStops(color: string, centre: number, half: number, alpha: number, ease: EasingName = 'smootherstep'): ColorStop[] {
  const lo = clamp(centre - half, 0, 100), hi = clamp(centre + half, 0, 100), mid = clamp(centre, lo, hi);
  const out: ColorStop[] = [];
  if (lo > 0.01) out.push(stop(color, 0, 0));
  out.push(stop(color, lo, 0, { ease }), stop(color, mid, alpha, { ease }), stop(color, hi, 0));
  if (hi < 99.99) out.push(stop(color, 100, 0));
  return out;
}

/** Several colours side by side as one soft spectrum band: each colour peaks in turn, the ends fade to transparent. */
export function spectrumStops(colors: string[], centre: number, half: number, alpha: number, ease: EasingName = 'smootherstep'): ColorStop[] {
  const n = colors.length, lo = clamp(centre - half, 0, 100), hi = clamp(centre + half, 0, 100);
  const out: ColorStop[] = [];
  if (lo > 0.01) out.push(stop(colors[0], 0, 0));
  out.push(stop(colors[0], lo, 0, { ease }));
  colors.forEach((color, i) => out.push(stop(color, n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * (i + 0.5)) / n, alpha, { ease })));
  out.push(stop(colors[n - 1], hi, 0));
  if (hi < 99.99) out.push(stop(colors[n - 1], 100, 0));
  return out;
}

/* ───────────────────────────── layers ───────────────────────────── */

export interface GlowOptions {
  name: string; color: string; cx: number; cy: number; rx: number; ry: number;
  /** layer opacity 0…1 */
  alpha: number;
  /** brightness of the centre, 0…1 (default 1) */
  core?: number;
  blend?: BlendMode;
  /** extra CSS blur in px */
  blur?: number;
  /** light-like falloff; the stops already fade to 0 so this refines the shape rather than creating it */
  falloff?: FalloffKind;
  /** falloff tightness 0…100 */
  tight?: number;
  /** degrees; radial layers turn about their own centre */
  rotate?: number;
  /** 0…100. When set the glow is a soft-edged *disc*: flat until this radius, then a smootherstep fade (used for ink / pigment) */
  plateau?: number;
}

/** A soft light-like blob: a radial layer mixed in OKLab with smootherstep easing and a falloff curve that reaches exactly zero at
 *  the edge, so it never shows a rim. This replaces the old pattern of three hand-placed stops on every radial. */
export function glow(o: GlowOptions): GradientLayer {
  const core = clamp01(o.core ?? 1);
  const stops = o.plateau !== undefined
    ? [stop(o.color, 0, core), stop(o.color, clamp(o.plateau, 5, 95), core, { ease: 'smootherstep' }), stop(o.color, 100, 0)]
    : [stop(o.color, 0, core, { ease: 'smootherstep' }), stop(o.color, 55, core * 0.32, { ease: 'smoothstep' }), stop(o.color, 100, 0)];
  const layer = newLayer('radial', {
    name: o.name, cx: o.cx, cy: o.cy, rx: Math.max(1, o.rx), ry: Math.max(1, o.ry), blend: o.blend ?? 'screen',
    opacity: clamp01(o.alpha), space: 'oklab', stops,
    ...(o.plateau === undefined ? { shaping: { falloff: o.falloff ?? 'smooth', falloffStrength: clamp(o.tight ?? 35, 0, 100) } } : {}),
  });
  if (o.rotate) layer.transform = { ...layer.transform, rotate: o.rotate };
  if ((o.blur ?? 0) > 0) layer.effects.push(newEffect('blur', { radius: Math.round(o.blur!) }));
  return layer;
}

/* ───────────────────────────── flow ───────────────────────────── */

export interface FlowPoint {
  /** position, % of the canvas */
  x: number; y: number;
  /** direction of travel in CSS degrees (0 = right, clockwise) */
  angle: number;
  /** local flow strength 0…1 */
  speed: number;
}
export interface FlowOptions {
  /** distance between samples, % of the canvas */
  step: number;
  /** noise frequency: higher = tighter curls */
  scale: number;
  /** general direction in degrees */
  drift: number;
  /** 0…1: how much the curl field bends the path away from the drift */
  turbulence: number;
}

/** Follows a streamline of a curl-noise field. The curl of a potential is divergence-free, so paths swirl and wrap around each
 *  other instead of bunching up — placing shapes along such a line (and turning each to face the local flow) is what makes
 *  generated fluid and smoke read as moving material instead of scattered blobs. Fully deterministic for a given seed. */
export function streamline(seed: number, startX: number, startY: number, steps: number, o: FlowOptions): FlowPoint[] {
  const out: FlowPoint[] = [], v = [0, 0], drift = (o.drift * Math.PI) / 180, dx = Math.cos(drift), dy = Math.sin(drift);
  const turbulence = clamp01(o.turbulence);
  let x = startX, y = startY;
  for (let i = 0; i < Math.max(1, steps); i++) {
    curlNoise((x / 100) * o.scale, (y / 100) * o.scale, seed, v);
    const magnitude = Math.hypot(v[0], v[1]);
    const cx = magnitude > 1e-6 ? v[0] / magnitude : 0, cy = magnitude > 1e-6 ? v[1] / magnitude : 0;
    let hx = dx * (1 - turbulence) + cx * turbulence * 1.6, hy = dy * (1 - turbulence) + cy * turbulence * 1.6;
    const length = Math.hypot(hx, hy);
    if (length < 1e-6) { hx = dx; hy = dy; } else { hx /= length; hy /= length; }
    out.push({ x, y, angle: (Math.atan2(hy, hx) * 180) / Math.PI, speed: clamp01(magnitude * 2.4) });
    x += hx * o.step; y += hy * o.step;
  }
  return out;
}
