import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, Plus, X } from 'lucide-react';
import { Switch } from '../../../shared/controls';
import {
  TRAILFX_BLENDS, TRAILFX_KINDS, TRAILFX_KIND_MAP, TRAILFX_MAX_PASSES, TRAILFX_PRESETS, TRAILFX_PRESET_GROUPS, TRAILFX_PRESET_MAP,
  describeTrailFx, makePass, newPassId, type TrailFxBlend, type TrailFxConfig, type TrailFxKind, type TrailFxPass,
} from '../../interactive/trailfx/model';
import { buildTrailFxFiles, buildTrailFxJson, parseTrailFxJson } from '../../interactive/trailfx/exportStandalone';
import { Num, Section, Select } from './parts';
import { useShader } from './context';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function PassCard({ pass, index, total, onChange, onMove, onRemove, onDuplicate }: {
  pass: TrailFxPass; index: number; total: number;
  onChange: (pass: TrailFxPass, coalesce?: string) => void;
  onMove: (direction: -1 | 1) => void; onRemove: () => void; onDuplicate: () => void;
}) {
  const def = TRAILFX_KIND_MAP[pass.kind];
  const setP = (key: string, value: number) => onChange({ ...pass, p: { ...pass.p, [key]: value } }, `${pass.id}-${key}`);
  const showColors = def.colors && (pass.kind !== 'base' || pass.p.style === 9);
  return <Section title={`${index + 1}. ${def.icon} ${def.label}`} aside={pass.enabled ? 'On' : 'Off'} open={false} testId={`trailfx-pass-${pass.kind}`}>
    <p className="hint">{def.blurb}</p>
    <Switch label="Enabled" checked={pass.enabled} onChange={enabled => onChange({ ...pass, enabled })} />
    {def.params.map(param => param.options
      ? <Select key={param.key} id={`trailfx-${pass.id}-${param.key}`} label={param.label} value={String(pass.p[param.key])} options={param.options.map((label, i) => ({ id: String(i), label }))} onChange={value => setP(param.key, Number(value))} />
      : (param.key === 'angle' && pass.p.style !== 9 ? null
        : <Num key={param.key} label={param.label} value={pass.p[param.key]} min={param.min} max={param.max} step={param.step} def={param.def} {...(param.unit ? { unit: param.unit } : {})} onChange={value => setP(param.key, value)} />))}
    {showColors && def.colors && <div className="gs-interaction-palette">
      {pass.colors.map((color, i) => <div className="gs-interaction-palette-row" key={`${pass.id}-c${i}`}>
        <label className="field-label" htmlFor={`trailfx-${pass.id}-c${i}`}>{def.colors!.label} {pass.colors.length > 1 ? i + 1 : ''}</label>
        <input id={`trailfx-${pass.id}-c${i}`} className="gs-interaction-color" type="color" value={color} onChange={event => onChange({ ...pass, colors: pass.colors.map((c, j) => j === i ? event.target.value : c) }, `${pass.id}-c${i}`)} />
      </div>)}
    </div>}
    <div className="gs-chip-row">
      <button type="button" className="btn small" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move pass earlier"><ArrowUp />Earlier</button>
      <button type="button" className="btn small" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move pass later"><ArrowDown />Later</button>
      <button type="button" className="btn small" onClick={onDuplicate} disabled={total >= TRAILFX_MAX_PASSES}><Copy />Duplicate</button>
      <button type="button" className="btn small" onClick={onRemove}><X />Remove</button>
    </div>
  </Section>;
}

