import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { Maximize, Minus, Pause, Play, Plus } from 'lucide-react';
import { clampViewport, fitViewport, fitZoom, nextStop, pinchViewport, screenToCanvas, zoomAt, type V2, type Viewport } from '../../lib/shape/viewport';
import { dragHandle, layerOverlay, type Handle } from '../engine/handles';
import { apply as applyMat, invert, layerMatrix } from '../engine/geom';
import { newMeshPoint } from '../engine/mesh';
import { colorAtPos } from '../engine/ramp';
import { rgbToHex } from '../engine/color';
import type { GradientLayer } from '../engine/model';
import { useStore, type StudioStore } from '../engine/store';
import { CHECKER } from './ui';
import LayeredArt from './LayeredArt';

/* The interactive canvas. The art is a real DOM composition (the exact CSS that gets exported), scaled with a CSS transform;
 * handles are an SVG overlay. Zoom / pan / pinch only touch the transform, never the project. */

const INV: CSSProperties = { transform: 'scale(var(--inv))' };
const THRESH = 6;

type G =
  | { t: 'idle' } | { t: 'locked' }
  | { t: 'pending'; id: number; s: V2; hit: Handle | null; type: string }
  | { t: 'pan'; id: number; s: V2; vp: Viewport }
  | { t: 'pinch'; ids: [number, number]; vp: Viewport; mid: V2; dist: number }
  | { t: 'drag'; id: number; handle: Handle; start: GradientLayer; p0: V2 };

interface Props { store: StudioStore; mode: 'gradient' | 'transform'; playing: boolean; onTogglePlay: () => void }

