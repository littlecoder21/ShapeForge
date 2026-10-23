import type { Canvas } from './geom';
import type { LayerMask } from './model';

const xy = (point: { x: number; y: number }, canvas: Canvas) => `${(point.x * canvas.w / 100).toFixed(2)} ${(point.y * canvas.h / 100).toFixed(2)}`;

export function layerMaskPath(mask: LayerMask, canvas: Canvas): string {
  const [first, ...rest] = mask.corners;
  let path = `M${xy(first, canvas)}`;
  rest.forEach((corner, index) => {
    const from = index, controls = [mask.controls[from * 2], mask.controls[from * 2 + 1]];
    path += mask.curved
      ? `C${xy(controls[0], canvas)} ${xy(controls[1], canvas)} ${xy(corner, canvas)}`
      : `L${xy(corner, canvas)}`;
  });
  if (mask.curved) {
    path += `C${xy(mask.controls[6], canvas)} ${xy(mask.controls[7], canvas)} ${xy(first, canvas)}Z`;
  } else path += 'Z';
  return path;
}

export function clipLayerMask(context: CanvasRenderingContext2D, mask: LayerMask, canvas: Canvas) {
  const point = (p: { x: number; y: number }) => ({ x: p.x * canvas.w / 100, y: p.y * canvas.h / 100 });
  const first = point(mask.corners[0]);
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let i = 1; i < mask.corners.length; i++) {
    const corner = point(mask.corners[i]);
    if (mask.curved) {
      context.bezierCurveTo(point(mask.controls[(i - 1) * 2]).x, point(mask.controls[(i - 1) * 2]).y, point(mask.controls[(i - 1) * 2 + 1]).x, point(mask.controls[(i - 1) * 2 + 1]).y, corner.x, corner.y);
    } else context.lineTo(corner.x, corner.y);
  }
  if (mask.curved) {
    const c1 = point(mask.controls[6]), c2 = point(mask.controls[7]);
    context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, first.x, first.y);
  }
  context.closePath();
  context.clip();
}

export function layerMaskSvgDataUri(mask: LayerMask): string {
  const path = mask.curved
    ? `M${mask.corners[0].x} ${mask.corners[0].y}C${mask.controls[0].x} ${mask.controls[0].y} ${mask.controls[1].x} ${mask.controls[1].y} ${mask.corners[1].x} ${mask.corners[1].y}C${mask.controls[2].x} ${mask.controls[2].y} ${mask.controls[3].x} ${mask.controls[3].y} ${mask.corners[2].x} ${mask.corners[2].y}C${mask.controls[4].x} ${mask.controls[4].y} ${mask.controls[5].x} ${mask.controls[5].y} ${mask.corners[3].x} ${mask.corners[3].y}C${mask.controls[6].x} ${mask.controls[6].y} ${mask.controls[7].x} ${mask.controls[7].y} ${mask.corners[0].x} ${mask.corners[0].y}Z`
    : `M${mask.corners.map(point => `${point.x} ${point.y}`).join('L')}Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${path}" fill="white"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const layerMaskPolygon = (mask: LayerMask) => `polygon(${mask.corners.map(point => `${point.x}% ${point.y}%`).join(', ')})`;
