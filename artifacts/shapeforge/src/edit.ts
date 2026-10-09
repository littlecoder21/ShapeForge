import { W, H } from './constants';
import {
  autoHandles, bezierAt, flattenSegment, getHandles, isStraightSegment, mapPoints, shapeBounds, shapeOutline, toPathExact,
  type Box, type NodeMode, type Point, type ShapeModel,
} from './geometry';
import { roundCorners } from './boundary';
import type { EditorSettings } from './settings';
import { screenToCanvas, type V2, type Viewport } from './viewport';

/* ═════════════ Editing engine: node/handle maths · hit-testing · snapping · transforms ═════════════
 * Every function here works in canvas units (the normalized 1000 × 600 space) and returns new shapes.
 * Screen-pixel tolerances are converted with the current zoom, never baked into geometry.
 */

export type Tool = 'Select' | 'Pen' | 'Hand';
export type Selection =
  | { kind: 'none' }
  | { kind: 'node'; index: number }
  | { kind: 'handle'; index: number; side: 'in' | 'out' }
  | { kind: 'segment'; index: number; t: number }
  | { kind: 'shape' };
export const NONE: Selection = { kind: 'none' };
export const selectedNode = (s: Selection) => (s.kind === 'node' || s.kind === 'handle' ? s.index : null);

/* ───────────────────────────── angles ───────────────────────────── */

/** Angles are in degrees, 0° = right, 90° = down (SVG / CSS convention), range 0…360. */
export const normDeg = (a: number) => ((a % 360) + 360) % 360;
export const angleDeg = (from: V2, to: V2) => normDeg(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI);
export const polar = (o: V2, deg: number, length: number): V2 => ({ x: o.x + Math.cos(deg * Math.PI / 180) * length, y: o.y + Math.sin(deg * Math.PI / 180) * length });
export const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: V2, b: V2, t: number): V2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const clampArt = (p: V2): V2 => ({ x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) });
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
export const angleDiff = (a: number, b: number) => { const d = Math.abs(normDeg(a) - normDeg(b)); return Math.min(d, 360 - d); };

/* ───────────────────────────── nodes ───────────────────────────── */

export function moveNodeTo(shape: ShapeModel, i: number, p: V2): ShapeModel {
  return { ...shape, points: shape.points.map((pt, k) => {
    if (k !== i) return pt;
    const dx = p.x - pt.x, dy = p.y - pt.y;
    return { ...pt, x: p.x, y: p.y, ...(pt.in ? { in: { x: pt.in.x + dx, y: pt.in.y + dy } } : {}), ...(pt.out ? { out: { x: pt.out.x + dx, y: pt.out.y + dy } } : {}) };
  }) };
}
export function nudgeNode(shape: ShapeModel, i: number, dx: number, dy: number) {
  const pt = shape.points[i];
  return moveNodeTo(shape, i, { x: pt.x + dx, y: pt.y + dy });
}

export function deleteNode(shape: ShapeModel, i: number): ShapeModel | null {
  const min = shape.closed ? 3 : 2;
  if (shape.points.length <= min) return null;
  return { ...shape, points: shape.points.filter((_, k) => k !== i) };
}

function tangentDir(points: Point[], i: number, closed: boolean): V2 {
  const a = autoHandles(points, i, closed), p = points[i];
  const dx = a.out.x - p.x, dy = a.out.y - p.y, l = Math.hypot(dx, dy);
  return l > 1e-6 ? { x: dx / l, y: dy / l } : { x: 1, y: 0 };
}

