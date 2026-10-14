/* Colour helpers: parsing, HSL, OKLab/OKLCH interpolation. Pure functions, no dependencies. */

export type RGB = { r: number; g: number; b: number };
export type RGBA = RGB & { a: number };

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
const h2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export const rgbToHex = ({ r, g, b }: RGB) => `#${h2(r)}${h2(g)}${h2(b)}`;

/** #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() → hex + alpha. Returns null when unreadable. */
export function parseColor(input: string): { hex: string; alpha: number } | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { hex: '#000000', alpha: 0 };
  let m = s.match(/^#?([0-9a-f]{3,8})$/);
  if (m && [3, 4, 6, 8].includes(m[1].length)) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map(c => c + c).join('');
    return { hex: `#${h.slice(0, 6)}`, alpha: h.length === 8 ? Math.round(parseInt(h.slice(6), 16) / 255 * 1000) / 1000 : 1 };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { hex: rgbToHex({ r: +m[1], g: +m[2], b: +m[3] }), alpha: clamp01(a) };
  }
  return null;
}

export function rgbaString(hex: string, alpha: number) {
  if (alpha >= 0.999) return hex.toLowerCase();
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(clamp01(alpha) * 1000) / 1000})`;
}

export function hslToHex(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
}
export function hexToHsl(hex: string) {
  const { r, g, b } = hexToRgb(hex), R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

/* ───────── OKLab / OKLCH ───────── */
const toLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLin = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export type Lab = { L: number; a: number; b: number };
export function rgbToOklab({ r, g, b }: RGB): Lab {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
}
export function oklabToRgb({ L, a, b }: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: clamp(fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), 0, 255),
    g: clamp(fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), 0, 255),
    b: clamp(fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), 0, 255),
  };
}

export type Space = 'srgb' | 'srgb-linear' | 'oklab' | 'oklch';
/** Interpolate two straight (non-premultiplied) colours; premultiplied alpha is applied like CSS. */
export function mixColors(c1: RGBA, c2: RGBA, t: number, space: Space = 'srgb'): RGBA {
  const a = c1.a + (c2.a - c1.a) * t;
  const w1 = c1.a * (1 - t), w2 = c2.a * t, wsum = w1 + w2;
  const q1 = wsum > 1e-9 ? w1 / wsum : 1 - t, q2 = wsum > 1e-9 ? w2 / wsum : t;
  if (space === 'srgb') return { r: c1.r * q1 + c2.r * q2, g: c1.g * q1 + c2.g * q2, b: c1.b * q1 + c2.b * q2, a };
  if (space === 'srgb-linear') return {
    r: fromLin(toLin(c1.r) * q1 + toLin(c2.r) * q2),
    g: fromLin(toLin(c1.g) * q1 + toLin(c2.g) * q2),
    b: fromLin(toLin(c1.b) * q1 + toLin(c2.b) * q2),
    a,
  };
  const l1 = rgbToOklab(c1), l2 = rgbToOklab(c2);
  if (space === 'oklab') return { ...oklabToRgb({ L: l1.L * q1 + l2.L * q2, a: l1.a * q1 + l2.a * q2, b: l1.b * q1 + l2.b * q2 }), a };
  const C1 = Math.hypot(l1.a, l1.b), C2 = Math.hypot(l2.a, l2.b);
  let h1 = Math.atan2(l1.b, l1.a), h2 = Math.atan2(l2.b, l2.a);
  if (C1 < 1e-4) h1 = h2; if (C2 < 1e-4) h2 = h1;
  let dh = h2 - h1; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
  const C = C1 * q1 + C2 * q2, h = h1 + dh * t;
  return { ...oklabToRgb({ L: l1.L * q1 + l2.L * q2, a: C * Math.cos(h), b: C * Math.sin(h) }), a };
}

export const toRgba = (hex: string, alpha: number): RGBA => ({ ...hexToRgb(hex), a: alpha });
export const rgbaCss = (c: RGBA) => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(clamp01(c.a) * 1000) / 1000})`;
