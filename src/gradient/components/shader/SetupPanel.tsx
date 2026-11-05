import { useEffect, useState } from 'react';
import { Copy, RotateCcw } from 'lucide-react';
import { Switch } from '../../../shared/controls';
import { BLEND_MODES, DEFAULT_LAYER_MASK, KIND_LABEL, type LayerMask } from '../../engine/model';
import { INTERACTIVE_PRESETS } from '../../interactive/presets';
import { rigFromLegacyMode } from '../../interactive/rig/presets';
import { DEFAULT_INTERACTIVE_SETTINGS, normalizeInteractiveSettings, type InteractiveSettings, type ShaderLayerColorBlend } from '../../interactive/types';
import { useStudio } from '../ui';
import { Num, Section, Select } from './parts';
import { useShader } from './context';

interface SavedShaderPreset { id: string; name: string; settings: InteractiveSettings }
const CUSTOM_PRESETS_KEY = 'shapeforge.interactive-presets.v1';
const LAYER_COLOR_BLEND_MODES: { id: ShaderLayerColorBlend; label: string }[] = [
  { id: 'mix', label: 'Mix' }, { id: 'multiply', label: 'Multiply' }, { id: 'screen', label: 'Screen' }, { id: 'overlay', label: 'Overlay' }, { id: 'add', label: 'Add' },
];

