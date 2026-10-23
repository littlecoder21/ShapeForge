import { apply, axisValueToPos, deg, invert, layerMatrix, linearLine, normDeg, pivotOf, radii, rad, stopAxisValue, type Canvas, type Mat, type Pt } from './geom';
import { pointRadii } from './mesh';
import { curvePoint } from './curve';
import { layerMaskPath } from './layerMask';
import { IDENTITY, type GradientLayer } from './model';

/* ═══════════ Direct manipulation: handles + drag maths ═══════════
 * Handles live in the layer's own coordinate space and are mapped to the canvas with the layer matrix, so they stay
 * glued to the gradient when the layer is moved / rotated / scaled. All maths is pure (testable without a DOM).
 */

export type HandleKind = 'origin' | 'move' | 'angle' | 'from' | 'rx' | 'ry' | 'stop' | 'curve-point' | 'mask-corner' | 'mask-control' | 'tf-move' | 'tf-scale' | 'tf-rotate' | 'point' | 'psize';
export interface Handle { id: string; kind: HandleKind; x: number; y: number; stopId?: string; pointIndex?: number; maskIndex?: number; color?: string; r: number; pri: number; label?: string; locked?: boolean }
export interface Overlay {
  /** matrix applied to `local` geometry (layer space → canvas) */
  matrix: Mat;
  /** guide geometry in layer space: svg path data */
  local: { d: string; dash?: boolean; kind: 'axis' | 'shape' | 'box' }[];
  handles: Handle[];
}

const snapTo = (v: number, step: number, tol: number) => { const r = Math.round(v / step) * step; return Math.abs(r - v) <= tol ? r : v; };
export const angleFrom = (c: Pt, p: Pt) => normDeg(deg(Math.atan2(p.x - c.x, -(p.y - c.y))));

