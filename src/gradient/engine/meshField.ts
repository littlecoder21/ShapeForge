import { clamp01, decodeColor, ditherAt, encodeColor, hexToUnit, linearToOklab, oklabToLinear, srgbToLinear, linearToSrgb, type Vec3 } from './colorScience';
import { fbm, hash2, rng } from './fieldNoise';
import { normalizeMeshField, type MeshFieldSettings } from './meshFieldSettings';

/* Smooth mesh colour field renderer (CPU reference). One pure function evaluates the field at any (u, v); the CPU fallback,
 * the unit tests and the GPU shader all implement exactly this maths. Cost is points × pixels, so CPU previews render at a reduced
 * size and are scaled up smoothly (the field is smooth by construction).
 *
 * Each pixel blends all point colours with kernel weights w_i = exp(logit_i − max logit). Working with logits and subtracting the
 * maximum keeps the blend defined everywhere (no underflow gaps far from every point) and keeps it differentiable, so there are no
 * visible cell boundaries or hard circles unless the "Soft cells" method with high sharpness asks for them. */

export interface MeshFieldPointInput {
  x: number; y: number; color: string; alpha: number;
  /** radius, % of canvas width (same unit as MeshPoint.size) */
  size: number;
  core?: number;
  strength?: number; aspect?: number; angle?: number;
  transform?: { x?: number; y?: number; scale?: number };
}
export interface MeshFieldInput { points: readonly MeshFieldPointInput[]; base?: string; core?: number; seed?: number }