/** Everything about how a layer takes part in the shader: switches, backend, blending, boundary, copy and saved looks. */
export default function SetupPanel() {
  const { store } = useStudio();
  const { settings, update, primary, targets, layers, patchLayers, announce } = useShader();
  const [customName, setCustomName] = useState('');
  const [customPresets, setCustomPresets] = useState<SavedShaderPreset[]>([]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_PRESETS_KEY);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new Error('Saved shader presets are not a list.');
      setCustomPresets(parsed.filter((item): item is SavedShaderPreset =>
        !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' && !!item.settings,
      ).map(item => ({ ...item, settings: normalizeInteractiveSettings(item.settings) })));
    } catch (error) {
      announce(error instanceof Error ? `Could not load shader presets: ${error.message}` : 'Could not load saved shader presets.');
    }
  }, [announce]);

  if (!primary) return null;
  const shader = primary.shader;
  const style = shader?.style ?? settings.style;
  const supportsMix = (primary.type === 'linear' || primary.type === 'radial' || primary.type === 'conic') && !primary.repeating;
  const mixCandidates = layers.filter(candidate => candidate.visible && candidate.id !== primary.id);
  const targetIds = targets.map(layer => layer.id);
  const updateMask = (patch: Partial<LayerMask>) => store.updateLayer(primary.id, current => ({ ...current, mask: { ...current.mask, ...patch } }));

  const applyLook = (look: { settings: Partial<InteractiveSettings> }) => {
    const next: Partial<InteractiveSettings> = { ...look.settings, enabled: true };
    if (look.settings.pointerMode && !('rig' in look.settings)) next.rig = rigFromLegacyMode(look.settings.pointerMode);
    update(next);
    patchLayers({ enabled: true, style: look.settings.style ?? settings.style, styleParams: undefined });
  };
  const persist = (next: SavedShaderPreset[], success?: string) => {
    try { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next)); setCustomPresets(next); if (success) announce(success); }
    catch (error) { announce(error instanceof Error ? `Could not save shader preset: ${error.message}` : 'Could not save shader preset.'); }
  };
  const saveCustom = () => {
    const name = customName.trim();
    if (!name) { announce('Enter a name for the shader preset.'); return; }
    const saved = { ...settings, style };
    persist([...customPresets.filter(item => item.name.toLocaleLowerCase() !== name.toLocaleLowerCase()), { id: `shader-${Date.now().toString(36)}`, name, settings: saved }], `Saved shader preset “${name}”`);
    setCustomName('');
  };
  const copyToSelected = () => {
    const others = targetIds.filter(id => id !== primary.id);
    if (!others.length) { announce('Tick other layers first, then copy the highlighted layer’s look to them.'); return; }
    patchLayers({ enabled: true, style, ...(shader?.styleParams ? { styleParams: shader.styleParams } : { styleParams: undefined }), controls: shader?.controls, interact: shader?.interact ?? true, reaction: shader?.reaction ?? 1 }, others);
    announce(`Copied style, motion and reaction to ${others.length} layer${others.length === 1 ? '' : 's'}.`);
  };

  return <div data-testid="shader-panel-setup">
    <Section title={primary.name || KIND_LABEL[primary.type]} aside={targets.length > 1 ? `+${targets.length - 1} selected` : undefined}>
      <Switch label="Shader layer" checked={!!shader?.enabled} onChange={enabled => patchLayers({ enabled })} testId="shader-layer-enabled" />
      <p className="hint">{primary.type === 'mesh'
        ? 'Mesh point colours and positions drive this layer’s shader colour field.'
        : 'This layer’s colour stops and gradient shape drive its shader. Every shader layer keeps its own colours and shape.'}</p>
      <Switch label="Reacts to pointer & touch" checked={shader?.interact !== false} onChange={interact => patchLayers({ interact })} testId="shader-layer-interact" />
      <Num label="Reaction strength" value={shader?.reaction ?? 1} min={-1.5} max={2} def={1} unit="×" onChange={reaction => patchLayers({ reaction }, undefined, 'reaction')} testId="shader-layer-reaction" />
      <p className="hint">Below 0 the layer reacts in the opposite direction. Give a back layer 0.4× and a front layer −0.6× for instant parallax.</p>
      {targets.length > 1 && <button type="button" className="btn wide" onClick={copyToSelected} data-testid="shader-copy-selected"><Copy />Copy this look to the selected layers</button>}
    </Section>

    <Section title="Renderer">
      <Select id="shader-render-backend" label="Renderer backend" value={settings.renderBackend} options={[{ id: 'css', label: 'CSS renderer' }, { id: 'webgl', label: 'WebGL renderer (CSS fallback)' }, { id: 'overlay', label: 'CSS + WebGL overlay' }]} onChange={renderBackend => update({ renderBackend })} />
      {supportsMix && <>
        <Num label="CSS / shader mix" value={settings.shaderMix} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.shaderMix} onChange={shaderMix => update({ shaderMix }, 'shader-mix')} testId="shader-mix" />
        <p className="hint">0 keeps the CSS gradient shape and stop ramp; 1 uses the full animated shader.</p>
      </>}
      <div className="gs-field">
        <label className="field-label" htmlFor="shader-pixel-blend">Rendered pixel blend</label>
        <select id="shader-pixel-blend" className="generate-select" value={primary.blend} onChange={event => targetIds.forEach(id => store.updateLayer(id, { blend: event.target.value as typeof primary.blend }))} data-testid="shader-pixel-blend">
          {BLEND_MODES.map(mode => <option key={mode} value={mode}>{mode.replace(/-/g, ' ')}</option>)}
        </select>
      </div>
    </Section>

    <Section title="Cross-layer colour flow" open={!!shader?.mixLayerId}>
      <div className="gs-field">
        <label className="field-label" htmlFor="shader-mix-layer">Mix colours from</label>
        <select id="shader-mix-layer" className="generate-select" value={shader?.mixLayerId ?? ''} onChange={event => patchLayers({ enabled: true, mixLayerId: event.target.value }, [primary.id])} disabled={!mixCandidates.length} data-testid="shader-mix-layer">
          <option value="">No other layer</option>
          {mixCandidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name || KIND_LABEL[candidate.type]}</option>)}
        </select>
      </div>
      {!!shader?.mixLayerId && <>
        <Select<ShaderLayerColorBlend> id="shader-mix-mode" label="Colour blend" value={shader.mixMode ?? 'mix'} options={LAYER_COLOR_BLEND_MODES} onChange={mixMode => patchLayers({ mixMode }, [primary.id])} />
        <Num label="Cross-layer colour mix" value={shader.mixStrength ?? 0.5} min={0} max={1} def={0.5} onChange={mixStrength => patchLayers({ mixStrength }, [primary.id], 'mix-strength')} testId="shader-mix-strength" />
        <Num label="Colour flow speed" value={shader.mixSpeed ?? 0.35} min={0} max={2} def={0.35} unit="×" onChange={mixSpeed => patchLayers({ mixSpeed }, [primary.id], 'mix-speed')} testId="shader-mix-speed" />
      </>}
    </Section>

    <Section title="Shader boundary" open={primary.mask.enabled} testId="shader-shape">
      <Switch label="Custom shader boundary" checked={primary.mask.enabled} onChange={enabled => updateMask({ enabled })} testId="shader-shape-enabled" />
      {primary.mask.enabled && <>
        <Switch label="Curved boundary handles" checked={primary.mask.curved} onChange={curved => updateMask({ curved })} testId="shader-shape-curved" />
        <p className="hint">Choose Edit layer on the preview, then drag green corners and purple Bézier handles to shape the shader.</p>
        {primary.mask.curved && <button type="button" className="btn wide" onClick={() => updateMask({ controls: DEFAULT_LAYER_MASK.controls.map(point => ({ ...point })) as LayerMask['controls'] })} data-testid="shader-shape-reset-curves"><RotateCcw />Reset curve handles</button>}
        <button type="button" className="btn wide" onClick={() => updateMask({
          ...DEFAULT_LAYER_MASK,
          corners: DEFAULT_LAYER_MASK.corners.map(point => ({ ...point })) as LayerMask['corners'],
          controls: DEFAULT_LAYER_MASK.controls.map(point => ({ ...point })) as LayerMask['controls'],
        })} data-testid="shader-shape-reset"><RotateCcw />Reset shader boundary</button>
      </>}
    </Section>

    <Section title="Looks" aside={`${INTERACTIVE_PRESETS.length + customPresets.length}`} open={false}>
      <div className="gs-chip-row" role="group" aria-label="Shader presets">
        {INTERACTIVE_PRESETS.map(preset => <button key={preset.id} type="button" className="chip" title={preset.description} onClick={() => applyLook(preset)} data-testid={`shader-preset-${preset.id}`}>{preset.name}</button>)}
      </div>
      <label className="field-label" htmlFor="shader-preset-name">Save current settings as a look</label>
      <div className="gs-interactive-custom-row">
        <input id="shader-preset-name" className="gs-custom-preset-name" value={customName} onChange={event => setCustomName(event.target.value)} placeholder="Look name" maxLength={48} />
        <button type="button" className="btn small" onClick={saveCustom} disabled={!customName.trim()} data-testid="shader-save-preset">Save</button>
      </div>
      {customPresets.map(preset => <div className="gs-interactive-saved" key={preset.id}>
        <button type="button" className="chip" onClick={() => applyLook(preset)} title="Apply saved shader settings">{preset.name}</button>
        <button type="button" className="link" onClick={() => persist(customPresets.filter(item => item.id !== preset.id))} aria-label={`Delete ${preset.name}`}>Remove</button>
      </div>)}
    </Section>
  </div>;
}