export function layerOverlay(layer: GradientLayer, canvas: Canvas, mode: 'gradient' | 'transform', selectedId?: string | null): Overlay {
  const { w, h } = canvas, M = layerMatrix(layer, canvas), map = (p: Pt) => apply(M, p);
  const handles: Handle[] = [], local: Overlay['local'] = [];
  const sorted = [...layer.stops];

  if (layer.mask.enabled) {
    local.push({ kind: 'shape', d: layerMaskPath(layer.mask, canvas) });
    layer.mask.corners.forEach((p, i) => handles.push({
      id: `mask-corner-${i}`, kind: 'mask-corner', maskIndex: i, ...map({ x: p.x * w / 100, y: p.y * h / 100 }),
      r: 14, pri: 6, color: '#69dfb5', label: `C${i + 1}`,
    }));
    if (layer.mask.curved) {
      layer.mask.controls.forEach((p, i) => handles.push({
        id: `mask-control-${i}`, kind: 'mask-control', maskIndex: i, ...map({ x: p.x * w / 100, y: p.y * h / 100 }),
        r: 12, pri: 5, color: '#c792ff', label: `H${i + 1}`,
      }));
      layer.mask.controls.forEach((p, i) => {
        const corner = layer.mask.corners[Math.floor(i / 2)];
        local.push({ kind: 'axis', d: `M${corner.x * w / 100} ${corner.y * h / 100}L${p.x * w / 100} ${p.y * h / 100}`, dash: true });
      });
    }
  }

  if (mode === 'transform') {
    const piv = pivotOf(layer, canvas), t = layer.transform;
    local.push({ kind: 'box', d: `M0 0H${w}V${h}H0Z` });
    const c = map({ x: w / 2, y: h / 2 }), top = map({ x: w / 2, y: 0 }), br = map({ x: w, y: h });
    const up = { x: top.x - c.x, y: top.y - c.y }, l = Math.hypot(up.x, up.y) || 1;
    const off = Math.min(w, h) * 0.1;
    handles.push(
      { id: 'tf-rotate', kind: 'tf-rotate', x: top.x + (up.x / l) * off, y: top.y + (up.y / l) * off, r: 12, pri: 3, color: '#ffd166', label: `${Math.round(t.rotate)}°` },
      { id: 'tf-scale', kind: 'tf-scale', x: br.x, y: br.y, r: 12, pri: 3, color: '#8fb4ff', label: `${Math.round(t.scale * 100)}%` },
      { id: 'tf-move', kind: 'tf-move', ...map(piv), r: 14, pri: 1, color: '#69dfb5' },
    );
    return { matrix: M, local, handles };
  }

  if (layer.type === 'noise') return { matrix: M, local, handles };
  if (layer.type === 'mesh') {
    layer.mesh.points.forEach(p => {
      const transform = { ...IDENTITY, ...(p.transform ?? {}) };
      const c = { x: ((p.x + transform.x) / 100) * w, y: ((p.y + transform.y) / 100) * h }, rr = pointRadii(p, canvas);
      rr.rx *= transform.scale; rr.ry *= transform.scale;
      if (p.id === selectedId) local.push({ kind: 'shape', d: `M${c.x - (rr.rx / 100) * w} ${c.y}a${(rr.rx / 100) * w} ${(rr.ry / 100) * h} 0 1 0 ${(rr.rx / 100) * w * 2} 0a${(rr.rx / 100) * w} ${(rr.ry / 100) * h} 0 1 0 ${-(rr.rx / 100) * w * 2} 0`, dash: true });
      handles.push({ id: `pt-${p.id}`, kind: 'point', stopId: p.id, ...map(c), r: 14, pri: 3, color: p.color, locked: p.locked });
      if (p.id === selectedId) handles.push({ id: `ps-${p.id}`, kind: 'psize', stopId: p.id, ...map({ x: c.x + (rr.rx / 100) * w, y: c.y }), r: 12, pri: 4, color: '#8fb4ff', label: `${Math.round(p.size)}%`, locked: p.locked });
    });
    return { matrix: M, local, handles };
  }
  if (layer.type === 'curve') {
    const { p0, p1, p2, p3 } = layer.curve;
    local.push({ kind: 'axis', d: `M${p0.x * w / 100} ${p0.y * h / 100}C${p1.x * w / 100} ${p1.y * h / 100} ${p2.x * w / 100} ${p2.y * h / 100} ${p3.x * w / 100} ${p3.y * h / 100}` });
    local.push({ kind: 'axis', d: `M${p0.x * w / 100} ${p0.y * h / 100}L${p1.x * w / 100} ${p1.y * h / 100}M${p2.x * w / 100} ${p2.y * h / 100}L${p3.x * w / 100} ${p3.y * h / 100}`, dash: true });
    ([p0, p1, p2, p3] as const).forEach((p, i) => handles.push({
      id: `curve-point-${i}`, kind: 'curve-point', pointIndex: i, ...map({ x: (p.x / 100) * w, y: (p.y / 100) * h }),
      r: 13, pri: i === 0 || i === 3 ? 4 : 3, color: i === 0 ? '#69dfb5' : i === 3 ? '#ffd166' : '#8fb4ff', label: `P${i}`,
    }));
    sorted.forEach(s => handles.push({
      id: `stop-${s.id}`, kind: 'stop', stopId: s.id, ...map(curvePoint(layer.curve, s.pos / 100, canvas)), r: 11, pri: 4, color: s.color,
    }));
    return { matrix: M, local, handles };
  }
  if (layer.type === 'linear') {
    const ln = linearLine(layer.angle, w, h), at = (v: number) => ({ x: ln.x1 + ln.dx * v, y: ln.y1 + ln.dy * v });
    local.push({ kind: 'axis', d: `M${ln.x1} ${ln.y1}L${ln.x2} ${ln.y2}` });
    const mid = { x: w / 2, y: h / 2 }, reach = Math.min(ln.L / 2, Math.min(w, h) * 0.42);
    handles.push({ id: 'angle', kind: 'angle', ...map({ x: mid.x + ln.dx * reach, y: mid.y + ln.dy * reach }), r: 12, pri: 2, color: '#ffd166', label: `${Math.round(layer.angle)}°` });
    handles.push({ id: 'move', kind: 'move', ...map(mid), r: 11, pri: 1, color: '#69dfb5' });
    sorted.forEach(s => handles.push({ id: `stop-${s.id}`, kind: 'stop', stopId: s.id, ...map(at(stopAxisValue(layer, canvas, s.pos))), r: 13, pri: 4, color: s.color }));
    return { matrix: M, local, handles };
  }

  const c = { x: (layer.cx / 100) * w, y: (layer.cy / 100) * h };
  if (layer.type === 'radial') {
    const rr = radii(layer, canvas);
    local.push({ kind: 'shape', d: `M${c.x - rr.rx} ${c.y}a${rr.rx} ${rr.ry} 0 1 0 ${rr.rx * 2} 0a${rr.rx} ${rr.ry} 0 1 0 ${-rr.rx * 2} 0` });
    local.push({ kind: 'axis', d: `M${c.x} ${c.y}V${c.y - rr.ry}`, dash: true });
    handles.push({ id: 'rx', kind: 'rx', ...map({ x: c.x + rr.rx, y: c.y }), r: 11, pri: 2, color: '#8fb4ff' });
    handles.push({ id: 'ry', kind: 'ry', ...map({ x: c.x, y: c.y + rr.ry }), r: 11, pri: 2, color: '#8fb4ff' });
    handles.push({ id: 'origin', kind: 'origin', ...map(c), r: 12, pri: 1, color: '#69dfb5' });
    sorted.forEach(s => handles.push({ id: `stop-${s.id}`, kind: 'stop', stopId: s.id, ...map({ x: c.x, y: c.y - stopAxisValue(layer, canvas, s.pos) }), r: 13, pri: 4, color: s.color }));
    return { matrix: M, local, handles };
  }

  // conic
  const R0 = Math.min(w, h) * 0.27, R1 = Math.min(w, h) * 0.36, onRing = (R: number, a: number) => ({ x: c.x + R * Math.sin(rad(a)), y: c.y - R * Math.cos(rad(a)) });
  local.push({ kind: 'shape', d: `M${c.x - R1} ${c.y}a${R1} ${R1} 0 1 0 ${R1 * 2} 0a${R1} ${R1} 0 1 0 ${-R1 * 2} 0`, dash: true });
  local.push({ kind: 'axis', d: `M${c.x} ${c.y}L${onRing(R0, layer.angle).x} ${onRing(R0, layer.angle).y}` });
  handles.push({ id: 'from', kind: 'from', ...map(onRing(R0, layer.angle)), r: 12, pri: 2, color: '#ffd166', label: `${Math.round(layer.angle)}°` });
  handles.push({ id: 'origin', kind: 'origin', ...map(c), r: 12, pri: 1, color: '#69dfb5' });
  sorted.forEach(s => handles.push({ id: `stop-${s.id}`, kind: 'stop', stopId: s.id, ...map(onRing(R1, layer.angle + stopAxisValue(layer, canvas, s.pos))), r: 13, pri: 4, color: s.color }));
  return { matrix: M, local, handles };
}

