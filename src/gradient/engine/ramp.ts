import { clamp01, hexToHsl, hslToHex, hexToRgb, mixColors, rgbToHex, toRgba, type RGBA } from './color';
import { sortedStops, type ColorStop, type GradientLayer } from './model';
import { activeEffects } from './effects';

/* Colour ramp evaluation with CSS semantics (hard stops, colour hints, curves, interpolation space).
 * SVG and canvas have no equivalent of hints / custom curves / oklab, so they sample this ramp. */

export const stopRgba = (s: ColorStop | { color: string; alpha: number; effects?: ColorStop['effects'] }): RGBA => {
  let rgb = hexToRgb(s.color);
  const effects = 'effects' in s ? activeEffects(s.effects ?? []) : [];
  effects.forEach(effect => {
    const params = effect.params;
    if (effect.type === 'brightness' || effect.type === 'contrast') {
      const amount = (params.amount ?? 100) / 100;
      const offset = effect.type === 'contrast' ? 127.5 * (1 - amount) : 0;
      rgb = {
        r: Math.max(0, Math.min(255, rgb.r * amount + offset)),
        g: Math.max(0, Math.min(255, rgb.g * amount + offset)),
        b: Math.max(0, Math.min(255, rgb.b * amount + offset)),
      };
    } else if (effect.type === 'hue' || effect.type === 'color-drift') {
      // rgbToHex rounds and clamps — brightness / contrast leave fractional channels that must never reach a hex string
      const hsl = hexToHsl(rgbToHex(rgb));
      rgb = hexToRgb(hslToHex(hsl.h + (params.angle ?? params.hue ?? 0), hsl.s * ((params.amount ?? 100) / 100), hsl.l));
    } else if (effect.type === 'saturate') {
      const hsl = hexToHsl(rgbToHex(rgb));
      rgb = hexToRgb(hslToHex(hsl.h, hsl.s * ((params.amount ?? 100) / 100), hsl.l));
    } else if (effect.type === 'grayscale') {
      const gray = rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114;
      const amount = (params.amount ?? 100) / 100;
      rgb = {
        r: rgb.r * (1 - amount) + gray * amount,
        g: rgb.g * (1 - amount) + gray * amount,
        b: rgb.b * (1 - amount) + gray * amount,
      };
    }
  });
  return { ...rgb, a: s.alpha };
};

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

/* ═══════════════════════════ Stop smoothing ═══════════════════════════
 * A stop can carry Blur, Colour bleed and Glow effects. A CSS gradient has no such thing, so the ramp is *baked*: the
 * smoothed colour is sampled along the gradient line and written out as plain colour stops. Every renderer — layer CSS, the
 * flat background, the stop bar, SVG and canvas — reads the same baked ramp, so they all agree.
 *
 *   Blur         local gaussian smoothing of the ramp. The blur is widest at the stop and fades out with distance, so the
 *                rest of the gradient stays crisp. Radius = how far (in % of the gradient) the softening reaches.
 *   Colour bleed pulls the neighbouring colours toward this stop's colour (Radius, Mix).
 *   Glow         soft blur + lightening around the stop (Radius, Intensity).
 */
export interface RampSample { pos: number; color: RGBA }
type Reach = { kind: 'blur' | 'bleed' | 'glow'; pos: number; radius: number; amount: number; color: RGBA };

const REACH_WIDTH = 1.4;                       // falloff = exp(-(distance / (radius × REACH_WIDTH))²)
const MAX_TAPS = 61;
const falloff = (distance: number, radius: number) => Math.exp(-((distance / (radius * REACH_WIDTH)) ** 2));

const stopReaches = (stops: ColorStop[]): Reach[] => {
  const out: Reach[] = [];
  sortedStops(stops).forEach(s => activeEffects(s.effects ?? []).forEach(effect => {
    const radius = Math.max(0, effect.params.radius ?? 12);
    if (radius <= 0) return;
    if (effect.type === 'blur') out.push({ kind: 'blur', pos: s.pos, radius, amount: 1, color: stopRgba(s) });
    else if (effect.type === 'color-bleed') out.push({ kind: 'bleed', pos: s.pos, radius, amount: clamp01((effect.params.amount ?? 45) / 100), color: stopRgba(s) });
    else if (effect.type === 'bloom') out.push({ kind: 'glow', pos: s.pos, radius, amount: clamp01((effect.params.intensity ?? 50) / 100), color: stopRgba(s) });
  }));
  return out;
};

