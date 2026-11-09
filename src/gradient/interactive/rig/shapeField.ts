import { activeRules, type InteractionRig, type RigShapePoint } from './model';

/* Custom interaction shapes as baked distance fields.
 *
 * The old shader unrolled the polygon into GLSL, so every change of a point rewrote the shader source and forced a recompile
 * (a visible hitch while drawing, and 32 edges of code per rule). Now the polygon is baked into a small signed-distance image
 * (64 × 64 per rule, one cell of an 8-cell atlas) that the shader samples. Editing a shape only re-uploads a few kilobytes,
 * the shader never changes, and bilinear filtering makes the outline smooth whatever the number of points.
 *
 * Encoding: R = 0.5 + 0.5 · d, where d is the signed distance (negative inside) in the shape's own space, in which the outline
 * lives in [-0.5, 0.5] on both axes. The cell texel (c, r) sits at x = -0.5 + c / 63, y = 0.5 - r / 63 (y up). */

export const SHAPE_CELL = 64;
export const SHAPE_CELLS = 8;
export const SHAPE_ATLAS_WIDTH = SHAPE_CELL * SHAPE_CELLS;
export const SHAPE_ATLAS_HEIGHT = SHAPE_CELL;

const FALLBACK: RigShapePoint[] = [{ x: 0, y: -0.5 }, { x: 0.5, y: 0 }, { x: 0, y: 0.5 }, { x: -0.5, y: 0 }];

/** The outline a custom rule really uses: its own points, or a diamond while it has fewer than three. */
export const shapePointsOf = (rule: { customPoints: readonly RigShapePoint[] }): readonly RigShapePoint[] =>
  rule.customPoints.length >= 3 ? rule.customPoints : FALLBACK;

/** Signed distance from (px, py) to a closed polygon: negative inside, positive outside. */
export function polygonSignedDistance(points: readonly RigShapePoint[], px: number, py: number): number {
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const length2 = ex * ex + ey * ey;
    let t = length2 > 1e-12 ? ((px - a.x) * ex + (py - a.y) * ey) / length2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (a.x + t * ex);
    const dy = py - (a.y + t * ey);
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
    if ((a.y > py) !== (b.y > py) && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  const distance = Math.sqrt(best);
  return inside ? -distance : distance;
}

const cellCache = new Map<string, Uint8Array>();
const CACHE_LIMIT = 32;
const cellKey = (points: readonly RigShapePoint[]) => points.map(point => `${point.x.toFixed(4)},${point.y.toFixed(4)}`).join(';');

/** One 64 × 64 single-channel distance field (4096 bytes). Cached by outline. */
export function bakeShapeCell(points: readonly RigShapePoint[]): Uint8Array {
  const key = cellKey(points);
  const hit = cellCache.get(key);
  if (hit) { cellCache.delete(key); cellCache.set(key, hit); return hit; }
  const cell = new Uint8Array(SHAPE_CELL * SHAPE_CELL);
  const last = SHAPE_CELL - 1;
  for (let row = 0; row < SHAPE_CELL; row++) {
    const y = 0.5 - row / last;
    for (let column = 0; column < SHAPE_CELL; column++) {
      const x = -0.5 + column / last;
      const value = 0.5 + 0.5 * polygonSignedDistance(points, x, y);
      cell[row * SHAPE_CELL + column] = Math.round(Math.max(0, Math.min(1, value)) * 255);
    }
  }
  cellCache.set(key, cell);
  if (cellCache.size > CACHE_LIMIT) cellCache.delete(cellCache.keys().next().value as string);
  return cell;
}

/** Active-rule index → outline, for the rules whose shape is custom. */
export function customShapeRules(rig: Pick<InteractionRig, 'rules'> | null): { index: number; points: readonly RigShapePoint[] }[] {
  if (!rig) return [];
  return activeRules(rig).flatMap((rule, index) => rule.shape === 'custom' ? [{ index, points: shapePointsOf(rule) }] : []);
}

/** Changes exactly when a custom outline changes ('' when no rule uses one). Cheap enough to call on every settings update. */
export function shapeAtlasKey(rig: Pick<InteractionRig, 'rules'> | null): string {
  const shapes = customShapeRules(rig);
  return shapes.length ? shapes.map(shape => `${shape.index}:${cellKey(shape.points)}`).join('|') : '';
}

/** The RGBA atlas (512 × 64) the renderer uploads, or null when no rule uses a custom shape. */
export function bakeShapeAtlas(rig: Pick<InteractionRig, 'rules'> | null): Uint8Array | null {
  const shapes = customShapeRules(rig);
  if (!shapes.length) return null;
  const atlas = new Uint8Array(SHAPE_ATLAS_WIDTH * SHAPE_ATLAS_HEIGHT * 4);
  for (let i = 3; i < atlas.length; i += 4) atlas[i] = 255;
  for (const shape of shapes) {
    if (shape.index >= SHAPE_CELLS) continue;
    placeShapeCell(atlas, shape.index, bakeShapeCell(shape.points));
  }
  return atlas;
}

/** Writes one single-channel cell into an RGBA atlas (R = G = B = the field). Shared by the editor and the exported runtime logic. */
export function placeShapeCell(atlas: Uint8Array, index: number, cell: ArrayLike<number>) {
  for (let row = 0; row < SHAPE_CELL; row++) {
    for (let column = 0; column < SHAPE_CELL; column++) {
      const at = (row * SHAPE_ATLAS_WIDTH + index * SHAPE_CELL + column) * 4;
      const value = cell[row * SHAPE_CELL + column];
      atlas[at] = value;
      atlas[at + 1] = value;
      atlas[at + 2] = value;
      atlas[at + 3] = 255;
    }
  }
}

/** For exported pages: index → base64 of the 4096-byte cell (about 5.5 kB per custom shape). */
export function shapeCellsBase64(rig: Pick<InteractionRig, 'rules'> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const shape of customShapeRules(rig)) {
    if (shape.index >= SHAPE_CELLS) continue;
    const cell = bakeShapeCell(shape.points);
    let binary = '';
    for (let i = 0; i < cell.length; i += 0x2000) binary += String.fromCharCode(...cell.subarray(i, i + 0x2000));
    out[String(shape.index)] = btoa(binary);
  }
  return out;
}
