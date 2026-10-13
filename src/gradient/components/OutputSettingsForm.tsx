import { Switch, Seg } from '../../shared/controls';
import { DEFAULT_OUTPUT, outputOf, type OutputSettings } from '../engine/model';
import { useStore } from '../engine/store';
import { useStudio } from './ui';

const W_UNITS = ['%', 'px', 'vw', 'rem', 'em', 'auto'] as const;
const H_UNITS = ['px', 'vh', '%', 'rem', 'em', 'auto'] as const;

/** Manual naming and sizing for the generated code — nothing is hard-coded. */
export default function OutputSettingsForm() {
  const { store } = useStudio();
  const project = useStore(store, s => s.project);
  const o = outputOf(project);
  const set = (patch: Partial<OutputSettings>, key = 'out') => store.update(p => ({ ...p, output: { ...outputOf(p), ...patch } }), { coalesce: key });
  const num = (v: string) => Math.max(0, Number(v) || 0);
  return <div className="gs-outform" data-testid="output-settings">
    <div className="field-label">Selector type</div>
    <Seg value={o.selectorType} label="Selector type" options={[{ id: 'class', label: 'Class' }, { id: 'id', label: 'ID' }, { id: 'attribute', label: 'Attribute' }]} onChange={v => set({ selectorType: v, selector: v === 'attribute' && !o.selector.startsWith('data-') ? 'data-gradient' : o.selector })} testId="out-type" />
    <div className="gs-two">
      <label className="nf"><span className="nf-label">{o.selectorType === 'attribute' ? 'Attribute name' : o.selectorType === 'id' ? 'ID name' : 'Class name'}</span>
        <input className="generate-select" value={o.selector} spellCheck={false} onChange={e => set({ selector: e.target.value }, 'out-sel')} data-testid="out-selector" placeholder={o.selectorType === 'id' ? 'hero-gradient' : o.selectorType === 'attribute' ? 'data-gradient' : 'gradient-canvas'} /></label>
      {o.selectorType === 'attribute' && <label className="nf"><span className="nf-label">Value</span><input className="generate-select" value={o.attrValue} spellCheck={false} onChange={e => set({ attrValue: e.target.value }, 'out-val')} data-testid="out-attrvalue" /></label>}
      <label className="nf"><span className="nf-label">Layer class prefix</span><input className="generate-select" value={o.layerPrefix} spellCheck={false} onChange={e => set({ layerPrefix: e.target.value }, 'out-prefix')} data-testid="out-prefix" /></label>
    </div>
    <label className="nf"><span className="nf-label">Download filename</span><input className="generate-select" value={o.downloadName} spellCheck={false} onChange={e => set({ downloadName: e.target.value }, 'out-download-name')} data-testid="out-download-name" placeholder="gradient" /><small className="gs-bar-hint">The extension is added automatically.</small></label>
    <Switch label="Include width / height in the code" checked={o.includeSize} onChange={v => set({ includeSize: v })} testId="out-include-size" />
    {o.includeSize && <>
      <div className="gs-two">
        <label className="nf"><span className="nf-label">Width</span><span className="gs-unitfield">
          <input inputMode="decimal" disabled={o.width.unit === 'auto'} value={o.width.unit === 'auto' ? '' : o.width.value} onChange={e => set({ width: { ...o.width, value: num(e.target.value) } }, 'out-w')} data-testid="out-width" aria-label="Width value" />
          <select value={o.width.unit} onChange={e => set({ width: { ...o.width, unit: e.target.value as OutputSettings['width']['unit'] } })} aria-label="Width unit" data-testid="out-width-unit">{W_UNITS.map(u => <option key={u}>{u}</option>)}</select></span></label>
        <label className="nf"><span className="nf-label">Height</span><span className="gs-unitfield">
          <input inputMode="decimal" disabled={o.height.unit === 'auto'} value={o.height.unit === 'auto' ? '' : o.height.value} onChange={e => set({ height: { ...o.height, value: num(e.target.value) } }, 'out-h')} data-testid="out-height" aria-label="Height value" />
          <select value={o.height.unit} onChange={e => set({ height: { ...o.height, unit: e.target.value as OutputSettings['height']['unit'] } })} aria-label="Height unit" data-testid="out-height-unit">{H_UNITS.map(u => <option key={u}>{u}</option>)}</select></span></label>
      </div>
      <Seg value={o.height.prop} label="Height property" options={[{ id: 'min-height', label: 'min-height' }, { id: 'height', label: 'height' }]} onChange={v => set({ height: { ...o.height, prop: v } })} testId="out-heightprop" />
    </>}
    <Switch label="Comments in code" checked={o.comments} onChange={v => set({ comments: v })} testId="out-comments" />
    <button type="button" className="btn wide" onClick={() => set({ ...DEFAULT_OUTPUT }, 'out-reset')}>Reset naming &amp; size</button>
  </div>;
}
