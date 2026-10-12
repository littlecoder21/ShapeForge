import { blurOf } from './effects';
import type { GradientLayer } from './model';

/* Shared geometry — used by CSS, SVG, canvas and the on-canvas handles so they can never disagree. */

export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
export const normDeg = (a: number) => ((a % 360) + 360) % 360;
export type Canvas = { w: number; h: number };
export type Pt = { x: number; y: number };

/** CSS gradient line for a given angle in a w × h box: unit direction, length and endpoints. */
export function linearLine(angle: number, w: number, h: number) {
  const a = rad(angle), dx = Math.sin(a), dy = -Math.cos(a);
  const L = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  return { dx, dy, L, x1: w / 2 - (dx * L) / 2, y1: h / 2 - (dy * L) / 2, x2: w / 2 + (dx * L) / 2, y2: h / 2 + (dy * L) / 2 };
}

/** Radial radii in canvas px. */
export function radii(layer: GradientLayer, c: Canvas) {
  if (layer.shape === 'circle') { const r = (layer.rx / 100) * Math.min(c.w, c.h); return { rx: r, ry: r }; }
  return { rx: (layer.rx / 100) * c.w, ry: (layer.ry / 100) * c.h };
}

/** Bleed fraction: blurred layers are drawn on a larger box so their edges do not fade out. */
export function bleedOf(layer: GradientLayer, c: Canvas) {
  const px = blurOf(layer.effects);
  const b = px > 0 ? Math.min(0.5, px / Math.min(c.w, c.h)) : 0;
  return Math.round(b * 1000) / 1000;
}

/** Pivot (transform origin) in canvas px: radial/conic rotate around their centre, linear around the box centre. */
export function pivotOf(layer: GradientLayer, c: Canvas): Pt {
  return layer.type === 'radial' || layer.type === 'conic' ? { x: (layer.cx / 100) * c.w, y: (layer.cy / 100) * c.h } : { x: c.w / 2, y: c.h / 2 };
}

export type Mat = [number, number, number, number, number, number]; // a b c d e f  (x' = a x + c y + e)
export const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m: Mat, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Layer local → canvas matrix. Mirrors the CSS: transform-origin: pivot; transform: translate rotate skew scale. */
export function layerMatrix(layer: GradientLayer, c: Canvas): Mat {
  const t = layer.transform, o = pivotOf(layer, c);
  const tr: Mat = [1, 0, 0, 1, (t.x / 100) * c.w, (t.y / 100) * c.h];
  const r = rad(t.rotate), rot: Mat = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
  const sk: Mat = [1, Math.tan(rad(t.skewY)), Math.tan(rad(t.skewX)), 1, 0, 0];
  const sc: Mat = [t.scale, 0, 0, t.scale, 0, 0];
  const toO: Mat = [1, 0, 0, 1, o.x, o.y], fromO: Mat = [1, 0, 0, 1, -o.x, -o.y];
  return mul(mul(mul(mul(mul(toO, tr), rot), sk), sc), fromO);
}
export const isIdentityTransform = (l: GradientLayer) => { const t = l.transform; return !t.x && !t.y && !t.rotate && !t.skewX && !t.skewY && t.scale === 1; };

/** Length (px) of one full stop range along the gradient axis: the unit stop positions are measured in. */
export function axisLength(layer: GradientLayer, c: Canvas) {
  if (layer.type === 'linear') return linearLine(layer.angle, c.w, c.h).L;
  if (layer.type === 'radial') return radii(layer, c).ry;
  return 360;
}
/** Period (in px for linear/radial, degrees for conic) of one repetition. */
export function periodOf(layer: GradientLayer, c: Canvas) {
  const { size, unit } = layer.repeat;
  if (layer.type === 'conic') return unit === '%' ? (size / 100) * 360 : size;
  if (unit === '%') return (size / 100) * (layer.type === 'linear' ? linearLine(layer.angle, c.w, c.h).L : radii(layer, c).ry);
  return size;
}
export function offsetOf(layer: GradientLayer, c: Canvas) {
  const { offset, unit } = layer.repeat;
  if (layer.type === 'conic') return unit === '%' ? (offset / 100) * 360 : offset;
  if (unit === '%') return (offset / 100) * (layer.type === 'linear' ? linearLine(layer.angle, c.w, c.h).L : radii(layer, c).ry);
  return offset;
}
/** Where stop `pos` (0…100) lies along the axis, in px (linear/radial) or degrees (conic). */
export function stopAxisValue(layer: GradientLayer, c: Canvas, pos: number) {
  if (layer.repeating) return offsetOf(layer, c) + (pos / 100) * periodOf(layer, c);
  return (pos / 100) * axisLength(layer, c);
}
/** Inverse of stopAxisValue. */
export function axisValueToPos(layer: GradientLayer, c: Canvas, v: number) {
  if (layer.repeating) { const per = periodOf(layer, c) || 1; return ((v - offsetOf(layer, c)) / per) * 100; }
  return (v / (axisLength(layer, c) || 1)) * 100;
}

