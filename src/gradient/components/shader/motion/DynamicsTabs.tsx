import { useMemo, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { Switch } from '../../../../shared/controls';
import { createDynamics, modulatorShape, stepDynamics } from '../../../../motion/motionRuntime';
import { INTERACTION_PRESETS } from '../../../../motion/presets';
import {
  FALLOFFS, INTERACTION_RESPONSES, LOOP_MODES, MOD_BLENDS, MOD_SHAPES, MOD_TARGETS, MOTION_LIMITS, MOTION_RANGE, PHYSICS_MODELS, SOURCE_MOD_PROPS, SOURCE_MOD_KIND,
  TURBULENCE_KINDS, newModulator, type Modulator, type MotionConfig,
} from '../../../../motion/types';
import { Num, Section, Select } from '../parts';
import { Seed } from './FlowTab';
import { Slider, Toggle, labelOf } from './controls';
import { MOTION_DEFAULTS, type MotionEditor } from './useMotion';

/* ───────────── physics ───────────── */

/** The step response of the chosen model, computed with the engine's own stepDynamics: what you see is what the motion does. */
function ResponseChart({ physics }: { physics: MotionConfig['physics'] }) {
  const path = useMemo(() => {
    const dyn = createDynamics(0);
    stepDynamics(dyn, 0, 1 / 60, physics);
    const values: number[] = [];
    for (let i = 0; i <= 180; i++) { stepDynamics(dyn, 1, 1 / 60, physics); values.push(dyn.x); }
    return values.map((v, i) => `${(i / 180 * 240).toFixed(1)},${(62 - Math.max(-0.4, Math.min(1.8, v)) * 28 + 0).toFixed(1)}`).join(' ');
  }, [physics]);
  return <svg className="gs-mot-plot" viewBox="0 0 240 70" role="img" aria-label="Response to a sudden change over three seconds">
    <line x1="0" y1="34" x2="240" y2="34" className="target" /><line x1="0" y1="62" x2="240" y2="62" className="axis" />
    <polyline points={path} className="curve" />
    <text x="4" y="30" className="label">target</text><text x="236" y="68" className="label" textAnchor="end">3 s</text>
  </svg>;
}

export function PhysicsTab({ editor }: { editor: MotionEditor }) {
  const { config, edit } = editor;
  const S = (field: string, label: string, step = 0.01, unit?: string) => <Slider editor={editor} group="physics" field={field} label={label} step={step} {...(unit ? { unit } : {})} />;
  return <div data-testid="motion-physics-tab">
    <Section title="Response" aside={labelOf(config.physics.model)}>
      <Select id="motion-physics-model" label="Model" value={config.physics.model} options={PHYSICS_MODELS.map(id => ({ id, label: labelOf(id) }))} onChange={model => edit(d => { d.physics.model = model; })} />
      <ResponseChart physics={config.physics} />
      <p className="hint">How pointer motion, direction changes and the global direction settle. The curve is a step response computed by the engine itself.</p>
      {S('mass', 'Mass')}{S('stiffness', 'Stiffness')}{S('damping', 'Damping')}{S('elasticity', 'Elasticity')}
    </Section>
    <Section title="Momentum" open={false}>
      {S('inertia', 'Inertia')}{S('friction', 'Friction')}{S('drag', 'Drag')}{S('resistance', 'Resistance')}{S('persistence', 'Persistence')}{S('impulse', 'Impulse')}{S('directionInertia', 'Direction inertia')}
    </Section>
    <Section title="Limits" open={false}>
      {S('maxSpeed', 'Max speed')}{S('minSpeed', 'Min speed')}
      <p className="hint">All models advance in fixed sub-steps with implicit damping, so a slow frame never makes them unstable.</p>
    </Section>
  </div>;
}

/* ───────────── organic motion & turbulence ───────────── */

export function OrganicTab({ editor }: { editor: MotionEditor }) {
  const { config, edit } = editor;
  const S = (group: 'organic' | 'turbulence', field: string, label: string, step = 0.01, unit?: string) => <Slider editor={editor} group={group} field={field} label={label} step={step} {...(unit ? { unit } : {})} />;
  return <div data-testid="motion-organic-tab">
    <Section title="Organic motion" aside={config.organic.enabled ? 'On' : 'Off'}>
      <Toggle editor={editor} group="organic" field="enabled" label="Organic motion" testId="motion-organic-enabled" />
      {config.organic.enabled && <>
        {S('organic', 'intensity', 'Amount')}{S('organic', 'scale', 'Scale')}{S('organic', 'speed', 'Speed')}{S('organic', 'drift', 'Drift')}
        {S('organic', 'spatial', 'Spatial warp')}{S('organic', 'variation', 'Variation')}
        <Seed label="Seed" value={config.organic.seed} onChange={v => edit(d => { d.organic.seed = v; })} testId="motion-organic-seed" />
        <Section title="Advanced" open={false}>
          {S('organic', 'smoothness', 'Smoothness')}{S('organic', 'evolution', 'Evolution')}{S('organic', 'randomness', 'Randomness')}{S('organic', 'persistence', 'Persistence')}{S('organic', 'phase', 'Phase', 1, '°')}
        </Section>
        <p className="hint">Seeded and deterministic: the same seed gives the same motion in the editor and in the exported page.</p>
      </>}
    </Section>
    <Section title="Turbulence" aside={config.turbulence.enabled ? labelOf(config.turbulence.kind) : 'Off'}>
      <Toggle editor={editor} group="turbulence" field="enabled" label="Turbulence" testId="motion-turb-enabled" />
      {config.turbulence.enabled && <>
        <Select id="motion-turb-kind" label="Kind" value={config.turbulence.kind} options={TURBULENCE_KINDS.map(id => ({ id, label: labelOf(id) }))} onChange={kind => edit(d => { d.turbulence.kind = kind; })} />
        {S('turbulence', 'strength', 'Strength')}{S('turbulence', 'scale', 'Scale')}{S('turbulence', 'speed', 'Speed')}{S('turbulence', 'detail', 'Detail (octaves)', 1)}
        <Section title="Shaping" open={false}>
          {S('turbulence', 'persistence', 'Persistence')}{S('turbulence', 'lacunarity', 'Lacunarity')}{S('turbulence', 'warp', 'Warp')}{S('turbulence', 'warpScale', 'Warp scale')}
          {S('turbulence', 'warpDirection', 'Warp direction', 1, '°')}{S('turbulence', 'rotation', 'Rotation', 1, '°')}{S('turbulence', 'evolution', 'Evolution')}{S('turbulence', 'angle', 'Direction (directional / aligned)', 1, '°')}
        </Section>
        <Section title="Local region" open={false}>
          {S('turbulence', 'influence', 'Influence')}{S('turbulence', 'localRadius', 'Radius (0 = everywhere)')}{S('turbulence', 'localX', 'Centre X')}{S('turbulence', 'localY', 'Centre Y')}
        </Section>
        <p className="hint">Turbulence is its own layer: it displaces the picture directly and works with or without any flow source. Detail is capped by the quality mode.</p>
      </>}
    </Section>
  </div>;
}

/* ───────────── pointer / touch interaction ───────────── */

export function PointerTab({ editor }: { editor: MotionEditor }) {
  const { config, edit, replace } = editor;
  const S = (field: string, label: string, step = 0.01, unit?: string) => <Slider editor={editor} group="interaction" field={field} label={label} step={step} {...(unit ? { unit } : {})} />;
  return <div data-testid="motion-pointer-tab">
    <Section title="Pointer & touch" aside={config.interaction.enabled ? labelOf(config.interaction.response) : 'Off'}>
      <Toggle editor={editor} group="interaction" field="enabled" label="React to the pointer" testId="motion-pointer-enabled" />
      <div className="gs-chip-row" aria-label="Pointer profiles">
        {INTERACTION_PRESETS.filter(p => p.id !== 'custom').map(preset => <button key={preset.id} type="button" className={`chip ${config.interaction.profile === preset.id ? 'active' : ''}`} title={preset.description} onClick={() => replace(preset.apply(config))} data-testid={`motion-pointer-profile-${preset.id}`}>{preset.label}</button>)}
      </div>
      {config.interaction.enabled && <>
        <Select id="motion-pointer-response" label="Response" value={config.interaction.response} options={INTERACTION_RESPONSES.map(id => ({ id, label: labelOf(id) }))} onChange={response => edit(d => { d.interaction.response = response; d.interaction.profile = 'custom'; })} />
        <Select id="motion-pointer-falloff" label="Falloff" value={config.interaction.falloff} options={FALLOFFS.map(id => ({ id, label: labelOf(id) }))} onChange={falloff => edit(d => { d.interaction.falloff = falloff; })} />
        {S('radius', 'Radius')}{S('strength', 'Strength')}{S('speed', 'Speed')}{S('maxDisplacement', 'Max displacement')}
        <Toggle editor={editor} group="interaction" field="clickImpulse" label="Press / tap sends an impulse" />
        <Toggle editor={editor} group="interaction" field="trail" label="Leave a trail behind the pointer" />
        <Section title="Feel" open={false}>
          {S('velocitySensitivity', 'Velocity sensitivity')}{S('accelerationSensitivity', 'Acceleration sensitivity')}{S('smoothing', 'Smoothing')}{S('lag', 'Lag')}
          {S('inertia', 'Inertia')}{S('drag', 'Drag')}{S('persistence', 'Persistence')}{S('directionResponse', 'Direction response')}{S('frequency', 'Frequency (ripple / orbit)')}
        </Section>
        <p className="hint">Mouse and touch feed the same pointer; a second finger adds a second influence. Everything the pointer does is on top of the flow field, never instead of it.</p>
      </>}
    </Section>
  </div>;
}

/* ───────────── modulation ───────────── */

function ModulatorPlot({ mod }: { mod: Modulator }) {
  const points = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) pts.push(`${(i / 120 * 240).toFixed(1)},${(35 - Math.max(-1.3, Math.min(1.3, modulatorShape(mod, i / 120 * 6))) * 26).toFixed(1)}`);
    return pts.join(' ');
  }, [mod]);
  return <svg className="gs-mot-plot" viewBox="0 0 240 70" role="img" aria-label="Modulator waveform over six seconds">
    <line x1="0" y1="35" x2="240" y2="35" className="axis" /><polyline points={points} className="curve" /><text x="236" y="68" className="label" textAnchor="end">6 s</text>
  </svg>;
}