/** Switching a polygon node to anything but Corner turns the polygon into an exact path first (no surprise smoothing). */
export function setNodeMode(shape: ShapeModel, i: number, mode: NodeMode): ShapeModel {
  const base = shape.kind === 'polygon' ? toPathExact(shape) : shape;
  const pts = base.points.map(p => ({ ...p }));
  const pt = pts[i];
  const h = getHandles(base.points, i, base.closed);
  const vOut = { x: h.out.x - pt.x, y: h.out.y - pt.y }, vIn = { x: h.in.x - pt.x, y: h.in.y - pt.y };
  const lo = Math.hypot(vOut.x, vOut.y), li = Math.hypot(vIn.x, vIn.y);
  if (mode === 'corner') { delete pt.in; delete pt.out; pt.mode = 'corner'; }
  else if (mode === 'auto') { delete pt.in; delete pt.out; pt.mode = 'auto'; }
  else if (mode === 'free') { pt.in = h.in; pt.out = h.out; pt.mode = 'free'; }
  else {
    const auto = autoHandles(base.points, i, base.closed);
    const dir = lo > 1e-6 ? { x: vOut.x / lo, y: vOut.y / lo } : li > 1e-6 ? { x: -vIn.x / li, y: -vIn.y / li } : tangentDir(base.points, i, base.closed);
    const fallback = Math.hypot(auto.out.x - pt.x, auto.out.y - pt.y) || 40;
    const lenOut = lo > 1e-6 ? lo : li > 1e-6 ? li : fallback;
    const lenIn = mode === 'symmetric' ? lenOut : (li > 1e-6 ? li : lenOut);
    pt.out = { x: pt.x + dir.x * lenOut, y: pt.y + dir.y * lenOut };
    pt.in = { x: pt.x - dir.x * lenIn, y: pt.y - dir.y * lenIn };
    pt.mode = mode;
  }
  return { ...base, points: pts };
}

/** Move one Bézier handle; the node's mode decides what the opposite handle does. */
export function moveHandle(shape: ShapeModel, i: number, side: 'in' | 'out', target: V2): ShapeModel {
  if (shape.kind !== 'path') return shape;
  const eff = getHandles(shape.points, i, shape.closed);
  return { ...shape, points: shape.points.map((pt, k) => {
    if (k !== i) return pt;
    const other = side === 'in' ? 'out' : 'in';
    const next: Point = { ...pt, [side]: { x: target.x, y: target.y } };
    const vx = target.x - pt.x, vy = target.y - pt.y, l = Math.hypot(vx, vy);
    const mode = pt.mode ?? 'auto';
    if (mode === 'auto' || mode === 'symmetric') { next[other] = { x: pt.x - vx, y: pt.y - vy }; next.mode = mode === 'auto' ? 'symmetric' : mode; }
    else if (mode === 'smooth') {
      const o = eff[other], ol = Math.hypot(o.x - pt.x, o.y - pt.y);
      if (l > 1e-6) { const use = ol > 1e-6 ? ol : l; next[other] = { x: pt.x - vx / l * use, y: pt.y - vy / l * use }; }
    } else if (mode === 'corner') { next[other] = pt[other] ?? { x: eff[other].x, y: eff[other].y }; next.mode = 'free'; }
    return next;
  }) };
}
export function handlePolar(shape: ShapeModel, i: number, side: 'in' | 'out') {
  const h = getHandles(shape.points, i, shape.closed)[side], p = shape.points[i];
  return { angle: angleDeg(p, h), length: dist(p, h) };
}
export function setHandlePolar(shape: ShapeModel, i: number, side: 'in' | 'out', patch: { angle?: number; length?: number }): ShapeModel {
  const cur = handlePolar(shape, i, side), p = shape.points[i];
  const length = patch.length ?? cur.length;
  const angle = patch.angle ?? (cur.length > 1e-6 ? cur.angle : side === 'out' ? 0 : 180);
  return moveHandle(shape, i, side, polar(p, angle, Math.max(0, length)));
}

