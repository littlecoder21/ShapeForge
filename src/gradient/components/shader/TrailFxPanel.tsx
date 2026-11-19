import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, Paintbrush, Palette, Plus, X } from 'lucide-react';
import { Switch } from '../../../shared/controls';
import {
  TRAILFX_BLENDS, TRAILFX_FAMILIES, TRAILFX_KINDS, TRAILFX_KIND_MAP, TRAILFX_MAX_PASSES, TRAILFX_PRESETS, TRAILFX_PRESET_GROUPS, TRAILFX_PRESET_MAP, TRAILFX_STARTERS,
  applyPaletteToConfig, describeTrailFx, makePass, newPassId, paramVisible, recolorWithColorMap,
  type TrailFxBlend, type TrailFxConfig, type TrailFxKind, type TrailFxParamDef, type TrailFxPass,
} from '../../interactive/trailfx/model';
import { buildTrailFxFiles, buildTrailFxJson, parseTrailFxJson } from '../../interactive/trailfx/exportStandalone';
import { Num, Section, Select } from './parts';
import { useShader } from './context';
import ColorEditor from './TrailFxColors';

const GLYPH_SAMPLES = ['✦', '★', '♥', '❄', '✿', '♪', '●', '◆', '+', '01', '❀✿'];

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
  const showColors = !!def.colors && (pass.kind !== 'base' || pass.p.style === 9);
  const visible = def.params.filter(param => paramVisible(param, pass.p));
  const control = (param: TrailFxParamDef) => <div key={param.key} className="gs-tf-param">
    {param.options
      ? <Select id={`trailfx-${pass.id}-${param.key}`} label={param.label} value={String(Math.round(pass.p[param.key] ?? param.def))} options={param.options.map((label, i) => ({ id: String(i), label }))} onChange={value => setP(param.key, Number(value))} />
      : <Num label={param.label} value={pass.p[param.key] ?? param.def} min={param.min} max={param.max} step={param.step} def={param.def} {...(param.unit ? { unit: param.unit } : {})} onChange={value => setP(param.key, value)} />}
    {param.hint && <p className="hint">{param.hint}</p>}
  </div>;
  // controls that belong to no group come first; the rest sit in collapsible groups (the first one starts open)
  const loose = visible.filter(param => !param.group);
  const groups = [...new Set(visible.filter(param => param.group).map(param => param.group as string))];
  const glyphOn = !!def.text && Math.round(pass.p.shape ?? 0) === 12;
  return <Section title={`${index + 1}. ${def.icon} ${def.label}`} aside={pass.enabled ? 'On' : 'Off'} open={false} testId={`trailfx-pass-${pass.kind}`}>
    <p className="hint">{def.blurb}</p>
    <Switch label="Enabled" checked={pass.enabled} onChange={enabled => onChange({ ...pass, enabled })} />
    {loose.map(control)}
    {showColors && def.colors && <ColorEditor
      colors={pass.colors} min={def.colors.min} max={def.colors.max} label={def.colors.label} idBase={`trailfx-${pass.id}`}
      sorted={pass.kind === 'gradmap'} onChange={(colors, coalesce) => onChange({ ...pass, colors }, coalesce)}
    />}
    {groups.map((name, i) => <details className="gs-tf-group" key={name} open={i === 0} data-testid={`trailfx-group-${pass.kind}-${name.toLowerCase().replace(/\W+/g, '-')}`}>
      <summary><b>{name}</b></summary>
      <div className="gs-tf-group-body">
        {visible.filter(param => param.group === name).map(control)}
        {name === 'Shape' && glyphOn && def.text && <div className="gs-field">
          <label className="field-label" htmlFor={`trailfx-${pass.id}-text`}>{def.text.label}</label>
          <input id={`trailfx-${pass.id}-text`} className="gs-tf-text" type="text" value={pass.text ?? def.text.def} maxLength={24} spellCheck={false} onChange={event => onChange({ ...pass, text: event.target.value }, `${pass.id}-text`)} data-testid={`trailfx-${pass.id}-text`} />
          <div className="gs-chip-row">{GLYPH_SAMPLES.map(sample => <button key={sample} type="button" className="chip" onClick={() => onChange({ ...pass, text: sample })}>{sample}</button>)}</div>
          <p className="hint">Up to 12 characters or emoji; each particle picks one of them. Emoji keep their own colours when “Tint glyphs” is 0.</p>
        </div>}
      </div>
    </details>)}
    {pass.kind !== 'base' && showColors && def.colors && def.colors.max > 1 && <p className="hint">The palette is read from first to last colour, so order matters.</p>}
    <div className="gs-chip-row">
      <button type="button" className="btn small" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move pass earlier"><ArrowUp />Earlier</button>
      <button type="button" className="btn small" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move pass later"><ArrowDown />Later</button>
      <button type="button" className="btn small" onClick={onDuplicate} disabled={total >= TRAILFX_MAX_PASSES}><Copy />Duplicate</button>
      <button type="button" className="btn small" onClick={onRemove}><X />Remove</button>
    </div>
  </Section>;
}

