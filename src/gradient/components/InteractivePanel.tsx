import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Seg, Switch, ValueControl } from '../../shared/controls';
import { DEFAULT_INTERACTIVE_SETTINGS, normalizeInteractiveSettings, normalizeShaderLayer, type InteractiveSettings, type InteractiveStyle, type PointerMode, type ShaderQuality } from '../interactive/types';
import { INTERACTIVE_PRESETS } from '../interactive/presets';
import { useStore } from '../engine/store';
import { Empty, useStudio } from './ui';
import { DEFAULT_LAYER_MASK, KIND_LABEL, type LayerMask } from '../engine/model';

interface SavedShaderPreset { id: string; name: string; settings: InteractiveSettings }
const CUSTOM_PRESETS_KEY = 'shapeforge.interactive-presets.v1';

const STYLES: { id: InteractiveStyle; label: string }[] = [
  { id: 'flow', label: 'Flow' }, { id: 'aurora', label: 'Aurora' }, { id: 'liquid', label: 'Liquid' }, { id: 'holographic', label: 'Holo' },
  { id: 'plasma', label: 'Plasma' }, { id: 'silk', label: 'Silk' }, { id: 'nebula', label: 'Nebula' }, { id: 'ribbons', label: 'Ribbons' },
  { id: 'metaballs', label: 'Metaballs' }, { id: 'contours', label: 'Contours' },
];
const POINTER_MODES: { id: PointerMode; label: string }[] = [
  { id: 'attract', label: 'Attract' }, { id: 'repel', label: 'Repel' }, { id: 'swirl', label: 'Swirl' },
  { id: 'glow', label: 'Glow light' }, { id: 'drag', label: 'Drag field' }, { id: 'wave', label: 'Wave' },
  { id: 'orbit', label: 'Orbit' }, { id: 'magnet', label: 'Magnet' }, { id: 'ripple', label: 'Move ripple' },
  { id: 'pulse', label: 'Pulse' }, { id: 'trail', label: 'Motion trail' }, { id: 'spotlight', label: 'Spotlight' },
  { id: 'hue', label: 'Hue shift' },
];
const QUALITY: { id: ShaderQuality; label: string }[] = [
  { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'ultra', label: 'Ultra' },
];

