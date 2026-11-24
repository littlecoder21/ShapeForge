import { clamp01, hexToHsl, hslToHex, hexToRgb, mixColors, rgbToHex, toRgba, type RGBA } from './color';
import { sortedStops, type ColorStop, type GradientLayer, type RampShaping } from './model';
import { activeEffects } from './effects';
import { distributionWarp, edgeFade, falloff as lightFalloff, seamWeight, shapeTransition, type EasingName } from './transitions';

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

export type CurvePreset = keyof typeof CURVE_PRESETS | 'custom' | 'midpoint' | EasingName;

/** Progress 0…1 from one stop to the next after its transition shape: a custom cubic-bezier (which wins over everything, as it always
 *  has), or a named easing, then the midpoint bias. Every renderer — CSS sampling, SVG, canvas, the WebGL palette LUT — calls this. */
export function curveProgress(stop: ColorStop, progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  if (stop.curve) return shapeTransition(t, { bezier: stop.curve });
  const mid = stop.mid !== undefined && Math.abs(stop.mid - 50) >= 0.5 ? Math.min(0.995, Math.max(0.005, stop.mid / 100)) : undefined;
  return shapeTransition(t, { easing: stop.ease, mid });
}

/** True when the transition out of this stop is anything other than a straight, unbiased mix. */
export const isShapedTransition = (stop: ColorStop) => !!stop.curve || (!!stop.ease && stop.ease !== 'linear');

export function curvePreset(stop: ColorStop): CurvePreset {
  if (!stop.curve) {
    if (stop.ease && stop.ease !== 'linear') return stop.ease;
    return stop.mid !== undefined && Math.abs(stop.mid - 50) >= 0.5 ? 'midpoint' : 'linear';
  }
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

/** The colour a renderer should paint at `pos`: the raw ramp, or — when stop effects or ramp shaping apply — the baked ramp. SVG conic
 *  wedges and curve bands read this so they agree with the CSS, canvas and WebGL output. (`colorAtPos` stays the raw ramp for editing.) */
export function shapedColorAt(layer: GradientLayer, pos: number): RGBA {
  const ramp = smoothedRamp(layer);
  if (!ramp) return colorAtPos(layer, pos);
  if (pos <= ramp[0].pos) return ramp[0].color;
  const last = ramp[ramp.length - 1];
  if (pos >= last.pos) return last.color;
  let lo = 0, hi = ramp.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ramp[mid].pos <= pos) lo = mid; else hi = mid; }
  const a = ramp[lo], b = ramp[hi];
  return mixColors(a.color, b.color, (pos - a.pos) / Math.max(1e-9, b.pos - a.pos), 'srgb');
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

/** The ramp shaping that applies to this kind of gradient. A leftover value that does not fit (a conic seam on a radial gradient)
 *  is inert, so switching a layer's type never leaves a hidden effect behind. */
export function activeShaping(layer: Pick<GradientLayer, 'type' | 'shaping'>): RampShaping | null {
  const s = layer.shaping;
  if (!s) return null;
  const out: RampShaping = {};
  if (s.distribution) out.distribution = s.distribution;
  if (s.edge && layer.type !== 'conic') out.edge = s.edge;
  if (s.falloff && s.falloff !== 'none' && layer.type === 'radial') { out.falloff = s.falloff; out.falloffStrength = s.falloffStrength ?? 50; }
  if (s.seam && layer.type === 'conic') out.seam = s.seam;
  return Object.keys(out).length ? out : null;
}

function bakeSmoothedRamp(layer: GradientLayer): RampSample[] | null {
  const reaches = stopReaches(layer.stops), shaping = activeShaping(layer);
  if (!reaches.length && !shaping) return null;
  const st = sortedStops(layer.stops), lo = st[0].pos, hi = st[st.length - 1].pos, span = hi - lo;
  if (span < 1e-6) return null;
  const base = sampler(layer), spatial = reaches.filter(r => r.kind !== 'bleed');
  // Sample density follows the narrowest radius so a tight blur is not under-sampled (≈ 80–120 stops at most; shaped ramps use ≥ 128
  // samples so a long soft falloff never shows steps).
  const narrow = reaches.length ? Math.min(...reaches.map(r => r.radius)) : Infinity;
  const step = shaping
    ? Math.max(span / 192, Math.min(span / 128, narrow / 4))
    : Math.max(span / 120, Math.min(span / 80, narrow / 4));
  const sigmaAt = (p: number) => spatial.reduce((sigma, r) => Math.max(sigma, r.radius * (r.kind === 'blur' ? 0.4 : 0.3) * falloff(p - r.pos, r.radius)), 0);

  // the stop-effect smoothing (blur / bleed / glow), evaluated at a ramp position
  const smoothAt = (p: number): RGBA => {
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

  const seamWidth = (shaping?.seam ?? 0) / 100;
  const startColor = seamWidth > 0 ? smoothAt(lo) : null;
  const at = (p: number): RGBA => {
    if (!shaping) return smoothAt(p);
    const u = (p - lo) / span;
    let c = smoothAt(lo + span * distributionWarp(u, shaping.distribution ?? 0));
    if (startColor) {
      const w = seamWeight(u, seamWidth);
      if (w > 0) c = mixColors(c, startColor, w, layer.space);
    }
    const factor = edgeFade(u, ((shaping.edge ?? 0) / 100) * 0.7) * (shaping.falloff ? lightFalloff(shaping.falloff, u, (shaping.falloffStrength ?? 50) / 100) : 1);
    return factor < 1 ? { ...c, a: c.a * factor } : c;
  };

  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  const positions = new Set<number>([round(hi)]);
  for (let p = lo; p < hi - 1e-9; p += step) positions.add(round(p));
  st.forEach((s, i) => {
    positions.add(round(s.pos));
    const next = st[i + 1];
    // a hard edge that no blur touches stays a hard edge: sample just before it so the colour does not ramp across the gap
    if (s.hard && next && next.pos - s.pos > 1e-3 && sigmaAt(next.pos) < 0.02 && !shaping?.distribution) positions.add(round(next.pos - 1e-4));
  });
  return [...positions].sort((a, b) => a - b).map(pos => ({ pos, color: at(pos) }));
}

const smoothCache = new WeakMap<ColorStop[], { key: string; ramp: RampSample[] | null }>();

/** The baked ramp — stop smoothing effects and ramp shaping applied — or null when there are none (the ramp is then used exactly as it is). */
export function smoothedRamp(layer: GradientLayer): RampSample[] | null {
  const key = `${layer.space}|${layer.type}|${JSON.stringify(activeShaping(layer))}`;
  const hit = smoothCache.get(layer.stops);
  if (hit && hit.key === key) return hit.ramp;
  const ramp = bakeSmoothedRamp(layer);
  smoothCache.set(layer.stops, { key, ramp });
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
    const curved = isShapedTransition(s);
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
