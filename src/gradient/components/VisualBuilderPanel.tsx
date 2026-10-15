import { useState } from 'react';
import { RotateCcw, Shuffle } from 'lucide-react';
import { Section, Switch, ValueControl } from '../../shared/controls';
import { BLEND_MODES } from '../engine/model';
import { VISUAL_BUILDERS, buildVisual, mergeVisualConfig, updateVisualColor, visualBuilder, visualConfig, visualSeed, type VisualBuilderId, type VisualConfig } from '../engine/visualBuilders';
import { ColorInput, useStudio } from './ui';

export default function VisualBuilderPanel({ id }: { id: VisualBuilderId }) {
  const builder = visualBuilder(id);
  const [config, setConfig] = useState<VisualConfig>(() => visualConfig(id));
  const [activePreset, setActivePreset] = useState('');
  const { store, announce } = useStudio();
  const update = (patch: Partial<VisualConfig>) => {
    setActivePreset('');
    setConfig(current => mergeVisualConfig(current, patch));
  };
  const applyPreset = (presetId: string) => {
    const preset = builder.presets.find(item => item.id === presetId);
    if (!preset) return;
    setActivePreset(presetId);
    setConfig(current => mergeVisualConfig(mergeVisualConfig(builder.defaults, preset.values), { seed: current.seed }));
  };
  const build = (mode: 'replace' | 'add') => {
    const layers = buildVisual(id, config);
    store.update(project => ({ ...project, layers: mode === 'replace' ? layers : [...layers, ...project.layers] }));
    const selected = layers.find(layer => layer.type !== 'noise') ?? layers[0];
    if (selected) store.select(selected.id);
    announce(`${mode === 'replace' ? 'Built' : 'Added'} ${builder.name} · ${layers.length} editable layers`);
  };
  const seed = visualSeed(config);
  const palette = Array.isArray(config.palette) ? config.palette : [];
  const background = typeof config.background === 'string' ? config.background : '#080b18';

  return <div data-testid={`${id}-builder`}>
    <p className="hint">{builder.description}</p>
    <Section title={`${builder.name} presets`}>
      <div className="gs-chips wrap" role="radiogroup" aria-label={`${builder.name} presets`}>
        {builder.presets.map(preset => <button key={preset.id} type="button" role="radio" aria-checked={activePreset === preset.id} className={`chip ${activePreset === preset.id ? 'active' : ''}`} onClick={() => applyPreset(preset.id)} data-testid={`${id}-preset-${preset.id}`}>{preset.name}</button>)}
      </div>
    </Section>
    <Section title="Color & background">
      {palette.map((color, index) => <ColorInput key={index} color={color} alpha={1} showAlpha={false} onChange={value => { setActivePreset(''); setConfig(current => updateVisualColor(current, index, value)); }} label={`${builder.name} color ${index + 1}`} testId={`${id}-color-${index}`} />)}
      <div className="field-label">Preview background</div>
      <ColorInput color={background} alpha={1} showAlpha={false} onChange={value => update({ background: value })} label={`${builder.name} background`} testId={`${id}-background`} />
      <Switch label="Transparent background" checked={config.transparent === true} onChange={transparent => update({ transparent })} testId={`${id}-transparent`} />
    </Section>
    <Section title="Effect controls">
      {builder.controls.map(control => {
        const value = config[control.key];
        return control.options
          ? <label key={control.key} className="field-label">{control.label}<select className="generate-select" value={typeof value === 'string' ? value : control.options[0].id} onChange={event => update({ [control.key]: event.target.value })} data-testid={`${id}-${control.key}`}>{control.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          : <ValueControl key={control.key} label={control.label} value={typeof value === 'number' ? value : control.min} min={control.min} max={control.max} step={control.step ?? 1} unit={control.unit} onChange={nextValue => update({ [control.key]: nextValue })} testId={`${id}-${control.key}`} />;
      })}
      <ValueControl label="Overall layer opacity" value={typeof config.layerOpacity === 'number' ? config.layerOpacity : 100} min={0} max={100} unit="%" onChange={layerOpacity => update({ layerOpacity })} testId={`${id}-layer-opacity`} />
      <label className="field-label">Effect blend mode<select className="generate-select" value={typeof config.blendMode === 'string' ? config.blendMode : 'auto'} onChange={event => update({ blendMode: event.target.value })} data-testid={`${id}-blend-mode`}>
        <option value="auto">Builder default</option>
        {BLEND_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
      </select></label>
    </Section>
    <Section title="Motion & reproducibility">
      <Switch label="Animate generated layers" checked={config.animate !== false} onChange={animate => update({ animate })} testId={`${id}-animate`} />
      <ValueControl label="Animation speed" value={typeof config.speed === 'number' ? config.speed : 48} min={0} max={100} unit="%" onChange={speed => update({ speed })} testId={`${id}-speed`} />
      <div className="seed-row">
        <ValueControl label="Seed" value={seed} min={1} max={999} onChange={value => update({ seed: value })} testId={`${id}-seed`} />
        <button type="button" className="btn" aria-label={`Regenerate ${builder.name} seed`} onClick={() => update({ seed: seed >= 999 ? 1 : seed + 1 })} data-testid={`${id}-randomize`}><Shuffle /></button>
      </div>
      <button type="button" className="btn wide" onClick={() => { setConfig(visualConfig(id)); setActivePreset(''); }} data-testid={`${id}-reset`}><RotateCcw />Reset defaults</button>
    </Section>
    <div className="gs-btnrow">
      <button type="button" className="btn primary" onClick={() => build('replace')} data-testid={`${id}-build`}>Build {builder.name.toLowerCase()}</button>
      <button type="button" className="btn" onClick={() => build('add')} data-testid={`${id}-add`}>Add as layers</button>
    </div>
    <p className="hint">Generated layers and their effects, textures, blend modes, opacity, animation, and transparency are included in project JSON, layered CSS, SVG, and PNG output. Single-element CSS may be approximate for layered designs. Procedural distortions are visual approximations, not physical simulations.</p>
  </div>;
}

export function AdvancedBuilderIndex() {
  return VISUAL_BUILDERS.map(builder => ({ id: builder.id, label: builder.name }));
}
