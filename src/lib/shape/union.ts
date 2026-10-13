import polygonClipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import { outlineRings, type Point, type ShapeModel } from './geometry';

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-7 && Math.abs(a.y - b.y) < 1e-7;

/** Flatten selected closed shapes and merge them into one even-odd compound path. */
export function unifyShapes(shapes: ShapeModel[]): ShapeModel | null {
  if (shapes.length < 2 || shapes.some(shape => !shape.closed || shape.points.length < 3)) return null;

  const polygons = shapes.map(shape => outlineRings(shape, 32)
    .filter(ring => ring.length >= 3)
    .map(ring => ring.map(point => [point.x, point.y] as [number, number])));
  const result: MultiPolygon = polygonClipping.union(polygons[0], ...polygons.slice(1));
  const rings: Point[][] = result.flatMap(polygon => polygon.map(ring => {
    const open = ring.length > 1 && same({ x: ring[0][0], y: ring[0][1] }, { x: ring[ring.length - 1][0], y: ring[ring.length - 1][1] }) ? ring.slice(0, -1) : ring;
    return open.map(([x, y]) => ({ x, y, mode: 'corner' as const }));
  })).filter(ring => ring.length >= 3);

  if (!rings.length) return null;
  const first = shapes[0];
  return {
    name: `${first.name} + ${shapes.length - 1} shapes`,
    kind: 'polygon',
    points: rings[0],
    extra: rings.slice(1),
    closed: true,
    fill: first.fill,
    stroke: first.stroke,
    strokeWidth: first.strokeWidth,
    fillRule: 'evenodd',
  };
}
