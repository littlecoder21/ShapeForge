import { Trash2 } from 'lucide-react';
import { Switch, ValueControl } from '../../shared/controls';
import { EFFECTS, EFFECT_LIST, newEffect } from '../engine/effects';
import type { EffectInstance } from '../engine/model';
import { useStore } from '../engine/store';
import { Empty, useStudio } from './ui';

export default function EffectsPanel({ layerId }: { layerId: string }) {
  const { store } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  if (!layer) return <Empty>Select a layer first.</Empty>;
  const setFx = (id: string, fn: (e: EffectInstance) => EffectInstance, key?: string) => store.updateLayer(layerId, l => ({ ...l, effects: l.effects.map(e => (e.id === id ? fn(e) : e)) }), { coalesce: key });
  return <div className="gs-fx" data-testid="effects-panel">
    <div className="gs-chips gs-addchips" role="group" aria-label="Add effect">
      {EFFECT_LIST.map(d => <button key={d.id} type="button" className="chip" title={d.hint} onClick={() => store.updateLayer(layerId, l => ({ ...l, effects: [...l.effects, newEffect(d.id)] }))} data-testid={`add-fx-${d.id}`}>+ {d.label}</button>)}
    </div>
    <div className="gs-chips">
      <button type="button" className="chip" onClick={() => store.updateLayer(layerId, l => ({ ...l, blend: 'screen', effects: [newEffect('blur', { radius: 48 }), ...l.effects.filter(e => e.type !== 'blur')] }))} data-testid="fx-soft-glow">Soft glow</button>
      <button type="button" className="chip" onClick={() => store.updateLayer(layerId, l => ({ ...l, opacity: Math.min(l.opacity, 0.65), effects: [newEffect('blur', { radius: 90 }), ...l.effects.filter(e => e.type !== 'blur')] }))}>Haze</button>
      <button type="button" className="chip" onClick={() => store.updateLayer(layerId, l => ({ ...l, effects: [...l.effects, newEffect('saturate', { amount: 150 }), newEffect('contrast', { amount: 115 })] }))}>Vivid</button>
    </div>
    {!layer.effects.length && <Empty>No effects yet. Add Blur for glows, colour filters to grade a layer, or Distortion to bend its edges.</Empty>}
    {layer.effects.map(e => {
      const def = EFFECTS[e.type]; if (!def) return null;
      return <div key={e.id} className={`gs-fxcard ${e.enabled ? '' : 'off'}`} data-testid="fx-card">
        <div className="gs-fxhead"><b>{def.label}</b>
          <Switch label="" checked={e.enabled} onChange={v => setFx(e.id, x => ({ ...x, enabled: v }))} testId={`fx-on-${e.type}`} />
          <button type="button" className="icon-btn" aria-label={`Remove ${def.label}`} onClick={() => store.updateLayer(layerId, l => ({ ...l, effects: l.effects.filter(x => x.id !== e.id) }))} data-testid={`fx-del-${e.type}`}><Trash2 /></button></div>
        {def.params.map(q => <ValueControl key={q.key} label={q.label} value={e.params[q.key] ?? q.def} min={q.min} max={q.max} step={q.step} unit={q.unit} def={q.def} onChange={v => setFx(e.id, x => ({ ...x, params: { ...x.params, [q.key]: v } }), `fx-${e.id}-${q.key}`)} testId={`fx-${e.type}-${q.key}`} />)}
        <p className="hint">{def.hint}</p>
      </div>;
    })}
  </div>;
}
