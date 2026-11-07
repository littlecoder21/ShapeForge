import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Copy, Plus, Trash2 } from 'lucide-react';
import { Switch } from '../../../shared/controls';
import {
  RIG_BLENDS, RIG_COLOR_MODES, RIG_DRIVE_CURVES, RIG_DRIVE_MODES, RIG_DRIVE_SOURCES, RIG_EFFECTS, RIG_EFFECT_MAP, RIG_FALLOFFS, RIG_MAX_DRIVES, RIG_SHAPES, RIG_SOURCES, RIG_SOURCE_MAP,
  makeDrive, makeRule, type RigDrive, type RigDriveTarget, type RigRule,
} from '../../interactive/rig/model';
import { FalloffChart, Num, Select } from './parts';

interface Props {
  rule: RigRule;
  index: number;
  total: number;
  initiallyOpen?: boolean;
  onChange: (rule: RigRule, coalesce?: string) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
}

const SHAPES_WITH_ASPECT = ['ellipse', 'box', 'diamond', 'capsule', 'roundBox'];

export default function RuleCard({ rule, index, total, initiallyOpen = false, onChange, onRemove, onDuplicate, onMove }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const def = RIG_EFFECT_MAP[rule.effect];
  const source = RIG_SOURCE_MAP[rule.source];
  const key = `${rule.id}`;
  const patch = (change: Partial<RigRule>, coalesce?: string) => onChange({ ...rule, ...change }, coalesce ? `${key}-${coalesce}` : undefined);
  const setParam = (slot: number, value: number) => {
    const p = [...rule.p] as RigRule['p'];
    p[slot] = value;
    patch({ p }, `p${slot}`);
  };
  const changeEffect = (effect: RigRule['effect']) => {
    const fresh = makeRule(effect);
    onChange({ ...rule, effect, amount: fresh.amount, p: fresh.p, drives: rule.drives.filter(drive => drive.target === 'amount' || drive.target === 'radius') });
  };
  const changeSource = (next: RigRule['source']) => {
    const fresh = makeRule(def.id, { source: next });
    patch({ source: next, sp1: fresh.sp1, sp2: fresh.sp2 });
  };
  const setDrive = (driveIndex: number, change: Partial<RigDrive>, coalesce?: string) => {
    const drives = rule.drives.map((item, i) => i === driveIndex ? { ...item, ...change } : item);
    patch({ drives }, coalesce);
  };
  const targetOptions: { id: RigDriveTarget; label: string }[] = [
    { id: 'amount', label: def.amount.label }, { id: 'radius', label: 'Radius' },
    ...def.params.map((param, slot) => ({ id: (['p1', 'p2', 'p3', 'p4'] as const)[slot], label: param.label })),
  ];
  const summary = `${source.label} · ${RIG_SHAPES.find(item => item.id === rule.shape)?.label ?? ''}${rule.drives.length ? ` · ${rule.drives.length} drive${rule.drives.length > 1 ? 's' : ''}` : ''}`;

  return <article className={`gs-rule ${rule.enabled ? '' : 'off'} ${open ? 'open' : ''}`} data-testid={`rig-rule-${index}`}>
    <header className="gs-rule-head">
      <button type="button" className="gs-rule-title" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="gs-rule-icon" aria-hidden="true">{def.icon}</span>
        <span><b>{def.label}</b><small>{summary}</small></span>
        <ChevronDown className="gs-rule-chevron" aria-hidden="true" />
      </button>
      <div className="gs-rule-tools">
        <button type="button" role="switch" aria-checked={rule.enabled} aria-label={`${def.label} enabled`} className={`gs-mini-switch ${rule.enabled ? 'on' : ''}`} onClick={() => patch({ enabled: !rule.enabled })}><i /></button>
        <button type="button" className="gs-icon-btn" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up"><ArrowUp /></button>
        <button type="button" className="gs-icon-btn" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move down"><ArrowDown /></button>
        <button type="button" className="gs-icon-btn" onClick={onDuplicate} disabled={total >= 8} aria-label="Duplicate"><Copy /></button>
        <button type="button" className="gs-icon-btn danger" onClick={onRemove} aria-label="Remove"><Trash2 /></button>
      </div>
    </header>
    {open && <div className="gs-rule-body">
      <Select id={`rig-effect-${index}`} label="Effect" value={rule.effect} groups options={RIG_EFFECTS.map(effect => ({ id: effect.id, label: effect.label, group: effect.group }))} onChange={changeEffect} />
      <p className="hint">{def.blurb}</p>
      <Num label={def.amount.label} value={rule.amount} min={def.amount.min} max={def.amount.max} def={def.amount.def} onChange={amount => patch({ amount }, 'amount')} testId={`rig-amount-${index}`} />
      <Num label="Radius" value={rule.radius} min={0.1} max={4} def={makeRule(rule.effect).radius} unit="×" onChange={radius => patch({ radius }, 'radius')} testId={`rig-radius-${index}`} />
      {def.params.map((param, slot) => <Num key={param.label} label={param.label} value={rule.p[slot]} min={param.min} max={param.max} step={param.step} def={param.def} {...(param.unit ? { unit: param.unit } : {})} onChange={value => setParam(slot, value)} testId={`rig-param-${index}-${slot}`} />)}

      <div className="gs-rule-group">
        <h4>Where</h4>
        <Select id={`rig-source-${index}`} label="Source" value={rule.source} options={RIG_SOURCES.map(item => ({ id: item.id, label: item.label }))} onChange={changeSource} />
        <p className="hint">{source.hint}</p>
        {source.params.map((param, slot) => <Num key={param.label} label={param.label} value={slot === 0 ? rule.sp1 : rule.sp2} min={param.min} max={param.max} step={param.step} def={param.def} {...(param.unit ? { unit: param.unit } : {})} onChange={value => patch(slot === 0 ? { sp1: value } : { sp2: value }, `sp${slot}`)} />)}
      </div>

      <div className="gs-rule-group">
        <h4>Shape & fade</h4>
        <Select id={`rig-shape-${index}`} label="Shape" value={rule.shape} options={RIG_SHAPES.map(item => ({ id: item.id, label: item.label }))} onChange={shape => patch({ shape })} />
        {SHAPES_WITH_ASPECT.includes(rule.shape) && <Num label="Aspect" value={rule.aspect} min={0.2} max={5} def={1} onChange={aspect => patch({ aspect }, 'aspect')} />}
        {rule.shape !== 'circle' && <Num label="Rotation" value={rule.rotation} min={-180} max={180} step={1} def={0} unit="°" onChange={rotation => patch({ rotation }, 'rotation')} />}
        {(rule.shape === 'star' || rule.shape === 'poly') && <Num label={rule.shape === 'star' ? 'Points' : 'Sides'} value={rule.shapeN} min={rule.shape === 'star' ? 2 : 3} max={12} step={1} def={5} onChange={shapeN => patch({ shapeN })} />}
        {rule.shape !== 'circle' && <Switch label="Face the direction of motion" checked={rule.follow} onChange={follow => patch({ follow })} />}
        <Num label="Organic edge" value={rule.edge} min={0} max={1} def={0} onChange={edge => patch({ edge }, 'edge')} />
        <Num label="Fade curve power" value={rule.fadePower} min={0.25} max={4} def={1} onChange={fadePower => patch({ fadePower }, 'fade-power')} testId={`rig-fade-power-${index}`} />
        <Num label="Fade distance" value={rule.fadeWidth} min={0.25} max={2} def={1} unit="×" onChange={fadeWidth => patch({ fadeWidth }, 'fade-width')} testId={`rig-fade-width-${index}`} />
        <div className="gs-falloff-row">
          <Select id={`rig-falloff-${index}`} label="Falloff" value={rule.falloff} options={RIG_FALLOFFS} onChange={falloff => patch({ falloff })} />
          <FalloffChart falloff={rule.falloff} />
        </div>
      </div>

      {(def.usesColor || def.usesBlend) && <div className="gs-rule-group">
        <h4>Colour</h4>
        {def.usesColor && <Select id={`rig-color-mode-${index}`} label="Colour from" value={rule.colorMode} options={RIG_COLOR_MODES} onChange={colorMode => patch({ colorMode })} />}
        {def.usesColor && rule.colorMode === 'custom' && <input type="color" className="gs-interaction-color" value={rule.color} onChange={event => patch({ color: event.target.value }, 'color')} aria-label="Custom colour" />}
        {def.usesBlend && <Select id={`rig-blend-${index}`} label="Blend" value={rule.blend} options={RIG_BLENDS} onChange={blend => patch({ blend })} />}
      </div>}

      <div className="gs-rule-group">
        <h4>Drives <small>what controls this live</small></h4>
        {rule.drives.map((drive, driveIndex) => {
          const driveDef = RIG_DRIVE_SOURCES.find(item => item.id === drive.source);
          return <div className="gs-drive" key={driveIndex}>
            <div className="gs-drive-line">
              <Select id={`rig-drive-source-${index}-${driveIndex}`} label="When" value={drive.source} groups options={RIG_DRIVE_SOURCES.map(item => ({ id: item.id, label: item.label, group: item.group }))} onChange={value => setDrive(driveIndex, { source: value })} />
              <Select id={`rig-drive-target-${index}-${driveIndex}`} label="Controls" value={targetOptions.some(item => item.id === drive.target) ? drive.target : 'amount'} options={targetOptions} onChange={value => setDrive(driveIndex, { target: value })} />
            </div>
            <div className="gs-drive-line">
              <Select id={`rig-drive-mode-${index}-${driveIndex}`} label="How" value={drive.mode} options={RIG_DRIVE_MODES} onChange={value => setDrive(driveIndex, { mode: value })} />
              <Select id={`rig-drive-curve-${index}-${driveIndex}`} label="Response" value={drive.curve} options={RIG_DRIVE_CURVES} onChange={value => setDrive(driveIndex, { curve: value })} />
            </div>
            <Num label="Depth" value={drive.depth} min={0} max={2} def={1} onChange={depth => setDrive(driveIndex, { depth }, `dd${driveIndex}`)} />
            {driveDef?.rate && <Num label={driveDef.rate} value={drive.rate} min={0.05} max={12} step={0.05} def={0.5} onChange={rate => setDrive(driveIndex, { rate }, `dr${driveIndex}`)} />}
            <button type="button" className="link" onClick={() => patch({ drives: rule.drives.filter((_, i) => i !== driveIndex) })}>Remove drive</button>
          </div>;
        })}
        <button type="button" className="btn small" disabled={rule.drives.length >= RIG_MAX_DRIVES} onClick={() => patch({ drives: [...rule.drives, makeDrive({ source: 'press' })] })} data-testid={`rig-add-drive-${index}`}><Plus />Add drive</button>
      </div>
    </div>}
  </article>;
}
