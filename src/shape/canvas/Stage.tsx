import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { H, W } from '../../lib/shape/constants';
import { fmt, getHandles, isStraightSegment, pathFromPoints, pathOfShape, shapeBounds, type Box, type Point, type ShapeModel } from '../../lib/shape/geometry';
import { paintedMarkup, type Painted } from '../../lib/shape/paintMarkup';
import StaticShape from './StaticShape';
import NodeMenu from './NodeMenu';
import NodeBar from './NodeBar';
import {
  angleDeg, boundsCenter, deleteNode, deleteNodes, dist, handlePolar, hitTest, insertOnSegment, matRotateAbout, matTranslate, moveHandle, moveNodeTo, moveNodesBy, neighborOf, pointInShape,
  partPoint, partOffsetPx, scaleFromHandle, selectedNode, setNodeMode, snapHandle, snapNode, snapTranslate, transformShape, BBOX_PARTS,
  selectedIndices, setNodesLocked, toggleInSelection, type BBoxPart, type Guide, type Hit, type PointerKind, type Selection, type Tool,
} from '../../lib/shape/edit';
import type { EditorSettings } from '../../lib/shape/settings';
import { clampViewport, fitViewport, fitZoom, nextStop, pinchViewport, screenToCanvas, zoomAt, type V2, type Viewport } from '../../lib/shape/viewport';

export type StageHandle = { zoomIn(): void; zoomOut(): void; reset(): void; fit(): void };

type Props = {
  shape: ShapeModel; others: ShapeModel[]; shapeOrder: string[]; tool: Tool; selection: Selection; settings: EditorSettings; showGrid: boolean; polygonPoints: string | null;
  strokeDraw: number | null;
  multiSelect: boolean; onMultiSelect: (enabled: boolean) => void; pageBackground: string;
  onSelect: (s: Selection) => void;
  /** live update while a gesture runs (no history entry) */
  onPreview: (s: ShapeModel) => void;
  /** a gesture finished: push `before` to history */
  onGestureEnd: (before: ShapeModel) => void;
  /** a discrete edit: push history and apply */
  onCommit: (next: ShapeModel, sel?: Selection) => void;
  onPickShape: (id: string) => void;
  onAddShape: (shape: ShapeModel, sel?: Selection) => void;
  onAnnounce: (message: string) => void;
};

type G =
  | { t: 'idle' } | { t: 'locked' }
  | { t: 'pending'; id: number; s: V2; hit: Hit | null; ptr: PointerKind }
  | { t: 'pan'; id: number; s: V2; vp: Viewport }
  | { t: 'pinch'; ids: [number, number]; vp: Viewport; mid: V2; dist: number }
  | { t: 'node'; id: number; index: number; before: ShapeModel; startNode: V2; startC: V2; dirty: boolean }
  | { t: 'nodes'; id: number; indices: number[]; before: ShapeModel; startC: V2; dirty: boolean }
  | { t: 'handle'; id: number; index: number; side: 'in' | 'out'; before: ShapeModel; startH: V2; startC: V2; dirty: boolean }
  | { t: 'pen'; id: number; index: number; before: ShapeModel; origin: V2; startC: V2; dirty: boolean }
  | { t: 'line'; id: number; before: ShapeModel; start: V2; end: V2; dirty: boolean }
  | { t: 'bbox'; id: number; part: BBoxPart | 'move'; before: ShapeModel; bounds: Box; startC: V2; g0: V2; dirty: boolean };

const THRESHOLD: Record<PointerKind, number> = { touch: 9, pen: 6, mouse: 3 };
const INV: CSSProperties = { transform: 'scale(var(--inv))' };
const ptr = (e: { pointerType: string }): PointerKind => (e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse');
const f1 = (n: number) => fmt(n, 1);
const CURSORS: Record<string, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rotate: 'grab' };

function segmentPath(shape: ShapeModel, i: number) {
  const n = shape.points.length, j = (i + 1) % n, a = shape.points[i], b = shape.points[j];
  if (shape.kind === 'polygon' || isStraightSegment(shape.points, i, shape.closed)) return `M${a.x} ${a.y}L${b.x} ${b.y}`;
  const ha = getHandles(shape.points, i, shape.closed), hb = getHandles(shape.points, j, shape.closed);
  return `M${a.x} ${a.y}C${ha.out.x} ${ha.out.y} ${hb.in.x} ${hb.in.y} ${b.x} ${b.y}`;
}

/* ─────────── static layers (re-render only when their own inputs change, never on viewport changes) ─────────── */

const ArtboardLayer = memo(function ArtboardLayer({ showGrid, step, minor, background }: { showGrid: boolean; step: number; minor: boolean; background: string }) {
  const grid = useMemo(() => {
    let d = '';
    for (let x = step; x < W; x += step) d += `M${x} 0V${H}`;
    for (let y = step; y < H; y += step) d += `M0 ${y}H${W}`;
    return d;
  }, [step]);
  return <g>
    <rect className="art-rect" width={W} height={H} style={{ fill: background === 'transparent' ? '#21262d' : background }} />
    {showGrid && minor && <path className="art-grid" d={grid} />}
    <path className="art-center" d={`M${W / 2} 0V${H}M0 ${H / 2}H${W}`} />
  </g>;
});

