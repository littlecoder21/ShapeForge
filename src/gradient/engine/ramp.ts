import { hexToRgb, mixColors, toRgba, type RGBA } from './color';
import { sortedStops, type ColorStop, type GradientLayer } from './model';

/* Colour ramp evaluation with CSS semantics (hard stops, colour hints, curves, interpolation space).
 * SVG and canvas have no equivalent of hints / custom curves / oklab, so they sample this ramp. */

export const stopRgba = (s: { color: string; alpha: number }): RGBA => ({ ...hexToRgb(s.color), a: s.alpha });
export const rampRange = (layer: GradientLayer) => { const st = sortedStops(layer.stops); return { lo: st[0].pos, hi: st[st.length - 1].pos }; };

export const CURVE_PRESETS = {
  linear: { x1: 0, y1: 0, x2: 1, y2: 1 },
  'ease-in': { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  'ease-out': { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  'ease-in-out': { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  ease: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
} as const;

export type CurvePreset = keyof typeof CURVE_PRESETS | 'custom' | 'midpoint';

const bezier = (t: number, p1: number, p2: number) => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;

/** Evaluate a CSS cubic-bezier curve by solving its x coordinate for the input progress. */
export function curveProgress(stop: ColorStop, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  if (!stop.curve) {
    if (stop.mid === undefined || Math.abs(stop.mid - 50) < 0.5) return t;
    const midpoint = Math.min(0.995, Math.max(0.005, stop.mid / 100));
    return t ** (Math.log(0.5) / Math.log(midpoint));
  }
  const { x1, y1, x2, y2 } = stop.curve;
  let low = 0, high = 1;
  for (let i = 0; i < 18; i++) {
    const at = (low + high) / 2;
    if (bezier(at, x1, x2) < t) low = at;
    else high = at;
  }
  return bezier((low + high) / 2, y1, y2);
}

export function curvePreset(stop: ColorStop): CurvePreset {
  if (!stop.curve) return stop.mid !== undefined && Math.abs(stop.mid - 50) >= 0.5 ? 'midpoint' : 'linear';
  for (const [name, curve] of Object.entries(CURVE_PRESETS)) {
    if (Object.keys(curve).every(key => Math.abs(curve[key as keyof typeof curve] - stop.curve![key as keyof typeof stop.curve]) < 0.005)) return name as CurvePreset;
  }
  return 'custom';
}

export function colorAtPos(layer: GradientLayer, pos: number): RGBA {
  const st = sortedStops(layer.stops), n = st.length;
  if (pos <= st[0].pos) return stopRgba(st[0]);
  if (pos >= st[n - 1].pos) return stopRgba(st[n - 1]);
  let i = 0;
  while (i < n - 2 && st[i + 1].pos <= pos) i++;
  const a = st[i], b = st[i + 1];
  if (a.hard) return stopRgba(a);
  const t = curveProgress(a, (pos - a.pos) / Math.max(1e-9, b.pos - a.pos));
  return mixColors(stopRgba(a), stopRgba(b), t, layer.space);
}

export interface RampStop { offset: number; color: RGBA }

/** Normalised 0…1 stop list covering [lo, hi] — sampled when the target cannot represent the ramp directly. */
export function rampStops(layer: GradientLayer): RampStop[] {
  const st = sortedStops(layer.stops), { lo, hi } = rampRange(layer), span = Math.max(1e-9, hi - lo);
  const out: RampStop[] = [];
  const off = (p: number) => (p - lo) / span;
  st.forEach((s, i) => {
    const nx = st[i + 1], c = stopRgba(s);
    out.push({ offset: off(s.pos), color: c });
    if (!nx) return;
    if (s.hard) { out.push({ offset: off(nx.pos), color: c }); return; }
    const curved = !!s.curve;
    if (curved || layer.space !== 'srgb' || Math.abs((s.mid ?? 50) - 50) > 0.5) {
      const steps = Math.max(3, Math.ceil(((nx.pos - s.pos) / span) * (curved ? 48 : 24)));
      for (let k = 1; k < steps; k++) { const p = s.pos + ((nx.pos - s.pos) * k) / steps; out.push({ offset: off(p), color: colorAtPos(layer, p) }); }
    }
  });
  // enforce non-decreasing offsets
  let last = 0;
  return out.map(o => { last = Math.max(last, o.offset); return { ...o, offset: last }; });
}

export const rgbaOf = (hex: string, alpha: number) => toRgba(hex, alpha);
