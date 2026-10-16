import { H, W } from './constants';
import { buildWaveShape, DEFAULT_WAVE } from './wave';
import type { WaveParams } from './wave';
import { paintCss, paintShowsFill, paintSvgParts } from './paint';
import type { ShapePaint } from './paint';

export { H, W };

/* ───────────────────────────── Types ───────────────────────────── */

/**
 * Node behaviour.
 *  auto      – handles are computed from neighbours (original ShapeForge behaviour)
 *  corner    – no handles unless explicit ones are stored (sharp)
 *  smooth    – explicit handles kept collinear, lengths independent
 *  symmetric – explicit handles kept collinear and equal length
 *  free      – explicit handles, fully independent
 */
export type NodeMode = 'auto' | 'corner' | 'smooth' | 'symmetric' | 'free';
export type Point = { x: number; y: number; in?: Point; out?: Point; mode?: NodeMode; /** a locked node cannot be dragged, nudged or deleted */ locked?: boolean };
export type ShapeKind = 'path' | 'polygon';
export type Box = { x: number; y: number; w: number; h: number };
export interface TextGlyphShape { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
export interface TextVectorGlyph {
  index: number;
  char: string;
  d: string;
  contourPaths: string[];
  transform: string;
  contours: Point[][];
  pivotX: number;
  pivotY: number;
}
export interface TextStrokePath {
  id: string;
  name: string;
  d: string;
  glyphIndex?: number;
  transform?: string;
  reverse: boolean;
  startPercent: number;
  duration: number;
  pauseAfter: number;
  overlapNext: number;
  closed: boolean;
}
export interface TextShapeData {
  value: string;
  font: string;
  fontSize: number;
  weight: string;
  italic: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  draw: boolean;
  duration: number;
  letterSpacing: number;
  lineSpacing: number;
  glyphShapes: TextGlyphShape[];
  width: number;
  height: number;
  content: string;
  vectorGlyphs?: TextVectorGlyph[];
  strokePaths?: TextStrokePath[];
}
/** Which rectangle exports are measured against. */
export type FrameMode = 'artboard' | 'bounds' | 'box';
export type Unit = '%' | 'px' | 'rem' | 'em' | 'vw' | 'vh';
export type FillRule = 'nonzero' | 'evenodd';
export type ShapeModel = {
  /** assigned by the document when the shape is added to a page */
  id?: string;
  name: string;
  kind: ShapeKind;
  points: Point[];
  closed: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Wave maker frame (artboard units). */
  box?: Box;
  frame?: FrameMode;
  /** Parameters of the procedural wave this shape was generated from (cleared once edited by hand). */
  wave?: WaveParams;
  /** gradient applied from Gradient Studio */
  paint?: ShapePaint;
  /** hidden on the canvas (still on the page) */
  hidden?: boolean;
  /** shape-level lock: no node editing or transforming */
  locked?: boolean;
  /** further sub-paths (holes). `points` is the main ring; the shape is one compound path. */
  extra?: Point[][];
  /** Editable SVG text content; points define its movable, resizable artboard frame. */
  text?: TextShapeData;
  fillRule?: FillRule;
  /** 'outer' = computed complement of the page's shapes (read-only geometry) */
  derived?: 'outer';
};

export const ringsOf = (s: Pick<ShapeModel, 'points' | 'extra'>): Point[][] => [s.points, ...(s.extra ?? [])];

export const UNITS: Unit[] = ['%', 'px', 'rem', 'em', 'vw', 'vh'];

/* ───────────────────────────── Basics ───────────────────────────── */

export function fmt(n: number, precision = 1) {
  const p = 10 ** precision;
  const v = Math.round(n * p) / p;
  return Object.is(v, -0) ? '0' : String(v);
}
const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

/** Handles computed from the neighbours (used by `auto` nodes). */
export function autoHandles(points: Point[], index: number, closed: boolean) {
  const n = points.length, point = points[index];
  const prev = points[(index - 1 + n) % n], next = points[(index + 1) % n];
  const before = !closed && index === 0 ? point : prev;
  const after = !closed && index === n - 1 ? point : next;
  const dx = after.x - before.x, dy = after.y - before.y;
  const length = Math.min(Math.hypot(point.x - before.x, point.y - before.y) || 100, Math.hypot(after.x - point.x, after.y - point.y) || 100) / 6;
  const norm = Math.hypot(dx, dy) || 1;
  return {
    in: { x: point.x - dx / norm * length, y: point.y - dy / norm * length },
    out: { x: point.x + dx / norm * length, y: point.y + dy / norm * length },
  };
}

/** Effective handles of a node: explicit ones win, `corner`/`free` nodes never fall back to auto. */
export function getHandles(points: Point[], index: number, closed: boolean) {
  const point = points[index];
  const sharp = point.mode === 'corner' || point.mode === 'free' || points.length < 3;
  const auto = sharp ? null : autoHandles(points, index, closed);
  return {
    in: point.in ?? auto?.in ?? { x: point.x, y: point.y },
    out: point.out ?? auto?.out ?? { x: point.x, y: point.y },
  };
}

export function isStraightSegment(points: Point[], i: number, closed: boolean) {
  const j = (i + 1) % points.length;
  const a = getHandles(points, i, closed), b = getHandles(points, j, closed);
  return near(a.out, points[i]) && near(b.in, points[j]);
}

export function pathFromPoints(points: Point[], closed = true, smooth = true, precision = 1) {
  if (!points.length) return '';
  const f = (v: number) => fmt(v, precision);
  let d = `M ${f(points[0].x)} ${f(points[0].y)}`;
  if (points.length === 1) return d;
  const n = points.length, count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n, p2 = points[j];
    if (!smooth || isStraightSegment(points, i, closed)) {
      if (!(closed && i === n - 1)) d += ` L ${f(p2.x)} ${f(p2.y)}`;   // Z draws the closing straight edge itself
      continue;
    }
    const a = getHandles(points, i, closed), b = getHandles(points, j, closed);
    d += ` C ${f(a.out.x)} ${f(a.out.y)} ${f(b.in.x)} ${f(b.in.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return closed ? `${d} Z` : d;
}

export function bezierAt(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * p1.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * p1.y,
  };
}

/** Flatten one segment (i → i+1) into points, endpoints included. */
export function flattenSegment(points: Point[], i: number, closed: boolean, steps = 12): Point[] {
  const n = points.length, j = (i + 1) % n, p1 = points[i], p2 = points[j];
  if (isStraightSegment(points, i, closed)) return [{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }];
  const a = getHandles(points, i, closed), b = getHandles(points, j, closed);
  return Array.from({ length: steps + 1 }, (_, k) => bezierAt(p1, a.out, b.in, p2, k / steps));
}

export function samplePath(points: Point[], closed: boolean, steps = 8): Point[] {
  if (points.length < 2) return points.map(p => ({ x: p.x, y: p.y }));
  const sampled: Point[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const seg = flattenSegment(points, i, closed, steps);
    for (let k = 0; k < seg.length - 1; k++) sampled.push(seg[k]);
  }
  if (!closed) sampled.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  return sampled;
}

/** Ramer–Douglas–Peucker: `tolerance` is the maximum allowed deviation (canvas units). */
export function simplify(points: Point[], tolerance: number) {
  if (points.length <= 4 || tolerance <= 0) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a], pb = points[b], dx = pb.x - pa.x, dy = pb.y - pa.y, l = Math.hypot(dx, dy);
    let max = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const d = l < 1e-9 ? Math.hypot(p.x - pa.x, p.y - pa.y) : Math.abs(dy * p.x - dx * p.y + pb.x * pa.y - pb.y * pa.x) / l;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tolerance && idx > 0) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Resample a polyline to an exact point count, preserving corners when the count allows. */
export function resamplePolyline(points: Point[], requestedCount: number, closed: boolean): Point[] {
  if (!points.length) return [];
  const count = Math.max(1, Math.min(300, Math.round(requestedCount)));
  if (count === 1) return [{ x: points[0].x, y: points[0].y }];

  const segmentCount = closed ? points.length : points.length - 1;
  if (segmentCount < 1) return Array.from({ length: count }, () => ({ x: points[0].x, y: points[0].y }));
  if (count < points.length) {
    const lengths = Array.from({ length: segmentCount }, (_, i) => {
      const a = points[i], b = points[(i + 1) % points.length];
      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (total <= 1e-9) return Array.from({ length: count }, () => ({ x: points[0].x, y: points[0].y }));
    return Array.from({ length: count }, (_, i) => {
      let distance = total * (closed ? i / count : i / (count - 1));
      for (let segment = 0; segment < segmentCount; segment++) {
        const length = lengths[segment];
        if (distance <= length || segment === segmentCount - 1) {
          const a = points[segment], b = points[(segment + 1) % points.length];
          const t = length <= 1e-9 ? 0 : Math.min(1, distance / length);
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
        distance -= length;
      }
      return { x: points[points.length - 1].x, y: points[points.length - 1].y };
    });
  }

  const intervals = new Array(segmentCount).fill(1);
  const remaining = count - segmentCount - (closed ? 0 : 1);
  const lengths = Array.from({ length: segmentCount }, (_, i) => {
    const a = points[i], b = points[(i + 1) % points.length];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (remaining > 0 && total > 1e-9) {
    const shares = lengths.map(length => remaining * length / total);
    shares.forEach((share, i) => { intervals[i] += Math.floor(share); });
    let left = remaining - shares.reduce((sum, share) => sum + Math.floor(share), 0);
    const remainders = shares.map((share, i) => ({ i, remainder: share - Math.floor(share) }))
      .sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < left; i++) intervals[remainders[i].i]++;
  } else if (remaining > 0) {
    for (let i = 0; i < remaining; i++) intervals[i % segmentCount]++;
  }

  const result: Point[] = [];
  for (let segment = 0; segment < segmentCount; segment++) {
    const a = points[segment], b = points[(segment + 1) % points.length];
    for (let i = 0; i < intervals[segment]; i++) {
      const t = i / intervals[segment];
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  if (!closed) result.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
  return result.slice(0, count);
}

export function polygonOutputPoints(points: Point[], closed: boolean, smooth: boolean, count: number, tolerance: number): Point[] {
  const pointCount = Math.max(1, Math.min(300, Math.round(count)));
  const steps = Math.max(8, Math.min(48, Math.ceil(pointCount / Math.max(1, points.length))));
  const sampled = smooth ? simplify(samplePath(points, closed, steps), tolerance) : points;
  return resamplePolyline(sampled, pointCount, closed);
}
export function shapeOutline(shape: Pick<ShapeModel, 'points' | 'closed' | 'kind'>, steps = 12): Point[] {
  return shape.kind === 'path' ? samplePath(shape.points, shape.closed, steps) : shape.points.map(p => ({ x: p.x, y: p.y }));
}

/** One SVG path string for all rings of a shape. */
export function pathOfShape(shape: Pick<ShapeModel, 'points' | 'extra' | 'closed' | 'kind'>, precision = 1) {
  return ringsOf(shape).map(r => pathFromPoints(r, shape.closed, shape.kind === 'path', precision)).join(' ');
}

export function boundsOf(pts: { x: number; y: number }[]): Box {
  if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function outlineRings(shape: Pick<ShapeModel, 'points' | 'closed' | 'kind' | 'extra'>, steps = 12): Point[][] {
  return ringsOf(shape).map(r => (shape.kind === 'path' ? samplePath(r, shape.closed, steps) : r.map(p => ({ x: p.x, y: p.y }))));
}
export function shapeBounds(shape: Pick<ShapeModel, 'points' | 'closed' | 'kind' | 'extra'>): Box {
  return boundsOf(outlineRings(shape, 16).flat());
}

export function mapPoints(points: Point[], fn: (p: { x: number; y: number }) => { x: number; y: number }): Point[] {
  return points.map(p => ({ ...p, ...fn(p), ...(p.in ? { in: { ...p.in, ...fn(p.in) } } : {}), ...(p.out ? { out: { ...p.out, ...fn(p.out) } } : {}) }));
}
export const translatePoints = (points: Point[], dx: number, dy: number) => mapPoints(points, p => ({ x: p.x + dx, y: p.y + dy }));

/* ───────────────────────────── Shape library ───────────────────────────── */

export function polygonPoints(sides: number, radius = 220, cx = 500, cy = 300, start = -Math.PI / 2): Point[] {
  return Array.from({ length: sides }, (_, i) => ({ x: cx + Math.cos(start + i * Math.PI * 2 / sides) * radius, y: cy + Math.sin(start + i * Math.PI * 2 / sides) * radius }));
}
const base = { fill: '#69dfb5', stroke: '#9bf0d0', strokeWidth: 2 };
export function makeShape(kind: string, seed = 9): ShapeModel {
  if (kind === 'Wave') return buildWaveShape(DEFAULT_WAVE, base.fill);
  if (kind === 'Blob') {
    let s = seed >>> 0; const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pts = Array.from({ length: 10 }, (_, i) => { const a = i * Math.PI * 2 / 10; const r = 190 + rand() * 65; return { x: 500 + Math.cos(a) * r, y: 300 + Math.sin(a) * r }; });
    return { name: 'Seeded blob', kind: 'path', points: pts, closed: true, ...base };
  }
  if (kind === 'Circle') return { name: 'Circle', kind: 'path', points: polygonPoints(16, 180), closed: true, ...base };
  if (kind === 'Ellipse') return { name: 'Ellipse', kind: 'path', points: Array.from({ length: 32 }, (_, i) => ({ x: 500 + Math.cos(i * Math.PI / 16) * 245, y: 300 + Math.sin(i * Math.PI / 16) * 165 })), closed: true, ...base };
  if (kind === 'Rectangle') return { name: 'Rectangle', kind: 'polygon', points: [{ x: 250, y: 120 }, { x: 750, y: 120 }, { x: 750, y: 480 }, { x: 250, y: 480 }], closed: true, ...base };
  if (kind === 'Rounded rectangle') {
    const points: Point[] = [];
    const corners = [{ x: 320, y: 180, a: Math.PI }, { x: 680, y: 180, a: -Math.PI / 2 }, { x: 680, y: 420, a: 0 }, { x: 320, y: 420, a: Math.PI / 2 }];
    for (const corner of corners) for (let i = 0; i <= 6; i++) {
      const a = corner.a + i * Math.PI / 12;
      points.push({ x: corner.x + Math.cos(a) * 70, y: corner.y + Math.sin(a) * 70 });
    }
    return { name: 'Rounded rectangle', kind: 'polygon', points, closed: true, ...base };
  }
  if (kind === 'Half circle') return { name: 'Half circle', kind: 'polygon', points: Array.from({ length: 25 }, (_, i) => {
    const a = Math.PI - i * Math.PI / 24;
    return { x: 500 + Math.cos(a) * 230, y: 360 - Math.sin(a) * 230 };
  }), closed: true, ...base };
  if (kind === 'Trapezoid') return { name: 'Trapezoid', kind: 'polygon', points: [{ x: 350, y: 120 }, { x: 650, y: 120 }, { x: 790, y: 480 }, { x: 210, y: 480 }], closed: true, ...base };
  if (kind === 'Parallelogram') return { name: 'Parallelogram', kind: 'polygon', points: [{ x: 370, y: 120 }, { x: 790, y: 120 }, { x: 630, y: 480 }, { x: 210, y: 480 }], closed: true, ...base };
  if (kind === 'Arrow') return { name: 'Arrow', kind: 'polygon', points: [{ x: 120, y: 245 }, { x: 610, y: 245 }, { x: 610, y: 120 }, { x: 880, y: 300 }, { x: 610, y: 480 }, { x: 610, y: 355 }, { x: 120, y: 355 }], closed: true, ...base };
  if (kind === 'Cross') return { name: 'Cross', kind: 'polygon', points: [{ x: 400, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 230 }, { x: 730, y: 230 }, { x: 730, y: 370 }, { x: 600, y: 370 }, { x: 600, y: 500 }, { x: 400, y: 500 }, { x: 400, y: 370 }, { x: 270, y: 370 }, { x: 270, y: 230 }, { x: 400, y: 230 }], closed: true, ...base };
  if (kind === 'Heart') {
    const points: Point[] = [];
    for (let i = 0; i < 64; i++) {
      const t = i * Math.PI * 2 / 64;
      const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      points.push({ x: 500 + x * 15, y: 285 - y * 15 });
    }
    return { name: 'Heart', kind: 'polygon', points, closed: true, ...base };
  }
  if (kind === 'Triangle') return { name: 'Triangle', kind: 'polygon', points: polygonPoints(3), closed: true, ...base };
  if (kind === 'Diamond') return { name: 'Diamond', kind: 'polygon', points: [{ x: 500, y: 70 }, { x: 760, y: 300 }, { x: 500, y: 530 }, { x: 240, y: 300 }], closed: true, ...base };
  if (kind === 'Star') {
    const points = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 112 : 235; return { x: 500 + Math.cos(a) * r, y: 300 + Math.sin(a) * r }; });
    return { name: 'Star', kind: 'polygon', points, closed: true, ...base };
  }
  return { name: kind, kind: 'polygon', points: polygonPoints(kind === 'Pentagon' ? 5 : kind === 'Octagon' ? 8 : 6), closed: true, ...base };
}

/** Polygon → path without altering the outline: every node becomes an exact corner. */
export function toPathExact(shape: ShapeModel): ShapeModel {
  return { ...shape, kind: 'path', points: shape.points.map(p => ({ ...p, mode: p.mode && p.mode !== 'auto' ? p.mode : 'corner' })) };
}
/** Explicit smoothing: every node becomes auto-smooth. */
export function smoothAll(shape: ShapeModel): ShapeModel {
  return { ...shape, kind: 'path', points: shape.points.map(p => ({ x: p.x, y: p.y, mode: 'auto' as const })) };
}

/* ───────────────────────────── Export ───────────────────────────── */

export function frameOf(shape: ShapeModel): Box {
  const mode = shape.frame ?? (shape.box ? 'box' : 'artboard');
  if (mode === 'box' && shape.box) return shape.box;
  if (mode === 'bounds') { const b = shapeBounds(shape); if (b.w > 0.5 && b.h > 0.5) return b; }
  return { x: 0, y: 0, w: W, h: H };
}

export function polygonToCss(points: Point[], percentage = true, precision = 1) {
  return `clip-path: polygon(${points.map(p => `${fmt(percentage ? p.x / W * 100 : p.x, precision)}${percentage ? '%' : 'px'} ${fmt(percentage ? p.y / H * 100 : p.y, precision)}${percentage ? '%' : 'px'}`).join(', ')});`;
}
export function polygonToCssUnits(points: Point[], frame: Box, unit: Unit, precision = 1, evenodd = false) {
  const conv = (v: number, size: number) => {
    if (unit === '%') return `${fmt(v / size * 100, precision)}%`;
    if (unit === 'vw' || unit === 'vh') return `${fmt(v / size * 100, precision)}${unit}`;
    if (unit === 'rem' || unit === 'em') return `${fmt(v / 16, Math.max(precision, 2))}${unit}`;
    return `${fmt(v, precision)}px`;
  };
  return `clip-path: polygon(${evenodd ? 'evenodd, ' : ''}${points.map(p => `${conv(p.x, frame.w)} ${conv(p.y, frame.h)}`).join(', ')});`;
}

/** One polygon from several rings: each extra ring is joined to the first by a zero-width bridge (use fill-rule evenodd). */
export function chainRings<T extends { x: number; y: number }>(rings: T[][]): T[] {
  if (rings.length <= 1) return rings[0] ?? [];
  const main = rings[0], out: T[] = [...main, main[0]];
  for (let i = 1; i < rings.length; i++) out.push(...rings[i], rings[i][0], main[0]);
  return out;
}

function textSvgElement(shape: ShapeModel, offsetX = 0, offsetY = 0) {
  const text = shape.text!;
  if (shape.points.length < 4 || !text.width || !text.height) return '';
  const origin = shape.points[0], topRight = shape.points[1], bottomLeft = shape.points[3];
  const a = (topRight.x - origin.x) / text.width, b = (topRight.y - origin.y) / text.width;
  const c = (bottomLeft.x - origin.x) / text.height, d = (bottomLeft.y - origin.y) / text.height;
  return `<svg x="0" y="0" width="${fmt(text.width)}" height="${fmt(text.height)}" viewBox="0 0 ${fmt(text.width)} ${fmt(text.height)}" preserveAspectRatio="none" transform="matrix(${fmt(a, 5)} ${fmt(b, 5)} ${fmt(c, 5)} ${fmt(d, 5)} ${fmt(origin.x - offsetX)} ${fmt(origin.y - offsetY)})">${text.content}</svg>`;
}

export function exportCode(shape: ShapeModel, format: string, precision = 1, tolerance = 1, unit: Unit = '%', pageSize?: { width: number; height: number; unit: string }, polygonPointCount = 48) {
  const frame = frameOf(shape);
  const rings = ringsOf(shape).map(r => translatePoints(r, -frame.x, -frame.y));
  const smooth = shape.kind === 'path', evenodd = shape.fillRule === 'evenodd';
  const d = rings.map(r => pathFromPoints(r, shape.closed, smooth, precision)).join(' ');
  const sampled = chainRings(rings.map(r => polygonOutputPoints(r, shape.closed, smooth, polygonPointCount, tolerance)));
  const poly = polygonToCssUnits(sampled, frame, unit, precision, evenodd);
  const vb = `0 0 ${fmt(frame.w, precision)} ${fmt(frame.h, precision)}`;
  const pageAttrs = pageSize && (shape.frame ?? (shape.box ? 'box' : 'artboard')) === 'artboard'
    ? ` width="${fmt(pageSize.width, precision)}${pageSize.unit}" height="${fmt(pageSize.height, precision)}${pageSize.unit}"`
    : '';
  const par = shape.wave || pageSize ? ' preserveAspectRatio="none"' : '';
  const rule = evenodd ? ' fill-rule="evenodd" clip-rule="evenodd"' : '';
  const paint = shape.paint && (shape.fill === 'none' ? { ...shape.paint, fill: false, css: false } : shape.paint);
  let svg = shape.text
    ? `<svg${pageAttrs} viewBox="${vb}"${par} xmlns="http://www.w3.org/2000/svg">\n  ${textSvgElement(shape, frame.x, frame.y)}\n</svg>`
    : `<svg${pageAttrs} viewBox="${vb}"${par} xmlns="http://www.w3.org/2000/svg">\n  <path d="${d}" fill="${shape.fill}"${rule} />\n</svg>`;
  if (!shape.text && paint && (paintShowsFill(paint) || paint.stroke)) {
    const pp = paintSvgParts(paint, d, frame, shape.strokeWidth);
    const outline = paint.stroke ? '' : '';
    svg = `<svg${pageAttrs} viewBox="${vb}"${par} xmlns="http://www.w3.org/2000/svg">\n  <defs>${pp.defs}</defs>\n  ${paintShowsFill(paint) ? '' : `<path d="${d}" fill="${shape.fill}"${rule} />\n  `}${pp.body}${outline}\n</svg>`;
  }

  const ratio = `${fmt(frame.w, 1)} / ${fmt(frame.h, 1)}`;
  if (format === 'SVG') return svg;
  if (format === 'SVG PATH') return evenodd ? `d="${d}"\nfill-rule="evenodd"` : `d="${d}"`;
  if (format === 'CSS PATH') return `/* path() is px-based and does not scale: size the element ${fmt(frame.w, 0)}×${fmt(frame.h, 0)}px, or use POLYGON for fluid sizing */\nclip-path: path(${evenodd ? 'evenodd, ' : ''}"${d}");`;
  if (format === 'POLYGON') return poly;
  if (paint?.css && (format === 'REACT' || format === 'HTML + CSS')) {
    const pc = paintCss(paint, ratio, poly);
    return format === 'REACT' ? `export function Shape() {\n  return (\n${pc.html.split('\n').map(l => `    ${l.replace('class=', 'className=')}`).join('\n')}\n  );\n}\n\n/* shape.css */\n${pc.css}` : `${pc.html}\n\n<style>\n${pc.css}\n</style>`;
  }
  if (format === 'REACT') return `export function Shape() {\n  return <div className="shape" />;\n}\n\n/* shape.css */\n.shape {\n  width: 100%;\n  aspect-ratio: ${ratio};\n  ${poly}\n  background: ${shape.fill};\n}`;
  if (format === 'HTML + CSS') return `<div class="shape"></div>\n\n<style>\n.shape {\n  width: 100%;\n  aspect-ratio: ${ratio};\n  ${poly}\n  background: ${shape.fill};\n}\n</style>`;
  if (format === 'JSON') {
    const r = (n: number) => Number(fmt(n, precision));
    const pt = (p: Point) => ({ x: r(p.x), y: r(p.y) });
    return JSON.stringify({
      name: shape.name, kind: shape.kind, viewBox: [W, H], closed: shape.closed, fill: shape.fill, stroke: shape.stroke, strokeWidth: shape.strokeWidth,
      ...(shape.fillRule ? { fillRule: shape.fillRule } : {}), ...(shape.derived ? { derived: shape.derived } : {}),
      ...(shape.box ? { box: { x: r(shape.box.x), y: r(shape.box.y), w: r(shape.box.w), h: r(shape.box.h) } } : {}),
      ...(shape.wave ? { wave: shape.wave } : {}),
      ...(shape.text ? { text: shape.text } : {}),
      points: shape.points.map(p => ({ ...pt(p), ...(p.mode ? { mode: p.mode } : {}), ...(p.locked ? { locked: true } : {}), ...(p.in ? { in: pt(p.in) } : {}), ...(p.out ? { out: pt(p.out) } : {}) })),
      ...(shape.extra?.length ? { extra: shape.extra.map(ring => ring.map(p => ({ ...pt(p), ...(p.mode ? { mode: p.mode } : {}), ...(p.in ? { in: pt(p.in) } : {}), ...(p.out ? { out: pt(p.out) } : {}) }))) } : {}),
    }, null, 2);
  }
  return svg;
}

/** Export every visible shape on a page in artboard coordinates, preserving each shape's SVG paint and compound rings. */
export function exportPageSvg(shapes: ShapeModel[], precision = 1, page: { width: number; height: number; unit: string; background?: string } = { width: W, height: H, unit: 'px' }) {
  const defs: string[] = [], body: string[] = [];
  if (page.background && page.background !== 'transparent') body.push(`<rect width="${W}" height="${H}" fill="${page.background}" />`);
  for (const shape of shapes) {
    if (shape.hidden) continue;
    if (shape.text) {
      body.push(textSvgElement(shape));
      continue;
    }
    const rings = ringsOf(shape);
    const d = rings.map(r => pathFromPoints(r, shape.closed, shape.kind === 'path', precision)).join(' ');
    const rule = shape.fillRule === 'evenodd' ? ' fill-rule="evenodd" clip-rule="evenodd"' : '';
    const paint = shape.paint && (shape.fill === 'none' ? { ...shape.paint, fill: false, css: false } : shape.paint);
    if (paint && (paintShowsFill(paint) || paint.stroke)) {
      const frame = frameOf(shape), local = rings.map(r => translatePoints(r, -frame.x, -frame.y));
      const localD = local.map(r => pathFromPoints(r, shape.closed, shape.kind === 'path', precision)).join(' ');
      const markup = paintSvgParts(paint, localD, frame, shape.strokeWidth, `sfp-${shape.id ?? 'shape'}`, shape.fillRule === 'evenodd');
      defs.push(markup.defs);
      body.push(`<g transform="translate(${fmt(frame.x, precision)} ${fmt(frame.y, precision)})">${markup.body}</g>`);
      if (!paintShowsFill(paint)) body.push(`<path d="${d}" fill="${shape.fill}"${rule} />`);
    } else {
      const stroke = shape.stroke && shape.stroke !== 'none' ? ` stroke="${shape.stroke}" stroke-width="${fmt(shape.strokeWidth, precision)}"` : '';
      body.push(`<path d="${d}" fill="${shape.fill}"${rule}${stroke} />`);
    }
  }
  return `<svg width="${fmt(page.width, precision)}${page.unit}" height="${fmt(page.height, precision)}${page.unit}" viewBox="0 0 ${fmt(W, precision)} ${fmt(H, precision)}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">\n${defs.length ? `  <defs>${defs.join('')}</defs>\n` : ''}${body.map(markup => `  ${markup}`).join('\n')}\n</svg>`;
}