export interface PreparedMeshField {
  n: number;
  settings: MeshFieldSettings;
  aspect: number;
  /** canvas height in width units */
  H: number;
  time: number;
  seed: number;
  base: Vec3 | null;
  cx: Float64Array; cy: Float64Array; cs: Float64Array; sn: Float64Array; ix: Float64Array; iy: Float64Array;
  lnS: Float64Array; plateau: Float64Array; alpha: Float64Array;
  e0: Float64Array; e1: Float64Array; e2: Float64Array;
  conf: Float64Array;
  lw: Float64Array;
  warpAmt: number;
  phase: number[];
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function prepareMeshField(input: MeshFieldInput, raw: Partial<MeshFieldSettings> | undefined, aspect: number, time = 0): PreparedMeshField {
  const settings = normalizeMeshField(raw);
  const pts = input.points.slice(0, 128), n = pts.length, H = 1 / Math.max(0.05, aspect);
  const f64 = () => new Float64Array(n);
  const p: PreparedMeshField = {
    n, settings, aspect, H, time, seed: input.seed ?? 7,
    base: input.base ? hexToUnit(input.base) : null,
    cx: f64(), cy: f64(), cs: f64(), sn: f64(), ix: f64(), iy: f64(), lnS: f64(), plateau: f64(), alpha: f64(), e0: f64(), e1: f64(), e2: f64(), conf: f64(), lw: f64(),
    warpAmt: settings.warp * 0.13, phase: [],
  };
  const r = rng((input.seed ?? 7) * 977 + 5);
  p.phase = Array.from({ length: 6 }, () => r());
  const meshCore = input.core ?? 40;
  pts.forEach((pt, i) => {
    const t = pt.transform ?? {};
    p.cx[i] = (pt.x + (t.x ?? 0)) / 100;
    p.cy[i] = ((pt.y + (t.y ?? 0)) / 100) * H;
    const radius = Math.max(0.01, (pt.size * (t.scale ?? 1)) / 100) * settings.spread;
    const stretch = Math.sqrt(Math.min(4, Math.max(0.25, pt.aspect ?? 1)));
    const angle = ((pt.angle ?? 0) * Math.PI) / 180;
    p.cs[i] = Math.cos(angle); p.sn[i] = Math.sin(angle);
    p.ix[i] = 1 / (radius * stretch); p.iy[i] = stretch / radius;
    p.lnS[i] = Math.log(Math.max(1e-4, pt.strength ?? 1));
    p.plateau[i] = (Math.min(100, Math.max(0, pt.core ?? meshCore)) / 100) * 0.3;
    p.alpha[i] = clamp01(pt.alpha);
    const e = encodeColor(hexToUnit(pt.color), settings.space);
    p.e0[i] = e[0]; p.e1[i] = e[1]; p.e2[i] = e[2];
    // OKLCH: greys have no meaningful hue, so they must not drag the blended hue around
    p.conf[i] = settings.space === 'oklch' ? e[1] / (e[1] + 0.03) : 1;
  });
  return p;
}

/** Kernel logit (log of the unnormalised weight) for one point at normalised squared distance q2. */
function logit(f: PreparedMeshField, i: number, q2: number): number {
  const sharp = f.settings.sharpness;
  switch (f.settings.method) {
    // The constants below are calibrated so that at the default sharpness every point's own colour stays clearly visible at its
    // centre while neighbouring colours still blend smoothly (too wide a kernel averages everything into a muddy diagonal).
    case 'idw': return f.lnS[i] - 0.5 * mix(1.6, 4.2, sharp) * Math.log(q2 + 0.03);
    case 'imq': { const e = mix(2.5, 9, sharp); return f.lnS[i] - Math.log(1 + e * e * q2); }
    case 'wendland': {
      const q = Math.sqrt(q2) / mix(2, 0.9, sharp);
      const w = q < 1 ? (1 - q) ** 4 * (4 * q + 1) : 0;
      return f.lnS[i] + Math.log(w + 2e-4 / (1 + q2));
    }
    case 'cells': return f.lnS[i] - q2 / (1.0 * 0.03 ** sharp);
    default: { // gaussian with a flat core: the point holds its colour out to `plateau` before it starts to fall away
      const e = Math.max(0, Math.sqrt(q2) - f.plateau[i]);
      return f.lnS[i] - mix(2.5, 16, sharp) * e * e;
    }
  }
}

const TAU = Math.PI * 2;
/** Evaluates the field at canvas coordinates u, v (0…1, v down). Writes straight-alpha sRGB r, g, b, a (0…1) into `out`. */
export function sampleMeshField(f: PreparedMeshField, u: number, v: number, out: ArrayLike<number> & { [i: number]: number }): void {
  const s = f.settings, n = f.n;
  if (!n) { out[0] = out[1] = out[2] = 0; out[3] = 0; return; }
  let X = u, Y = v * f.H;
  if (f.warpAmt > 0) {
    const t = f.time * s.flow * 0.15, A = f.warpAmt;
    if (s.edge === 'wrap') { // periodic sinusoid warp: still tiles seamlessly
      const m = Math.max(1, Math.round(s.warpScale / 1.5)), p = f.phase, ph = t * TAU;
      X += A * (Math.sin(TAU * (m * u + 2 * v + p[0]) + ph) + 0.5 * Math.sin(TAU * (2 * m * u - v + p[1]) - ph * 1.3));
      Y += A * (Math.sin(TAU * (2 * u + m * v + p[2]) - ph) + 0.5 * Math.sin(TAU * (-u + 3 * m * v + p[3]) + ph * 0.8));
    } else {
      const k = s.warpScale, qx = fbm(X * k + t, Y * k, f.seed, 2), qy = fbm(X * k + 5.2, Y * k + 1.3 - t, f.seed + 7, 2);
      X += fbm(X * k + 3 * qx + 1.7, Y * k + 3 * qy + 9.2, f.seed + 13, 2) * A * 2.2;
      Y += fbm(X * k + 3 * qx + 8.3, Y * k + 3 * qy + 2.8, f.seed + 19, 2) * A * 2.2;
    }
  }
  const wrap = s.edge === 'wrap', lw = f.lw;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    let dx = X - f.cx[i], dy = Y - f.cy[i];
    if (wrap) { dx -= Math.round(dx); dy -= Math.round(dy / f.H) * f.H; }
    const rx = (dx * f.cs[i] + dy * f.sn[i]) * f.ix[i], ry = (dy * f.cs[i] - dx * f.sn[i]) * f.iy[i];
    const l = logit(f, i, rx * rx + ry * ry);
    lw[i] = l;
    if (l > max) max = l;
  }
  let sum = 0, a0 = 0, a1 = 0, a2 = 0, alpha = 0, raw = 0;
  const lch = s.space === 'oklch', fade = s.edge === 'fade';
  for (let i = 0; i < n; i++) {
    const w = Math.exp(lw[i] - max);
    sum += w; alpha += w * f.alpha[i];
    if (fade) raw += Math.exp(lw[i]) * f.alpha[i];
    if (lch) { const c = f.conf[i]; a0 += w * f.e0[i]; a1 += w * f.e1[i]; a2 += w * c * Math.cos(f.e2[i]); /* a2 = Σ w·conf·cos h */ lw[i] = w * c * Math.sin(f.e2[i]); }
    else { a0 += w * f.e0[i]; a1 += w * f.e1[i]; a2 += w * f.e2[i]; }
  }
  const inv = 1 / Math.max(sum, 1e-30);
  let rgb: Vec3;
  if (lch) {
    let hy = 0;
    for (let i = 0; i < n; i++) hy += lw[i];
    rgb = decodeColor([a0 * inv, a1 * inv, Math.atan2(hy * inv, a2 * inv)], 'oklch');
  } else rgb = decodeColor([a0 * inv, a1 * inv, a2 * inv], s.space);
  if (s.saturation !== 1 || s.contrast !== 1) rgb = grade(rgb, s.saturation, s.contrast);
  let a = clamp01(alpha * inv);
  if (fade) a *= 1 - Math.exp(-3 * raw);
  if (f.base) {
    out[0] = rgb[0] * a + f.base[0] * (1 - a); out[1] = rgb[1] * a + f.base[1] * (1 - a); out[2] = rgb[2] * a + f.base[2] * (1 - a); out[3] = 1;
  } else { out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2]; out[3] = a; }
}

