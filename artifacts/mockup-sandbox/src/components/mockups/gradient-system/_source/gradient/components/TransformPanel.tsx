import { RotateCcw } from 'lucide-react';
import { Section, ValueControl } from '../../shared/controls';
import { BLEND_MODES, IDENTITY, type GradientLayer, type Transform } from '../engine/model';
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
  </div>;
}