/** The same maths as `colorAtPos`, with the sorted stops and their colours resolved once. */
function sampler(layer: GradientLayer) {
  const st = sortedStops(layer.stops), n = st.length, colors = st.map(stopRgba);
  return (pos: number): RGBA => {
    if (pos <= st[0].pos) return colors[0];
    if (pos >= st[n - 1].pos) return colors[n - 1];
    let i = 0;
    while (i < n - 2 && st[i + 1].pos <= pos) i++;
    const a = st[i], b = st[i + 1];
    if (a.hard) return colors[i];
    return mixColors(colors[i], colors[i + 1], curveProgress(a, (pos - a.pos) / Math.max(1e-9, b.pos - a.pos)), layer.space);
  };
}

function bakeSmoothedRamp(layer: GradientLayer): RampSample[] | null {
  const reaches = stopReaches(layer.stops);
  if (!reaches.length) return null;
  const st = sortedStops(layer.stops), lo = st[0].pos, hi = st[st.length - 1].pos, span = hi - lo;
  if (span < 1e-6) return null;
  const base = sampler(layer), spatial = reaches.filter(r => r.kind !== 'bleed');
  // Sample density follows the narrowest radius so a tight blur is not under-sampled (≈ 80–120 stops at most).
  const step = Math.max(span / 120, Math.min(span / 80, Math.min(...reaches.map(r => r.radius)) / 4));
  const sigmaAt = (p: number) => spatial.reduce((sigma, r) => Math.max(sigma, r.radius * (r.kind === 'blur' ? 0.4 : 0.3) * falloff(p - r.pos, r.radius)), 0);

  const at = (p: number): RGBA => {
    const sigma = sigmaAt(p);
    let c: RGBA;
    if (sigma < 0.02) c = base(Math.min(hi, Math.max(lo, p)));
    else {
      // gaussian taps over ±3σ, spaced finer than the output stops so a hard edge blurs into a smooth ramp, not a staircase
      const half = Math.min((MAX_TAPS - 1) / 2, Math.max(6, Math.ceil((3 * sigma) / (step * 0.5))));
      let alpha = 0, red = 0, green = 0, blue = 0, weight = 0;
      for (let k = -half; k <= half; k++) {
        const t = (3 * k) / half, w = Math.exp(-0.5 * t * t), q = base(Math.min(hi, Math.max(lo, p + t * sigma)));
        alpha += q.a * w; red += q.r * q.a * w; green += q.g * q.a * w; blue += q.b * q.a * w; weight += w;
      }
      c = alpha > 1e-9 ? { r: red / alpha, g: green / alpha, b: blue / alpha, a: alpha / weight } : { r: 0, g: 0, b: 0, a: 0 };
    }
    for (const r of reaches) {
      const k = falloff(p - r.pos, r.radius);
      if (r.kind === 'bleed') c = mixColors(c, r.color, r.amount * k, layer.space);
      else if (r.kind === 'glow') { const lift = Math.min(1, r.amount * 0.6 * k); c = { r: c.r + (255 - c.r) * lift, g: c.g + (255 - c.g) * lift, b: c.b + (255 - c.b) * lift, a: c.a }; }
    }
    return c;
  };

  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  const positions = new Set<number>([round(hi)]);
  for (let p = lo; p < hi - 1e-9; p += step) positions.add(round(p));
  st.forEach((s, i) => {
    positions.add(round(s.pos));
    const next = st[i + 1];
    // a hard edge that no blur touches stays a hard edge: sample just before it so the colour does not ramp across the gap
    if (s.hard && next && next.pos - s.pos > 1e-3 && sigmaAt(next.pos) < 0.02) positions.add(round(next.pos - 1e-4));
  });
  return [...positions].sort((a, b) => a - b).map(pos => ({ pos, color: at(pos) }));
}

const smoothCache = new WeakMap<ColorStop[], { space: string; ramp: RampSample[] | null }>();

/** The baked, smoothed ramp — or null when no stop carries a smoothing effect (the ramp is then used exactly as it is). */
export function smoothedRamp(layer: GradientLayer): RampSample[] | null {
  const hit = smoothCache.get(layer.stops);
  if (hit && hit.space === layer.space) return hit.ramp;
  const ramp = bakeSmoothedRamp(layer);
  smoothCache.set(layer.stops, { space: layer.space, ramp });
  return ramp;
}

export interface RampStop { offset: number; color: RGBA }

/** Normalised 0…1 stop list covering [lo, hi] — sampled when the target cannot represent the ramp directly. */
export function rampStops(layer: GradientLayer): RampStop[] {
  const st = sortedStops(layer.stops), { lo, hi } = rampRange(layer), span = Math.max(1e-9, hi - lo);
  const off = (p: number) => (p - lo) / span;
  const smooth = smoothedRamp(layer);
  if (smooth) {
    let previous = 0;
    return smooth.map(s => { previous = Math.max(previous, off(s.pos)); return { offset: previous, color: s.color }; });
  }
  const out: RampStop[] = [];
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