const ShapeLayer = memo(function ShapeLayer({ d, polygonPoints, painted, fill, fillRule, strokeDraw }: { d: string; polygonPoints: string | null; painted: Painted | null; fill: string; fillRule?: ShapeModel['fillRule']; strokeDraw: number | null }) {
  const cls = `shape-fill${painted ? ' painted' : ''}`;
  const drawStyle = strokeDraw === null ? undefined : { strokeDasharray: 1, strokeDashoffset: 1 - strokeDraw };
  return <g>
    {painted && <g transform={`translate(${painted.x} ${painted.y})`} pointerEvents="none"><defs dangerouslySetInnerHTML={{ __html: painted.defs }} /><g dangerouslySetInnerHTML={{ __html: painted.body }} /></g>}
    {polygonPoints ? <polygon className={cls} points={polygonPoints} pathLength={strokeDraw === null ? undefined : 1} fillRule={fillRule} style={{ ...(painted ? {} : { fill }), ...drawStyle }} /> : <path className={cls} d={d} pathLength={strokeDraw === null ? undefined : 1} fillRule={fillRule} style={{ ...(painted ? {} : { fill }), ...drawStyle }} />}
  </g>;
});

const Stage = forwardRef<StageHandle, Props>(function Stage(props, ref) {
  const { shape, selection, settings, tool } = props;
  const propsRef = useRef(props); propsRef.current = props;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const fitRef = useRef(1);
  const userMoved = useRef(false);
  const animRef = useRef(0);
  const rafRef = useRef(0);
  const pointers = useRef(new Map<number, V2 & { type: PointerKind }>());
  const gest = useRef<G>({ t: 'idle' });
  const mods = useRef({ shift: false, alt: false });
  const space = useRef(false);
  const lastTap = useRef<{ time: number; s: V2; hit: Hit | null } | null>(null);
  const [pct, setPct] = useState(100);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [linePreview, setLinePreview] = useState<{ start: V2; end: V2 } | null>(null);

  /* ───── viewport (imperative: never goes through React state while a gesture runs) ───── */
  const applyView = useCallback((v: Viewport) => {
    const vp = clampViewport(v, sizeRef.current.w, sizeRef.current.h);
    vpRef.current = vp;
    gRef.current?.setAttribute('transform', `translate(${vp.x} ${vp.y}) scale(${vp.zoom})`);
    svgRef.current?.style.setProperty('--inv', String(1 / vp.zoom));
    const p = Math.round(vp.zoom * 100);
    setPct(prev => (prev === p ? prev : p));
  }, []);
  const cancelAnim = () => cancelAnimationFrame(animRef.current);
  const animateTo = useCallback((target: Viewport) => {
    cancelAnimationFrame(animRef.current);
    const from = { ...vpRef.current }, t0 = performance.now(), dur = 170;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { applyView(target); return; }
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
      applyView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, zoom: from.zoom * (target.zoom / from.zoom) ** e });
      if (k < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }, [applyView]);
  const doFit = useCallback((animate = true) => {
    const { w, h } = sizeRef.current;
    userMoved.current = false;
    const t = fitViewport(w, h);
    animate ? animateTo(t) : applyView(t);
  }, [animateTo, applyView]);
  const zoomStep = useCallback((dir: 1 | -1) => {
    userMoved.current = true;
    const { w, h } = sizeRef.current, v = vpRef.current;
    animateTo(zoomAt(v, w / 2, h / 2, nextStop(v.zoom, dir)));
  }, [animateTo]);
  const doReset = useCallback(() => { userMoved.current = true; const { w, h } = sizeRef.current; animateTo(zoomAt(vpRef.current, w / 2, h / 2, 1)); }, [animateTo]);
  useImperativeHandle(ref, () => ({ zoomIn: () => zoomStep(1), zoomOut: () => zoomStep(-1), fit: () => doFit(true), reset: doReset }), [zoomStep, doFit, doReset]);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
    fitRef.current = fitZoom(el.clientWidth, el.clientHeight);
    applyView(fitViewport(el.clientWidth, el.clientHeight));
    const ro = new ResizeObserver(() => {
      const old = sizeRef.current, nw = el.clientWidth, nh = el.clientHeight;
      if (nw === old.w && nh === old.h) return;
      const v = vpRef.current, centre = screenToCanvas(v, old.w / 2, old.h / 2);
      sizeRef.current = { w: nw, h: nh };
      fitRef.current = fitZoom(nw, nh);
      if (!userMoved.current) applyView(fitViewport(nw, nh));
      else applyView({ zoom: v.zoom, x: nw / 2 - centre.x * v.zoom, y: nh / 2 - centre.y * v.zoom });
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(animRef.current); cancelAnimationFrame(rafRef.current); };
  }, [applyView]);

  /* wheel: ctrl/⌘/trackpad-pinch zooms at the cursor, plain wheel pans */
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); cancelAnim(); userMoved.current = true;
      const r = el.getBoundingClientRect(), v = vpRef.current;
      if (e.ctrlKey || e.metaKey) applyView(zoomAt(v, e.clientX - r.left, e.clientY - r.top, v.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01))));
      else applyView({ ...v, x: v.x - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey && !e.deltaX ? 0 : e.deltaY) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyView]);

  /* hold Space to pan with any tool */
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e.target)) { e.preventDefault(); space.current = true; if (wrapRef.current) wrapRef.current.style.cursor = 'grab'; } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') { space.current = false; if (wrapRef.current) wrapRef.current.style.cursor = ''; } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  /* ───── helpers ───── */
  const local = (e: { clientX: number; clientY: number }): V2 => { const r = wrapRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const setHud = (text: string | null) => { const el = hudRef.current; if (!el) return; if (text === null) { el.classList.remove('on'); } else { el.textContent = text; el.classList.add('on'); } };
  const showGuides = (next: Guide[]) => setGuides(prev => (!prev.length && !next.length ? prev : next));
  const doHit = (s: V2, p: PointerKind): Hit | null => {
    const P = propsRef.current;
    const active = !P.shape.locked && !P.shape.hidden
      ? hitTest({ screen: s, vp: vpRef.current, fit: fitRef.current, shape: P.shape, selection: P.selection, settings: P.settings, pointer: p })
      : null;
    if (active && active.kind !== 'shape') return active;
    const c = screenToCanvas(vpRef.current, s.x, s.y);
    const byId = new Map(P.others.map(other => [other.id, other]));
    for (let i = P.shapeOrder.length - 1; i >= 0; i--) {
      const id = P.shapeOrder[i];
      if (id === P.shape.id) {
        if (!P.shape.hidden && pointInShape(P.shape, c)) return active ?? { kind: 'shape' };
      } else {
        const other = byId.get(id);
        if (other && !other.hidden && pointInShape(other, c)) return { kind: 'other', id };
      }
    }
    return active;
  };

  /** Cancel an in-flight edit without touching history (used when a second finger lands). */
  const revert = (g: G) => {
    if (g.t === 'node' || g.t === 'nodes' || g.t === 'handle' || g.t === 'pen' || g.t === 'bbox') { if (g.dirty) propsRef.current.onPreview(g.before); }
    if (g.t === 'line') setLinePreview(null);
    showGuides([]); setHud(null);
  };

  const beginPinch = () => {
    const ids = [...pointers.current.keys()].slice(0, 2) as [number, number];
    revert(gest.current);
    const a = pointers.current.get(ids[0])!, b = pointers.current.get(ids[1])!;
    gest.current = { t: 'pinch', ids, vp: { ...vpRef.current }, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    userMoved.current = true; cancelAnim();
  };

  const penCommitNode = (c: V2, closeHit: Hit | null) => {
    const P = propsRef.current, s = P.shape;
    const continuing = s.name === 'Custom path' && s.kind === 'path' && !s.closed;
    if (continuing && closeHit?.kind === 'node' && closeHit.index === 0 && s.points.length >= 3) {
      P.onCommit({ ...s, closed: true }, { kind: 'node', index: 0 }); return;
    }
    const pts = continuing ? s.points : [];
    const snapped = snapNode(c, { index: -1, points: pts, closed: false, zoom: vpRef.current.zoom, settings: P.settings, shift: mods.current.shift, alt: mods.current.alt }).p;
    const node: Point = { x: snapped.x, y: snapped.y, mode: P.settings.penMode === 'smooth' ? 'auto' : 'corner' };
    const points = [...pts, node];
    const base = continuing ? s : { name: 'Custom path', kind: 'path' as const, points: [], closed: false, fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth };
    const next = { ...base, name: 'Custom path', kind: 'path' as const, points, closed: false };
    if (continuing) P.onCommit(next, { kind: 'node', index: points.length - 1 });
    else P.onAddShape(next, { kind: 'node', index: points.length - 1 });
  };

  const handleTap = (g: Extract<G, { t: 'pending' }>) => {
    const P = propsRef.current, now = performance.now(), c = screenToCanvas(vpRef.current, g.s.x, g.s.y);
    const prevTap = lastTap.current;
    const dbl = !!prevTap && now - prevTap.time < 320 && dist(prevTap.s, g.s) < 26;
    lastTap.current = { time: now, s: g.s, hit: g.hit };
    if (P.tool === 'Pen') { penCommitNode(c, g.hit); return; }
    const hit = g.hit;
    if (!hit) { P.onSelect({ kind: 'none' }); return; }
    if (hit.kind === 'other') { P.onPickShape(hit.id); return; }
    if (hit.kind === 'node') {
      if (dbl && prevTap?.hit?.kind === 'node' && prevTap.hit.index === hit.index) {
        P.onSelect({ kind: 'node', index: hit.index });
        setNodeMenu({ x: g.s.x, y: g.s.y, index: hit.index });
      } else if (P.multiSelect || mods.current.shift) P.onSelect(toggleInSelection(P.selection, hit.index));
      else P.onSelect({ kind: 'node', index: hit.index });
    } else if (hit.kind === 'handle') P.onSelect({ kind: 'handle', index: hit.index, side: hit.side });
    else if (hit.kind === 'segment') {
      if (dbl && prevTap?.hit?.kind === 'segment' && prevTap.hit.index === hit.index) { const r = insertOnSegment(P.shape, hit.index, hit.t); P.onCommit(r.shape, { kind: 'node', index: r.index }); }
      else P.onSelect({ kind: 'segment', index: hit.index, t: hit.t });
    } else if (hit.kind === 'shape') P.onSelect({ kind: 'shape' });
  };

  /** A pending touch has moved past the threshold: decide what it is (edit / pan) — only now do we commit. */
  const startFromPending = (g: Extract<G, { t: 'pending' }>) => {
    const P = propsRef.current, vp = vpRef.current, c0 = screenToCanvas(vp, g.s.x, g.s.y), before = P.shape, hit = g.hit;
    const panIt = () => { gest.current = { t: 'pan', id: g.id, s: g.s, vp: { ...vp } }; userMoved.current = true; };
    if (P.tool === 'Pen' && (!hit || hit.kind !== 'node')) {
      const continuing = before.name === 'Custom path' && before.kind === 'path' && !before.closed;
      const pts = continuing ? before.points : [];
      const sn = snapNode(c0, { index: -1, points: pts, closed: false, zoom: vp.zoom, settings: P.settings, shift: mods.current.shift, alt: mods.current.alt }).p;
      const node: Point = { x: sn.x, y: sn.y, mode: 'smooth', in: { ...sn }, out: { ...sn } };
      const points = [...pts, node];
      const base = continuing ? before : { name: 'Custom path', kind: 'path' as const, points: [], closed: false, fill: before.fill, stroke: before.stroke, strokeWidth: before.strokeWidth };
      const next = { ...base, name: 'Custom path', kind: 'path' as const, points, closed: false };
      if (continuing) P.onPreview(next); else P.onAddShape(next, { kind: 'node', index: points.length - 1 });
      P.onSelect({ kind: 'node', index: points.length - 1 });
      gest.current = { t: 'pen', id: g.id, index: points.length - 1, before, origin: sn, startC: c0, dirty: true };
      return;
    }
    if (!hit || hit.kind === 'segment') return panIt();
    if (hit.kind === 'other') return panIt();
    if (hit.kind === 'shape') {
      if (P.selection.kind !== 'shape') return panIt();
      gest.current = { t: 'bbox', id: g.id, part: 'move', before, bounds: shapeBounds(before), startC: c0, g0: c0, dirty: false };
      return;
    }
    if (hit.kind === 'bbox') {
      const b = shapeBounds(before);
      gest.current = { t: 'bbox', id: g.id, part: hit.part, before, bounds: b, startC: c0, g0: partPoint(b, hit.part), dirty: false };
      return;
    }
    if (hit.kind === 'node') {
      const indices = selectedIndices(P.selection);
      if (before.points[hit.index]?.locked) return panIt();
      if (P.multiSelect || mods.current.shift || indices.length > 1 && indices.includes(hit.index)) {
        const group = [...new Set([...indices, hit.index])].sort((a, b) => a - b);
        P.onSelect(group.length > 1 ? { kind: 'nodes', indices: group } : { kind: 'node', index: hit.index });
        gest.current = { t: 'nodes', id: g.id, indices: group, before, startC: c0, dirty: false };
        return;
      }
      P.onSelect({ kind: 'node', index: hit.index });
      const p = before.points[hit.index];
      gest.current = { t: 'node', id: g.id, index: hit.index, before, startNode: { x: p.x, y: p.y }, startC: c0, dirty: false };
      return;
    }
    if (hit.kind === 'handle') {
      P.onSelect({ kind: 'handle', index: hit.index, side: hit.side });
      const h = getHandles(before.points, hit.index, before.closed)[hit.side];
      gest.current = { t: 'handle', id: g.id, index: hit.index, side: hit.side, before, startH: { x: h.x, y: h.y }, startC: c0, dirty: false };
    }
  };

  /** One frame of high-frequency pointer work (rAF-coalesced). */
  const frame = () => {
    rafRef.current = 0;
    let g = gest.current;
    const P = propsRef.current, vp = vpRef.current;
    if (g.t === 'pinch') {
      const a = pointers.current.get(g.ids[0]), b = pointers.current.get(g.ids[1]);
      if (!a || !b) return;
      applyView(pinchViewport(g.vp, g.mid, g.dist, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.hypot(a.x - b.x, a.y - b.y)));
      return;
    }
    if (g.t === 'idle' || g.t === 'locked') return;
    const cur = pointers.current.get(g.id);
    if (!cur) return;
    if (g.t === 'pending') {
      if (Math.hypot(cur.x - g.s.x, cur.y - g.s.y) < THRESHOLD[g.ptr]) return;
      startFromPending(g);
      g = gest.current;
      if (g.t === 'pending') return;
    }
    if (g.t === 'pan') { applyView({ ...g.vp, x: g.vp.x + cur.x - g.s.x, y: g.vp.y + cur.y - g.s.y }); return; }
    const c = screenToCanvas(vp, cur.x, cur.y), m = mods.current;
    const st = P.settings;

    if (g.t === 'line') {
      const { p } = snapNode(c, { index: -1, points: [], closed: false, zoom: vp.zoom, settings: st, shift: m.shift, alt: m.alt });
      g.end = p;
      g.dirty = dist(g.start, p) >= 1;
      setLinePreview({ start: g.start, end: p });
      setHud(`Line · ${f1(dist(g.start, p))}`);
    } else if (g.t === 'nodes') {
      P.onPreview(moveNodesBy(g.before, g.before, g.indices, c.x - g.startC.x, c.y - g.startC.y)); g.dirty = true;
      setHud(`${g.indices.length} nodes · ${f1(c.x - g.startC.x)}, ${f1(c.y - g.startC.y)}`);
    } else if (g.t === 'node') {
      const raw = { x: g.startNode.x + c.x - g.startC.x, y: g.startNode.y + c.y - g.startC.y };
      const { p, guides: gd } = snapNode(raw, { index: g.index, points: g.before.points, closed: g.before.closed, zoom: vp.zoom, settings: st, shift: m.shift, alt: m.alt });
      P.onPreview(moveNodeTo(g.before, g.index, p)); g.dirty = true; showGuides(gd);
      const nb = neighborOf(g.before.points, g.index, g.before.closed);
      setHud(`X ${f1(p.x)}  Y ${f1(p.y)}` + (nb ? `  ·  ${f1(angleDeg(nb, p))}°  ${f1(dist(nb, p))}` : ''));
    } else if (g.t === 'handle') {
      const node = g.before.points[g.index];
      const raw = { x: g.startH.x + c.x - g.startC.x, y: g.startH.y + c.y - g.startC.y };
      const { p, guides: gd } = snapHandle(raw, node, { settings: st, zoom: vp.zoom, shift: m.shift, alt: m.alt });
      const next = moveHandle(g.before, g.index, g.side, p);
      P.onPreview(next); g.dirty = true; showGuides(gd);
      const pol = handlePolar(next, g.index, g.side);
      setHud(`Angle ${f1(pol.angle)}°  Length ${f1(pol.length)}`);
    } else if (g.t === 'pen') {
      const raw = { x: g.origin.x + c.x - g.startC.x, y: g.origin.y + c.y - g.startC.y };
      const { p, guides: gd } = snapHandle(raw, g.origin, { settings: st, zoom: vp.zoom, shift: m.shift, alt: m.alt });
      const pts = P.shape.points.map((pt, i) => (i === g.index ? { ...pt, out: { x: p.x, y: p.y }, in: { x: 2 * g.origin.x - p.x, y: 2 * g.origin.y - p.y } } : pt));
      P.onPreview({ ...P.shape, points: pts }); showGuides(gd);
      setHud(`Angle ${f1(angleDeg(g.origin, p))}°  Length ${f1(dist(g.origin, p))}`);
    } else if (g.t === 'bbox') {
      const b = g.bounds;
      if (g.part === 'move') {
        const r = snapTranslate(b, { x: c.x - g.startC.x, y: c.y - g.startC.y }, { settings: st, zoom: vp.zoom, alt: m.alt });
        P.onPreview(transformShape(g.before, matTranslate(r.delta.x, r.delta.y))); g.dirty = true; showGuides(r.guides);
        setHud(`X ${f1(b.x + r.delta.x)}  Y ${f1(b.y + r.delta.y)}`);
      } else if (g.part === 'rotate') {
        const ctr = boundsCenter(b);
        let d = (Math.atan2(c.y - ctr.y, c.x - ctr.x) - Math.atan2(g.startC.y - ctr.y, g.startC.x - ctr.x)) * 180 / Math.PI;
        if (st.snapAngle || m.shift) { const step = m.shift && !st.snapAngle ? 15 : st.angleStep; d = Math.round(d / step) * step; }
        P.onPreview(transformShape(g.before, matRotateAbout(ctr.x, ctr.y, d * Math.PI / 180))); g.dirty = true;
        setHud(`Rotate ${f1(((d % 360) + 360) % 360)}°`);
      } else {
        let target = { x: g.g0.x + c.x - g.startC.x, y: g.g0.y + c.y - g.startC.y };
        if (st.snapOn && st.snapGrid && !m.alt) target = { x: Math.round(target.x / st.gridSize) * st.gridSize, y: Math.round(target.y / st.gridSize) * st.gridSize };
        const isCorner = g.part.length === 2;
        const r = scaleFromHandle(g.before, b, g.part, target, { uniform: isCorner ? st.lockRatio !== m.shift : false, center: st.fromCenter !== m.alt });
        P.onPreview(r.shape); g.dirty = true;
        setHud(`W ${f1(r.box.w)}  H ${f1(r.box.h)}  ·  ${Math.round(r.box.w / Math.max(b.w, 1e-6) * 100)}% × ${Math.round(r.box.h / Math.max(b.h, 1e-6) * 100)}%`);
      }
    }
  };
  const schedule = () => { if (!rafRef.current) rafRef.current = requestAnimationFrame(frame); };

  /* ───── pointer events ───── */
  const onDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    const el = wrapRef.current!;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const s = local(e), type = ptr(e);
    if (nodeMenu) setNodeMenu(null);
    pointers.current.set(e.pointerId, { ...s, type });
    mods.current = { shift: e.shiftKey, alt: e.altKey };
    cancelAnim();
    if (pointers.current.size >= 2) { if (gest.current.t !== 'pinch') beginPinch(); return; }
    if (e.button === 1 || space.current || tool === 'Hand') {
      gest.current = { t: 'pan', id: e.pointerId, s, vp: { ...vpRef.current } }; userMoved.current = true;
      el.style.cursor = 'grabbing'; return;
    }
    if (tool === 'Line') {
      const start = screenToCanvas(vpRef.current, s.x, s.y);
      gest.current = { t: 'line', id: e.pointerId, before: propsRef.current.shape, start, end: start, dirty: false };
      setLinePreview({ start, end: start });
      return;
    }
    gest.current = { t: 'pending', id: e.pointerId, s, hit: doHit(s, type), ptr: type };
  };
  const onMove = (e: RPointerEvent) => {
    const known = pointers.current.get(e.pointerId);
    mods.current = { shift: e.shiftKey, alt: e.altKey };
    if (!known) {
      if (e.pointerType === 'mouse' && gest.current.t === 'idle' && wrapRef.current && !space.current) {
        const s = local(e), hit = tool === 'Hand' ? null : doHit(s, 'mouse');
        wrapRef.current.style.cursor = tool === 'Hand' ? 'grab' : tool === 'Pen' || tool === 'Line' ? 'crosshair'
          : hit?.kind === 'handle' ? 'crosshair' : hit?.kind === 'node' ? 'grab' : hit?.kind === 'bbox' ? CURSORS[hit.part]
          : hit?.kind === 'segment' ? 'pointer' : hit?.kind === 'shape' && selection.kind === 'shape' ? 'move' : '';
      }
      return;
    }
    const s = local(e); known.x = s.x; known.y = s.y;
    schedule();
  };
  const finish = (e: RPointerEvent, cancelled: boolean) => {
    if (!pointers.current.has(e.pointerId)) return;
    // apply the final pointer position before ending, so a quick flick is never lost to rAF coalescing
    const last = pointers.current.get(e.pointerId), at = local(e);
    if (last && !cancelled) { last.x = at.x; last.y = at.y; }
    cancelAnimationFrame(rafRef.current); rafRef.current = 0;
    if (!cancelled) frame();
    const g = gest.current, P = propsRef.current;
    pointers.current.delete(e.pointerId);
    if (g.t === 'pinch') {
      if (pointers.current.size < 2) gest.current = pointers.current.size ? { t: 'locked' } : { t: 'idle' };
    } else if (g.t === 'pending') {
      if (g.id === e.pointerId) { gest.current = { t: 'idle' }; if (!cancelled) handleTap(g); }
    } else if (g.t === 'pan') {
      if (g.id === e.pointerId) gest.current = { t: 'idle' };
    } else if (g.t === 'line') {
      if (g.id === e.pointerId && !cancelled && g.dirty) {
        const P = propsRef.current;
        const line: ShapeModel = {
          name: 'Line',
          kind: 'path',
          points: [{ ...g.start, mode: 'corner' }, { ...g.end, mode: 'corner' }],
          closed: false,
          fill: 'none',
          stroke: P.shape.stroke === 'none' ? P.shape.fill : P.shape.stroke,
          strokeWidth: P.shape.strokeWidth || 1,
        };
        P.onAddShape(line, { kind: 'node', index: 1 });
      }
      setLinePreview(null);
      setHud(null);
      if (g.id === e.pointerId) gest.current = { t: 'idle' };
    } else if (g.t !== 'idle' && g.t !== 'locked' && g.id === e.pointerId) {
      if (cancelled) revert(g); else if (g.dirty) P.onGestureEnd(g.before);
      gest.current = { t: 'idle' }; showGuides([]); setHud(null);
    }
    if (!pointers.current.size) { gest.current = { t: 'idle' }; if (wrapRef.current && !space.current) wrapRef.current.style.cursor = ''; }
  };

  /* ───── render ───── */
  const d = useMemo(() => pathOfShape(shape), [shape.points, shape.extra, shape.closed, shape.kind]);
  const dots = useMemo(() => shape.hidden || shape.locked ? '' : shape.points.map(p => `M${p.x} ${p.y}h.01`).join(''), [shape.points, shape.hidden, shape.locked]);
  const otherById = useMemo(() => new Map(props.others.map(other => [other.id, other])), [props.others]);
  const bounds = useMemo(() => (selection.kind === 'shape' && !shape.locked && !shape.hidden ? shapeBounds(shape) : null), [selection.kind, shape]);
  const painted = useMemo(() => paintedMarkup(shape), [shape.paint, shape.points, shape.extra, shape.closed, shape.kind, shape.box, shape.frame, shape.strokeWidth, shape.fillRule, shape.id]);
  const selIdx = shape.hidden || shape.locked ? null : selectedNode(selection);
  const selPoint = selIdx !== null ? shape.points[selIdx] : undefined;
  const handles = selPoint && shape.kind === 'path' ? getHandles(shape.points, selIdx!, shape.closed) : null;
  const nodeIndices = selectedIndices(selection);
  const allNodesLocked = nodeIndices.length > 0 && nodeIndices.every(index => !!shape.points[index]?.locked);
  const menuPoint = nodeMenu ? shape.points[nodeMenu.index] : undefined;
  const gridStep = settings.snapGrid ? settings.gridSize : 50;
  const showMinor = gridStep * (pct / 100) >= 6;

  return <div className="stage" ref={wrapRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={e => finish(e, false)} onPointerCancel={e => finish(e, true)} onContextMenu={e => e.preventDefault()}
    data-tool={tool} data-testid="stage">
    <svg ref={svgRef} className="stage-svg" role="img" aria-label={`${shape.name} shape preview`} style={{ '--inv': 1 } as CSSProperties} data-testid="shape-preview">
      <g ref={gRef}>
        <ArtboardLayer showGrid={props.showGrid} step={gridStep} minor={showMinor} background={props.pageBackground} />
        {!shape.hidden && shape.box && (shape.frame ?? 'box') === 'box' && <rect className="frame-box" x={shape.box.x} y={shape.box.y} width={shape.box.w} height={shape.box.h} />}
        {props.shapeOrder.map(id => id === shape.id
          ? (!shape.hidden && <ShapeLayer key={id} d={d} polygonPoints={props.polygonPoints} painted={painted} fill={shape.fill} fillRule={shape.fillRule} strokeDraw={props.strokeDraw} />)
          : (() => { const other = otherById.get(id); return other && !other.hidden ? <StaticShape key={id} shape={other} /> : null; })())}
        {linePreview && <path className="line-preview" d={`M${linePreview.start.x} ${linePreview.start.y}L${linePreview.end.x} ${linePreview.end.y}`} fill="none" stroke={shape.stroke === 'none' ? shape.fill : shape.stroke} strokeWidth={shape.strokeWidth || 1} />}
        {dots && <><path className="dots-ring" d={dots} style={{ strokeWidth: settings.nodeSize + 4 }} /><path className="dots-fill" d={dots} style={{ strokeWidth: settings.nodeSize }} /></>}
        {!shape.hidden && !shape.locked && selection.kind === 'segment' && shape.points[selection.index] && <path className="seg-sel" d={segmentPath(shape, selection.index)} />}
        {bounds && <g>
          <rect className="bbox" x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h} />
          {[...BBOX_PARTS, 'rotate' as const].map(part => {
            const q = partPoint(bounds, part), off = partOffsetPx(part);
            return <g key={part} transform={`translate(${q.x} ${q.y})`}><g style={INV}>
              {part === 'rotate' ? <><line className="bbox-stem" x1={0} y1={0} x2={off.x} y2={off.y} /><circle className="bbox-rot" cx={off.x} cy={off.y} r={7} /></>
                : <rect className="bbox-h" x={off.x - 5} y={off.y - 5} width={10} height={10} rx={2} />}
            </g></g>;
          })}
        </g>}
        {selPoint && <g transform={`translate(${selPoint.x} ${selPoint.y})`}>
          {settings.showTouch && <circle className="touch-halo" r={settings.touchSize / 2} style={INV} />}
          <circle className="node-sel" r={settings.nodeSize / 2 + 1} style={INV} />
        </g>}
        {selection.kind === 'nodes' && selection.indices.map(index => {
          const point = shape.points[index];
          return point ? <circle key={index} className="node-multi-sel" cx={point.x} cy={point.y} r={settings.nodeSize / 2 + 3} style={INV} /> : null;
        })}
        {!shape.hidden && shape.points.map((point, index) => point.locked
          ? <circle key={`locked-${index}`} className="node-locked" cx={point.x} cy={point.y} r={settings.nodeSize / 2 + 2} style={INV} />
          : null)}
        {handles && selPoint && (['in', 'out'] as const).map(side => {
          const h = handles[side];
          if (dist(h, selPoint) < 1e-6) return null;
          const isSel = selection.kind === 'handle' && selection.side === side;
          const pol = isSel ? handlePolar(shape, selIdx!, side) : null;
          return <g key={side}>
            <line className="handle-line" x1={selPoint.x} y1={selPoint.y} x2={h.x} y2={h.y} />
            <g transform={`translate(${h.x} ${h.y})`}>
              {settings.showTouch && <circle className="touch-halo" r={settings.touchSize * 0.45} style={INV} />}
              <circle className={`handle-dot ${isSel ? 'sel' : ''}`} r={settings.handleSize / 2} style={INV} data-testid={`handle-${side}-${selIdx}`} />
              {pol && <text className="hlabel" x={12} y={-10} style={INV}>{`${f1(pol.angle)}° · ${f1(pol.length)}`}</text>}
            </g>
          </g>;
        })}
        {guides.map((g, i) => <g key={i}>
          <line className={`guide ${g.kind}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} />
          {g.label && <g transform={`translate(${(g.x1 + g.x2) / 2} ${(g.y1 + g.y2) / 2})`}><text className="glabel" x={7} y={-7} style={INV}>{g.label}</text></g>}
        </g>)}
      </g>
    </svg>
    {(nodeIndices.length > 0 || props.multiSelect) && <NodeBar count={nodeIndices.length} multi={props.multiSelect} allLocked={allNodesLocked}
      onMulti={() => props.onMultiSelect(!props.multiSelect)} onAll={() => props.onSelect({ kind: 'nodes', indices: shape.points.map((_, index) => index) })}
      onLock={() => props.onCommit(setNodesLocked(shape, nodeIndices, !allNodesLocked), selection)}
      onDelete={() => {
        const result = deleteNodes(shape, nodeIndices);
        if (result.shape && result.removed) props.onCommit(result.shape, { kind: 'none' });
        if (result.skipped) props.onAnnounce(`${result.skipped} locked node${result.skipped > 1 ? 's' : ''} kept`);
        else if (!result.shape) props.onAnnounce(`A shape needs at least ${shape.closed ? 3 : 2} nodes`);
      }} onClear={() => props.onSelect({ kind: 'none' })} />}
    {nodeMenu && menuPoint && <NodeMenu x={nodeMenu.x} y={nodeMenu.y} width={wrapRef.current?.clientWidth ?? 0} height={wrapRef.current?.clientHeight ?? 0}
      count={nodeIndices.length || 1} selected={nodeIndices.includes(nodeMenu.index)} locked={!!menuPoint.locked}
      smooth={shape.kind === 'polygon' ? false : (menuPoint.mode ?? 'auto') !== 'corner'} onSelect={() => { props.onSelect(toggleInSelection(selection, nodeMenu.index)); setNodeMenu(null); }}
      onLock={() => { props.onCommit(setNodesLocked(shape, [nodeMenu.index], !menuPoint.locked), selection); setNodeMenu(null); }}
      onToggleType={() => { const mode = shape.kind === 'polygon' || (menuPoint.mode ?? 'auto') === 'corner' ? 'smooth' : 'corner'; props.onCommit(setNodeMode(shape, nodeMenu.index, mode), { kind: 'node', index: nodeMenu.index }); setNodeMenu(null); }}
      onDelete={() => {
        const selected = selectedIndices(selection).includes(nodeMenu.index) ? selectedIndices(selection) : [nodeMenu.index];
        const result = deleteNodes(shape, selected);
        if (result.shape && result.removed) props.onCommit(result.shape, { kind: 'none' });
        else if (!result.shape) props.onAnnounce(`A shape needs at least ${shape.closed ? 3 : 2} nodes`);
        if (result.skipped) props.onAnnounce(`${result.skipped} locked node${result.skipped > 1 ? 's' : ''} kept`);
        setNodeMenu(null);
      }} onClose={() => setNodeMenu(null)} />}
    <div className="hud" ref={hudRef} aria-live="off" />
    <div className="zoom-hud" onPointerDown={e => e.stopPropagation()} role="group" aria-label="Zoom">
      <button type="button" onClick={() => zoomStep(-1)} aria-label="Zoom out" data-testid="zoom-out"><Minus /></button>
      <button type="button" className="pct" onClick={doReset} aria-label="Reset zoom to 100%" data-testid="zoom-pct">{pct}%</button>
      <button type="button" onClick={() => zoomStep(1)} aria-label="Zoom in" data-testid="zoom-in"><Plus /></button>
      <button type="button" className="fit" onClick={() => doFit(true)} aria-label="Fit to screen" data-testid="zoom-fit"><Maximize /><span>Fit</span></button>
    </div>
  </div>;
});

export default Stage;
