import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { Switch } from '../../../../shared/controls';
import {
  BLENDS, COMPOSITIONS, COMPOSITION_LABEL, FALLOFFS, FLOW_PARAMS, FLOW_TYPES, FLOW_TYPE_LABEL, MOTION_LIMITS, MOTION_RANGE, UNLOCKED_RANGE,
  newFlowSource, type Blend, type Falloff, type FlowSource, type FlowType, type MotionConfig,
} from '../../../../motion/types';
import { Num, Section, Select } from '../parts';
import { MOTION_DEFAULTS, type MotionEditor } from './useMotion';
import { useState } from 'react';

const BLEND_LABEL: Record<Blend, string> = { add: 'Add', screen: 'Screen', difference: 'Difference', override: 'Override', max: 'Maximum' };
const FALLOFF_LABEL: Record<Falloff, string> = { hard: 'Hard edge', linear: 'Linear', smooth: 'Smooth', gauss: 'Gaussian', inverse: 'Inverse', ring: 'Ring' };
const COMPOSITION_HINT: Record<MotionConfig['composition']['mode'], string> = {
  additive: 'Sources add up. Strong stacks are caught by the velocity limit.',
  weighted: 'Each source is scaled by its Weight before adding.',
  average: 'The weighted mean of all sources: stacking never makes it faster.',
  normalized: 'Adds, then limits the sum to the strongest single source.',
  maximum: 'Only the strongest source wins at each point.',
  dominant: 'The nearest-to-peak source dominates; the rest only steer it.',
  soft: 'A soft sum: gets gradually less sensitive the more sources overlap.',
  priority: 'Higher-priority sources override lower ones where they act.',
};