/** Insert a node on segment `seg` at parameter t. Curves are split exactly (de Casteljau), shape unchanged. */
export function insertOnSegment(shape: ShapeModel, seg: number, t: number): { shape: ShapeModel; index: number } {
  const pts = shape.points, n = pts.length, j = (seg + 1) % n, a = pts[seg], b = pts[j];
  const at = seg + 1;
  if (shape.kind === 'polygon' || isStraightSegment(pts, seg, shape.closed)) {
    const p = lerp(a, b, t), node: Point = { x: p.x, y: p.y, mode: shape.kind === 'polygon' ? undefined : 'corner' };
    return { shape: { ...shape, points: [...pts.slice(0, at), node, ...pts.slice(at)] }, index: at };
  }
  const ha = getHandles(pts, seg, shape.closed), hb = getHandles(pts, j, shape.closed);
  const q0 = lerp(a, ha.out, t), q1 = lerp(ha.out, hb.in, t), q2 = lerp(hb.in, b, t), r0 = lerp(q0, q1, t), r1 = lerp(q1, q2, t), s = lerp(r0, r1, t);
  const na: Point = { ...a, in: ha.in, out: q0, mode: 'free' };
  const nn: Point = { x: s.x, y: s.y, in: r0, out: r1, mode: 'smooth' };
  const nb: Point = { ...b, in: q2, out: hb.out, mode: 'free' };
  const next = pts.map(p => p);
  next[seg] = na; next[j] = nb;
  return { shape: { ...shape, points: [...next.slice(0, at), nn, ...next.slice(at)] }, index: at };
}

/* ───────────────────────────── corner geometry ───────────────────────────── */

export function cornerInfo(shape: ShapeModel, i: number) {
  const n = shape.points.length, c = shape.closed;
  const pi = c ? (i - 1 + n) % n : i - 1, ni = c ? (i + 1) % n : i + 1;
  if (pi < 0 || ni >= n || n < 3) return null;
  const P = shape.points[pi], N = shape.points[i], X = shape.points[ni];
  const incoming = angleDeg(P, N), outgoing = angleDeg(N, X);
  let turn = normDeg(outgoing - incoming); if (turn > 180) turn -= 360;
  return { prev: pi, next: ni, incoming, outgoing, turn, corner: 180 - Math.abs(turn), lenIn: dist(P, N), lenOut: dist(N, X) };
}

/** Exact corner editing: the node stays, the neighbour's segment is rotated to the requested direction/angle. */
export function setCorner(shape: ShapeModel, i: number, field: 'incoming' | 'outgoing' | 'corner', value: number): ShapeModel {
  const info = cornerInfo(shape, i);
  if (!info) return shape;
  let s = shape.points[i].mode === 'corner' && !shape.points[i].in && !shape.points[i].out ? shape : setNodeMode(shape, i, 'corner');
  const N = s.points[i];
  const move = (idx: number, to: V2): ShapeModel => moveNodeTo(s, idx, to);
  if (field === 'incoming') {
    const l = info.lenIn || 100;
    const a = normDeg(value);
    return move(info.prev, { x: N.x - Math.cos(a * Math.PI / 180) * l, y: N.y - Math.sin(a * Math.PI / 180) * l });
  }
  const l = info.lenOut || 100;
  let out = field === 'outgoing' ? value : info.incoming + (info.turn >= 0 ? 1 : -1) * (180 - Math.max(1, Math.min(180, value)));
  out = normDeg(out);
  return move(info.next, polar(N, out, l));
}

export function roundNode(shape: ShapeModel, i: number, radius: number): { shape: ShapeModel; ok: boolean } {
  const base = shape.kind === 'polygon' ? toPathExact(shape) : shape;
  const r = roundCorners(base.points, base.closed, radius, i);
  if (!r.rounded) return { shape, ok: false };
  return { shape: { ...base, points: r.points }, ok: true };
}

/* ───────────────────────────── transforms ───────────────────────────── */