export function ModulationTab({ editor }: { editor: MotionEditor }) {
  const { config, edit, announce } = editor;
  const [open, setOpen] = useState<string | null>(config.modulators[0]?.id ?? null);
  const targets = (current: string) => {
    const options: { id: string; label: string; group: string }[] = MOD_TARGETS.map(target => ({ id: target.id, label: target.label, group: 'Engine' }));
    for (const src of config.sources) for (const prop of SOURCE_MOD_PROPS) options.push({ id: `src:${src.id}:${prop}`, label: `${src.name} · ${SOURCE_MOD_KIND[prop].label}`, group: 'Flow sources' });
    if (!options.some(option => option.id === current)) options.push({ id: current, label: `${current} (source removed)`, group: 'Other' });
    return options;
  };
  const patch = (id: string, change: (m: Modulator) => void, coalesce?: string) => edit(d => { const m = d.modulators.find(item => item.id === id); if (m) change(m); }, coalesce);
  const add = () => {
    if (config.modulators.length >= MOTION_LIMITS.modulators) { announce(`Limit of ${MOTION_LIMITS.modulators} modulators reached.`); return; }
    const created = newModulator({ name: `Modulator ${config.modulators.length + 1}` }, config.modulators.map(m => m.id));
    edit(d => { d.modulators.push(created); d.enabled = true; });
    setOpen(created.id);
  };
  const duplicate = (id: string) => {
    const found = config.modulators.find(m => m.id === id);
    if (!found || config.modulators.length >= MOTION_LIMITS.modulators) return;
    const fresh = newModulator({}, config.modulators.map(m => m.id));
    const copy: Modulator = { ...(JSON.parse(JSON.stringify(found)) as Modulator), id: fresh.id, name: `${found.name} copy`.slice(0, 40) };
    edit(d => { d.modulators.push(copy); });
    setOpen(copy.id);
  };
  const R = MOTION_RANGE.modulator;
  const D = newModulator();
  return <div data-testid="motion-modulation-tab">
    <Section title="Modulators" aside={`${config.modulators.length}/${MOTION_LIMITS.modulators}`}>
      <p className="hint">A modulator is a waveform that drives one property over time: flow strength, direction, turbulence, zoom, colour and more.</p>
      {config.modulators.map((mod, index) => <div key={mod.id} className={`gs-mot-mod ${open === mod.id ? 'open' : ''}`}>
        <div className="gs-mot-row">
          <input type="checkbox" checked={mod.enabled} aria-label={`Enable ${mod.name}`} onChange={event => patch(mod.id, m => { m.enabled = event.target.checked; })} />
          <button type="button" className="gs-mot-pick" aria-expanded={open === mod.id} onClick={() => setOpen(open === mod.id ? null : mod.id)} data-testid={`motion-mod-${index}`}><b>{mod.name}</b><span>{labelOf(mod.shape)} → {mod.target.startsWith('src:') ? 'a source' : (MOD_TARGETS.find(t => t.id === mod.target)?.label ?? mod.target)}</span></button>
          <button type="button" className="gs-mot-icon" aria-label={`Duplicate ${mod.name}`} onClick={() => duplicate(mod.id)}><Copy size={13} /></button>
          <button type="button" className="gs-mot-icon danger" aria-label={`Delete ${mod.name}`} onClick={() => edit(d => { d.modulators = d.modulators.filter(m => m.id !== mod.id); })} data-testid={`motion-mod-del-${index}`}><Trash2 size={13} /></button>
        </div>
        {open === mod.id && <div className="gs-mot-mod-body">
          <ModulatorPlot mod={mod} />
          <Select id={`motion-mod-shape-${index}`} label="Shape" value={mod.shape} options={MOD_SHAPES.map(id => ({ id, label: labelOf(id) }))} onChange={shape => patch(mod.id, m => { m.shape = shape; })} />
          <Select id={`motion-mod-target-${index}`} label="Drives" value={mod.target} groups options={targets(mod.target)} onChange={target => patch(mod.id, m => { m.target = target; })} />
          <Select id={`motion-mod-blend-${index}`} label="Combine" value={mod.blend} options={MOD_BLENDS.map(id => ({ id, label: labelOf(id) }))} onChange={blend => patch(mod.id, m => { m.blend = blend; })} />
          <Num label="Amount" value={mod.amplitude} min={R.amplitude[0]} max={R.amplitude[1]} step={0.01} def={D.amplitude} onChange={v => patch(mod.id, m => { m.amplitude = v; }, `motion-mod-${mod.id}`)} />
          <Num label="Rate" value={mod.speed} min={R.speed[0]} max={R.speed[1]} step={0.01} def={D.speed} unit="×" onChange={v => patch(mod.id, m => { m.speed = v; }, `motion-mod-${mod.id}`)} />
          <Num label="Frequency" value={mod.frequency} min={R.frequency[0]} max={R.frequency[1]} step={0.01} def={D.frequency} unit="Hz" onChange={v => patch(mod.id, m => { m.frequency = v; }, `motion-mod-${mod.id}`)} />
          <Section title="Shaping" open={false}>
            <Num label="Phase" value={mod.phase} min={R.phase[0]} max={R.phase[1]} step={1} def={0} unit="°" onChange={v => patch(mod.id, m => { m.phase = v; }, `motion-mod-${mod.id}`)} />
            <Num label="Offset" value={mod.offset} min={R.offset[0]} max={R.offset[1]} step={0.01} def={0} onChange={v => patch(mod.id, m => { m.offset = v; }, `motion-mod-${mod.id}`)} />
            <Num label="Minimum" value={mod.min} min={R.min[0]} max={R.min[1]} step={0.01} def={D.min} onChange={v => patch(mod.id, m => { m.min = v; }, `motion-mod-${mod.id}`)} />
            <Num label="Maximum" value={mod.max} min={R.max[0]} max={R.max[1]} step={0.01} def={D.max} onChange={v => patch(mod.id, m => { m.max = v; }, `motion-mod-${mod.id}`)} />
            <Num label="Smoothness" value={mod.smoothness} min={R.smoothness[0]} max={R.smoothness[1]} step={0.01} def={D.smoothness} onChange={v => patch(mod.id, m => { m.smoothness = v; }, `motion-mod-${mod.id}`)} />
            <Seed label="Seed (noise / random)" value={mod.seed} onChange={v => patch(mod.id, m => { m.seed = v; })} />
          </Section>
          {mod.shape === 'curve' && <div className="gs-field">
            <span className="field-label">Custom curve</span>
            <div className="gs-mot-curve">
              {mod.curve.map((value, k) => <input key={k} type="range" min={0} max={1} step={0.01} value={value} aria-label={`Curve point ${k + 1}`} onChange={event => patch(mod.id, m => { m.curve[k] = Number(event.target.value); }, `motion-curve-${mod.id}`)} />)}
            </div>
          </div>}
        </div>}
      </div>)}
      <button type="button" className="chip" onClick={add} disabled={config.modulators.length >= MOTION_LIMITS.modulators} data-testid="motion-mod-add"><Plus size={12} /> Add modulator</button>
    </Section>
  </div>;
}

