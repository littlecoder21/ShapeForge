import { useState } from 'react';
import { Check, Copy, ScanLine } from 'lucide-react';
import { H, W } from '../constants';
import { extractOuterShape, nodesToRing, parseShapeInput, ringsToPath, roundCorners, type CompoundPath } from '../boundary';
import { fmt, pathFromPoints, type Point, type ShapeModel } from '../geometry';
import { ValueControl } from './controls';

const EXAMPLE = 'polygon(\n  0 0,\n  85% 0,\n  85% 50%,\n  100% 50%,\n  100% 100%,\n  0 100%\n)';
const RADII = [0, 10, 25, 50];

type Props = {
  shape: ShapeModel; precision: number;
  onApply: (next: ShapeModel) => void;                  // history entry
  onLive: (next: ShapeModel) => void; onLiveEnd: () => void;
  announce: (m: string) => void;
};

/** Text of the current shape, so it can be edited / re-extracted. */
function shapeToText(shape: ShapeModel, precision: number) {
  if (shape.kind === 'polygon') return `polygon(${shape.points.map(p => `${fmt(p.x / W * 100, 2)}% ${fmt(p.y / H * 100, 2)}%`).join(', ')})`;
  return pathFromPoints(shape.points, shape.closed, true, precision);
}

export default function BoundaryPanel({ shape, precision, onApply, onLive, onLiveEnd, announce }: Props) {
  const [text, setText] = useState(EXAMPLE);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [base, setBase] = useState<{ nodes: Point[]; closed: boolean; rings: CompoundPath } | null>(null);
  const [radius, setRadius] = useState(0);
  const [copied, setCopied] = useState(false);

  const build = (nodes: Point[], closed: boolean, r: number, name: string): ShapeModel => {
    const res = r > 0 ? roundCorners(nodes, closed, r) : { points: nodes.map(p => ({ ...p })), rounded: 0 };
    return { ...shape, name, kind: 'path', points: res.points, closed, box: undefined, frame: 'artboard', wave: undefined };
  };

  const extract = () => {
    try {
      const result = extractOuterShape(parseShapeInput(text));
      setError(''); setNotes(result.notes);
      setBase({ nodes: result.nodes, closed: result.closed, rings: result.rings });
      onApply(build(result.nodes, result.closed, radius, 'Outer shape'));
      announce('Outer shape extracted as an SVG path');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read that shape'); }
  };
  const useCurrent = () => {
    setText(shapeToText(shape, precision)); setError('');
    const hasCurves = shape.kind === 'path' && shape.points.some(p => p.in || p.out || p.mode === 'auto' || p.mode === undefined);
    const nodes = hasCurves ? shape.points.map(p => ({ ...p })) : shape.points.map(p => ({ x: p.x, y: p.y, mode: 'corner' as const }));
    setBase({ nodes, closed: shape.closed, rings: [nodesToRing(shape.points, shape.closed, 16)] }); setNotes([]);
    announce('Loaded the current shape');
  };
  const changeRadius = (r: number) => {
    setRadius(r);
    const b = base ?? (() => {
      const hasCurves = shape.kind === 'path' && shape.points.some(p => p.in || p.out || p.mode === 'auto' || p.mode === undefined);
      if (hasCurves) return null;
      const nodes = shape.points.map(p => ({ x: p.x, y: p.y, mode: 'corner' as const }));
      const nb = { nodes, closed: shape.closed, rings: [nodesToRing(nodes, shape.closed)] };
      setBase(nb); return nb;
    })();
    if (!b) { announce('Corner radius needs straight corners — extract or convert first'); return; }
    onLive(build(b.nodes, b.closed, r, shape.name.replace(/ · rounded$/, '') + (r ? ' · rounded' : '')));
  };

  const d = base?.rings.length && base.rings.length > 1 ? ringsToPath(base.rings, precision) : pathFromPoints(shape.points, shape.closed, shape.kind === 'path', precision);
  const copy = async () => { try { await navigator.clipboard.writeText(d); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { announce('Clipboard unavailable'); } };

  return <div className="boundary-panel">
    <h2 className="properties-title">Outer shape</h2>
    <p className="hint" style={{ marginTop: -8 }}>Paste a <code>polygon()</code>, <code>polyline()</code>, SVG path or point list. Percentages resolve against {W} × {H}. Several shapes merge into one outline.</p>
    <textarea className="boundary-input" value={text} onChange={e => setText(e.target.value)} spellCheck={false} rows={7} aria-label="Shape source" data-testid="boundary-input" />
    {error && <p className="boundary-error" role="alert" data-testid="boundary-error">{error}</p>}
    {notes.map((n, i) => <p key={i} className="boundary-note">{n}</p>)}
    <div className="btn-row">
      <button className="btn" onClick={useCurrent} data-testid="boundary-current">Use current shape</button>
      <button className="btn primary" onClick={extract} data-testid="boundary-extract"><ScanLine />Extract outer shape</button>
    </div>
    <div className="prec-sub">Corner radius</div>
    <ValueControl label="Radius" value={radius} min={0} max={200} def={0} unit="px" onChange={changeRadius} onCommit={onLiveEnd} testId="boundary-radius" />
    <div className="chips">{RADII.map(r => <button key={r} className={`chip ${radius === r ? 'active' : ''}`} onClick={() => { setRadius(r); const b = base; if (b) onApply(build(b.nodes, b.closed, r, 'Outer shape' + (r ? ' · rounded' : ''))); else changeRadius(r); }} data-testid={`boundary-r-${r}`}>{r}px</button>)}</div>
    <p className="hint">Rounded corners are exact circular fillets (tangent length r ÷ tan(½ · angle)), emitted as Bézier arcs. Sharp corners are never smoothed unless you choose a radius.</p>
    <div className="prec-sub">SVG path</div>
    <div className="path-out"><code data-testid="boundary-path">{d}</code><button className="btn" onClick={copy} aria-label="Copy path">{copied ? <Check /> : <Copy />}</button></div>
  </div>;
}
