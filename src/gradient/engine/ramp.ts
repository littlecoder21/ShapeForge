import { hexToRgb, mixColors, toRgba, type RGBA } from './color';
import { sortedStops, type GradientLayer } from './model';

/* Colour ramp evaluation with CSS semantics (hard stops, colour hints, interpolation space).
 * SVG and canvas have no equivalent of hints / hard flags / oklab, so they sample this ramp. */

export const stopRgba = (s: { color: string; alpha: number }): RGBA => ({ ...hexToRgb(s.color), a: s.alpha });
export const rampRange = (layer: GradientLayer) => { const st = sortedStops(layer.stops); return { lo: st[0].pos, hi: st[st.length - 1].pos }; };

export function colorAtPos(layer: GradientLayer, pos: number): RGBA {
  const st = sortedStops(layer.stops), n = st.length;
  if (pos <= st[0].pos) return stopRgba(st[0]);
  if (pos >= st[n - 1].pos) return stopRgba(st[n - 1]);
  let i = 0;
  while (i < n - 2 && st[i + 1].pos <= pos) i++;
  const a = st[i], b = st[i + 1];
  if (a.hard) return stopRgba(a);
  let t = (pos - a.pos) / Math.max(1e-9, b.pos - a.pos);
  const mid = (a.mid ?? 50) / 100;
  if (Math.abs(mid - 0.5) > 0.005) t = t ** (Math.log(0.5) / Math.log(Math.min(0.995, Math.max(0.005, mid))));
  return mixColors(stopRgba(a), stopRgba(b), t, layer.space);
}

export interface RampStop { offset: number; color: RGBA }

/** Normalised 0…1 stop list covering [lo, hi] — exact where the target supports it, sampled otherwise. */
export function rampStops(layer: GradientLayer): RampStop[] {
  const st = sortedStops(layer.stops), { lo, hi } = rampRange(layer), span = Math.max(1e-9, hi - lo);
  const out: RampStop[] = [];
  const off = (p: number) => (p - lo) / span;
  st.forEach((s, i) => {
    const nx = st[i + 1], c = stopRgba(s);
    out.push({ offset: off(s.pos), color: c });
    if (!nx) return;
    if (s.hard) { out.push({ offset: off(nx.pos), color: c }); return; }
    const mid = s.mid ?? 50;
    if (layer.space !== 'srgb' || Math.abs(mid - 50) > 0.5) {
      const steps = Math.max(3, Math.ceil(((nx.pos - s.pos) / span) * 24));
      for (let k = 1; k < steps; k++) { const p = s.pos + ((nx.pos - s.pos) * k) / steps; out.push({ offset: off(p), color: colorAtPos(layer, p) }); }
    }
  });
  // enforce non-decreasing offsets
  let last = 0;
  return out.map(o => { last = Math.max(last, o.offset); return { ...o, offset: last }; });
}

export const rgbaOf = (hex: string, alpha: number) => toRgba(hex, alpha);
