import { RotateCcw } from 'lucide-react';
import { Section, Switch, ValueControl } from '../../shared/controls';
import { BLEND_MODES, DEFAULT_LAYER_MASK, IDENTITY, type GradientLayer, type LayerMask, type Transform } from '../engine/model';
import { useStore } from '../engine/store';
import { Empty, useStudio } from './ui';

export default function TransformPanel({ layerId }: { layerId: string }) {
  const { store } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  if (!layer) return <Empty>Select a layer first.</Empty>;
  const set = (patch: Partial<GradientLayer>, key?: string) => store.updateLayer(layerId, patch, { coalesce: key });
  const tf = (k: keyof Transform, v: number) => set({ transform: { ...layer.transform, [k]: v } }, `tf-${k}`);
  const t = layer.transform;
  return <div data-testid="transform-panel">
    <Section title="Layer">
      <label className="field-label" htmlFor="layer-name">Name</label>
      <input id="layer-name" className="generate-select" value={layer.name} onChange={e => set({ name: e.target.value }, 'name')} data-testid="layer-name" />
      <ValueControl label="Opacity" value={Math.round(layer.opacity * 100)} min={0} max={100} unit="%" def={100} onChange={v => set({ opacity: v / 100 }, 'opacity')} testId="layer-opacity" />
      <label className="field-label" htmlFor="layer-blend">Blend mode</label>
      <select id="layer-blend" className="generate-select" value={layer.blend} onChange={e => set({ blend: e.target.value as GradientLayer['blend'] })} data-testid="layer-blend">{BLEND_MODES.map(m => <option key={m} value={m}>{m}</option>)}</select>
    </Section>
    <Section title="Transform" hint="drag handles on the canvas too">
      <ValueControl label="Position X" value={t.x} min={-100} max={100} step={0.5} unit="%" def={0} onChange={v => tf('x', v)} testId="tf-x" />
      <ValueControl label="Position Y" value={t.y} min={-100} max={100} step={0.5} unit="%" def={0} onChange={v => tf('y', v)} testId="tf-y" />
      <ValueControl label="Scale" value={Math.round(t.scale * 100)} min={5} max={500} unit="%" def={100} onChange={v => tf('scale', v / 100)} testId="tf-scale" />
      <ValueControl label="Rotate" value={t.rotate} min={-180} max={180} step={0.5} unit="°" def={0} onChange={v => tf('rotate', v)} testId="tf-rotate" />
      <ValueControl label="Skew X" value={t.skewX} min={-60} max={60} step={0.5} unit="°" def={0} onChange={v => tf('skewX', v)} testId="tf-skewx" />
      <ValueControl label="Skew Y" value={t.skewY} min={-60} max={60} step={0.5} unit="°" def={0} onChange={v => tf('skewY', v)} testId="tf-skewy" />
      <button type="button" className="btn wide" onClick={() => set({ transform: { ...IDENTITY } })} data-testid="tf-reset"><RotateCcw />Reset transform</button>
    </Section>
    <Section title="Layer shape" hint="Reshape the boundary without warping its contents">
      <Switch label="Custom boundary" checked={layer.mask.enabled} onChange={enabled => set({ mask: { ...layer.mask, enabled } })} testId="mask-enabled" />
      {layer.mask.enabled && <>
        <Switch label="Curved edges" checked={layer.mask.curved} onChange={curved => set({ mask: { ...layer.mask, curved } })} testId="mask-curved" />
        <p className="hint">Drag the four green corner handles on the preview. Curved edges reveal purple handles for adjusting each Bézier section.</p>
        {layer.mask.corners.map((point, index) => <div className="gs-curve-point-controls" key={`corner-${index}`}>
          <div className="field-label">Corner {index + 1}</div>
          <ValueControl label={`Corner ${index + 1} X`} value={point.x} min={-25} max={125} step={0.5} unit="%" onChange={x => set({ mask: { ...layer.mask, corners: layer.mask.corners.map((p, i) => i === index ? { ...p, x } : p) as LayerMask['corners'] } }, `mask-corner-${index}-x`)} testId={`mask-corner-${index}-x`} />
          <ValueControl label={`Corner ${index + 1} Y`} value={point.y} min={-25} max={125} step={0.5} unit="%" onChange={y => set({ mask: { ...layer.mask, corners: layer.mask.corners.map((p, i) => i === index ? { ...p, y } : p) as LayerMask['corners'] } }, `mask-corner-${index}-y`)} testId={`mask-corner-${index}-y`} />
        </div>)}
        {layer.mask.curved && <button type="button" className="btn wide" onClick={() => set({ mask: { ...layer.mask, controls: DEFAULT_LAYER_MASK.controls.map(p => ({ ...p })) as LayerMask['controls'] } })} data-testid="mask-reset-curves"><RotateCcw />Reset curve handles</button>}
        <button type="button" className="btn wide" onClick={() => set({ mask: { ...DEFAULT_LAYER_MASK, corners: DEFAULT_LAYER_MASK.corners.map(p => ({ ...p })) as LayerMask['corners'], controls: DEFAULT_LAYER_MASK.controls.map(p => ({ ...p })) as LayerMask['controls'] } })} data-testid="mask-reset"><RotateCcw />Reset layer shape</button>
      </>}
    </Section>
  </div>;
}
