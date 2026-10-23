import { rgbaCss } from './color';
import type { Canvas, Pt } from './geom';
import { colorAtPos } from './ramp';
import type { CurveData, GradientLayer } from './model';

export interface CurveBand { d: string; points: [Pt, Pt, Pt, Pt]; progress: number }

export function curvePoint(curve: CurveData, t: number, canvas: Canvas): Pt {
  const u = 1 - t;
  const p0 = curve.p0, p1 = curve.p1, p2 = curve.p2, p3 = curve.p3;
  return {
    x: (u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x) * canvas.w / 100,
    y: (u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y) * canvas.h / 100,
  };
}

export function curveTangent(curve: CurveData, t: number, canvas: Canvas): Pt {
  const u = 1 - t, p0 = curve.p0, p1 = curve.p1, p2 = curve.p2, p3 = curve.p3;
  const dx = 3 * u ** 2 * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t ** 2 * (p3.x - p2.x);
  const dy = 3 * u ** 2 * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t ** 2 * (p3.y - p2.y);
  const x = dx * canvas.w, y = dy * canvas.h, length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/** Each narrow band spans the canvas across the normal of the Bézier curve. */
export function curveBands(curve: CurveData, canvas: Canvas, count = 256): CurveBand[] {
  const reach = Math.hypot(canvas.w, canvas.h) * 1.5;
  const point = (t: number, side: -1 | 1) => {
    const c = curvePoint(curve, t, canvas), d = curveTangent(curve, t, canvas);
    return { x: c.x - d.y * reach * side, y: c.y + d.x * reach * side };
  };
  return Array.from({ length: count }, (_, i) => {
    const t0 = i / count, t1 = (i + 1) / count, tm = (t0 + t1) / 2;
    const a = point(t0, -1), b = point(t0, 1), c = point(t1, 1), d = point(t1, -1);
    return { d: `M${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}L${c.x.toFixed(2)} ${c.y.toFixed(2)}L${d.x.toFixed(2)} ${d.y.toFixed(2)}Z`, points: [a, b, c, d], progress: tm };
  });
}

export function curveSvgDataUri(layer: GradientLayer, canvas: Canvas): string {
  const bands = curveBands(layer.curve, canvas);
  const paths = bands.map(band => `<path d="${band.d}" fill="${rgbaCss(colorAtPos(layer, band.progress * 100))}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.w}" height="${canvas.h}" viewBox="0 0 ${canvas.w} ${canvas.h}">${paths}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