export default function FlowTab({ editor, selectedId, onSelect }: { editor: MotionEditor; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { config, edit, announce } = editor;
  const [addType, setAddType] = useState<FlowType>('curl');
  const selected = config.sources.find(src => src.id === selectedId) ?? null;
  const unlocked = config.composition.unlockLimits;
  const strengthRange = unlocked ? UNLOCKED_RANGE.strength : MOTION_RANGE.source.strength;
  const D = MOTION_DEFAULTS;

  const addSource = (type: FlowType) => {
    if (config.sources.length >= MOTION_LIMITS.sources) { announce(`Limit of ${MOTION_LIMITS.sources} flow sources reached.`); return; }
    const created = newFlowSource(type, {}, config.sources.map(s => s.id));
    edit(draft => { draft.sources.push(created); draft.enabled = true; });
    onSelect(created.id);
  };
  const removeSource = (id: string) => {
    const index = config.sources.findIndex(s => s.id === id);
    edit(draft => { draft.sources = draft.sources.filter(s => s.id !== id); });
    const next = config.sources.filter(s => s.id !== id);
    onSelect(next[Math.min(index, next.length - 1)]?.id ?? null);
  };
  const duplicateSource = (id: string) => {
    if (config.sources.length >= MOTION_LIMITS.sources) { announce(`Limit of ${MOTION_LIMITS.sources} flow sources reached.`); return; }
    const found = config.sources.find(s => s.id === id);
    if (!found) return;
    const fresh = newFlowSource(found.type, {}, config.sources.map(s => s.id));
    const copy: FlowSource = { ...(JSON.parse(JSON.stringify(found)) as FlowSource), id: fresh.id, name: `${found.name} copy`.slice(0, 40), x: Math.min(1.2, found.x + 0.06), y: Math.max(-0.2, found.y - 0.06) };
    edit(draft => { draft.sources.splice(draft.sources.findIndex(s => s.id === id) + 1, 0, copy); });
    onSelect(copy.id);
  };
  const moveSource = (id: string, delta: -1 | 1) => edit(draft => {
    const i = draft.sources.findIndex(s => s.id === id), j = i + delta;
    if (i < 0 || j < 0 || j >= draft.sources.length) return;
    const [item] = draft.sources.splice(i, 1);
    draft.sources.splice(j, 0, item!);
  });
  const patchSource = (id: string, change: (src: FlowSource) => void, coalesce?: string) => edit(draft => { const src = draft.sources.find(s => s.id === id); if (src) change(src); }, coalesce);

  const comp = config.composition;
  return <div data-testid="motion-flow-tab">
    <Section title="Flow sources" aside={`${config.sources.filter(s => s.enabled).length}/${config.sources.length}`} testId="motion-sources">
      <ul className="gs-mot-list" aria-label="Flow sources">
        {config.sources.map((src, index) => <li key={src.id} className={`gs-mot-row ${src.id === selectedId ? 'on' : ''} ${src.enabled ? '' : 'off'}`}>
          <input type="checkbox" checked={src.enabled} aria-label={`Enable ${src.name}`} onChange={event => patchSource(src.id, s => { s.enabled = event.target.checked; })} data-testid={`motion-source-enable-${index}`} />
          <button type="button" className="gs-mot-pick" onClick={() => onSelect(src.id === selectedId ? null : src.id)} aria-pressed={src.id === selectedId} data-testid={`motion-source-${index}`}>
            <b>{src.name}</b><span>{FLOW_TYPE_LABEL[src.type]}{src.global ? ' · global' : ''}</span>
          </button>
          <button type="button" className="gs-mot-icon" aria-label={`Move ${src.name} up`} disabled={index === 0} onClick={() => moveSource(src.id, -1)}><ArrowUp size={13} /></button>
          <button type="button" className="gs-mot-icon" aria-label={`Move ${src.name} down`} disabled={index === config.sources.length - 1} onClick={() => moveSource(src.id, 1)}><ArrowDown size={13} /></button>
          <button type="button" className="gs-mot-icon" aria-label={`Duplicate ${src.name}`} onClick={() => duplicateSource(src.id)} data-testid={`motion-source-dup-${index}`}><Copy size={13} /></button>
          <button type="button" className="gs-mot-icon danger" aria-label={`Delete ${src.name}`} onClick={() => removeSource(src.id)} data-testid={`motion-source-del-${index}`}><Trash2 size={13} /></button>
        </li>)}
        {config.sources.length === 0 && <li className="hint">No flow sources yet. Pick a scene above or add one below.</li>}
      </ul>
      <div className="gs-mot-add">
        <Select id="motion-new-type" label="Add a flow" value={addType} options={FLOW_TYPES.map(id => ({ id, label: FLOW_TYPE_LABEL[id] }))} onChange={setAddType} />
        <button type="button" className="chip" onClick={() => addSource(addType)} disabled={config.sources.length >= MOTION_LIMITS.sources} data-testid="motion-source-add"><Plus size={12} /> Add</button>
      </div>
    </Section>

    {selected && <SourceEditor key={selected.id} src={selected} config={config} patch={change => patchSource(selected.id, change, `motion-src-${selected.id}`)} patchNow={change => patchSource(selected.id, change)} strengthMax={strengthRange[1]} />}

    <Section title="Composition" aside={COMPOSITION_LABEL[comp.mode]} open={config.sources.length > 1} testId="motion-composition">
      <Select id="motion-comp-mode" label="Mode" value={comp.mode} options={COMPOSITIONS.map(id => ({ id, label: COMPOSITION_LABEL[id] }))} onChange={mode => edit(d => { d.composition.mode = mode; })} />
      <p className="hint">{COMPOSITION_HINT[comp.mode]}</p>
      <Switch label="Normalise the result" checked={comp.normalize} onChange={normalize => edit(d => { d.composition.normalize = normalize; })} testId="motion-comp-normalize" />
      <Num label="Maximum velocity" value={comp.maxVelocity} min={(unlocked ? UNLOCKED_RANGE.maxVelocity : MOTION_RANGE.composition.maxVelocity)[0]} max={(unlocked ? UNLOCKED_RANGE.maxVelocity : MOTION_RANGE.composition.maxVelocity)[1]} step={0.01} def={D.composition.maxVelocity} unit="h/s" onChange={v => edit(d => { d.composition.maxVelocity = v; }, 'motion-maxvel')} />
      <Num label="Blend strength" value={comp.strength} min={0} max={2} step={0.01} def={D.composition.strength} onChange={v => edit(d => { d.composition.strength = v; }, 'motion-comp-strength')} />
      <Num label="Flow memory (cycle)" value={comp.cycle} min={MOTION_RANGE.composition.cycle[0]} max={MOTION_RANGE.composition.cycle[1]} step={0.5} def={D.composition.cycle} unit="s" onChange={v => edit(d => { d.composition.cycle = v; }, 'motion-cycle')} />
      <p className="hint">How far the colours are carried before the loop refreshes. Longer memory means longer streaks; the loop is cross-faded so there is never a visible reset.</p>
      <Section title="Advanced" open={false}>
        <Num label="Smoothing" value={comp.smoothing} min={0} max={1} step={0.01} def={D.composition.smoothing} onChange={v => edit(d => { d.composition.smoothing = v; }, 'motion-comp-smooth')} />
        <Num label="Balance (global vs local)" value={comp.balance} min={0} max={1} step={0.01} def={D.composition.balance} onChange={v => edit(d => { d.composition.balance = v; }, 'motion-comp-balance')} />
        <Switch label="Unlock extreme limits" checked={unlocked} onChange={unlockLimits => edit(d => { d.composition.unlockLimits = unlockLimits; })} testId="motion-unlock" />
        <p className="hint">Raises the strength and velocity caps for deliberately wild motion. The shader still guards against NaN and runaway values.</p>
      </Section>
    </Section>

    <Section title="Global" open={false} testId="motion-global">
      <Num label="Intensity" value={config.global.intensity} min={0} max={2} step={0.01} def={D.global.intensity} onChange={v => edit(d => { d.global.intensity = v; }, 'motion-g-int')} testId="motion-global-intensity" />
      <Num label="Speed" value={config.global.speed} min={0} max={4} step={0.01} def={D.global.speed} unit="×" onChange={v => edit(d => { d.global.speed = v; }, 'motion-g-speed')} />
      <Num label="Direction offset" value={config.global.direction} min={-180} max={180} step={1} def={D.global.direction} unit="°" onChange={v => edit(d => { d.global.direction = v; }, 'motion-g-dir')} />
      <Num label="Flow amount" value={config.global.flow} min={0} max={2} step={0.01} def={D.global.flow} onChange={v => edit(d => { d.global.flow = v; }, 'motion-g-flow')} />
      <Num label="Organic amount" value={config.global.organic} min={0} max={2} step={0.01} def={D.global.organic} onChange={v => edit(d => { d.global.organic = v; }, 'motion-g-org')} />
      <Num label="Turbulence amount" value={config.global.turbulence} min={0} max={2} step={0.01} def={D.global.turbulence} onChange={v => edit(d => { d.global.turbulence = v; }, 'motion-g-turb')} />
      <Num label="Interaction amount" value={config.global.interaction} min={0} max={2} step={0.01} def={D.global.interaction} onChange={v => edit(d => { d.global.interaction = v; }, 'motion-g-inter')} />
      <Seed label="Seed" value={config.global.seed} onChange={v => edit(d => { d.global.seed = v; })} testId="motion-global-seed" />
    </Section>
  </div>;
}

/** A seed with a dice button: the same seed always gives the same motion. */
export function Seed({ label, value, onChange, testId }: { label: string; value: number; onChange: (value: number) => void; testId?: string }) {
  return <div className="gs-field">
    <label className="field-label">{label}</label>
    <div className="gs-mot-seed">
      <input type="number" className="generate-select" min={0} max={9999} step={1} value={value} onChange={event => { const v = Math.round(Number(event.target.value)); if (Number.isFinite(v)) onChange(Math.min(9999, Math.max(0, v))); }} data-testid={testId} />
      <button type="button" className="chip" onClick={() => onChange(Math.floor(Math.random() * 10000))}>Randomise</button>
    </div>
  </div>;
}

function SourceEditor({ src, config, patch, patchNow, strengthMax }: { src: FlowSource; config: MotionConfig; patch: (change: (s: FlowSource) => void) => void; patchNow: (change: (s: FlowSource) => void) => void; strengthMax: number }) {
  const R = MOTION_RANGE.source;
  const params = FLOW_PARAMS[src.type];
  const base = newFlowSource(src.type);
  const changeType = (type: FlowType) => patchNow(s => {
    const fresh = newFlowSource(type);
    const wasDefaultName = s.name === newFlowSource(s.type).name;
    // keep identity, placement and blending; take everything else from the new type's defaults
    Object.assign(s, fresh, { id: s.id, name: wasDefaultName ? fresh.name : s.name, x: s.x, y: s.y, enabled: s.enabled, priority: s.priority, weight: s.weight, blend: s.blend });
  });
  return <Section title={src.name} aside={FLOW_TYPE_LABEL[src.type]} testId="motion-source-editor">
    <div className="gs-field">
      <label className="field-label" htmlFor="motion-src-name">Name</label>
      <input id="motion-src-name" className="generate-select" type="text" maxLength={40} value={src.name} onChange={event => patch(s => { s.name = event.target.value.slice(0, 40) || s.name; })} />
    </div>
    <Select id="motion-src-type" label="Type" value={src.type} options={FLOW_TYPES.map(id => ({ id, label: FLOW_TYPE_LABEL[id] }))} onChange={changeType} />
    <Num label="Strength" value={src.strength} min={R.strength[0]} max={strengthMax} step={0.01} def={base.strength} onChange={v => patch(s => { s.strength = v; })} testId="motion-src-strength" />
    <Num label="Direction" value={src.angle} min={R.angle[0]} max={R.angle[1]} step={1} def={base.angle} unit="°" onChange={v => patch(s => { s.angle = v; })} />
    <Num label="Speed" value={src.speed} min={R.speed[0]} max={R.speed[1]} step={0.01} def={base.speed} unit="×" onChange={v => patch(s => { s.speed = v; })} />
    <Switch label="Reverse" checked={src.reverse} onChange={reverse => patchNow(s => { s.reverse = reverse; })} />
    <Switch label="Affects the whole canvas" checked={src.global} onChange={global => patchNow(s => { s.global = global; })} testId="motion-src-global" />
    {!src.global && <>
      <Num label="Radius of influence" value={src.radius} min={R.radius[0]} max={R.radius[1]} step={0.01} def={base.radius} onChange={v => patch(s => { s.radius = v; })} testId="motion-src-radius" />
      <Select id="motion-src-falloff" label="Falloff" value={src.falloff} options={FALLOFFS.map(id => ({ id, label: FALLOFF_LABEL[id] }))} onChange={falloff => patchNow(s => { s.falloff = falloff; })} />
      <Num label="Centre X" value={src.x} min={R.x[0]} max={R.x[1]} step={0.005} def={base.x} onChange={v => patch(s => { s.x = v; })} />
      <Num label="Centre Y" value={src.y} min={R.y[0]} max={R.y[1]} step={0.005} def={base.y} onChange={v => patch(s => { s.y = v; })} />
    </>}
    {params.map(meta => {
      const value = src.params[Number(meta.key.slice(1)) - 1] ?? 0;
      const set = (v: number) => patch(s => { s.params[Number(meta.key.slice(1)) - 1] = v; });
      const hint = meta.hint ? <p className="hint">{meta.hint}</p> : null;
      if (meta.options) {
        const options = src.type === 'path' ? config.paths.map((path, index) => ({ id: String(index), label: `${index + 1}. ${path.name}` })) : meta.options.map((label, index) => ({ id: String(index), label }));
        if (options.length === 0) return <p key={meta.key} className="hint">Draw a path in the Field tab to give this source something to follow.</p>;
        return <div key={meta.key}><Select id={`motion-param-${meta.key}`} label={meta.label} value={String(Math.round(value))} options={options} onChange={v => patchNow(s => { s.params[Number(meta.key.slice(1)) - 1] = Number(v); })} />{hint}</div>;
      }
      return <div key={meta.key}><Num label={meta.label} value={value} min={meta.min} max={meta.max} step={meta.step} def={base.params[Number(meta.key.slice(1)) - 1] ?? 0} onChange={set} testId={`motion-param-${meta.key}`} />{hint}</div>;
    })}
    <Section title="Pattern & time" open={false}>
      <Num label="Scale" value={src.scale} min={R.scale[0]} max={R.scale[1]} step={0.01} def={base.scale} onChange={v => patch(s => { s.scale = v; })} />
      <Num label="Rotation" value={src.rotation} min={R.rotation[0]} max={R.rotation[1]} step={1} def={0} unit="°" onChange={v => patch(s => { s.rotation = v; })} />
      <Num label="Offset X" value={src.offsetX} min={R.offsetX[0]} max={R.offsetX[1]} step={0.01} def={0} onChange={v => patch(s => { s.offsetX = v; })} />
      <Num label="Offset Y" value={src.offsetY} min={R.offsetY[0]} max={R.offsetY[1]} step={0.01} def={0} onChange={v => patch(s => { s.offsetY = v; })} />
      <Num label="Phase" value={src.phase} min={R.phase[0]} max={R.phase[1]} step={1} def={0} unit="°" onChange={v => patch(s => { s.phase = v; })} />
      <Num label="Evolution" value={src.evolution} min={R.evolution[0]} max={R.evolution[1]} step={0.01} def={base.evolution} onChange={v => patch(s => { s.evolution = v; })} />
      <Num label="Time scale" value={src.timeScale} min={R.timeScale[0]} max={R.timeScale[1]} step={0.01} def={1} unit="×" onChange={v => patch(s => { s.timeScale = v; })} />
    </Section>
    <Section title="Blending" open={false}>
      <Select id="motion-src-blend" label="Blend" value={src.blend} options={BLENDS.map(id => ({ id, label: BLEND_LABEL[id] }))} onChange={blend => patchNow(s => { s.blend = blend; })} />
      <Num label="Influence" value={src.influence} min={R.influence[0]} max={R.influence[1]} step={0.01} def={1} onChange={v => patch(s => { s.influence = v; })} />
      <Num label="Weight" value={src.weight} min={R.weight[0]} max={R.weight[1]} step={0.01} def={1} onChange={v => patch(s => { s.weight = v; })} />
      <Num label="Priority" value={src.priority} min={R.priority[0]} max={R.priority[1]} step={1} def={0} onChange={v => patch(s => { s.priority = v; })} />
    </Section>
    <Section title="Follow a path" aside={src.follow.enabled ? 'On' : 'Off'} open={src.follow.enabled}>
      {config.paths.length === 0
        ? <p className="hint">Draw a path in the Field tab first. A source can then travel along it.</p>
        : <>
          <Switch label="Move this source along a path" checked={src.follow.enabled} onChange={enabled => patchNow(s => { s.follow.enabled = enabled; if (enabled && !config.paths.some(p => p.id === s.follow.pathId)) s.follow.pathId = config.paths[0]!.id; })} testId="motion-follow" />
          {src.follow.enabled && <>
            <Select id="motion-follow-path" label="Path" value={src.follow.pathId} options={config.paths.map((path, index) => ({ id: path.id, label: `${index + 1}. ${path.name}` }))} onChange={pathId => patchNow(s => { s.follow.pathId = pathId; })} />
            <Num label="Speed" value={src.follow.speed} min={-1} max={1} step={0.005} def={0.12} unit="loops/s" onChange={v => patch(s => { s.follow.speed = v; })} />
            <Num label="Acceleration" value={src.follow.acceleration} min={-1} max={1} step={0.01} def={0} onChange={v => patch(s => { s.follow.acceleration = v; })} />
            <Num label="Start offset" value={src.follow.offset} min={0} max={1} step={0.01} def={0} onChange={v => patch(s => { s.follow.offset = v; })} />
            <Select id="motion-follow-mode" label="At the end" value={src.follow.mode} options={[{ id: 'loop', label: 'Loop' }, { id: 'pingpong', label: 'Ping-pong' }]} onChange={mode => patchNow(s => { s.follow.mode = mode; })} />
            <Select id="motion-follow-orient" label="Orient flow" value={src.follow.orient} options={[{ id: 'none', label: 'Keep direction' }, { id: 'tangent', label: 'Along the path' }, { id: 'normal', label: 'Across the path' }]} onChange={orient => patchNow(s => { s.follow.orient = orient; })} />
          </>}
        </>}
    </Section>
  </Section>;
}
