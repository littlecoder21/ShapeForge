/* Shared colour science for every field renderer (mesh field, scene builders, ramps, exports).
 *
 * Everything works on unit-range floats (0…1) so the same maths runs per pixel without allocating objects.
 * The preview, PNG and SVG exports all call these functions, which is what keeps them visually identical.
 *
 *   sRGB      gamma-encoded, what CSS blends in by default (muddy midpoints between saturated hues)
 *   linear    physically-correct light mixing (bright, glowing mixes; good for light and glow)
 *   OKLab     perceptually uniform: even lightness steps, no grey dip between complementary colours
 *   OKLCH     OKLab in polar form: hue-aware mixing that keeps chroma (rainbow-like transitions)
 */

export type Vec3 = [number, number, number];
export type FieldSpace = 'srgb' | 'linear' | 'oklab' | 'oklch';
export const FIELD_SPACES: readonly FieldSpace[] = ['srgb', 'linear', 'oklab', 'oklch'];

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a || 1e-9)); return t * t * (3 - 2 * t); };

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

/** `#rgb` / `#rrggbb` → sRGB unit floats. Unreadable input becomes black. */
export function hexToUnit(hex: string): Vec3 {
  let h = (hex || '').trim().replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : [0, 0, 0];
}
const h2 = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
export const unitToHex = (c: Vec3) => `#${h2(c[0])}${h2(c[1])}${h2(c[2])}`;

export function linearToOklab(r: number, g: number, b: number): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function oklabToLinear(L: number, a: number, b: number): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** sRGB unit colour → the interpolation space's coordinates (OKLCH is [L, C, hue radians]). */
export function encodeColor(rgb: Vec3, space: FieldSpace): Vec3 {
  if (space === 'srgb') return [rgb[0], rgb[1], rgb[2]];
  const lin: Vec3 = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
  if (space === 'linear') return lin;
  const lab = linearToOklab(lin[0], lin[1], lin[2]);
  return space === 'oklab' ? lab : [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
}

const inGamut = (c: Vec3) => c[0] >= -1e-4 && c[0] <= 1.0001 && c[1] >= -1e-4 && c[1] <= 1.0001 && c[2] >= -1e-4 && c[2] <= 1.0001;

/** Coordinates of an interpolation space → displayable sRGB unit colour.
 *  Out-of-gamut OKLab colours are brought back by reducing chroma at constant lightness and hue, never by hard clipping each channel,
 *  so a bright saturated mix keeps its hue instead of shifting toward yellow or cyan. */
export function decodeColor(v: Vec3, space: FieldSpace): Vec3 {
  if (space === 'srgb') return [clamp01(v[0]), clamp01(v[1]), clamp01(v[2])];
  if (space === 'linear') return [clamp01(linearToSrgb(v[0])), clamp01(linearToSrgb(v[1])), clamp01(linearToSrgb(v[2]))];
  let L = v[0], a: number, b: number;
  if (space === 'oklch') { a = v[1] * Math.cos(v[2]); b = v[1] * Math.sin(v[2]); } else { a = v[1]; b = v[2]; }
  L = L < 0 ? 0 : L > 1 ? 1 : L;
  let lin = oklabToLinear(L, a, b);
  if (!inGamut(lin)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 12; i++) {
      const k = (lo + hi) / 2, t = oklabToLinear(L, a * k, b * k);
      if (inGamut(t)) lo = k; else hi = k;
    }
    lin = oklabToLinear(L, a * lo, b * lo);
  }
  return [clamp01(linearToSrgb(lin[0])), clamp01(linearToSrgb(lin[1])), clamp01(linearToSrgb(lin[2]))];
}

/** Shortest-arc hue interpolation for OKLCH; a near-grey colour adopts the other colour's hue so it cannot swing the mix. */
export function mixHue(h1: number, c1: number, h2v: number, c2: number, t: number): number {
  if (c1 < 1e-3) h1 = h2v; else if (c2 < 1e-3) h2v = h1;
  let d = h2v - h1;
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return h1 + d * t;
}

/** Interpolates two already-encoded colours. Hue-aware for OKLCH, plain per-channel otherwise. */
export function mixEncoded(a: Vec3, b: Vec3, t: number, space: FieldSpace): Vec3 {
  if (space === 'oklch') return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), mixHue(a[2], a[1], b[2], b[1], t)];
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Convenience for one-off mixes (palette building, tests). Per-pixel code should encode once and call `mixEncoded`. */
export function mixRgb(a: Vec3, b: Vec3, t: number, space: FieldSpace = 'oklab'): Vec3 {
  return decodeColor(mixEncoded(encodeColor(a, space), encodeColor(b, space), t, space), space);
}

/** Relative luminance (Rec.709, linear light) of an sRGB unit colour. */
export const luminance = (c: Vec3) => 0.2126 * srgbToLinear(c[0]) + 0.7152 * srgbToLinear(c[1]) + 0.0722 * srgbToLinear(c[2]);

/** Interleaved-gradient dither in −0.5…0.5: add `ditherAt(x, y) / 255` before quantising to 8 bits to remove banding in smooth fields. */
export const ditherAt = (x: number, y: number) => { const v = 52.9829189 * (0.06711056 * x + 0.00583715 * y); return v - Math.floor(v) - 0.5; };
