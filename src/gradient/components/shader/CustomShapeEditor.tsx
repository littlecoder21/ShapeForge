import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Upload } from 'lucide-react';
import type { RigShapePoint } from '../../interactive/rig/model';

/* Custom interaction shape editor.
 *
 * The outline is rendered from a distance-field texture (see rig/shapeField.ts), so changing it never recompiles the shader.
 * That is what makes live editing possible: dragging a point updates the preview on every frame, and the commit to the
 * project is throttled to one update per animation frame (and recorded as ONE undo step by the caller's coalesce key).
 *
 *   • draw      drag on an empty spot to draw a new closed outline (resampled evenly to at most 32 points)
 *   • reshape   drag any point of the current outline
 *   • tools     smooth the corners, use fewer points, flip, clear, or load the boundary of an SVG path */

const MAX_POINTS = 32;
const SIZE = 240;
/** pixels per shape unit: the outline spans [-0.5, 0.5] in both axes and the canvas keeps a margin around it */
const SCALE = SIZE * 0.86;
const HANDLE_RADIUS = 6;
const HIT_RADIUS = 16;
const NS = 'http://www.w3.org/2000/svg';

const toCanvas = (point: RigShapePoint) => ({ x: SIZE / 2 + point.x * SCALE, y: SIZE / 2 - point.y * SCALE });
const toShape = (x: number, y: number): RigShapePoint => ({ x: (x - SIZE / 2) / SCALE, y: -(y - SIZE / 2) / SCALE });
const clampPoint = (point: RigShapePoint): RigShapePoint => ({ x: Math.max(-0.75, Math.min(0.75, point.x)), y: Math.max(-0.75, Math.min(0.75, point.y)) });