/* ───────────── time ───────────── */

export function TimeTab({ editor }: { editor: MotionEditor }) {
  const { config, edit } = editor;
  return <div data-testid="motion-time-tab">
    <Section title="Time">
      <Slider editor={editor} group="time" field="scale" label="Time scale" unit="×" />
      <Slider editor={editor} group="time" field="offset" label="Start offset" step={0.5} unit="s" />
      <Select id="motion-time-loop" label="Loop" value={config.time.loop} options={LOOP_MODES.map(id => ({ id, label: id === 'pingpong' ? 'Ping-pong' : labelOf(id) }))} onChange={loop => edit(d => { d.time.loop = loop; })} />
      {config.time.loop !== 'none' && <Slider editor={editor} group="time" field="duration" label="Loop length" step={0.5} unit="s" />}
      <Switch label="Reverse" checked={config.time.reverse} onChange={reverse => edit(d => { d.time.reverse = reverse; })} testId="motion-time-reverse" />
      <Switch label="Freeze" checked={config.time.freeze} onChange={freeze => edit(d => { d.time.freeze = freeze; })} testId="motion-time-freeze" />
      <p className="hint">Freeze stops motion time where it is. Loop wraps motion time so a clip can repeat seamlessly; ping-pong plays forward and back.</p>
    </Section>
  </div>;
}

export { MOTION_DEFAULTS };