export type Mat = [number, number, number, number, number, number];   // x' = a·x + c·y + e,  y' = b·x + d·y + f
export const matTranslate = (dx: number, dy: number): Mat => [1, 0, 0, 1, dx, dy];
export const matScaleAbout = (ax: number, ay: number, sx: number, sy: number): Mat => [sx, 0, 0, sy, ax - sx * ax, ay - sy * ay];
export const matRotateAbout = (cx: number, cy: number, rad: number): Mat => {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};
export const applyMat = (m: Mat, p: V2): V2 => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export const transformShape = (shape: ShapeModel, m: Mat): ShapeModel => ({ ...shape, points: mapPoints(shape.points, p => applyMat(m, p)) });
export const boundsCenter = (b: Box): V2 => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export function setBounds(shape: ShapeModel, from: Box, to: Box): ShapeModel {
  const sx = from.w > 1e-6 ? to.w / from.w : 1, sy = from.h > 1e-6 ? to.h / from.h : 1;
  return transformShape(shape, [sx, 0, 0, sy, to.x - from.x * sx, to.y - from.y * sy]);
}

export type BBoxPart = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';
export const BBOX_PARTS: BBoxPart[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const BBOX_OFFSET_PX = 11;     // handles sit just outside the box so they never collide with corner nodes
export const ROTATE_OFFSET_PX = 36;
export const partDir = (p: BBoxPart): V2 => ({ x: p.includes('e') ? 1 : p.includes('w') ? -1 : 0, y: p.includes('s') ? 1 : p.includes('n') ? -1 : 0 });
/** Anchor point of a bbox part in canvas units (without the px offset). */
export function partPoint(b: Box, part: BBoxPart): V2 {
  if (part === 'rotate') return { x: b.x + b.w / 2, y: b.y };
  const d = partDir(part);
  return { x: b.x + b.w / 2 + d.x * b.w / 2, y: b.y + b.h / 2 + d.y * b.h / 2 };
}
/** Outward px offset of a part on screen. */
export function partOffsetPx(part: BBoxPart): V2 {
  if (part === 'rotate') return { x: 0, y: -ROTATE_OFFSET_PX };
  const d = partDir(part), k = d.x && d.y ? Math.SQRT1_2 : 1;
  return { x: d.x * BBOX_OFFSET_PX * k, y: d.y * BBOX_OFFSET_PX * k };
}

/** Scale from a bbox handle. `target` is where the handle should now sit (canvas). */
export function scaleFromHandle(start: ShapeModel, b: Box, part: BBoxPart, target: V2, opts: { uniform: boolean; center: boolean }): { shape: ShapeModel; box: Box } {
  const d = partDir(part), c = boundsCenter(b);
  const g = partPoint(b, part);
  const anchor = opts.center ? c : { x: b.x + b.w / 2 - d.x * b.w / 2, y: b.y + b.h / 2 - d.y * b.h / 2 };
  const gx = g.x - anchor.x, gy = g.y - anchor.y;
  let sx = d.x && Math.abs(gx) > 1e-6 ? (target.x - anchor.x) / gx : 1;
  let sy = d.y && Math.abs(gy) > 1e-6 ? (target.y - anchor.y) / gy : 1;
  if (opts.uniform || (d.x && d.y && false)) {
    let s: number;
    if (d.x && d.y) s = ((target.x - anchor.x) * gx + (target.y - anchor.y) * gy) / (gx * gx + gy * gy);
    else s = d.x ? sx : sy;
    sx = s; sy = s;
  }
  const min = 0.02;
  sx = Math.max(min, sx); sy = Math.max(min, sy);
  const ax = d.x === 0 && !opts.center ? c.x : anchor.x, ay = d.y === 0 && !opts.center ? c.y : anchor.y;
  const m = matScaleAbout(ax, ay, sx, sy);
  const p0 = applyMat(m, { x: b.x, y: b.y }), p1 = applyMat(m, { x: b.x + b.w, y: b.y + b.h });
  return { shape: transformShape(start, m), box: { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) } };
}

/* ───────────────────────────── hit testing ───────────────────────────── */

