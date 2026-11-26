import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Switch } from '../../../../shared/controls';
import { createMotionState, stepMotion, type MotionState } from '../../../../motion/motionRuntime';
import { displacementAt, evaluateFlow } from '../../../../motion/motionField';
import { FLOW_TYPES, FLOW_TYPE_LABEL, MOTION_LIMITS, MOTION_RANGE, newFlowSource, newPath, type FlowType } from '../../../../motion/types';
import { Select } from '../parts';
import type { MotionEditor } from './useMotion';

/** Canvas field editor. It draws the REAL composed field (the same math the shader runs, via the CPU twin) and edits the real config:
 *  every drag writes straight into `settings.motion`, so the preview canvas and the exported page move with it. */

const ASPECT = 1.6;
type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'add' | 'draw' | 'path' | 'influence';
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: 'Click a source or path to select it.' },
  { id: 'move', label: 'Move', hint: 'Drag a source or a path point.' },
  { id: 'rotate', label: 'Rotate', hint: 'Drag around the selected source to set its direction.' },
  { id: 'scale', label: 'Scale', hint: 'Drag away from the selected source to set its field scale.' },
  { id: 'influence', label: 'Influence', hint: 'Drag away from the selected source to set its radius of influence.' },
  { id: 'add', label: 'Add', hint: 'Click to place a new flow source of the chosen type.' },
  { id: 'draw', label: 'Draw path', hint: 'Draw a stroke; it becomes a path that Path flow sources can follow.' },
  { id: 'path', label: 'Edit path', hint: 'Drag points. Click a segment to add a point, double-click a point to remove it.' },
];
const TOOL_CURSOR: Record<Tool, string> = { select: 'pointer', move: 'move', rotate: 'crosshair', scale: 'nwse-resize', influence: 'nwse-resize', add: 'copy', draw: 'crosshair', path: 'pointer' };

interface View { vectors: boolean; heat: boolean; streams: boolean; rings: boolean; turbulence: boolean }
const DEFAULT_VIEW: View = { vectors: true, heat: true, streams: false, rings: true, turbulence: false };
const HIT = 16;
const FIELD_COLS = 26;
const FIELD_ROWS = 16;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Drag =
  | { kind: 'source'; id: string; tool: Tool }
  | { kind: 'node'; pathId: string; index: number }
  | { kind: 'stroke'; points: { x: number; y: number }[] };

