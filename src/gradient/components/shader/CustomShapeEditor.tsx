import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Upload } from 'lucide-react';
import type { RigShapePoint } from '../../interactive/rig/model';

const MAX_POINTS = 32;
const NS = 'http://www.w3.org/2000/svg';

function fitBoundary(points: RigShapePoint[]): RigShapePoint[] {
  if (points.length < 3) return [];
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const size = Math.max(1, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
  const stride = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  return points.filter((_, index) => index % stride === 0).slice(0, MAX_POINTS)
    .map(point => ({ x: (point.x - cx) / size, y: -(point.y - cy) / size }));
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
    const points = Array.from({ length: count }, (_, index) => {
      const point = path.getPointAtLength(length * index / count);
      return { x: point.x, y: point.y };
    });
    const fitted = fitBoundary(points);
    if (fitted.length < 3) throw new Error('SVG path needs at least three boundary points.');
    return fitted;
  } finally {
    svg.remove();
  }
}

export default function CustomShapeEditor({ points, onChange }: { points: RigShapePoint[]; onChange: (points: RigShapePoint[]) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<RigShapePoint[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length < 3) return;
    context.beginPath();
    context.moveTo((points[0].x + 0.5) * canvas.width, (0.5 - points[0].y) * canvas.height);
    points.slice(1).forEach(point => context.lineTo((point.x + 0.5) * canvas.width, (0.5 - point.y) * canvas.height));
    context.closePath();
    context.fillStyle = 'rgba(105,223,181,.18)';
    context.strokeStyle = '#69dfb5';
    context.lineWidth = 2;
    context.fill();
    context.stroke();
  }, [points]);

  const drawStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
    const last = strokeRef.current.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 3) strokeRef.current.push(point);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const preview = [...points.map(item => ({ x: (item.x + 0.5) * canvas.width, y: (0.5 - item.y) * canvas.height })), ...strokeRef.current];
    if (preview.length < 2) return;
    context.beginPath();
    context.moveTo(preview[0].x, preview[0].y);
    preview.slice(1).forEach(item => context.lineTo(item.x, item.y));
    if (strokeRef.current.length === 0) context.closePath();
    context.fillStyle = 'rgba(105,223,181,.18)';
    context.strokeStyle = '#69dfb5';
    context.lineWidth = 2;
    context.fill();
    context.stroke();
  };

  return <div className="gs-custom-shape" data-testid="rig-custom-shape">
    <canvas
      ref={canvasRef}
      width={320}
      height={180}
      aria-label="Draw a custom interaction shape"
      onPointerDown={event => {
        strokeRef.current = [];
        event.currentTarget.setPointerCapture(event.pointerId);
        drawStroke(event);
        setMessage('');
      }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) drawStroke(event); }}
      onPointerUp={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const next = fitBoundary(strokeRef.current);
        strokeRef.current = [];
        if (next.length >= 3) onChange(next);
        else setMessage('Draw a closed shape with at least three points.');
      }}
      onPointerCancel={() => { strokeRef.current = []; }}
      style={{ display: 'block', width: '100%', height: 150, border: '1px solid #3a424c', borderRadius: 8, touchAction: 'none', cursor: 'crosshair' }}
      data-testid="rig-custom-shape-canvas"
    />
    <div className="gs-custom-shape-tools">
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
              const next = svgBoundary(await file.text());
              onChange(next);
              setMessage('');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Could not load this SVG shape.');
            }
          }}
        />
      </label>
      <button type="button" className="btn small" disabled={!points.length} onClick={() => { onChange([]); setMessage(''); }}>
        Clear shape
      </button>
    </div>
    <p className="hint">Draw a closed outline or load an SVG containing a path. SVG curves are sampled to a compact polygon for realtime rendering.</p>
    {message && <p className="hint" role="status">{message}</p>}
  </div>;
}
