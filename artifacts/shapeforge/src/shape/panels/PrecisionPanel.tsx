import { useState } from 'react';
import { ChevronsLeftRight, FlipHorizontal, FlipVertical, Plus, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { fmt, getHandles, shapeBounds, type NodeMode, type ShapeModel } from '../../lib/shape/geometry';
import {
  cornerInfo, deleteNode, deleteNodes, setNodesLocked, dist, flipShape, handlePolar, insertOnSegment, rotateShape, roundNode, scaleShape, setBounds, setCorner, setHandlePolar,
  setNodeMode, setSegmentCurve, moveNodeTo, NONE, type Selection,
} from '../../lib/shape/edit';
import type { EditorSettings } from '../../lib/shape/settings';
import { NumField, Seg, Switch } from '../../shared/controls';

type Common = { shape: ShapeModel; settings: EditorSettings; setSettings: (p: Partial<EditorSettings>) => void; onCommit: (next: ShapeModel, sel?: Selection) => void; announce: (m: string) => void };

/** Numeric bounds / rotation / scale — the "Position · Scale · Rotation · Bounds" model for the whole shape. */
export function TransformBlock({ shape, settings, setSettings, onCommit }: Omit<Common, 'announce'>) {
  const b = shapeBounds(shape);
  const setBox = (patch: Partial<typeof b>) => {
    let to = { ...b, ...patch };
    if (settings.lockRatio && (patch.w !== undefined || patch.h !== undefined) && b.w > 1e-6 && b.h > 1e-6) {
      if (patch.w !== undefined) to.h = b.h * (patch.w / b.w); else to.w = b.w * ((patch.h as number) / b.h);
      to = { ...to, x: patch.x ?? b.x, y: patch.y ?? b.y };
    }
    if (to.w < 1 || to.h < 1) return;
    onCommit(setBounds(shape, b, to), { kind: 'shape' });
  };
  return <div className="xform">
    <div className="nf-grid">
      <NumField label="X" value={b.x} onCommit={v => setBox({ x: v })} testId="xf-x" />
      <NumField label="Y" value={b.y} onCommit={v => setBox({ y: v })} testId="xf-y" />
      <NumField label="W" value={b.w} min={1} onCommit={v => setBox({ w: v })} testId="xf-w" />
      <NumField label="H" value={b.h} min={1} onCommit={v => setBox({ h: v })} testId="xf-h" />
      <NumField label="Rotate by" value={0} step={5} unit="°" dp={1} onCommit={v => v && onCommit(rotateShape(shape, v), { kind: 'shape' })} testId="xf-rotate" />
      <NumField label="Scale to" value={100} step={5} min={2} max={1000} unit="%" dp={0} onCommit={v => v !== 100 && onCommit(scaleShape(shape, v / 100), { kind: 'shape' })} testId="xf-scale" />
    </div>
    <div className="btn-row">
      <button className="btn" onClick={() => onCommit(rotateShape(shape, -90), { kind: 'shape' })} data-testid="button-rotate-ccw"><RotateCcw />90°</button>
      <button className="btn" onClick={() => onCommit(rotateShape(shape, 90), { kind: 'shape' })} data-testid="button-rotate"><RotateCw />90°</button>
      <button className="btn" onClick={() => onCommit(flipShape(shape, 'x'), { kind: 'shape' })} data-testid="button-flip-x"><FlipHorizontal />Flip</button>
      <button className="btn" onClick={() => onCommit(flipShape(shape, 'y'), { kind: 'shape' })} data-testid="button-flip-y"><FlipVertical />Flip</button>
    </div>
    <div className="switch-row">
      <Switch label="Lock ratio" checked={settings.lockRatio} onChange={v => setSettings({ lockRatio: v })} />
      <Switch label="Scale from centre" checked={settings.fromCenter} onChange={v => setSettings({ fromCenter: v })} />
    </div>
  </div>;
}

const MODES: { id: NodeMode; label: string }[] = [{ id: 'auto', label: 'Auto' }, { id: 'corner', label: 'Corner' }, { id: 'smooth', label: 'Smooth' }, { id: 'symmetric', label: 'Symm.' }, { id: 'free', label: 'Free' }];
const PRESETS = [30, 45, 60, 90, 120, 135];
const STEPS = [5, 10, 15, 22.5, 30, 45, 90];

function HandleFields({ shape, index, side, onCommit }: { shape: ShapeModel; index: number; side: 'in' | 'out'; onCommit: Common['onCommit'] }) {
  const pol = handlePolar(shape, index, side);
  const sel: Selection = { kind: 'handle', index, side };
  return <div className="nf-grid two">
    <NumField label="Angle" unit="°" step={1} min={0} max={360} dp={2} value={pol.angle} onCommit={v => onCommit(setHandlePolar(shape, index, side, { angle: v }), sel)} testId={`handle-${side}-angle`} />
    <NumField label="Length" step={1} min={0} dp={2} value={pol.length} onCommit={v => onCommit(setHandlePolar(shape, index, side, { length: v }), sel)} testId={`handle-${side}-length`} />
  </div>;
}

/** Precision panel — what the compact mobile dock and the desktop "Node" tab both show. */
export default function PrecisionPanel(props: Common & { selection: Selection; onSelect: (s: Selection) => void }) {
  const { shape, selection, settings, setSettings, onCommit, onSelect, announce } = props;

  if (selection.kind === 'none') return <div className="prec-empty">
    <p className="hint">Tap a node, a handle or a path segment to edit it with exact numbers. Tap inside the shape to transform it.</p>
    <button className="btn" onClick={() => onSelect({ kind: 'shape' })} data-testid="select-shape">Select whole shape</button>
  </div>;

  if (selection.kind === 'shape') return <div>
    <div className="prec-title"><b>TRANSFORM</b><small>{shape.points.length} nodes</small></div>
    <TransformBlock shape={shape} settings={settings} setSettings={setSettings} onCommit={onCommit} />
  </div>;

  if (selection.kind === 'nodes') {
    const idx = selection.indices, locked = idx.filter(i => shape.points[i]?.locked).length, allLocked = locked === idx.length;
    return <div data-testid="multi-panel">
      <div className="prec-title"><b>{idx.length} NODES</b><small>{locked} locked</small></div>
      <div className="btn-row">
        <button className="btn" onClick={() => onCommit(setNodesLocked(shape, idx, !allLocked), selection)} data-testid="multi-lock">{allLocked ? 'Unlock' : 'Lock'} all</button>
        <button className="btn danger" onClick={() => { const r = deleteNodes(shape, idx); if (!r.shape) announce('A shape needs at least ' + (shape.closed ? 3 : 2) + ' nodes'); else { onCommit(r.shape, NONE); if (r.skipped) announce(`${r.skipped} locked node${r.skipped > 1 ? 's' : ''} kept`); } }} data-testid="multi-delete"><Trash2 />Delete all</button>
        <button className="btn" onClick={() => onSelect(NONE)} data-testid="multi-clear">Clear</button>
      </div>
      <p className="hint">Drag any selected node to move them together. Locked nodes stay put and are skipped when deleting.</p>
    </div>;
  }

  if (selection.kind === 'segment') {
    const i = selection.index, n = shape.points.length, a = shape.points[i], b = shape.points[(i + 1) % n];
    if (!a || !b) return null;
    const straight = shape.kind === 'polygon' || (() => { const ha = getHandles(shape.points, i, shape.closed), hb = getHandles(shape.points, (i + 1) % n, shape.closed); return dist(ha.out, a) < 1e-6 && dist(hb.in, b) < 1e-6; })();
    return <div>
      <div className="prec-title"><b>SEGMENT {i + 1}</b><small>{straight ? 'straight' : 'curved'} · chord {fmt(dist(a, b), 1)}</small></div>
      <div className="btn-row">
        <button className="btn" onClick={() => { const r = insertOnSegment(shape, i, selection.t); onCommit(r.shape, { kind: 'node', index: r.index }); }} data-testid="segment-add"><Plus />Add node here</button>
        <button className="btn" onClick={() => onCommit(setSegmentCurve(shape, i, straight), selection)} data-testid="segment-toggle">{straight ? 'Make curved' : 'Make straight'}</button>
      </div>
      <p className="hint">Double-tap a segment to add a node exactly where you tapped.</p>
    </div>;
  }

  const i = selection.index, pt = shape.points[i];
  if (!pt) return null;
  const isPath = shape.kind === 'path';
  const info = cornerInfo(shape, i);
  const sharp = pt.mode === 'corner' && !pt.in && !pt.out;
  const mode: NodeMode = isPath ? (pt.mode ?? 'auto') : 'corner';
  const setSel: Selection = { kind: 'node', index: i };

  return <div>
    <div className="prec-title"><b>{selection.kind === 'handle' ? 'HANDLE' : 'NODE'}</b><small>{i + 1} / {shape.points.length}</small></div>
    {selection.kind === 'handle' && isPath && <>
      <HandleFields shape={shape} index={i} side={selection.side} onCommit={onCommit} />
      <div className="switch-row">
        <Switch label="Snap angle" checked={settings.snapAngle} onChange={v => setSettings({ snapAngle: v })} testId="handle-snap" />
        <label className="nf compact"><span className="nf-label">Step</span>
          <select value={settings.angleStep} onChange={e => setSettings({ angleStep: Number(e.target.value) })} aria-label="Angle step" data-testid="handle-step">{STEPS.map(s => <option key={s} value={s}>{s}°</option>)}</select></label>
      </div>
      <div className="prec-sub">Node</div>
    </>}
    <div className="nf-grid two">
      <NumField label="X" value={pt.x} onCommit={v => onCommit(moveNodeTo(shape, i, { x: v, y: pt.y }), setSel)} testId="node-x" />
      <NumField label="Y" value={pt.y} onCommit={v => onCommit(moveNodeTo(shape, i, { x: pt.x, y: v }), setSel)} testId="node-y" />
    </div>
    <Switch label="Lock this node" checked={!!pt.locked} onChange={v => onCommit(setNodesLocked(shape, [i], v), setSel)} testId="node-lock" />
    <div className="prec-sub">Type</div>
    <Seg value={mode} label="Node type" testId="node-type" options={MODES.map(m => ({ id: m.id, label: m.label }))} onChange={m => onCommit(setNodeMode(shape, i, m), setSel)} />
    {isPath && selection.kind === 'node' && <>
      <div className="prec-sub">Handle in</div><HandleFields shape={shape} index={i} side="in" onCommit={onCommit} />
      <div className="prec-sub">Handle out</div><HandleFields shape={shape} index={i} side="out" onCommit={onCommit} />
    </>}
    {info && (sharp || !isPath) && <>
      <div className="prec-sub">Corner geometry</div>
      <div className="nf-grid three">
        <NumField label="Incoming" unit="°" dp={2} min={0} max={360} value={info.incoming} onCommit={v => onCommit(setCorner(shape, i, 'incoming', v), setSel)} testId="corner-in" />
        <NumField label="Outgoing" unit="°" dp={2} min={0} max={360} value={info.outgoing} onCommit={v => onCommit(setCorner(shape, i, 'outgoing', v), setSel)} testId="corner-out" />
        <NumField label="Corner" unit="°" dp={2} min={1} max={180} value={info.corner} onCommit={v => onCommit(setCorner(shape, i, 'corner', v), setSel)} testId="corner-angle" />
      </div>
      <div className="chips">{PRESETS.map(p => <button key={p} className={`chip ${Math.abs(info.corner - p) < 0.01 ? 'active' : ''}`} onClick={() => onCommit(setCorner(shape, i, 'corner', p), setSel)} data-testid={`corner-${p}`}>{p}°</button>)}</div>
      <RoundRow shape={shape} index={i} onCommit={onCommit} announce={announce} />
    </>}
    <div className="btn-row">
      <button className="btn" onClick={() => { const r = insertOnSegment(shape, i, 0.5); onCommit(r.shape, { kind: 'node', index: r.index }); }} data-testid="node-add"><ChevronsLeftRight />Add after</button>
      <button className="btn danger" onClick={() => { const next = deleteNode(shape, i); if (next) onCommit(next, NONE); else announce('A shape needs at least ' + (shape.closed ? 3 : 2) + ' nodes'); }} data-testid="node-delete"><Trash2 />Delete</button>
    </div>
  </div>;
}

function RoundRow({ shape, index, onCommit, announce }: { shape: ShapeModel; index: number; onCommit: Common['onCommit']; announce: (m: string) => void }) {
  const [r, setR] = useState(40);
  return <div className="round-row">
    <NumField label="Round this corner" unit="px" step={5} min={1} max={500} dp={0} value={r} onCommit={setR} testId="corner-radius" />
    <button className="btn" onClick={() => { const res = roundNode(shape, index, r); if (res.ok) onCommit(res.shape, { kind: 'node', index }); else announce('Only straight corners can be rounded'); }} data-testid="corner-round">Round</button>
  </div>;
}