export default function FieldEditor({ editor, selectedId, onSelect }: { editor: MotionEditor; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { config, edit, announce } = editor;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>('move');
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [addType, setAddType] = useState<FlowType>('vortex');
  const [pathSel, setPathSel] = useState<{ pathId: string; index: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const live = useRef({ config, view, selectedId, tool, pathSel, stroke: [] as { x: number; y: number }[] });
  live.current = { ...live.current, config, view, selectedId, tool, pathSel };

  /* ── the preview loop: steps a private engine state with the real config, ~30 fps, paused when hidden ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    const state: MotionState = createMotionState();
    const heat = document.createElement('canvas');
    heat.width = FIELD_COLS; heat.height = FIELD_ROWS;
    const heatCtx = heat.getContext('2d');
    const heatData = heatCtx?.createImageData(FIELD_COLS, FIELD_ROWS);
    const field = new Float32Array(FIELD_COLS * FIELD_ROWS * 2);
    const out = [0, 0], tmp = [0, 0], sampled = [0, 0];
    let raf = 0, last = 0, clock = 0;

    const toPx = (u: number, v: number, w: number, h: number): [number, number] => [u * w, (1 - v) * h];
    const flowAtUv = (u: number, v: number, into: number[]) => evaluateFlow(state, (u - 0.5) * ASPECT, v - 0.5, ASPECT, into);
    const flowAtGridUv = (u: number, v: number, into: number[]) => {
      const gx = clamp(u * FIELD_COLS - 0.5, 0, FIELD_COLS - 1);
      const gy = clamp((1 - v) * FIELD_ROWS - 0.5, 0, FIELD_ROWS - 1);
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const x1 = Math.min(x0 + 1, FIELD_COLS - 1), y1 = Math.min(y0 + 1, FIELD_ROWS - 1);
      const tx = gx - x0, ty = gy - y0;
      const a = (y0 * FIELD_COLS + x0) * 2, b = (y0 * FIELD_COLS + x1) * 2;
      const c = (y1 * FIELD_COLS + x0) * 2, d = (y1 * FIELD_COLS + x1) * 2;
      into[0] = (field[a]! + (field[b]! - field[a]!) * tx) * (1 - ty) + (field[c]! + (field[d]! - field[c]!) * tx) * ty;
      into[1] = (field[a + 1]! + (field[b + 1]! - field[a + 1]!) * tx) * (1 - ty) + (field[c + 1]! + (field[d + 1]! - field[c + 1]!) * tx) * ty;
      return into;
    };

    const paint = (now: number) => {
      raf = requestAnimationFrame(paint);
      if (document.hidden || now - last < 50) return;
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 1 / 30);
      last = now; clock += dt;
      const { config: cfg, view: show, selectedId: selected, tool: activeTool, pathSel: activePath } = live.current;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(80, Math.round(rect.width * dpr)), h = Math.max(50, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      // The editor shows the field even while the engine is off, so it can be designed before switching on.
      stepMotion(state, { ...cfg, enabled: true }, null, dt, { aspect: ASPECT, shaderDt: dt, animate: true, projectQuality: 'medium', octaveCap: 4, dual: true, clock });
      const cap = Math.max(0.02, cfg.composition.maxVelocity);

      ctx.fillStyle = '#10131a';
      ctx.fillRect(0, 0, w, h);

      if (show.heat || show.vectors || show.streams) {
        for (let j = 0; j < FIELD_ROWS; j++) for (let i = 0; i < FIELD_COLS; i++) {
          flowAtUv((i + 0.5) / FIELD_COLS, 1 - (j + 0.5) / FIELD_ROWS, out);
          const fieldIndex = (j * FIELD_COLS + i) * 2;
          field[fieldIndex] = out[0]!;
          field[fieldIndex + 1] = out[1]!;
          if (show.heat && heatCtx && heatData) {
            const s = clamp(Math.hypot(out[0]!, out[1]!) / cap, 0, 1);
            const k = (j * FIELD_COLS + i) * 4;
            heatData.data[k] = 20 + 90 * s; heatData.data[k + 1] = 22 + 70 * s; heatData.data[k + 2] = 40 + 200 * s; heatData.data[k + 3] = 255;
          }
        }
      }

      if (show.heat && heatCtx && heatData) {
        heatCtx.putImageData(heatData, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(heat, 0, 0, w, h);
      }

      // rings of influence
      if (show.rings) {
        ctx.lineWidth = Math.max(1, dpr);
        for (const src of cfg.sources) {
          if (!src.enabled || src.global) continue;
          const [x, y] = toPx(src.x, src.y, w, h);
          ctx.strokeStyle = src.id === selected ? 'rgba(160,140,255,.95)' : 'rgba(255,255,255,.22)';
          ctx.setLineDash([5 * dpr, 5 * dpr]);
          ctx.beginPath(); ctx.arc(x, y, src.radius * h, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // streamlines: short integral curves of the composed field
      if (show.streams) {
        ctx.lineWidth = 1.2 * dpr;
        for (let sy = 0; sy < 7; sy++) for (let sx = 0; sx < 11; sx++) {
          let u = (sx + 0.5 + 0.35 * Math.sin(sx * 12.9 + sy * 4.1)) / 11, v = (sy + 0.5 + 0.35 * Math.cos(sy * 7.7 + sx * 2.3)) / 7;
          ctx.beginPath();
          let [px, py] = toPx(u, v, w, h);
          ctx.moveTo(px, py);
          for (let step = 0; step < 26; step++) {
            flowAtGridUv(u, v, sampled);
            const speed = Math.hypot(sampled[0]!, sampled[1]!);
            if (speed < 1e-4) break;
            u += sampled[0]! / speed * 0.012 / ASPECT; v += sampled[1]! / speed * 0.012;
            if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) break;
            [px, py] = toPx(u, v, w, h);
            ctx.lineTo(px, py);
          }
          ctx.strokeStyle = 'rgba(120,235,200,.55)';
          ctx.stroke();
        }
      }

      // vectors (and turbulence displacement, in another colour)
      if (show.vectors || show.turbulence) {
        const cols = FIELD_COLS, rows = FIELD_ROWS;
        ctx.lineWidth = 1.3 * dpr;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const u = (i + 0.5) / cols, v = 1 - (j + 0.5) / rows;
          const [cx, cy] = toPx(u, v, w, h);
          const cell = w / cols;
          if (show.vectors) {
            const fieldIndex = (j * FIELD_COLS + i) * 2;
            out[0] = field[fieldIndex]!;
            out[1] = field[fieldIndex + 1]!;
            const speed = Math.hypot(out[0]!, out[1]!);
            if (speed > 1e-5) {
              const len = clamp(speed / cap, 0.05, 1) * cell * 0.9;
              const dx = out[0]! / speed, dy = -out[1]! / speed;
              ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.6 * clamp(speed / cap, 0, 1)})`;
              ctx.beginPath(); ctx.moveTo(cx - dx * len / 2, cy - dy * len / 2); ctx.lineTo(cx + dx * len / 2, cy + dy * len / 2);
              ctx.lineTo(cx + dx * len / 2 - (dx * 0.4 - dy * 0.3) * len * 0.45, cy + dy * len / 2 - (dy * 0.4 + dx * 0.3) * len * 0.45);
              ctx.moveTo(cx + dx * len / 2, cy + dy * len / 2);
              ctx.lineTo(cx + dx * len / 2 - (dx * 0.4 + dy * 0.3) * len * 0.45, cy + dy * len / 2 - (dy * 0.4 - dx * 0.3) * len * 0.45);
              ctx.stroke();
            }
          }
          if (show.turbulence && cfg.turbulence.enabled) {
            displacementAt(state, cfg.turbulence.kind, (u - 0.5) * ASPECT, v - 0.5, ASPECT, 0, tmp);
            const m = Math.hypot(tmp[0]!, tmp[1]!);
            if (m > 1e-6) {
              const len = clamp(m / 0.06, 0.05, 1) * cell * 0.8;
              ctx.strokeStyle = 'rgba(255,170,90,.85)';
              ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + tmp[0]! / m * len, cy - tmp[1]! / m * len); ctx.stroke();
            }
          }
        }
      }

      // paths
      cfg.paths.forEach((path, index) => {
        const slot = state.pathSlots[index];
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = 'rgba(255,214,102,.9)';
        if (slot && slot.used && slot.denseCount > 1) {
          ctx.beginPath();
          for (let k = 0; k < slot.denseCount; k++) {
            const [px, py] = toPx(slot.dense[k * 2]!, slot.dense[k * 2 + 1]!, w, h);
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
        } else {
          ctx.beginPath();
          path.points.forEach((point, k) => { const [px, py] = toPx(point.x + path.offsetX, point.y + path.offsetY, w, h); if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
          ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.stroke(); ctx.setLineDash([]);
        }
        const editing = activeTool === 'path' || activeTool === 'move' || activeTool === 'select';
        if (editing) path.points.forEach((point, k) => {
          const [px, py] = toPx(point.x + path.offsetX, point.y + path.offsetY, w, h);
          const picked = activePath && activePath.pathId === path.id && activePath.index === k;
          ctx.fillStyle = picked ? '#fff' : 'rgba(255,214,102,1)';
          ctx.beginPath(); ctx.rect(px - 4 * dpr, py - 4 * dpr, 8 * dpr, 8 * dpr); ctx.fill();
        });
        const [lx, ly] = toPx((path.points[0]?.x ?? 0) + path.offsetX, (path.points[0]?.y ?? 0) + path.offsetY, w, h);
        ctx.fillStyle = 'rgba(255,214,102,.95)'; ctx.font = `${10 * dpr}px sans-serif`; ctx.fillText(`${index + 1}`, lx + 7 * dpr, ly - 7 * dpr);
      });
      const stroke = live.current.stroke;
      if (drag.current?.kind === 'stroke' && stroke.length > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2 * dpr; ctx.beginPath();
        stroke.forEach((point, k) => { const [px, py] = toPx(point.x, point.y, w, h); if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
        ctx.stroke();
      }

      // source handles
      cfg.sources.forEach(src => {
        const [x, y] = toPx(src.x, src.y, w, h);
        const picked = src.id === selected;
        const a = src.angle * Math.PI / 180;
        ctx.globalAlpha = src.enabled ? 1 : 0.35;
        ctx.strokeStyle = picked ? '#b9a8ff' : 'rgba(255,255,255,.8)';
        ctx.lineWidth = (picked ? 2.4 : 1.6) * dpr;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 20 * dpr, y - Math.sin(a) * 20 * dpr); ctx.stroke();
        ctx.fillStyle = picked ? '#7c5cff' : '#232a36';
        ctx.beginPath(); ctx.arc(x, y, 8 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = `600 ${9 * dpr}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(FLOW_TYPE_LABEL[src.type][0]!.toUpperCase(), x, y + 0.5 * dpr);
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
        ctx.globalAlpha = 1;
      });
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ── pointer editing ── */
  const toUv = (event: RPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { u: (event.clientX - rect.left) / rect.width, v: 1 - (event.clientY - rect.top) / rect.height, rect };
  };
  const pxDistance = (a: { u: number; v: number }, b: { x: number; y: number }, rect: DOMRect) => Math.hypot((a.u - b.x) * rect.width, (a.v - b.y) * rect.height);
  const nearestSource = (pos: { u: number; v: number }, rect: DOMRect) => {
    let best: { id: string; d: number } | null = null;
    for (const src of config.sources) { const d = pxDistance(pos, src, rect); if (d <= HIT && (!best || d < best.d)) best = { id: src.id, d }; }
    return best?.id ?? null;
  };
  const nearestNode = (pos: { u: number; v: number }, rect: DOMRect) => {
    let best: { pathId: string; index: number; d: number } | null = null;
    for (const path of config.paths) {
      for (let index = 0; index < path.points.length; index++) {
        const point = path.points[index]!;
        const d = pxDistance(pos, { x: point.x + path.offsetX, y: point.y + path.offsetY }, rect);
        if (d <= HIT && (best === null || d < best.d)) best = { pathId: path.id, index, d };
      }
    }
    return best as { pathId: string; index: number; d: number } | null;
  };
  const nearestSegment = (pos: { u: number; v: number }, rect: DOMRect) => {
    let best: { pathId: string; index: number; x: number; y: number; d: number } | null = null;
    for (const path of config.paths) for (let k = 0; k < path.points.length - 1; k++) {
      const a = path.points[k]!, b = path.points[k + 1]!;
      const ax = (a.x + path.offsetX) * rect.width, ay = (1 - a.y - path.offsetY) * rect.height, bx = (b.x + path.offsetX) * rect.width, by = (1 - b.y - path.offsetY) * rect.height;
      const px = pos.u * rect.width, py = (1 - pos.v) * rect.height;
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2, 0, 1);
      const d = Math.hypot(px - (ax + (bx - ax) * t), py - (ay + (by - ay) * t));
      if (d <= 10 && (best === null || d < best.d)) best = { pathId: path.id, index: k + 1, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, d };
    }
    return best as { pathId: string; index: number; x: number; y: number; d: number } | null;
  };

  const applyDrag = (pos: { u: number; v: number }, current: Drag) => {
    if (current.kind === 'source') {
      edit(draft => {
        const src = draft.sources.find(item => item.id === current.id);
        if (!src) return;
        const dx = (pos.u - src.x) * ASPECT, dy = pos.v - src.y;
        if (current.tool === 'move') { src.x = clamp(pos.u, ...MOTION_RANGE.source.x); src.y = clamp(pos.v, ...MOTION_RANGE.source.y); }
        else if (current.tool === 'rotate') src.angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
        else if (current.tool === 'scale') src.scale = Math.round(clamp(Math.hypot(dx, dy) / 0.25, ...MOTION_RANGE.source.scale) * 100) / 100;
        else if (current.tool === 'influence') { src.radius = Math.round(clamp(Math.hypot(dx, dy), ...MOTION_RANGE.source.radius) * 100) / 100; src.global = false; }
      }, 'motion-field');
    } else if (current.kind === 'node') {
      edit(draft => {
        const path = draft.paths.find(item => item.id === current.pathId);
        const point = path?.points[current.index];
        if (path && point) { point.x = clamp(pos.u - path.offsetX, -0.25, 1.25); point.y = clamp(pos.v - path.offsetY, -0.25, 1.25); }
      }, 'motion-field');
    } else {
      const stroke = live.current.stroke;
      const last = stroke[stroke.length - 1];
      if (!last || Math.hypot((pos.u - last.x) * ASPECT, pos.v - last.y) > 0.012) stroke.push({ x: clamp(pos.u, 0, 1), y: clamp(pos.v, 0, 1) });
    }
  };

  const finishStroke = (points: { x: number; y: number }[]) => {
    live.current.stroke = [];
    if (points.length < 2) return;
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot((points[i]!.x - points[i - 1]!.x) * ASPECT, points[i]!.y - points[i - 1]!.y);
    if (length < 0.08) { announce('That stroke was too short to make a path.'); return; }
    const count = clamp(Math.round(length / 0.14) + 1, 3, MOTION_LIMITS.pathPoints);
    const nodes: { x: number; y: number; ix: number; iy: number; ox: number; oy: number }[] = [];
    for (let k = 0; k < count; k++) {
      const target = length * k / (count - 1);
      let run = 0, picked = points[points.length - 1]!;
      for (let i = 1; i < points.length; i++) {
        const seg = Math.hypot((points[i]!.x - points[i - 1]!.x) * ASPECT, points[i]!.y - points[i - 1]!.y);
        if (run + seg >= target) { const t = seg > 0 ? (target - run) / seg : 0; picked = { x: points[i - 1]!.x + (points[i]!.x - points[i - 1]!.x) * t, y: points[i - 1]!.y + (points[i]!.y - points[i - 1]!.y) * t }; break; }
        run += seg;
      }
      nodes.push({ x: Math.round(picked.x * 1000) / 1000, y: Math.round(picked.y * 1000) / 1000, ix: 0, iy: 0, ox: 0, oy: 0 });
    }
    edit(draft => {
      let index: number;
      if (draft.paths.length < MOTION_LIMITS.paths) {
        draft.paths.push(newPath({ name: `Path ${draft.paths.length + 1}`, points: nodes }, draft.paths.map(p => p.id)));
        index = draft.paths.length - 1;
      } else {
        index = draft.paths.length - 1;
        draft.paths[index] = { ...draft.paths[index]!, points: nodes };
        announce(`Path limit is ${MOTION_LIMITS.paths}: the last path was redrawn.`);
      }
      if (!draft.sources.some(src => src.type === 'path') && draft.sources.length < MOTION_LIMITS.sources) {
        draft.sources.push(newFlowSource('path', { params: [index, 0.6, 1, 0] }, draft.sources.map(s => s.id)));
      }
    });
  };

  const onDown = (event: RPointerEvent<HTMLCanvasElement>) => {
    const pos = toUv(event);
    const { rect } = pos;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'add') {
      if (config.sources.length >= MOTION_LIMITS.sources) { announce(`Limit of ${MOTION_LIMITS.sources} flow sources reached.`); return; }
      const created = newFlowSource(addType, { x: Math.round(pos.u * 1000) / 1000, y: Math.round(pos.v * 1000) / 1000 }, config.sources.map(s => s.id));
      edit(draft => { draft.enabled = true; draft.sources.push(created); });
      onSelect(created.id);
      return;
    }
    if (tool === 'draw') { live.current.stroke = [{ x: clamp(pos.u, 0, 1), y: clamp(pos.v, 0, 1) }]; drag.current = { kind: 'stroke', points: live.current.stroke }; return; }
    if (tool === 'path') {
      const node = nearestNode(pos, rect);
      if (node) {
        if (event.detail >= 2 || event.altKey) {
          edit(draft => { const path = draft.paths.find(p => p.id === node.pathId); if (path && path.points.length > 2) path.points.splice(node.index, 1); });
          setPathSel(null);
          return;
        }
        setPathSel({ pathId: node.pathId, index: node.index });
        drag.current = { kind: 'node', pathId: node.pathId, index: node.index };
        return;
      }
      const seg = nearestSegment(pos, rect);
      const path = seg && config.paths.find(p => p.id === seg.pathId);
      if (seg && path && path.points.length < MOTION_LIMITS.pathPoints) {
        edit(draft => { draft.paths.find(p => p.id === seg.pathId)?.points.splice(seg.index, 0, { x: seg.x, y: seg.y, ix: 0, iy: 0, ox: 0, oy: 0 }); });
        setPathSel({ pathId: seg.pathId, index: seg.index });
        drag.current = { kind: 'node', pathId: seg.pathId, index: seg.index };
      }
      return;
    }
    // select / move / rotate / scale / influence
    const hit = nearestSource(pos, rect);
    if (tool === 'move' || tool === 'select') {
      if (hit) { onSelect(hit); setPathSel(null); if (tool === 'move') drag.current = { kind: 'source', id: hit, tool }; return; }
      const node = nearestNode(pos, rect);
      if (node) { setPathSel({ pathId: node.pathId, index: node.index }); if (tool === 'move') drag.current = { kind: 'node', pathId: node.pathId, index: node.index }; return; }
      onSelect(null); setPathSel(null);
      return;
    }
    const target = hit ?? selectedId;
    if (!target) { announce('Select a source first (Select or Move tool).'); return; }
    if (hit) onSelect(hit);
    drag.current = { kind: 'source', id: target, tool };
    applyDrag(pos, drag.current);
  };
  const onMove = (event: RPointerEvent<HTMLCanvasElement>) => {
    if (drag.current) applyDrag(toUv(event), drag.current);
  };
  const onUp = (event: RPointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current?.kind === 'stroke') finishStroke(current.points);
  };

  const toggle = (key: keyof View, label: string) => <Switch key={key} label={label} checked={view[key]} onChange={value => setView(prev => ({ ...prev, [key]: value }))} testId={`motion-view-${key}`} />;
  const info = TOOLS.find(item => item.id === tool)!;
  return <div className="gs-mot-field" data-testid="motion-field-editor">
    <div className="gs-chip-row" role="tablist" aria-label="Field editor tools">
      {TOOLS.map(item => <button key={item.id} type="button" role="tab" aria-selected={tool === item.id} className={`chip ${tool === item.id ? 'active' : ''}`} onClick={() => setTool(item.id)} data-testid={`motion-tool-${item.id}`}>{item.label}</button>)}
    </div>
    <p className="hint">{info.hint}</p>
    {tool === 'add' && <Select id="motion-add-type" label="New source type" value={addType} options={FLOW_TYPES.map(id => ({ id, label: FLOW_TYPE_LABEL[id] }))} onChange={setAddType} />}
    <canvas
      ref={canvasRef} className="gs-mot-canvas" style={{ cursor: TOOL_CURSOR[tool] }} role="img" aria-label="Flow field preview: arrows show the direction and speed of the composed motion"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="motion-field-canvas"
    />
    <div className="gs-mot-toggles">
      {toggle('vectors', 'Vectors')}{toggle('heat', 'Speed heat')}{toggle('streams', 'Streamlines')}{toggle('rings', 'Influence')}{toggle('turbulence', 'Turbulence')}
    </div>
    <p className="hint">The preview is drawn at 16:10 from the same field math the shader runs. Brighter arrows are faster; the dashed rings are each source's radius of influence.</p>
  </div>;
}