/** Saturation and contrast in OKLab (chroma scale, lightness pivot at 0.5), so grading does not shift hue. */
function grade(rgb: Vec3, saturation: number, contrast: number): Vec3 {
  const lab = linearToOklab(srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2]));
  const L = Math.min(1, Math.max(0, 0.5 + (lab[0] - 0.5) * contrast));
  let lin = oklabToLinear(L, lab[1] * saturation, lab[2] * saturation);
  if (lin.some(c => c < -1e-4 || c > 1.0001)) lin = oklabToLinear(L, lab[1] * saturation * 0.7, lab[2] * saturation * 0.7);
  return [clamp01(linearToSrgb(lin[0])), clamp01(linearToSrgb(lin[1])), clamp01(linearToSrgb(lin[2]))];
}

export interface RenderMeshFieldOptions { time?: number; aspect?: number; seed?: number }

/** Renders an already prepared field to straight-alpha RGBA bytes. Grain and dither are applied per output pixel. */
export function renderPreparedMeshField(f: PreparedMeshField, width: number, height: number): Uint8ClampedArray {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const data = new Uint8ClampedArray(w * h * 4), px = new Float32Array(4), grain = f.settings.grain, seed = f.seed | 0;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      sampleMeshField(f, (x + 0.5) / w, v, px);
      const g = ditherAt(x, y) / 255 + (grain > 0 ? (hash2(x, y, seed) - 0.5) * grain * 0.1 : 0), o = (y * w + x) * 4;
      data[o] = (px[0] + g) * 255 + 0.5; data[o + 1] = (px[1] + g) * 255 + 0.5; data[o + 2] = (px[2] + g) * 255 + 0.5; data[o + 3] = px[3] * 255 + 0.5;
    }
  }
  return data;
}

/** Renders the field to straight-alpha RGBA bytes. */
export function renderMeshField(input: MeshFieldInput, settings: Partial<MeshFieldSettings> | undefined, width: number, height: number, opts: RenderMeshFieldOptions = {}): Uint8ClampedArray {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const field = prepareMeshField(input, settings, opts.aspect ?? w / h, opts.time ?? 0);
  if (opts.seed !== undefined) field.seed = opts.seed;
  return renderPreparedMeshField(field, w, h);
}