export interface DragInput { start: GradientLayer; handle: Handle; pointer: Pt; startPointer: Pt; canvas: Canvas; shift: boolean }

/** New layer after dragging a handle. Always computed from the layer as it was when the drag began (no drift). */
export function dragHandle({ start, handle, pointer, startPointer, canvas, shift }: DragInput): GradientLayer {
  const { w, h } = canvas, M = layerMatrix(start, canvas), inv = invert(M);
  const p = apply(inv, pointer), p0 = apply(inv, startPointer);
  const next: GradientLayer = { ...start, transform: { ...start.transform }, stops: start.stops.map(s => ({ ...s })) };
  if (handle.locked) return next;
  const dxc = ((pointer.x - startPointer.x) / w) * 100, dyc = ((pointer.y - startPointer.y) / h) * 100;
  const r1 = (v: number) => Math.round(v * 10) / 10;

  switch (handle.kind) {
    case 'move': case 'tf-move':
      next.transform.x = r1(start.transform.x + dxc); next.transform.y = r1(start.transform.y + dyc);
      if (!shift) { next.transform.x = snapTo(next.transform.x, 25, 1.2); next.transform.y = snapTo(next.transform.y, 25, 1.2); }
      break;
    case 'origin': {
      const cx = start.cx + ((p.x - p0.x) / w) * 100, cy = start.cy + ((p.y - p0.y) / h) * 100;
      next.cx = r1(Math.max(-50, Math.min(150, shift ? cx : snapTo(cx, 25, 1.5)))); next.cy = r1(Math.max(-50, Math.min(150, shift ? cy : snapTo(cy, 25, 1.5))));
      break;
    }
    case 'angle': case 'from': {
      const c = start.type === 'linear' ? { x: w / 2, y: h / 2 } : { x: (start.cx / 100) * w, y: (start.cy / 100) * h };
      let a = angleFrom(c, p);
      a = shift ? Math.round(a / 15) * 15 : snapTo(a, 15, 2.5);
      next.angle = Math.round(a * 10) / 10 % 360;
      break;
    }
    case 'rx': case 'ry': {
      const c = { x: (start.cx / 100) * w, y: (start.cy / 100) * h };
      if (start.shape === 'circle') next.rx = r1(Math.max(1, (Math.hypot(p.x - c.x, p.y - c.y) / Math.min(w, h)) * 100));
      else if (handle.kind === 'rx') { next.rx = r1(Math.max(1, (Math.abs(p.x - c.x) / w) * 100)); if (shift) next.ry = start.ry * (next.rx / start.rx); }
      else { next.ry = r1(Math.max(1, (Math.abs(p.y - c.y) / h) * 100)); if (shift) next.rx = start.rx * (next.ry / start.ry); }
      break;
    }
    case 'stop': {
      const s = next.stops.find(x => x.id === handle.stopId);
      if (!s) break;
      let v: number;
      if (start.type === 'linear') { const ln = linearLine(start.angle, w, h); v = (p.x - ln.x1) * ln.dx + (p.y - ln.y1) * ln.dy; }
      else if (start.type === 'radial') v = (start.cy / 100) * h - p.y;
      else if (start.type === 'curve') {
        let closest = { distance: Infinity, progress: 0 };
        for (let i = 0; i <= 300; i++) {
          const progress = i / 300, q = curvePoint(start.curve, progress, canvas), distance = Math.hypot(q.x - p.x, q.y - p.y);
          if (distance < closest.distance) closest = { distance, progress };
        }
        v = closest.progress * 100;
      }
      else {
        const c = { x: (start.cx / 100) * w, y: (start.cy / 100) * h };
        v = normDeg(angleFrom(c, p) - start.angle);
        if (start.repeating) { const per = start.repeat.unit === '%' ? start.repeat.size * 3.6 : start.repeat.size, off = start.repeat.unit === '%' ? start.repeat.offset * 3.6 : start.repeat.offset; v = off + ((((v - off) % per) + per) % per); }
        else if (v > 345 && s.pos < 15) v -= 360;
      }
      let pos = start.type === 'curve' ? v : axisValueToPos(start, canvas, v);
      pos = Math.max(0, Math.min(100, pos));
      if (!shift) { pos = snapTo(pos, 25, 1.2); next.stops.forEach(o => { if (o.id !== s.id && Math.abs(o.pos - pos) < 1.2) pos = o.pos; }); }
      s.pos = Math.round(pos * 10) / 10;
      break;
    }
    case 'curve-point': {
      if (handle.pointIndex === undefined) break;
      const key = (`p${handle.pointIndex}`) as keyof GradientLayer['curve'];
      const point = start.curve[key];
      const x = point.x + ((p.x - p0.x) / w) * 100, y = point.y + ((p.y - p0.y) / h) * 100;
      next.curve = {
        ...start.curve,
        [key]: {
          x: r1(Math.max(-25, Math.min(125, x))),
          y: r1(Math.max(-25, Math.min(125, y))),
        },
      };
      break;
    }
    case 'mask-corner': case 'mask-control': {
      if (handle.maskIndex === undefined) break;
      const key = handle.kind === 'mask-corner' ? 'corners' : 'controls';
      const points = [...start.mask[key]];
      const point = points[handle.maskIndex];
      if (!point) break;
      points[handle.maskIndex] = {
        x: r1(Math.max(-25, Math.min(125, point.x + ((p.x - p0.x) / w) * 100))),
        y: r1(Math.max(-25, Math.min(125, point.y + ((p.y - p0.y) / h) * 100))),
      };
      next.mask = { ...start.mask, [key]: points };
      break;
    }
    case 'point': {
      const pt = next.mesh.points.find(x => x.id === handle.stopId);
      if (!pt) break;
      next.mesh = { ...next.mesh, points: next.mesh.points.map(x => (x.id === pt.id ? { ...x } : x)) };
      const q = next.mesh.points.find(x => x.id === pt.id)!, sp = start.mesh.points.find(x => x.id === pt.id)!;
      q.x = Math.round(Math.max(-20, Math.min(120, sp.x + ((p.x - p0.x) / w) * 100)) * 10) / 10; q.y = Math.round(Math.max(-20, Math.min(120, sp.y + ((p.y - p0.y) / h) * 100)) * 10) / 10;
      if (!shift) { q.x = snapTo(q.x, 25, 1.2); q.y = snapTo(q.y, 25, 1.2); }
      break;
    }
    case 'psize': {
      const sp = start.mesh.points.find(x => x.id === handle.stopId);
      if (!sp) break;
      const pointTransform = { ...IDENTITY, ...(sp.transform ?? {}) };
      const centerX = ((sp.x + pointTransform.x) / 100) * w;
      next.mesh = { ...next.mesh, points: next.mesh.points.map(x => (x.id === sp.id ? { ...x, size: Math.round(Math.max(4, Math.min(160, (Math.abs(p.x - centerX) / w / pointTransform.scale) * 100)) * 10) / 10 } : x)) };
      break;
    }
    case 'tf-scale': {
      const piv = apply(M, start.type === 'linear' ? { x: w / 2, y: h / 2 } : { x: (start.cx / 100) * w, y: (start.cy / 100) * h });
      const d0 = Math.hypot(startPointer.x - piv.x, startPointer.y - piv.y) || 1, d1 = Math.hypot(pointer.x - piv.x, pointer.y - piv.y);
      next.transform.scale = Math.round(Math.max(0.05, Math.min(10, start.transform.scale * (d1 / d0))) * 100) / 100;
      if (!shift) next.transform.scale = snapTo(next.transform.scale, 0.25, 0.03);
      break;
    }
    case 'tf-rotate': {
      const piv = apply(M, start.type === 'linear' ? { x: w / 2, y: h / 2 } : { x: (start.cx / 100) * w, y: (start.cy / 100) * h });
      const a0 = deg(Math.atan2(startPointer.y - piv.y, startPointer.x - piv.x)), a1 = deg(Math.atan2(pointer.y - piv.y, pointer.x - piv.x));
      let r = start.transform.rotate + (a1 - a0);
      r = shift ? Math.round(r / 15) * 15 : snapTo(r, 15, 3);
      next.transform.rotate = Math.round(((r + 180) % 360 + 360) % 360 - 180);
      break;
    }
  }
  return next;
}
