/* Colour helpers: parsing, HSL, OKLab/OKLCH interpolation. Pure functions; the colour-space maths comes from colorScience.ts. */
import { decodeColor, linearToOklab, linearToSrgb, mixHue, srgbToLinear } from './colorScience';

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

/* ───────── OKLab / OKLCH ─────────
 * The conversions live in colorScience.ts (one implementation for the whole studio). Colours that leave the sRGB gamut when mixed are
 * brought back by reducing chroma at constant lightness and hue — never by clipping each channel, which shifts the hue. */
const toLin = (c: number) => srgbToLinear(c / 255);
const fromLin = (c: number) => 255 * linearToSrgb(c);
export type Lab = { L: number; a: number; b: number };
export function rgbToOklab({ r, g, b }: RGB): Lab {
  const [L, a, bb] = linearToOklab(toLin(r), toLin(g), toLin(b));
  return { L, a, b: bb };
}
export function oklabToRgb({ L, a, b }: Lab): RGB {
  const [r, g, bb] = decodeColor([L, a, b], 'oklab');
  return { r: r * 255, g: g * 255, b: bb * 255 };
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
  const C = C1 * q1 + C2 * q2, h = mixHue(Math.atan2(l1.b, l1.a), C1, Math.atan2(l2.b, l2.a), C2, t);
  return { ...oklabToRgb({ L: l1.L * q1 + l2.L * q2, a: C * Math.cos(h), b: C * Math.sin(h) }), a };
}

export const toRgba = (hex: string, alpha: number): RGBA => ({ ...hexToRgb(hex), a: alpha });
export const rgbaCss = (c: RGBA) => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(clamp01(c.a) * 1000) / 1000})`;
