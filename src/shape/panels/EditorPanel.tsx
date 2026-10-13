import { RotateCcw } from 'lucide-react';
import { DEFAULT_SETTINGS, type EditorSettings } from '../../lib/shape/settings';
import { Section, Seg, Switch, ValueControl } from '../../shared/controls';

const STEPS = [5, 10, 15, 22.5, 30, 45, 90];

/** Editor settings: visual size, touch size and snapping — none of these ever changes the geometry. */
export default function EditorPanel({ settings, set }: { settings: EditorSettings; set: (p: Partial<EditorSettings>) => void }) {
  return <div>
    <h2 className="properties-title">Editor settings</h2>
    <Section title="Sizes" hint="screen px">
      <ValueControl label="Node size" value={settings.nodeSize} min={6} max={24} def={DEFAULT_SETTINGS.nodeSize} unit="px" onChange={v => set({ nodeSize: v })} testId="set-node" />
      <ValueControl label="Handle size" value={settings.handleSize} min={6} max={22} def={DEFAULT_SETTINGS.handleSize} unit="px" onChange={v => set({ handleSize: v })} testId="set-handle" />
      <ValueControl label="Touch area" value={settings.touchSize} min={36} max={96} def={DEFAULT_SETTINGS.touchSize} unit="px" onChange={v => set({ touchSize: v })} testId="set-touch" />
      <Switch label="Show touch area of selection" checked={settings.showTouch} onChange={v => set({ showTouch: v })} testId="set-show-touch" />
      <p className="hint">Visual size, touch area and geometry are independent. Resizing never moves a point.</p>
    </Section>
    <Section title="Snapping" hint={settings.snapOn ? 'on' : 'off'}>
      <Switch label="Snapping enabled" checked={settings.snapOn} onChange={v => set({ snapOn: v })} testId="set-snap-on" />
      <div className="switch-grid">
        <Switch label="Grid" checked={settings.snapGrid} onChange={v => set({ snapGrid: v })} testId="set-snap-grid" />
        <Switch label="Horizontal" checked={settings.snapH} onChange={v => set({ snapH: v })} testId="set-snap-h" />
        <Switch label="Vertical" checked={settings.snapV} onChange={v => set({ snapV: v })} testId="set-snap-v" />
        <Switch label="Angle" checked={settings.snapAngle} onChange={v => set({ snapAngle: v })} testId="set-snap-angle" />
        <Switch label="Node" checked={settings.snapNode} onChange={v => set({ snapNode: v })} testId="set-snap-node" />
        <Switch label="Centre" checked={settings.snapCenter} onChange={v => set({ snapCenter: v })} testId="set-snap-center" />
        <Switch label="Line assist" checked={settings.assist} onChange={v => set({ assist: v })} testId="set-assist" />
        <Switch label="Smart guides" checked={settings.guides} onChange={v => set({ guides: v })} testId="set-guides" />
      </div>
      <label className="nf compact wide"><span className="nf-label">Angle step</span>
        <select value={settings.angleStep} onChange={e => set({ angleStep: Number(e.target.value) })} aria-label="Angle step" data-testid="set-step">{STEPS.map(s => <option key={s} value={s}>{s}°</option>)}</select></label>
      <ValueControl label="Grid size" value={settings.gridSize} min={5} max={100} step={5} def={DEFAULT_SETTINGS.gridSize} onChange={v => set({ gridSize: v })} testId="set-grid" />
      <ValueControl label="Magnet distance" value={settings.snapPx} min={3} max={20} def={DEFAULT_SETTINGS.snapPx} unit="px" onChange={v => set({ snapPx: v })} testId="set-magnet" />
      <p className="hint">Hold Shift while dragging for 15° angles, Alt to disable snapping temporarily. Line assist only pulls toward horizontal, vertical, 45° and 15° steps when you are already close.</p>
    </Section>
    <Section title="Pen" open={false}>
      <div className="field-label">New nodes</div>
      <Seg value={settings.penMode} label="Pen node type" options={[{ id: 'corner', label: 'Corner' }, { id: 'smooth', label: 'Auto-smooth' }]} onChange={v => set({ penMode: v })} testId="set-pen" />
      <p className="hint">Tap = node. Press and drag = node with symmetric handles. Tap the first node to close.</p>
    </Section>
    <button className="btn" style={{ marginTop: 10 }} onClick={() => set(DEFAULT_SETTINGS)} data-testid="set-reset"><RotateCcw />Reset editor settings</button>
  </div>;
}