/** The Trail FX builder: pick a look, recolour it, then edit the pass stack, or build a completely different kind of effect
 *  (particles, ribbons, colour maps) from scratch. */
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
  const startFrom = (id: string) => { const starter = TRAILFX_STARTERS.find(item => item.id === id); if (starter) commit({ ...starter.build(), enabled: true }); };
  const setPalette = (palette: string[], coalesce?: string) => withConfig(current => ({ ...current, palette }), coalesce);
  const applyEverywhere = () => { withConfig(current => ({ ...applyPaletteToConfig(current, current.palette), ...edited(current) })); announce('Palette applied to every pass that uses colours.'); };
  const recolour = () => {
    if (!config) return;
    const next = recolorWithColorMap(config, config.palette);
    if (next === config) { announce(`A Trail FX stack can hold up to ${TRAILFX_MAX_PASSES} passes.`); return; }
    commit({ ...next, ...edited(next) });
    announce('Colour map set to your palette: it recolours everything above it.');
  };
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
      <p className="hint">An effect that follows the pointer. Choose a look, or build your own from different kinds of pass: a liquid trail that bends a picture, a particle system (any shape, motion and trigger: move, press, click, ambient, a chain that follows you), or a ribbon. Passes stack, so you can mix them. It sits over the shader gradient.</p>
      <Switch label="Enable Trail FX" checked={!!config?.enabled} onChange={enabled => config ? commit({ ...config, enabled }) : enabled && choosePreset('chrome-trail')} testId="trailfx-enabled" />
      <div className="gs-chip-row" role="tablist" aria-label="Trail FX groups">
        {TRAILFX_PRESET_GROUPS.map(item => <button key={item} type="button" role="tab" aria-selected={group === item} className={`chip ${group === item ? 'active' : ''}`} onClick={() => setGroup(item)}>{item}</button>)}
      </div>
      <div className="gs-preset-grid" data-testid="trailfx-presets">
        {TRAILFX_PRESETS.filter(preset => preset.group === group).map(preset => <button key={preset.id} type="button" className={`gs-preset-card ${config?.presetId === preset.id ? 'active' : ''}`} onClick={() => choosePreset(preset.id)} title={preset.description} aria-pressed={config?.presetId === preset.id} data-testid={`trailfx-preset-${preset.id}`}><b>{preset.label}</b></button>)}
      </div>
      <p className="hint">{config ? (TRAILFX_PRESET_MAP[config.presetId]?.description ?? `${config.name}: a custom stack of ${config.passes.length} passes.`) : 'Pick a look to start, or build one from scratch.'}</p>
      <span className="field-label">Build from scratch</span>
      <div className="gs-chip-row" data-testid="trailfx-starters">
        {TRAILFX_STARTERS.map(starter => <button key={starter.id} type="button" className="btn small" title={starter.blurb} onClick={() => startFrom(starter.id)} data-testid={`trailfx-start-${starter.id}`}><Plus />{starter.label}</button>)}
      </div>
    </Section>

    {config && <>
      <Section title="Colours" aside={`${config.palette.length} colours`} open={false} testId="trailfx-colours">
        <p className="hint">Choose a colour combination once, then use it anywhere. Each pass also has its own colours inside its card.</p>
        <ColorEditor colors={config.palette} min={2} max={8} label="Your palette" idBase="trailfx-palette" onChange={setPalette} />
        <div className="gs-chip-row">
          <button type="button" className="btn small" onClick={applyEverywhere} data-testid="trailfx-apply-palette" title="Copies the palette into every particle, ribbon, colour map and gradient pass"><Palette />Apply to every pass</button>
          <button type="button" className="btn small" onClick={recolour} data-testid="trailfx-recolour" title="Adds (or updates) a Colour map pass that recolours everything above it"><Paintbrush />Recolour the whole effect</button>
        </div>
        <p className="hint">“Apply to every pass” fills the colour lists of particles, ribbons, colour maps and custom gradients. “Recolour the whole effect” adds a Colour map near the end of the stack, which maps dark to light through your palette; it works on any look, including the silver Chrome trail.</p>
      </Section>

      <Section title="Look" open={false}>
        <Num label="Opacity over the gradient" value={config.opacity} min={0} max={1} def={0.5} onChange={opacity => withConfig(current => ({ ...current, opacity }), 'opacity')} />
        <Select id="trailfx-blend" label="Blend with the gradient" value={config.blend} options={TRAILFX_BLENDS} onChange={(blend: TrailFxBlend) => withConfig(current => ({ ...current, blend }))} />
        <Num label="Resolution" value={config.scale} min={0.4} max={1} def={1} unit="×" onChange={scale => withConfig(current => ({ ...current, scale }), 'scale')} />
        <p className="hint">The effect lowers its own resolution on slow GPUs. Touch follows the “Touch interaction” switch in Pointer &amp; touch. Particle and ribbon looks use full opacity; the original Chrome look uses 50%.</p>
      </Section>

      <Section title="Passes" aside={`${config.passes.length} / ${TRAILFX_MAX_PASSES}`} testId="trailfx-passes">
        <p className="hint">Passes run top to bottom and each reads the one before it. Particles and ribbons draw into their own layer and then meet the picture before them: over it, added to it, revealing it, or bending it like a lens. Reveal and Directional blur each keep their own trail; Light rays reads the picture before it as well.</p>
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
          {TRAILFX_FAMILIES.map(family => <div className="gs-add-group" key={family}>
            <h4>{family}</h4>
            <div className="gs-chip-row">{TRAILFX_KINDS.filter(kind => kind.family === family).map(kind => <button key={kind.id} type="button" className="chip" title={kind.blurb} onClick={() => addPass(kind.id)} data-testid={`trailfx-add-${kind.id}`}>{kind.icon} {kind.label}</button>)}</div>
          </div>)}
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