function PreviewStage({ store, mode, playing, onTogglePlay }: Props) {
  const project = useStore(store, s => s.project);
  const layerId = useStore(store, s => s.layerId);
  const stopId = useStore(store, s => s.stopId);
  const layer = project.layers.find(l => l.id === layerId) ?? null;
  const { w, h } = project.canvas;

  const wrapRef = useRef<HTMLDivElement>(null), worldRef = useRef<HTMLDivElement>(null), readRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 }), sizeRef = useRef({ w: 0, h: 0 }), fitRef = useRef(1), userMoved = useRef(false);
  const pointers = useRef(new Map<number, V2 & { type: string }>()), gest = useRef<G>({ t: 'idle' }), raf = useRef(0), anim = useRef(0);
  const [pct, setPct] = useState(100);

  const overlay = useMemo(() => (layer && layer.visible ? layerOverlay(layer, project.canvas, mode, stopId) : null), [layer, project.canvas, mode, stopId]);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const live = useRef({ overlay, layer, canvas: project.canvas }); live.current = { overlay, layer, canvas: project.canvas };

  /* ───── viewport ───── */
  const applyView = useCallback((v: Viewport) => {
    const vp = clampViewport(v, sizeRef.current.w, sizeRef.current.h, w, h);
    vpRef.current = vp;
    if (worldRef.current) worldRef.current.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
    wrapRef.current?.style.setProperty('--inv', String(1 / vp.zoom));
    const p = Math.round(vp.zoom * 100); setPct(prev => (prev === p ? prev : p));
  }, [w, h]);
  const animateTo = useCallback((t: Viewport) => {
    cancelAnimationFrame(anim.current);
    const f = { ...vpRef.current }, t0 = performance.now();
    const step = (now: number) => { const k = Math.min(1, (now - t0) / 160), e = 1 - (1 - k) ** 3; applyView({ x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, zoom: f.zoom * (t.zoom / f.zoom) ** e }); if (k < 1) anim.current = requestAnimationFrame(step); };
    anim.current = requestAnimationFrame(step);
  }, [applyView]);
  const fit = useCallback((animate = true) => { userMoved.current = false; const t = fitViewport(sizeRef.current.w, sizeRef.current.h, w, h); animate ? animateTo(t) : applyView(t); }, [animateTo, applyView, w, h]);
  const zoomBy = (dir: 1 | -1) => { userMoved.current = true; const { w: sw, h: sh } = sizeRef.current, v = vpRef.current; animateTo(zoomAt(v, sw / 2, sh / 2, nextStop(v.zoom, dir))); };

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    sizeRef.current = { w: el.clientWidth, h: el.clientHeight }; fitRef.current = fitZoom(el.clientWidth, el.clientHeight, w, h);
    userMoved.current = false; applyView(fitViewport(el.clientWidth, el.clientHeight, w, h));
    const ro = new ResizeObserver(() => {
      const old = sizeRef.current, nw = el.clientWidth, nh = el.clientHeight;
      if (nw === old.w && nh === old.h) return;
      const v = vpRef.current, c = screenToCanvas(v, old.w / 2, old.h / 2);
      sizeRef.current = { w: nw, h: nh }; fitRef.current = fitZoom(nw, nh, w, h);
      if (!userMoved.current) applyView(fitViewport(nw, nh, w, h)); else applyView({ zoom: v.zoom, x: nw / 2 - c.x * v.zoom, y: nh / 2 - c.y * v.zoom });
    });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(anim.current); cancelAnimationFrame(raf.current); };
  }, [applyView, w, h]);

  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); userMoved.current = true; cancelAnimationFrame(anim.current);
      const r = el.getBoundingClientRect(), v = vpRef.current;
      if (e.ctrlKey || e.metaKey) applyView(zoomAt(v, e.clientX - r.left, e.clientY - r.top, v.zoom * Math.exp(-e.deltaY * 0.01)));
      else applyView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyView]);

  /* ───── gestures ───── */
  const local = (e: { clientX: number; clientY: number }): V2 => { const r = wrapRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const setRead = (t: string | null) => { const el = readRef.current; if (!el) return; if (t === null) el.classList.remove('on'); else { el.textContent = t; el.classList.add('on'); } };
  const hitTest = (s: V2, type: string): Handle | null => {
    const o = live.current.overlay; if (!o) return null;
    const vp = vpRef.current, R = type === 'mouse' ? 15 : 27;
    let best: Handle | null = null, bs = Infinity;
    for (const hd of o.handles) {
      const d = Math.hypot(hd.x * vp.zoom + vp.x - s.x, hd.y * vp.zoom + vp.y - s.y), score = d / (R + (hd.kind === 'stop' ? 4 : 0)) - hd.pri * 0.02;
      if (d <= R + (hd.kind === 'stop' ? 4 : 0) && score < bs) { bs = score; best = hd; }
    }
    return best;
  };
  const cancelDrag = () => { const g = gest.current; if (g.t === 'drag') { store.updateLayer(g.start.id, () => g.start); store.end(); } setRead(null); };
  const beginPinch = () => {
    const ids = [...pointers.current.keys()].slice(0, 2) as [number, number]; cancelDrag();
    const a = pointers.current.get(ids[0])!, b = pointers.current.get(ids[1])!;
    gest.current = { t: 'pinch', ids, vp: { ...vpRef.current }, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    userMoved.current = true; cancelAnimationFrame(anim.current);
  };
  const frame = () => {
    raf.current = 0;
    let g = gest.current; const vp = vpRef.current;
    if (g.t === 'pinch') {
      const a = pointers.current.get(g.ids[0]), b = pointers.current.get(g.ids[1]); if (!a || !b) return;
      applyView(pinchViewport(g.vp, g.mid, g.dist, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.hypot(a.x - b.x, a.y - b.y))); return;
    }
    if (g.t === 'idle' || g.t === 'locked') return;
    const cur = pointers.current.get(g.id); if (!cur) return;
    if (g.t === 'pending') {
      if (Math.hypot(cur.x - g.s.x, cur.y - g.s.y) < THRESH) return;
      const L = live.current.layer;
      if (g.hit && L) {
        store.begin(); if (g.hit.stopId) store.selectStop(g.hit.stopId);
        gest.current = { t: 'drag', id: g.id, handle: g.hit, start: L, p0: screenToCanvas(vp, g.s.x, g.s.y) };
      } else { gest.current = { t: 'pan', id: g.id, s: g.s, vp: { ...vp } }; userMoved.current = true; }
      g = gest.current;
    }
    if (g.t === 'pan') { applyView({ ...g.vp, x: g.vp.x + cur.x - g.s.x, y: g.vp.y + cur.y - g.s.y }); return; }
    if (g.t === 'drag') {
      const p = screenToCanvas(vp, cur.x, cur.y);
      const next = dragHandle({ start: g.start, handle: g.handle, pointer: p, startPointer: g.p0, canvas: live.current.canvas, shift: false });
      store.updateLayer(g.start.id, () => next);
      const hk = g.handle.kind;
      setRead(hk === 'stop' ? `Stop ${next.stops.find(s => s.id === g.handle.stopId)?.pos.toFixed(1)}%` : hk === 'angle' || hk === 'from' ? `${next.angle.toFixed(1)}°` : hk === 'tf-scale' ? `Scale ${Math.round(next.transform.scale * 100)}%` : hk === 'tf-rotate' ? `Rotate ${next.transform.rotate}°` : hk === 'rx' || hk === 'ry' ? `${next.shape === 'circle' ? 'Radius' : hk === 'rx' ? 'Rx' : 'Ry'} ${(hk === 'ry' ? next.ry : next.rx).toFixed(1)}%` : hk === 'point' ? (() => { const q = next.mesh.points.find(x => x.id === g.handle.stopId); return `X ${q?.x}%  Y ${q?.y}%`; })() : hk === 'psize' ? `Size ${next.mesh.points.find(x => x.id === g.handle.stopId)?.size}%` : hk === 'move' || hk === 'tf-move' ? `X ${next.transform.x}%  Y ${next.transform.y}%` : `${next.cx}% · ${next.cy}%`);
    }
  };
  const schedule = () => { if (!raf.current) raf.current = requestAnimationFrame(frame); };

  const onDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    try { wrapRef.current!.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const s = local(e); pointers.current.set(e.pointerId, { ...s, type: e.pointerType });
    cancelAnimationFrame(anim.current);
    if (pointers.current.size >= 2) { if (gest.current.t !== 'pinch') beginPinch(); return; }
    if (e.button === 1) { gest.current = { t: 'pan', id: e.pointerId, s, vp: { ...vpRef.current } }; userMoved.current = true; return; }
    gest.current = { t: 'pending', id: e.pointerId, s, hit: hitTest(s, e.pointerType), type: e.pointerType };
  };
  const onMove = (e: RPointerEvent) => {
    const k = pointers.current.get(e.pointerId);
    if (!k) { if (e.pointerType === 'mouse' && gest.current.t === 'idle') wrapRef.current!.style.cursor = hitTest(local(e), 'mouse') ? 'grab' : ''; return; }
    const s = local(e); k.x = s.x; k.y = s.y; schedule();
  };
  const finish = (e: RPointerEvent, cancelled: boolean) => {
    const k = pointers.current.get(e.pointerId); if (!k) return;
    const at = local(e); if (!cancelled) { k.x = at.x; k.y = at.y; }
    cancelAnimationFrame(raf.current); raf.current = 0; if (!cancelled) frame();
    const g = gest.current; pointers.current.delete(e.pointerId);
    if (g.t === 'pinch') gest.current = pointers.current.size ? { t: 'locked' } : { t: 'idle' };
    else if (g.t === 'pending' && g.id === e.pointerId) {
      gest.current = { t: 'idle' };
      if (!cancelled) {
        store.selectStop(g.hit?.stopId ?? null);
        const now = performance.now(), prev = lastTap.current, L = live.current.layer;
        lastTap.current = { t: now, x: g.s.x, y: g.s.y };
        if (!g.hit && L && L.type === 'mesh' && prev && now - prev.t < 340 && Math.hypot(prev.x - g.s.x, prev.y - g.s.y) < 28) {
          const c = screenToCanvas(vpRef.current, g.s.x, g.s.y), cv = live.current.canvas, lp = applyMat(invert(layerMatrix(L, cv)), c);
          const near = [...L.mesh.points].sort((a, b) => Math.hypot(a.x - (lp.x / cv.w) * 100, a.y - (lp.y / cv.h) * 100) - Math.hypot(b.x - (lp.x / cv.w) * 100, b.y - (lp.y / cv.h) * 100))[0];
          const np = newMeshPoint((lp.x / cv.w) * 100, (lp.y / cv.h) * 100, near?.color ?? rgbToHex(colorAtPos({ ...L, type: 'linear', stops: [{ id: 'a', color: '#7c5cff', alpha: 1, pos: 0 }, { id: 'b', color: '#22d3ee', alpha: 1, pos: 100 }] }, 50)), 1, 46);
          store.updateLayer(L.id, l => ({ ...l, mesh: { ...l.mesh, points: [...l.mesh.points, np] } })); store.selectStop(np.id); lastTap.current = null;
        }
      }
    }
    else if (g.t === 'drag' && g.id === e.pointerId) { if (cancelled) cancelDrag(); else store.end(); setRead(null); gest.current = { t: 'idle' }; }
    else if (g.t === 'pan' && g.id === e.pointerId) gest.current = { t: 'idle' };
    if (!pointers.current.size) gest.current = { t: 'idle' };
  };

  /* ───── render ───── */
  const stopColor = (id?: string) => layer?.stops.find(s => s.id === id)?.color;

  return <div className="gs-stage" ref={wrapRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={e => finish(e, false)} onPointerCancel={e => finish(e, true)} onContextMenu={e => e.preventDefault()} data-testid="gs-stage">
    <div className="gs-world" ref={worldRef} style={{ width: w, height: h }}>
      <div className="gs-checker" style={{ background: CHECKER }} />
      <LayeredArt project={project} rootClass="gs-art" playing={playing} testId="gs-art" />
      <svg className="gs-overlay" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {overlay && <>
          <g transform={`matrix(${overlay.matrix.join(' ')})`}>
            {overlay.local.map((p, i) => <g key={i}><path className={`gs-line ${p.kind} ${p.dash ? 'dash' : ''}`} d={p.d} /></g>)}
          </g>
          {overlay.handles.map(hd => {
            const sel = hd.stopId && hd.stopId === stopId, sq = hd.kind === 'rx' || hd.kind === 'ry' || hd.kind === 'tf-scale';
            return <g key={hd.id} transform={`translate(${hd.x} ${hd.y})`} data-testid={`gs-handle-${hd.kind}`}>
              <g style={INV}>
                {hd.kind === 'stop' && sel && <circle r={19} className="gs-halo" />}
                {sq ? <rect x={-8} y={-8} width={16} height={16} rx={3} className="gs-h" style={{ fill: hd.color }} />
                  : <circle r={hd.kind === 'stop' ? (sel ? 13 : 11) : hd.kind === 'origin' || hd.kind === 'move' || hd.kind === 'tf-move' ? 9 : 10} className={`gs-h ${hd.kind}`} style={{ fill: hd.kind === 'stop' ? stopColor(hd.stopId) : hd.color }} />}
                {hd.label && <text className="gs-hl" x={14} y={-12}>{hd.label}</text>}
              </g>
            </g>;
          })}
        </>}
      </svg>
    </div>
    <div className="gs-readout" ref={readRef} />
    <div className="gs-hud" onPointerDown={e => e.stopPropagation()}>
      <div className="zoom-hud" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Zoom out" data-testid="gs-zoom-out"><Minus /></button>
        <button type="button" className="pct" onClick={() => { userMoved.current = true; const { w: sw, h: sh } = sizeRef.current; animateTo(zoomAt(vpRef.current, sw / 2, sh / 2, 1)); }} aria-label="Reset zoom to 100%" data-testid="gs-zoom-pct">{pct}%</button>
        <button type="button" onClick={() => zoomBy(1)} aria-label="Zoom in" data-testid="gs-zoom-in"><Plus /></button>
        <button type="button" className="fit" onClick={() => fit(true)} aria-label="Fit to screen" data-testid="gs-zoom-fit"><Maximize /><span>Fit</span></button>
      </div>
      <button type="button" className={`gs-play-btn ${playing ? 'on' : ''}`} onClick={onTogglePlay} aria-pressed={playing} aria-label={playing ? 'Pause animation preview' : 'Play animation preview'} data-testid="gs-play">{playing ? <Pause /> : <Play />}</button>
    </div>
  </div>;
}

export default memo(PreviewStage);