export default function InteractivePanel({ layerId }: { layerId: string | null }) {
  const { store, announce } = useStudio();
  const project = useStore(store, state => state.project);
  const layer = project.layers.find(item => item.id === layerId) ?? null;
  const settings = normalizeInteractiveSettings(project.shader);
  const [customName, setCustomName] = useState('');
  const [customPresets, setCustomPresets] = useState<SavedShaderPreset[]>([]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_PRESETS_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed)) throw new Error('Saved shader presets are not a list.');
        setCustomPresets(parsed.filter((item): item is SavedShaderPreset =>
          !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' && !!item.settings,
        ).map(item => ({ ...item, settings: normalizeInteractiveSettings(item.settings) })));
      }
    } catch (error) {
      announce(error instanceof Error ? `Could not load shader presets: ${error.message}` : 'Could not load saved shader presets.');
    }
  }, [announce]);
  const update = (patch: Partial<InteractiveSettings>, coalesce?: string) => store.update(
    current => ({ ...current, shader: normalizeInteractiveSettings({ ...current.shader, ...patch }) }),
    coalesce ? { coalesce: `shader-${coalesce}` } : {},
  );
  const updateLayerShader = (patch: Partial<ReturnType<typeof normalizeShaderLayer>>) => {
    if (!layer) return;
    if (patch.enabled) {
      store.update(project => ({
        ...project,
        shader: normalizeInteractiveSettings({ ...project.shader, enabled: true }),
        layers: project.layers.map(current => current.id === layer.id
          ? { ...current, shader: normalizeShaderLayer({ ...current.shader, ...patch }) }
          : current),
      }));
      return;
    }
    store.updateLayer(layer.id, current => ({
      ...current,
      shader: normalizeShaderLayer({ ...current.shader, ...patch }),
    }));
  };
  const updateMask = (patch: Partial<LayerMask>) => {
    if (!layer) return;
    store.updateLayer(layer.id, current => ({ ...current, mask: { ...current.mask, ...patch } }));
  };
  const applyPreset = (preset: typeof INTERACTIVE_PRESETS[number]) => {
    update({ ...preset.settings, enabled: true });
    updateLayerShader({ enabled: true, style: preset.settings.style ?? settings.style });
  };
  const saveCustom = () => {
    const name = customName.trim();
    if (!name) { announce('Enter a name for the shader preset.'); return; }
    const savedSettings = { ...settings, style: layer?.shader?.style ?? settings.style };
    const next = [...customPresets.filter(preset => preset.name.toLocaleLowerCase() !== name.toLocaleLowerCase()), { id: `shader-${Date.now().toString(36)}`, name, settings: savedSettings }];
    try {
      localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next));
      setCustomPresets(next);
      setCustomName('');
      announce(`Saved shader preset “${name}”`);
    } catch (error) {
      announce(error instanceof Error ? `Could not save shader preset: ${error.message}` : 'Could not save shader preset.');
    }
  };
  const deleteCustom = (id: string) => {
    const next = customPresets.filter(preset => preset.id !== id);
    try {
      localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next));
      setCustomPresets(next);
    } catch (error) {
      announce(error instanceof Error ? `Could not delete shader preset: ${error.message}` : 'Could not delete shader preset.');
    }
  };

  if (!project.layers.length) return <Empty>Add a gradient layer before enabling shader effects.</Empty>;
  if (!layer) return <Empty>Select a layer, then enable shader rendering on that layer. Existing layer tools remain available.</Empty>;

  return <div className="gs-interactive" data-testid="interactive-panel">
    <div className="gs-section-title"><b>Interactive shader engine</b><Switch label={settings.enabled ? 'On' : 'Off'} checked={settings.enabled} onChange={enabled => update({ enabled })} testId="shader-enabled" /></div>
    <p className="hint">Enable the engine and this layer. In the preview, click Interact to route pointer and touch input to the shader; Edit layer mode keeps stops, mesh points and Bézier handles editable.</p>
    <section className="gs-interactive-section">
      <div className="gs-section-title"><b>{layer.name || KIND_LABEL[layer.type]}</b><Switch label="Shader layer" checked={!!layer.shader?.enabled} onChange={enabled => updateLayerShader({ enabled })} testId="shader-layer-enabled" /></div>
      <p className="hint">{layer.type === 'mesh'
        ? 'Edit each shader color point, position, size and opacity in Mesh. Use Transform for a custom Bézier boundary; layer effects, texture and blending still apply.'
        : 'Edit its color ramp in Gradient and its shape in Transform. Layer effects, texture and blending still apply.'}</p>
      <div className="field-label">Layer shader style</div>
      <Seg value={layer.shader?.style ?? settings.style} options={STYLES} onChange={style => updateLayerShader({ style })} label="Layer shader style" testId="shader-layer-style" />
    </section>

    <section className="gs-interactive-section" data-testid="shader-shape">
      <div className="gs-section-title"><b>Shader shape</b></div>
      <Switch label="Custom shader boundary" checked={layer.mask.enabled} onChange={enabled => updateMask({ enabled })} testId="shader-shape-enabled" />
      {layer.mask.enabled && <>
        <Switch label="Curved boundary handles" checked={layer.mask.curved} onChange={curved => updateMask({ curved })} testId="shader-shape-curved" />
        <p className="hint">Choose Edit layer on the preview, then drag green corners and purple Bézier handles to shape the shader.</p>
        {layer.mask.curved && <button type="button" className="btn wide" onClick={() => updateMask({ controls: DEFAULT_LAYER_MASK.controls.map(point => ({ ...point })) as LayerMask['controls'] })} data-testid="shader-shape-reset-curves"><RotateCcw />Reset curve handles</button>}
        <button type="button" className="btn wide" onClick={() => updateMask({
          ...DEFAULT_LAYER_MASK,
          corners: DEFAULT_LAYER_MASK.corners.map(point => ({ ...point })) as LayerMask['corners'],
          controls: DEFAULT_LAYER_MASK.controls.map(point => ({ ...point })) as LayerMask['controls'],
        })} data-testid="shader-shape-reset"><RotateCcw />Reset shader boundary</button>
      </>}
    </section>

    <div className="gs-interactive-presets" role="group" aria-label="Shader presets">
      {INTERACTIVE_PRESETS.map(preset => (
        <button key={preset.id} type="button" className="chip" title={preset.description} onClick={() => applyPreset(preset)} data-testid={`shader-preset-${preset.id}`}>
          {preset.name}
        </button>
      ))}
    </div>
    <div className="gs-interactive-custom">
      <label className="field-label" htmlFor="shader-preset-name">Save current settings</label>
      <div className="gs-interactive-custom-row">
        <input id="shader-preset-name" className="gs-custom-preset-name" value={customName} onChange={event => setCustomName(event.target.value)} placeholder="Preset name" maxLength={48} />
        <button type="button" className="btn small" onClick={saveCustom} disabled={!customName.trim()} data-testid="shader-save-preset">Save</button>
      </div>
      {customPresets.map(preset => (
        <div className="gs-interactive-saved" key={preset.id}>
          <button type="button" className="chip" onClick={() => {
            update({ ...preset.settings, enabled: true });
            updateLayerShader({ enabled: true, style: preset.settings.style });
          }} title="Apply saved shader settings">{preset.name}</button>
          <button type="button" className="link" onClick={() => deleteCustom(preset.id)} aria-label={`Delete ${preset.name}`}>Remove</button>
        </div>
      ))}
    </div>

    <section className="gs-interactive-section">
      <div className="field-label">Style default for new shader layers</div>
      <Seg value={settings.style} options={STYLES} onChange={style => update({ style })} label="Default shader style" testId="shader-style" />
      <Switch label="Animate" checked={settings.animate} onChange={animate => update({ animate })} testId="shader-animate" />
      <ValueControl label="Animation speed" value={settings.speed} min={0} max={1.5} step={0.01} unit="×" def={DEFAULT_INTERACTIVE_SETTINGS.speed} onChange={speed => update({ speed }, 'speed')} testId="shader-speed" />
      <ValueControl label="Intensity" value={settings.intensity} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.intensity} onChange={intensity => update({ intensity }, 'intensity')} testId="shader-intensity" />
    </section>

    <details className="gs-interactive-section gs-interactive-menu" open data-testid="shader-pointer-menu">
      <summary className="gs-section-title"><b>Pointer &amp; touch</b><span>{settings.interactionEnabled ? 'Enabled' : 'Disabled'}</span></summary>
      <Switch label="Enable pointer and touch" checked={settings.interactionEnabled} onChange={interactionEnabled => update({ interactionEnabled })} testId="shader-interaction" />
      <label className="field-label" htmlFor="shader-pointer-mode">Interaction style</label>
      <select id="shader-pointer-mode" className="generate-select" value={settings.pointerMode} onChange={event => update({ pointerMode: event.target.value as PointerMode })} data-testid="shader-pointer-mode">
        {POINTER_MODES.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
      </select>
      <ValueControl label="Interaction strength" value={settings.interactionStrength} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.interactionStrength} onChange={interactionStrength => update({ interactionStrength }, 'interaction')} testId="shader-interaction-strength" />
      <ValueControl label="Influence radius" value={settings.interactionRadius} min={0.04} max={0.8} step={0.01} unit="×" def={DEFAULT_INTERACTIVE_SETTINGS.interactionRadius} onChange={interactionRadius => update({ interactionRadius }, 'radius')} testId="shader-radius" />
      <label className="field-label" htmlFor="shader-interaction-color">Interaction color</label>
      <input id="shader-interaction-color" className="gs-interaction-color" type="color" value={settings.interactionColor} onChange={event => update({ interactionColor: event.target.value })} data-testid="shader-interaction-color" />
      <ValueControl label="Glow" value={settings.glow} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.glow} onChange={glow => update({ glow }, 'glow')} testId="shader-glow" />
      <Switch label="Touch interaction" checked={settings.touchEnabled} onChange={touchEnabled => update({ touchEnabled })} testId="shader-touch" />
      <Switch label="Click ripples" checked={settings.ripplesEnabled} onChange={ripplesEnabled => update({ ripplesEnabled })} testId="shader-ripples" />
      {settings.ripplesEnabled && <>
        <ValueControl label="Ripple strength" value={settings.rippleStrength} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.rippleStrength} onChange={rippleStrength => update({ rippleStrength }, 'ripple-strength')} testId="shader-ripple-strength" />
        <ValueControl label="Ripple speed" value={settings.rippleSpeed} min={0.05} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.rippleSpeed} onChange={rippleSpeed => update({ rippleSpeed }, 'ripple-speed')} testId="shader-ripple-speed" />
        <ValueControl label="Maximum ripples" value={settings.maximumRipples} min={1} max={8} step={1} def={DEFAULT_INTERACTIVE_SETTINGS.maximumRipples} onChange={maximumRipples => update({ maximumRipples }, 'max-ripples')} testId="shader-ripple-count" />
      </>}
    </details>

    <section className="gs-interactive-section">
      <div className="field-label">Fluid distortion</div>
      <ValueControl label="Distortion" value={settings.distortion} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.distortion} onChange={distortion => update({ distortion }, 'distortion')} testId="shader-distortion" />
      <ValueControl label="Distortion scale" value={settings.distortionScale} min={0.2} max={8} step={0.1} def={DEFAULT_INTERACTIVE_SETTINGS.distortionScale} onChange={distortionScale => update({ distortionScale }, 'distortion-scale')} testId="shader-distortion-scale" />
      <ValueControl label="Turbulence" value={settings.turbulence} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.turbulence} onChange={turbulence => update({ turbulence }, 'turbulence')} testId="shader-turbulence" />
    </section>

    <section className="gs-interactive-section">
      <div className="field-label">Performance</div>
      <Seg value={settings.quality} options={QUALITY} onChange={quality => update({ quality })} label="Shader quality" testId="shader-quality" />
      <ValueControl label="Resolution scale" value={settings.resolutionScale} min={0.35} max={1.5} step={0.05} unit="×" def={DEFAULT_INTERACTIVE_SETTINGS.resolutionScale} onChange={resolutionScale => update({ resolutionScale }, 'resolution')} testId="shader-resolution" />
    </section>

    <button type="button" className="btn wide" onClick={() => update({ ...DEFAULT_INTERACTIVE_SETTINGS })} data-testid="shader-reset"><RotateCcw />Reset shader settings</button>
  </div>;
}