/** `count` points spaced evenly along the closed outline. */
function resampleClosed(points: readonly RigShapePoint[], count: number): RigShapePoint[] {
  const n = points.length;
  if (n < 2 || count < 3) return points.slice(0, Math.max(count, 0));
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    total += length;
  }
  if (total < 1e-6) return points.slice(0, count);
  const out: RigShapePoint[] = [];
  let edge = 0;
  let travelled = 0;
  for (let k = 0; k < count; k++) {
    const target = total * k / count;
    while (edge < n - 1 && travelled + lengths[edge] < target) { travelled += lengths[edge]; edge++; }
    const a = points[edge];
    const b = points[(edge + 1) % n];
    const t = lengths[edge] > 0 ? (target - travelled) / lengths[edge] : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Centres and scales any outline (y up) so it spans one unit, then limits it to 32 evenly spaced points. */
function fitShape(points: readonly RigShapePoint[]): RigShapePoint[] {
  if (points.length < 3) return [];
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const size = Math.max(1e-4, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
  const normalised = points.map(point => ({ x: (point.x - cx) / size, y: (point.y - cy) / size }));
  return normalised.length > MAX_POINTS ? resampleClosed(normalised, MAX_POINTS) : normalised;
}

/** One round of corner cutting: every edge is replaced by two points at 1/4 and 3/4 of its length. */
function smoothShape(points: readonly RigShapePoint[]): RigShapePoint[] {
  const cut = points.flatMap((a, index) => {
    const b = points[(index + 1) % points.length];
    return [
      { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y },
      { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y },
    ];
  });
  return cut.length > MAX_POINTS ? resampleClosed(cut, MAX_POINTS) : cut;
}

function svgBoundary(source: string): RigShapePoint[] {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') throw new Error('Choose a valid SVG file.');
  const pathData = parsed.querySelector('path[d]')?.getAttribute('d');
  if (!pathData || pathData.length > 20000) throw new Error('SVG must contain a path with a boundary under 20,000 characters.');
  const svg = document.createElementNS(NS, 'svg');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  Object.assign(svg.style, { position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden' });
  document.body.append(svg);
  try {
    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length < 1) throw new Error('SVG path has no drawable boundary.');
    const count = Math.min(256, Math.max(24, Math.ceil(length / 4)));
    // SVG y points down, the shape space points up
    const points = Array.from({ length: count }, (_, index) => {
      const point = path.getPointAtLength(length * index / count);
      return { x: point.x, y: -point.y };
    });
    const fitted = fitShape(points);
    if (fitted.length < 3) throw new Error('SVG path needs at least three boundary points.');
    return fitted;
  } finally {
    svg.remove();
  }
}

export default function CustomShapeEditor({ points, onChange }: { points: RigShapePoint[]; onChange: (points: RigShapePoint[]) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** the outline as drawn right now (ahead of the props while a point is being dragged) */
  const liveRef = useRef<RigShapePoint[]>(points);
  const strokeRef = useRef<RigShapePoint[]>([]);
  const dragRef = useRef<{ pointerId: number; index: number } | null>(null);
  const frameRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [message, setMessage] = useState('');

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(SIZE * dpr)) { canvas.width = Math.round(SIZE * dpr); canvas.height = Math.round(SIZE * dpr); }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, SIZE, SIZE);
    // guides: the unit box the outline is normalised to, and the centre cross
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(255,255,255,.10)';
    context.strokeRect(SIZE / 2 - SCALE / 2, SIZE / 2 - SCALE / 2, SCALE, SCALE);
    context.beginPath();
    context.moveTo(SIZE / 2, 0); context.lineTo(SIZE / 2, SIZE);
    context.moveTo(0, SIZE / 2); context.lineTo(SIZE, SIZE / 2);
    context.stroke();
    const stroke = strokeRef.current;
    context.strokeStyle = '#69dfb5';
    context.fillStyle = 'rgba(105,223,181,.18)';
    context.lineWidth = 2;
    context.lineJoin = 'round';
    if (stroke.length) {
      context.beginPath();
      stroke.forEach((point, index) => { const at = toCanvas(point); if (index) context.lineTo(at.x, at.y); else context.moveTo(at.x, at.y); });
      context.stroke();
      return;
    }
    const shape = liveRef.current;
    if (shape.length < 3) return;
    context.beginPath();
    shape.forEach((point, index) => { const at = toCanvas(point); if (index) context.lineTo(at.x, at.y); else context.moveTo(at.x, at.y); });
    context.closePath();
    context.fill();
    context.stroke();
    shape.forEach((point, index) => {
      const at = toCanvas(point);
      context.beginPath();
      context.arc(at.x, at.y, HANDLE_RADIUS, 0, Math.PI * 2);
      context.fillStyle = dragRef.current?.index === index ? '#ffffff' : '#1d2630';
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = '#69dfb5';
      context.stroke();
    });
  }, []);

  // follow the project, but never while a point is being dragged (the drag is ahead of the props)
  useEffect(() => {
    if (dragRef.current) return;
    liveRef.current = points;
    draw();
  }, [points, draw]);

  useEffect(() => () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); }, []);

  /** Shows the outline immediately and hands it to the project at most once per animation frame. */
  const publish = (next: RigShapePoint[], immediate = false) => {
    liveRef.current = next;
    draw();
    if (immediate) {
      if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = 0; }
      onChangeRef.current(next);
      return;
    }
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      onChangeRef.current(liveRef.current);
    });
  };

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * SIZE / Math.max(1, rect.width), y: (event.clientY - rect.top) * SIZE / Math.max(1, rect.height) };
  };

  const handleDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const at = canvasPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setMessage('');
    const shape = liveRef.current;
    if (shape.length >= 3) {
      let best = -1;
      let bestDistance = HIT_RADIUS;
      shape.forEach((point, index) => {
        const handle = toCanvas(point);
        const distance = Math.hypot(handle.x - at.x, handle.y - at.y);
        if (distance < bestDistance) { best = index; bestDistance = distance; }
      });
      if (best >= 0) {
        dragRef.current = { pointerId: event.pointerId, index: best };
        draw();
        return;
      }
    }
    strokeRef.current = [clampPoint(toShape(at.x, at.y))];
    draw();
  };

  const handleMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const at = canvasPoint(event);
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const next = liveRef.current.map((point, index) => index === drag.index ? clampPoint(toShape(at.x, at.y)) : point);
      publish(next);
      return;
    }
    const point = clampPoint(toShape(at.x, at.y));
    const last = strokeRef.current.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 0.012) {
      strokeRef.current.push(point);
      draw();
    }
  };

  const handleUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragRef.current) {
      dragRef.current = null;
      publish(liveRef.current, true);
      return;
    }
    const stroke = strokeRef.current;
    strokeRef.current = [];
    const next = fitShape(stroke);
    if (next.length >= 3) publish(next, true);
    else { setMessage('Draw a closed shape with at least three points.'); draw(); }
  };

  const apply = (next: RigShapePoint[]) => { setMessage(''); publish(next, true); };
  const current = liveRef.current;

  return <div className="gs-custom-shape" data-testid="rig-custom-shape">
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      aria-label="Draw a custom interaction shape. Drag a point to reshape it."
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        strokeRef.current = [];
        if (dragRef.current) { dragRef.current = null; publish(liveRef.current, true); } else draw();
      }}
      style={{ display: 'block', width: '100%', maxWidth: 260, aspectRatio: '1 / 1', margin: '0 auto', border: '1px solid #3a424c', borderRadius: 8, touchAction: 'none', cursor: 'crosshair' }}
      data-testid="rig-custom-shape-canvas"
    />
    <div className="gs-custom-shape-tools">
      <button type="button" className="btn small" disabled={current.length < 3} onClick={() => apply(smoothShape(current))}>Smooth</button>
      <button type="button" className="btn small" disabled={current.length <= 5} onClick={() => apply(resampleClosed(current, Math.max(4, Math.ceil(current.length / 2))))}>Fewer points</button>
      <button type="button" className="btn small" disabled={current.length < 3} onClick={() => apply(current.map(point => ({ x: -point.x, y: point.y })))}>Flip ↔</button>
      <button type="button" className="btn small" disabled={current.length < 3} onClick={() => apply(current.map(point => ({ x: point.x, y: -point.y })))}>Flip ↕</button>
      <label className="btn small">
        <Upload aria-hidden="true" /> Load SVG
        <input
          type="file"
          accept=".svg,image/svg+xml"
          aria-label="Load custom shape SVG"
          data-testid="rig-custom-shape-svg"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          onChange={async event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            if (file.size > 256_000) { setMessage('SVG file must be smaller than 256 KB.'); return; }
            try {
              apply(svgBoundary(await file.text()));
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Could not load this SVG shape.');
            }
          }}
        />
      </label>
      <button type="button" className="btn small" disabled={!current.length} onClick={() => apply([])}>
        Clear shape
      </button>
    </div>
    <p className="hint">Drag on an empty spot to draw a closed outline; drag any point to reshape it live. Use Smooth to round the corners. Changes apply instantly without recompiling the shader.</p>
    {message && <p className="hint" role="status">{message}</p>}
  </div>;
}
