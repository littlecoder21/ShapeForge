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

export function exportCode(shape: ShapeModel, format: string, precision = 1, tolerance = 8, unit: Unit = '%') {
  const frame = frameOf(shape);
  const rings = ringsOf(shape).map(r => translatePoints(r, -frame.x, -frame.y));
  const smooth = shape.kind === 'path', evenodd = shape.fillRule === 'evenodd';
  const d = rings.map(r => pathFromPoints(r, shape.closed, smooth, precision)).join(' ');
  const sampled = chainRings(rings.map(r => simplify(smooth ? samplePath(r, shape.closed, 12) : r, tolerance)));
  const poly = polygonToCssUnits(sampled, frame, unit, precision, evenodd);
  const vb = `0 0 ${fmt(frame.w, precision)} ${fmt(frame.h, precision)}`;
  const par = shape.wave ? ' preserveAspectRatio="none"' : '';
  const rule = evenodd ? ' fill-rule="evenodd" clip-rule="evenodd"' : '';
  let svg = `<svg viewBox="${vb}"${par} xmlns="http://www.w3.org/2000/svg">\n  <path d="${d}" fill="${shape.fill}"${rule} />\n</svg>`;
  if (shape.paint && (paintShowsFill(shape.paint) || shape.paint.stroke)) {
    const pp = paintSvgParts(shape.paint, d, frame, shape.strokeWidth);
    const outline = shape.paint.stroke ? '' : '';
    svg = `<svg viewBox="${vb}"${par} xmlns="http://www.w3.org/2000/svg">\n  <defs>${pp.defs}</defs>\n  ${paintShowsFill(shape.paint) ? '' : `<path d="${d}" fill="${shape.fill}"${rule} />\n  `}${pp.body}${outline}\n</svg>`;
  }
  const ratio = `${fmt(frame.w, 1)} / ${fmt(frame.h, 1)}`;
  if (format === 'SVG') return svg;
  if (format === 'SVG PATH') return evenodd ? `d="${d}"\nfill-rule="evenodd"` : `d="${d}"`;
  if (format === 'CSS PATH') return `/* path() is px-based and does not scale: size the element ${fmt(frame.w, 0)}×${fmt(frame.h, 0)}px, or use POLYGON for fluid sizing */\nclip-path: path(${evenodd ? 'evenodd, ' : ''}"${d}");`;
  if (format === 'POLYGON') return poly;
  if (shape.paint?.css && (format === 'REACT' || format === 'HTML + CSS')) {
    const pc = paintCss(shape.paint, ratio, poly);
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
      points: shape.points.map(p => ({ ...pt(p), ...(p.mode ? { mode: p.mode } : {}), ...(p.locked ? { locked: true } : {}), ...(p.in ? { in: pt(p.in) } : {}), ...(p.out ? { out: pt(p.out) } : {}) })),
      ...(shape.extra?.length ? { extra: shape.extra.map(ring => ring.map(p => ({ ...pt(p), ...(p.mode ? { mode: p.mode } : {}), ...(p.in ? { in: pt(p.in) } : {}), ...(p.out ? { out: pt(p.out) } : {}) }))) } : {}),
    }, null, 2);
  }
  return svg;
}