export type Hit =
  | { kind: 'handle'; index: number; side: 'in' | 'out' }
  | { kind: 'node'; index: number }
  | { kind: 'segment'; index: number; t: number }
  | { kind: 'bbox'; part: BBoxPart }
  | { kind: 'shape' };
export type PointerKind = 'touch' | 'pen' | 'mouse';

/** Hit radii in SCREEN pixels (visual size and touch size are independent; neither touches the geometry). */
export function hitRadii(settings: EditorSettings, pointer: PointerKind, zoom: number, fit: number) {
  const rel = zoom / Math.max(fit, 1e-6);
  const factor = Math.max(0.82, Math.min(1.35, 1 + (1 - rel) * 0.3));   // zoomed out → generous, zoomed in → precise
  if (pointer === 'mouse') return { node: Math.max(settings.nodeSize / 2 + 5, 9), handle: Math.max(settings.handleSize / 2 + 5, 8), seg: 7, box: 10 };
  const base = Math.max(36, settings.touchSize) / 2 * factor;
  return { node: Math.max(18, base), handle: Math.max(16, base * 0.9), seg: Math.max(12, settings.touchSize * 0.3 * factor), box: Math.max(18, base * 0.9) };
}

function pointInRing(p: V2, ring: V2[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function distToSeg(p: V2, a: V2, b: V2) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return { d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
}

/**
 * Distance-based hit test: the finger does not have to land on the node, only within its touch radius.
 * Radii come in screen px and are converted to canvas units with the current zoom.
 */
export function hitTest(a: { screen: V2; vp: Viewport; fit: number; shape: ShapeModel; selection: Selection; settings: EditorSettings; pointer: PointerKind }): Hit | null {
  const { screen, vp, shape, selection, settings } = a;
  const z = vp.zoom, c = screenToCanvas(vp, screen.x, screen.y);
  const R = hitRadii(settings, a.pointer, z, a.fit);
  type Cand = { score: number; pri: number; hit: Hit };
  const cands: Cand[] = [];
  const push = (distPx: number, radiusPx: number, pri: number, hit: Hit) => { const score = distPx / radiusPx; if (score <= 1) cands.push({ score, pri, hit }); };

  const sel = selectedNode(selection);
  if (sel !== null && shape.kind === 'path' && shape.points[sel]) {
    const hs = getHandles(shape.points, sel, shape.closed), p = shape.points[sel];
    for (const side of ['in', 'out'] as const) {
      if (dist(p, hs[side]) < 0.5 / z) continue;
      push(dist(c, hs[side]) * z, R.handle, 3, { kind: 'handle', index: sel, side });
    }
  }
  let bounds: Box | null = null;
  if (selection.kind === 'shape') {
    bounds = shapeBounds(shape);
    for (const part of [...BBOX_PARTS, 'rotate' as const]) {
      const s0 = partPoint(bounds, part), off = partOffsetPx(part);
      const sx = s0.x * z + vp.x + off.x, sy = s0.y * z + vp.y + off.y;
      push(Math.hypot(screen.x - sx, screen.y - sy), R.box, 3, { kind: 'bbox', part });
    }
  }
  shape.points.forEach((p, i) => push(dist(c, p) * z, R.node, selectedNode(selection) === i ? 2.5 : 2, { kind: 'node', index: i }));
  if (cands.length) {
    cands.sort((x, y) => (Math.abs(x.score - y.score) < 0.02 ? y.pri - x.pri : x.score - y.score));
    return cands[0].hit;
  }
  // segments
  const n = shape.points.length, count = shape.closed ? n : n - 1;
  let best: { d: number; index: number; t: number } | null = null;
  for (let i = 0; i < count; i++) {
    const seg = flattenSegment(shape.points, i, shape.closed, 14);
    for (let k = 0; k < seg.length - 1; k++) {
      const r = distToSeg(c, seg[k], seg[k + 1]);
      if (!best || r.d < best.d) best = { d: r.d, index: i, t: (k + r.t) / (seg.length - 1) };
    }
  }
  if (best && best.d * z <= R.seg) return { kind: 'segment', index: best.index, t: best.t };
  if (shape.closed && pointInRing(c, shapeOutline(shape, 10))) return { kind: 'shape' };
  return null;
}

/* ───────────────────────────── snapping ───────────────────────────── */

export type Guide = { x1: number; y1: number; x2: number; y2: number; kind: 'axis' | 'angle' | 'dist'; label?: string };

type SnapCtx = { index: number; points: Point[]; closed: boolean; zoom: number; settings: EditorSettings; shift: boolean; alt: boolean };

export function neighborOf(points: Point[], index: number, closed: boolean): V2 | null {
  const n = points.length;
  if (index < 0) return points.length ? points[points.length - 1] : null;
  const prev = closed ? points[(index - 1 + n) % n] : points[index - 1];
  const next = closed ? points[(index + 1) % n] : points[index + 1];
  return prev ?? next ?? null;
}
const anchorFor = (ctx: SnapCtx) => neighborOf(ctx.points, ctx.index, ctx.closed);

/** Snap a dragged node. Hard snaps: grid, angle. Magnetic (assistive) snaps: H / V / line detection, node & centre alignment, equal length. */
export function snapNode(raw: V2, ctx: SnapCtx): { p: V2; guides: Guide[] } {
  const s = ctx.settings, guides: Guide[] = [];
  let p = { x: raw.x, y: raw.y };
  if (ctx.alt || (!s.snapOn && !ctx.shift)) return { p: clampArt(p), guides };
  const thr = s.snapPx / ctx.zoom, anchor = anchorFor(ctx);
  let lockedX = false, lockedY = false, angleLocked = false;

  if (anchor && (s.snapAngle || ctx.shift)) {
    const l = dist(anchor, p), step = ctx.shift && !s.snapAngle ? 15 : s.angleStep;
    const a = roundTo(angleDeg(anchor, p), step);
    p = polar(anchor, a, l); angleLocked = lockedX = lockedY = true;
    if (s.guides) guides.push({ x1: anchor.x, y1: anchor.y, x2: p.x, y2: p.y, kind: 'angle', label: `${Math.round(normDeg(a) * 100) / 100}°` });
  } else if (anchor) {
    if (s.snapH && Math.abs(p.y - anchor.y) <= thr * 1.5) { p.y = anchor.y; lockedY = true; if (s.guides) guides.push({ x1: anchor.x, y1: anchor.y, x2: p.x, y2: p.y, kind: 'axis', label: '0°' }); }
    if (s.snapV && Math.abs(p.x - anchor.x) <= thr * 1.5) { p.x = anchor.x; lockedX = true; if (s.guides) guides.push({ x1: anchor.x, y1: anchor.y, x2: p.x, y2: p.y, kind: 'axis', label: '90°' }); }
    if (s.assist && !lockedX && !lockedY) {
      const l = dist(anchor, p);
      if (l > 14 / ctx.zoom) {
        const a = angleDeg(anchor, p);
        const tryStep = (step: number, tol: number) => {
          const t = roundTo(a, step), dev = l * Math.sin(Math.min(Math.PI / 2, angleDiff(a, t) * Math.PI / 180));
          if (dev <= tol) { p = polar(anchor, t, l); angleLocked = lockedX = lockedY = true; if (s.guides) guides.push({ x1: anchor.x, y1: anchor.y, x2: p.x, y2: p.y, kind: 'angle', label: `${Math.round(normDeg(t) * 10) / 10}°` }); return true; }
          return false;
        };
        if (!tryStep(45, thr * 0.9)) tryStep(15, thr * 0.45);
      }
    }
  }
  if (s.snapGrid && !angleLocked) {
    if (!lockedX) p.x = roundTo(p.x, s.gridSize);
    if (!lockedY) p.y = roundTo(p.y, s.gridSize);
  }
  if (!angleLocked && (s.snapNode || s.snapCenter)) {
    let bx: { v: number; from: V2 | null } | null = null, by: { v: number; from: V2 | null } | null = null;
    const consider = (v: number, from: V2 | null, axis: 'x' | 'y') => {
      const d = Math.abs((axis === 'x' ? p.x : p.y) - v);
      if (d > thr) return;
      if (axis === 'x') { if (!bx || d < Math.abs(p.x - bx.v)) bx = { v, from }; } else if (!by || d < Math.abs(p.y - by.v)) by = { v, from };
    };
    if (s.snapNode) ctx.points.forEach((q, k) => { if (k === ctx.index) return; if (!lockedX) consider(q.x, q, 'x'); if (!lockedY) consider(q.y, q, 'y'); });
    if (s.snapCenter) { if (!lockedX) consider(W / 2, null, 'x'); if (!lockedY) consider(H / 2, null, 'y'); }
    const gx = bx as { v: number; from: V2 | null } | null, gy = by as { v: number; from: V2 | null } | null;
    if (gx) { p.x = gx.v; if (s.guides) guides.push(gx.from ? { x1: gx.v, y1: Math.min(p.y, gx.from.y), x2: gx.v, y2: Math.max(p.y, gx.from.y), kind: 'axis' } : { x1: gx.v, y1: 0, x2: gx.v, y2: H, kind: 'axis', label: 'centre' }); }
    if (gy) { p.y = gy.v; if (s.guides) guides.push(gy.from ? { x1: Math.min(p.x, gy.from.x), y1: gy.v, x2: Math.max(p.x, gy.from.x), y2: gy.v, kind: 'axis' } : { x1: 0, y1: gy.v, x2: W, y2: gy.v, kind: 'axis', label: 'centre' }); }
  }
  // equal segment length
  if (s.snapNode && anchor && !angleLocked && !lockedX && !lockedY && ctx.index >= 0) {
    const l = dist(anchor, p), n = ctx.points.length;
    const cnt = ctx.closed ? n : n - 1;
    for (let i = 0; i < cnt; i++) {
      const a = ctx.points[i], b = ctx.points[(i + 1) % n];
      if (i === ctx.index || (i + 1) % n === ctx.index) continue;
      const other = dist(a, b);
      if (other > 8 / ctx.zoom && Math.abs(other - l) <= thr * 0.6 && l > 0) {
        const k = other / l; p = { x: anchor.x + (p.x - anchor.x) * k, y: anchor.y + (p.y - anchor.y) * k };
        if (s.guides) guides.push({ x1: anchor.x, y1: anchor.y, x2: p.x, y2: p.y, kind: 'dist', label: `= ${Math.round(other)}` });
        break;
      }
    }
  }
  return { p: clampArt(p), guides };
}

/** Snap a dragged handle target relative to its node. */
export function snapHandle(raw: V2, node: V2, ctx: { settings: EditorSettings; zoom: number; shift: boolean; alt: boolean }): { p: V2; guides: Guide[] } {
  const s = ctx.settings, guides: Guide[] = [];
  if (ctx.alt || (!s.snapOn && !ctx.shift)) return { p: raw, guides };
  const l = dist(node, raw);
  if (l < 1e-6) return { p: raw, guides };
  let a = angleDeg(node, raw), locked = false;
  if (s.snapAngle || ctx.shift) { a = roundTo(a, ctx.shift && !s.snapAngle ? 15 : s.angleStep); locked = true; }
  else if (s.assist) {
    const t = roundTo(a, 45);
    if (l * Math.sin(Math.min(Math.PI / 2, angleDiff(a, t) * Math.PI / 180)) <= (s.snapPx * 0.6) / ctx.zoom) { a = t; locked = true; }
  }
  let p = locked ? polar(node, a, l) : raw;
  if (!locked && s.snapGrid) p = { x: roundTo(p.x, s.gridSize), y: roundTo(p.y, s.gridSize) };
  if (locked && s.guides) guides.push({ x1: node.x, y1: node.y, x2: p.x, y2: p.y, kind: 'angle', label: `${Math.round(normDeg(a) * 100) / 100}°` });
  return { p, guides };
}

/** Snap a translated bounding box: grid on its top-left, centre lines on its centre. Returns the corrected delta. */
export function snapTranslate(b: Box, delta: V2, ctx: { settings: EditorSettings; zoom: number; alt: boolean }): { delta: V2; guides: Guide[] } {
  const s = ctx.settings, guides: Guide[] = [];
  if (ctx.alt || !s.snapOn) return { delta, guides };
  const thr = s.snapPx / ctx.zoom;
  let dx = delta.x, dy = delta.y;
  const cx = b.x + b.w / 2 + dx, cy = b.y + b.h / 2 + dy;
  let sx = false, sy = false;
  if (s.snapCenter) {
    if (Math.abs(cx - W / 2) <= thr) { dx += W / 2 - cx; sx = true; if (s.guides) guides.push({ x1: W / 2, y1: 0, x2: W / 2, y2: H, kind: 'axis', label: 'centre' }); }
    if (Math.abs(cy - H / 2) <= thr) { dy += H / 2 - cy; sy = true; if (s.guides) guides.push({ x1: 0, y1: H / 2, x2: W, y2: H / 2, kind: 'axis', label: 'centre' }); }
  }
  if (s.snapGrid) {
    if (!sx) dx = roundTo(b.x + dx, s.gridSize) - b.x;
    if (!sy) dy = roundTo(b.y + dy, s.gridSize) - b.y;
  }
  return { delta: { x: dx, y: dy }, guides };
}

/* ───────────────────────────── misc helpers ───────────────────────────── */

export const pointOnCurve = (shape: ShapeModel, seg: number, t: number): V2 => {
  const n = shape.points.length, j = (seg + 1) % n, a = shape.points[seg], b = shape.points[j];
  if (shape.kind === 'polygon') return lerp(a, b, t);
  const ha = getHandles(shape.points, seg, shape.closed), hb = getHandles(shape.points, j, shape.closed);
  return bezierAt(a, ha.out, hb.in, b, t);
};

/** Straighten or curve one segment without touching any other part of the shape. */
export function setSegmentCurve(shape: ShapeModel, seg: number, curved: boolean): ShapeModel {
  const base = shape.kind === 'polygon' ? (curved ? toPathExact(shape) : shape) : shape;
  if (base.kind === 'polygon') return base;
  const n = base.points.length, j = (seg + 1) % n;
  const ha = getHandles(base.points, seg, base.closed), hb = getHandles(base.points, j, base.closed);
  const pts = base.points.map(p => ({ ...p }));
  const a = pts[seg], b = pts[j];
  if (curved) {
    a.in = { ...ha.in }; b.out = { ...hb.out };
    a.out = lerp(a, b, 1 / 3); b.in = lerp(a, b, 2 / 3);
  } else {
    a.in = { ...ha.in }; b.out = { ...hb.out };
    a.out = { x: a.x, y: a.y }; b.in = { x: b.x, y: b.y };
  }
  a.mode = 'free'; b.mode = 'free';
  return { ...base, points: pts };
}

export const flipShape = (shape: ShapeModel, axis: 'x' | 'y'): ShapeModel => {
  const c = boundsCenter(shapeBounds(shape));
  return transformShape(shape, matScaleAbout(c.x, c.y, axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1));
};
export const rotateShape = (shape: ShapeModel, deg: number): ShapeModel => {
  const c = boundsCenter(shapeBounds(shape));
  return transformShape(shape, matRotateAbout(c.x, c.y, deg * Math.PI / 180));
};
export const scaleShape = (shape: ShapeModel, factor: number): ShapeModel => {
  const c = boundsCenter(shapeBounds(shape));
  return transformShape(shape, matScaleAbout(c.x, c.y, factor, factor));
};