/** The Trail FX builder: pick the original Chrome look or any variant, then edit the pass stack, or build one from scratch. */
export default function TrailFxPanel() {
  const { settings, update, announce } = useShader();
  const config = settings.trailFx ?? null;
  const [group, setGroup] = useState<string>(TRAILFX_PRESET_MAP[config?.presetId ?? '']?.group ?? TRAILFX_PRESET_GROUPS[0]);
  const [jsonText, setJsonText] = useState('');
  const [showJson, setShowJson] = useState(false);

  const commit = (next: TrailFxConfig, coalesce?: string) => update({ trailFx: next }, coalesce ? `trailfx-${coalesce}` : undefined);
  const edited = (current: TrailFxConfig): Pick<TrailFxConfig, 'presetId' | 'name'> => ({
    presetId: '', name: current.presetId ? `${TRAILFX_PRESET_MAP[current.presetId]?.label ?? 'Custom'} (edited)` : current.name,
  });
  const withConfig = (change: (current: TrailFxConfig) => TrailFxConfig, coalesce?: string) => { if (config) commit(change(config), coalesce); };
  const setPasses = (passes: TrailFxPass[], coalesce?: string) => withConfig(current => ({ ...current, ...edited(current), passes }), coalesce);
  const choosePreset = (id: string) => { const preset = TRAILFX_PRESET_MAP[id]; if (preset) commit({ ...preset.build(), enabled: true }); };
  const addPass = (kind: TrailFxKind) => {
    if (!config) return;
    if (config.passes.length >= TRAILFX_MAX_PASSES) { announce(`A Trail FX stack can hold up to ${TRAILFX_MAX_PASSES} passes.`); return; }
    setPasses([...config.passes, makePass(kind)]);
  };
  const fromScratch = () => commit({ enabled: true, presetId: '', name: 'Custom', opacity: 0.5, blend: 'normal', scale: 1, passes: [makePass('base'), makePass('reveal'), makePass('liquify')] });
  const files = () => buildTrailFxFiles(config!, { title: config!.name });
  const downloadAll = () => {
    if (!config) return;
    const all = files();
    const types: Record<string, string> = { 'index.html': 'text/html', 'style.css': 'text/css', 'script.js': 'text/javascript', 'effect.json': 'application/json' };
    (Object.keys(all) as (keyof typeof all)[]).forEach((name, i) => setTimeout(() => download(name, all[name], types[name]), i * 300));
    announce('Downloading index.html, style.css, script.js and effect.json.');
  };
  const copyJson = async () => {
    if (!config) return;
    const text = buildTrailFxJson(config);
    setJsonText(text);
    setShowJson(true);
    try { await navigator.clipboard.writeText(text); announce('effect.json copied.'); } catch { /* the text area still shows it */ }
  };
  const importJson = () => {
    try {
      const next = parseTrailFxJson(jsonText);
      if (!next) throw new Error('That JSON is not a Trail FX effect.');
      commit({ ...next, enabled: true, passes: next.passes.map(pass => ({ ...pass, id: newPassId() })) });
      announce(`Imported “${next.name}”.`);
    } catch (error) { announce(error instanceof Error ? error.message : 'Could not import that JSON.'); }
  };

  return <div data-testid="shader-panel-trailfx">
    <Section title="Trail FX" aside={config?.enabled ? describeTrailFx(config) : 'Off'} testId="trailfx-main">
      <p className="hint">A multi-pass effect driven by how fast you move: the pointer paints a trail, and a stack of passes turns it into metal, glass, colour or light. Slow movement barely marks; quick sweeps and flicks make it bloom. It sits over the shader gradient.</p>
      <Switch label="Enable Trail FX" checked={!!config?.enabled} onChange={enabled => config ? commit({ ...config, enabled }) : enabled && choosePreset('chrome-trail')} testId="trailfx-enabled" />
      <div className="gs-chip-row" role="tablist" aria-label="Trail FX groups">
        {TRAILFX_PRESET_GROUPS.map(item => <button key={item} type="button" role="tab" aria-selected={group === item} className={`chip ${group === item ? 'active' : ''}`} onClick={() => setGroup(item)}>{item}</button>)}
      </div>
      <div className="gs-preset-grid" data-testid="trailfx-presets">
        {TRAILFX_PRESETS.filter(preset => preset.group === group).map(preset => <button key={preset.id} type="button" className={`gs-preset-card ${config?.presetId === preset.id ? 'active' : ''}`} onClick={() => choosePreset(preset.id)} title={preset.description} aria-pressed={config?.presetId === preset.id} data-testid={`trailfx-preset-${preset.id}`}><b>{preset.label}</b></button>)}
      </div>
      <p className="hint">{config ? (TRAILFX_PRESET_MAP[config.presetId]?.description ?? `${config.name}: a custom stack of ${config.passes.length} passes.`) : 'Pick a look to start, or build one from scratch.'}</p>
      <button type="button" className="btn small" onClick={fromScratch} data-testid="trailfx-scratch"><Plus />Build from scratch</button>
    </Section>

    {config && <>
      <Section title="Look" open={false}>
        <Num label="Opacity over the gradient" value={config.opacity} min={0} max={1} def={0.5} onChange={opacity => withConfig(current => ({ ...current, opacity }), 'opacity')} />
        <Select id="trailfx-blend" label="Blend with the gradient" value={config.blend} options={TRAILFX_BLENDS} onChange={(blend: TrailFxBlend) => withConfig(current => ({ ...current, blend }))} />
        <Num label="Resolution" value={config.scale} min={0.4} max={1} def={1} unit="×" onChange={scale => withConfig(current => ({ ...current, scale }), 'scale')} />
        <p className="hint">The effect lowers its own resolution on slow GPUs. Touch follows the “Touch interaction” switch in Pointer &amp; touch.</p>
      </Section>

      <Section title="Passes" aside={`${config.passes.length} / ${TRAILFX_MAX_PASSES}`} testId="trailfx-passes">
        <p className="hint">Passes run top to bottom and each reads the one before it. Reveal and Directional blur each keep their own trail; Light rays reads the picture before it as well.</p>
        <div className="gs-trailfx-pass-list" data-testid="trailfx-pass-list">
          {config.passes.map((pass, index) => <PassCard
            key={pass.id}
            pass={pass}
            index={index}
            total={config.passes.length}
            onChange={(next, coalesce) => setPasses(config.passes.map((item, i) => i === index ? next : item), coalesce)}
            onRemove={() => setPasses(config.passes.filter((_, i) => i !== index))}
            onDuplicate={() => setPasses([...config.passes.slice(0, index + 1), { ...JSON.parse(JSON.stringify(pass)) as TrailFxPass, id: newPassId() }, ...config.passes.slice(index + 1)])}
            onMove={direction => {
              const next = [...config.passes];
              const target = index + direction;
              if (target < 0 || target >= next.length) return;
              [next[index], next[target]] = [next[target], next[index]];
              setPasses(next);
            }}
          />)}
        </div>
        <details className="gs-add-effect" data-testid="trailfx-add">
          <summary className="btn wide"><Plus />Add pass</summary>
          <div className="gs-chip-row">{TRAILFX_KINDS.map(kind => <button key={kind.id} type="button" className="chip" title={kind.blurb} onClick={() => addPass(kind.id)} data-testid={`trailfx-add-${kind.id}`}>{kind.icon} {kind.label}</button>)}</div>
        </details>
      </Section>

      <Section title="Export" open={false}>
        <p className="hint">Download the effect as four plain files (index.html, style.css, script.js, effect.json). Open the page through a local server. The same effect.json can be pasted back here.</p>
        <div className="gs-chip-row">
          <button type="button" className="btn small" onClick={downloadAll} data-testid="trailfx-download"><Download />Download 4 files</button>
          <button type="button" className="btn small" onClick={copyJson}><Copy />Copy effect.json</button>
          <button type="button" className="btn small" onClick={() => setShowJson(!showJson)}>{showJson ? 'Hide JSON' : 'Paste JSON'}</button>
        </div>
        {showJson && <>
          <textarea className="gs-json" value={jsonText} onChange={event => setJsonText(event.target.value)} rows={6} spellCheck={false} aria-label="Trail FX JSON" placeholder="Paste an effect.json exported from ShapeForge" />
          <button type="button" className="btn small" onClick={importJson} disabled={!jsonText.trim()}>Import</button>
        </>}
      </Section>
    </>}
  </div>;
}
