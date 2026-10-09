import { useMemo } from 'react';
import { Pentagon, Plus, Spline, Waves } from 'lucide-react';
import { UNITS, simplify, samplePath, shapeBounds, smoothAll, toPathExact, type FrameMode, type ShapeModel, type Unit } from '../geometry';
import { insertOnSegment, type Selection } from '../edit';
import type { EditorSettings } from '../settings';
import { TransformBlock } from './PrecisionPanel';
import { Section, Seg, ValueControl } from './controls';

type Props = {
  shape: ShapeModel; fill: string; setFill: (c: string) => void;
  tolerance: number; setTolerance: (n: number) => void; precision: number; setPrecision: (n: number) => void; unit: Unit; setUnit: (u: Unit) => void;
  settings: EditorSettings; setSettings: (p: Partial<EditorSettings>) => void;
  onCommit: (next: ShapeModel, sel?: Selection) => void; announce: (m: string) => void;
};

export default function ShapePanel({ shape, fill, setFill, tolerance, setTolerance, precision, setPrecision, unit, setUnit, settings, setSettings, onCommit, announce }: Props) {
  const simplifiedCount = useMemo(() => simplify(shape.kind === 'path' ? samplePath(shape.points, shape.closed, 8) : shape.points, tolerance).length, [shape.points, shape.closed, shape.kind, tolerance]);
  const frame: FrameMode = shape.frame ?? (shape.box ? 'box' : 'artboard');
  const convert = () => {
    if (shape.kind === 'polygon') { onCommit({ ...toPathExact(shape), name: `${shape.name} · path` }); announce('Polygon converted to an exact path — corners kept sharp'); }
    else { onCommit({ ...shape, kind: 'polygon', points: simplify(samplePath(shape.points, shape.closed), tolerance), name: `${shape.name} · polygon`, wave: undefined }); announce('Path converted to editable polygon'); }
  };
  const addNode = () => { const r = insertOnSegment(shape, 0, 0.5); onCommit(r.shape, { kind: 'node', index: r.index }); };
  return <div>
    <h2 className="properties-title">Shape properties</h2>
    <Section title="Geometry" hint={`${shape.points.length} nodes`}>
      <label className="field-label" htmlFor="shape-name">Name</label>
      <input className="generate-select" id="shape-name" value={shape.name} onChange={e => onCommit({ ...shape, name: e.target.value })} data-testid="input-shape-name" />
      <div className="field-row">
        <button className="btn" onClick={convert} data-testid="button-convert">{shape.kind === 'path' ? <Pentagon /> : <Waves />}{shape.kind === 'path' ? 'To polygon' : 'To path'}</button>
        <button className="btn" onClick={() => onCommit({ ...shape, closed: !shape.closed, name: shape.closed ? 'Open path' : shape.name })} data-testid="button-close-path">{shape.closed ? 'Open path' : 'Close path'}</button>
      </div>
      <div className="field-row">
        <button className="btn" onClick={() => { onCommit(smoothAll(shape)); announce('All corners smoothed'); }} data-testid="button-smooth"><Spline />Smooth all</button>
        <button className="btn" onClick={addNode} data-testid="button-add-node"><Plus /> Add node</button>
      </div>
      <p className="hint">Polygon → path keeps every corner exact. Smoothing only happens when you ask for it.</p>
    </Section>
    <Section title="Transform" hint="position · scale · rotation">
      <TransformBlock shape={shape} settings={settings} setSettings={setSettings} onCommit={onCommit} />
    </Section>
    <Section title="Appearance" hint="live preview">
      <div className="field-label">Fill color <span>{fill}</span></div>
      <div className="swatch-row"><input aria-label="Shape fill color" type="color" value={fill} onChange={e => setFill(e.target.value)} data-testid="input-fill-color" /><input className="generate-select" value={fill} onChange={e => setFill(e.target.value)} data-testid="input-fill-hex" /></div>
    </Section>
    <Section title="Export" hint={`${shape.points.length} → ${simplifiedCount}`}>
      <div className="field-label">Frame</div>
      <Seg value={frame} label="Export frame" options={[{ id: 'artboard', label: 'Artboard' }, { id: 'bounds', label: 'Shape bounds' }, { id: 'box', label: 'Wave box', disabled: !shape.box }]}
        onChange={f => onCommit({ ...shape, frame: f })} testId="export-frame" />
      <ValueControl label="Simplify tolerance" value={tolerance} min={0} max={30} step={0.5} def={3} onChange={setTolerance} testId="range-tolerance" />
      <label className="field-label" htmlFor="precision" style={{ marginTop: 12 }}>Code precision</label>
      <select id="precision" className="generate-select" value={precision} onChange={e => setPrecision(Number(e.target.value))} data-testid="select-precision"><option value="0">0 decimals</option><option value="1">1 decimal</option><option value="2">2 decimals</option><option value="3">3 decimals</option></select>
      <div className="field-label" style={{ marginTop: 12 }}>Output units</div>
      <Seg value={unit} label="Output units" options={UNITS.map(u => ({ id: u, label: u }))} onChange={setUnit} testId="select-units" />
      <p className="hint">Frame sets what 0–100% means: the whole artboard, the shape's own bounds{shape.box ? ' or the wave box' : ''}. Zoom and pan never affect exports ({Math.round(shapeBounds(shape).w)} × {Math.round(shapeBounds(shape).h)} shape).</p>
    </Section>
  </div>;
}
