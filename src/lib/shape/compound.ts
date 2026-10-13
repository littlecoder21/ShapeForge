import { H, W } from './constants';
import { cleanRing, signedArea, splitParams } from './boundary';
import { outlineRings, shapeOutline, type Point, type ShapeModel } from './geometry';

/* ═══════════ Outer path = the page minus your shapes ═══════════
 * Draw a triangle on the page: the "outer shape" is everything on the page that is NOT the triangle (a rectangle with a
 * triangular hole). It is returned as rings for one compound path with the even-odd fill rule, so it exports in every format.
 *
 *  exact    – every shape lies fully inside the page and none overlap: page rectangle + the shapes' own paths (curves kept).
 *  computed – shapes touch / cross the page edge or each other: the region is computed by classifying split edges
 *             (an edge belongs to the result when exactly one side of it is "page but not shape").
 */

export interface OuterResult { rings: Point[][]; mode: 'exact' | 'computed' | 'empty'; notes: string[] }

const corner = (x: number, y: number): Point => ({ x, y, mode: 'corner' });
export const pageRing = (): Point[] => [corner(0, 0), corner(W, 0), corner(W, H), corner(0, H)];

type V = { x: number; y: number };
const cross = (a: V, b: V, c: V) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function pointInRing(p: V, ring: V[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function segsTouch(a: V, b: V, c: V, d: V) {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function distToRing(p: V, ring: V[]) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}
/** inside, or within a hair of the boundary — touching counts as overlapping so the safe (computed) path is used. */
const insideOrOn = (p: V, ring: V[]) => pointInRing(p, ring) || distToRing(p, ring) < 1e-3;
function ringsDisjoint(rings: V[][]) {
  for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) {
    const A = rings[i], B = rings[j];
    for (let a = 0; a < A.length; a++) for (let b = 0; b < B.length; b++) if (segsTouch(A[a], A[(a + 1) % A.length], B[b], B[(b + 1) % B.length])) return false;
    if (A.some(p => insideOrOn(p, B)) || B.some(p => insideOrOn(p, A))) return false;
  }
  return true;
}

const key = (p: V) => `${Math.round(p.x * 1e3)}_${Math.round(p.y * 1e3)}`;

/** The shapes that count as "occupied": closed, visible, and not themselves a derived outer shape. */
export const outerSources = (shapes: ShapeModel[]) => shapes.filter(s => s.closed && !s.hidden && !s.derived && s.points.length >= 3);

export function computeOuterPath(shapes: ShapeModel[]): OuterResult {
  const notes: string[] = [];
  const src = outerSources(shapes);
  if (shapes.some(s => !s.closed && !s.derived)) notes.push('Open paths are ignored — close a path to count it.');
  if (!src.length) return { rings: [pageRing()], mode: 'empty', notes: [...notes, 'There are no closed shapes on this page, so the outer shape is the whole page.'] };

  const flat = src.map(s => shapeOutline(s, 24).map(p => ({ x: p.x, y: p.y })));
  const EPS = 0.001;
  const inside = flat.every(r => r.every(p => p.x > EPS && p.x < W - EPS && p.y > EPS && p.y < H - EPS));
  if (inside && ringsDisjoint(flat)) {
    notes.push('Exact path: the page rectangle plus your shapes as holes — curves are kept as drawn.');
    return { rings: [pageRing(), ...src.map(s => s.points.map(p => ({ ...p, locked: undefined, mode: s.kind === 'polygon' ? ('corner' as const) : p.mode })))], mode: 'exact', notes };
  }

  // ── computed boolean difference: page rectangle − union(shapes) ──
  const page: V[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const loops: V[][] = [page, ...flat];
  const segs: [V, V][] = [];
  loops.forEach(r => r.forEach((a, i) => { const b = r[(i + 1) % r.length]; if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-9) segs.push([a, b]); }));

  const ids = new Map<string, number>(), coords: V[] = [];
  const vid = (p: V) => { const k = key(p); let id = ids.get(k); if (id === undefined) { id = coords.length; ids.set(k, id); coords.push({ x: p.x, y: p.y }); } return id; };
  const edges = new Map<string, [number, number]>();
  segs.forEach(([a, b], si) => {
    const ts = new Set<number>([0, 1]);
    segs.forEach(([c, d], sj) => { if (si !== sj) for (const t of splitParams(a, b, c, d)) ts.add(t); });
    const sorted = [...ts].sort((x, y) => x - y);
    let prev = vid(a);
    for (let k = 1; k < sorted.length; k++) {
      const t = sorted[k], p = t === 1 ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, id = vid(p);
      if (id !== prev) { const kk = prev < id ? `${prev}-${id}` : `${id}-${prev}`; if (!edges.has(kk)) edges.set(kk, [prev, id]); }
      prev = id;
    }
  });

  const inRegion = (p: V) => p.x > 0 && p.x < W && p.y > 0 && p.y < H && !flat.some(r => pointInRing(p, r));
  const kept: [number, number][] = [];
  for (const [u, v] of edges.values()) {
    const a = coords[u], b = coords[v], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len, e = Math.min(0.05, len * 0.2);
    if (inRegion({ x: mx + nx * e, y: my + ny * e }) !== inRegion({ x: mx - nx * e, y: my - ny * e })) kept.push([u, v]);
  }
  if (!kept.length) return { rings: [], mode: 'empty', notes: [...notes, 'The shapes cover the whole page — nothing remains outside them.'] };

  // chain boundary edges into loops (pairing at pinch points is irrelevant under the even-odd rule)
  const adj = new Map<number, number[]>();
  kept.forEach(([u, v], i) => { (adj.get(u) ?? adj.set(u, []).get(u)!).push(i); (adj.get(v) ?? adj.set(v, []).get(v)!).push(i); });
  const used = new Array(kept.length).fill(false), rings: Point[][] = [];
  for (let e0 = 0; e0 < kept.length; e0++) {
    if (used[e0]) continue;
    used[e0] = true;
    const [start, first] = kept[e0], ring: number[] = [start];
    let cur = first;
    for (let guard = 0; guard < 100000; guard++) {
      if (cur === start) break;
      ring.push(cur);
      const nextE = (adj.get(cur) ?? []).find(i => !used[i]);
      if (nextE === undefined) break;
      used[nextE] = true;
      cur = kept[nextE][0] === cur ? kept[nextE][1] : kept[nextE][0];
    }
    const cleaned = cleanRing(ring.map(i => coords[i]));
    if (cleaned.length >= 3 && Math.abs(signedArea(cleaned)) > 0.5) rings.push(cleaned.map(p => corner(Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100)));
  }
  rings.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  notes.push('Computed path: shapes touch the page edge or each other, so the result is a polygon (curves are flattened).');
  return { rings, mode: 'computed', notes };
}

/** A ready-to-add shape for the outer path (compound path, even-odd fill). */
export function outerShape(result: OuterResult, name: string, fill = '#8aa0ff'): ShapeModel | null {
  if (!result.rings.length) return null;
  return { name, kind: 'path', points: result.rings[0], extra: result.rings.slice(1), closed: true, fillRule: 'evenodd', derived: 'outer', fill, stroke: '#c3cdff', strokeWidth: 2 };
}

export const ringCount = (s: ShapeModel) => outlineRings(s, 4).length;
