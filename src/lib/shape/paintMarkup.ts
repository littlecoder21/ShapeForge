import { frameOf, pathFromPoints, translatePoints, ringsOf, type ShapeModel } from './geometry';
import { paintShowsFill, paintSvgParts } from './paint';

export type Painted = { defs: string; body: string; x: number; y: number };

/** SVG markup that paints a shape's gradient (null when it has none). Ids are unique per shape so many painted shapes can share a page. */
export function paintedMarkup(shape: ShapeModel): Painted | null {
  const pa = shape.paint && (shape.fill === 'none' ? { ...shape.paint, fill: false, css: false } : shape.paint);
  if (!pa || !(paintShowsFill(pa) || pa.stroke)) return null;
  const frame = frameOf(shape), rings = ringsOf(shape).map(r => translatePoints(r, -frame.x, -frame.y));
  const d = rings.map(r => pathFromPoints(r, shape.closed, shape.kind === 'path')).join(' ');
  return { ...paintSvgParts(pa, d, frame, shape.strokeWidth, `sfp-${shape.id ?? 'a'}`, shape.fillRule === 'evenodd'), x: frame.x, y: frame.y };
}
