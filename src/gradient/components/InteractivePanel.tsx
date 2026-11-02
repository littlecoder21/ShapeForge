import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Seg, Switch, ValueControl } from '../../shared/controls';
import { DEFAULT_INTERACTIVE_SETTINGS, normalizeInteractiveSettings, normalizeShaderLayer, type InteractiveSettings, type PointerMode, type ShaderQuality } from '../interactive/types';
import { POINTER_MODES } from '../interactive/pointerModes';
import { INTERACTIVE_PRESETS } from '../interactive/presets';
import { useStore } from '../engine/store';
import { Empty, useStudio } from './ui';
import { DEFAULT_LAYER_MASK, KIND_LABEL, type LayerMask } from '../engine/model';

interface SavedShaderPreset { id: string; name: string; settings: InteractiveSettings }
const CUSTOM_PRESETS_KEY = 'shapeforge.interactive-presets.v1';

const STYLES: { id: InteractiveSettings['style']; label: string }[] = [
  { id: 'flow', label: 'Flow' }, { id: 'aurora', label: 'Aurora' }, { id: 'liquid', label: 'Liquid' }, { id: 'holographic', label: 'Holo' },
  { id: 'plasma', label: 'Plasma' }, { id: 'silk', label: 'Silk' }, { id: 'nebula', label: 'Nebula' }, { id: 'ribbons', label: 'Ribbons' },
  { id: 'metaballs', label: 'Metaballs' }, { id: 'contours', label: 'Contours' },
];
const QUALITY: { id: ShaderQuality; label: string }[] = [
  { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'ultra', label: 'Ultra' },
];
const SHADER_PANELS = [
  { id: 'setup', label: 'Setup' },
  { id: 'motion', label: 'Motion' },
  { id: 'interaction', label: 'Interact' },
  { id: 'finish', label: 'Finish' },
  { id: 'performance', label: 'Quality' },
] as const;
type ShaderPanel = typeof SHADER_PANELS[number]['id'];

export default function InteractivePanel({ layerId }: { layerId: string | null }) {
  const { store, announce } = useStudio();
  const project = useStore(store, state => state.project);
  const layer = project.layers.find(item => item.id === layerId) ?? null;
  const settings = normalizeInteractiveSettings(project.shader);
  const [panel, setPanel] = useState<ShaderPanel>('setup');
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
  const pointerGroups = [...new Set(POINTER_MODES.map(mode => mode.group))];

  if (!project.layers.length) return <Empty>Add a gradient layer before enabling shader effects.</Empty>;
  if (!layer) return <Empty>Select a layer, then enable shader rendering on that layer. Existing layer tools remain available.</Empty>;

  return <div className="gs-interactive" data-testid="interactive-panel">
    <div className="gs-section-title"><b>Interactive shader engine</b><Switch label={settings.enabled ? 'On' : 'Off'} checked={settings.enabled} onChange={enabled => update({ enabled })} testId="shader-enabled" /></div>
    <p className="hint">Mouse hover interacts with the shader automatically. Enable Touch mode in the preview for touch input; switch back to Edit layer to work with stops, mesh points, and Bézier handles.</p>
    <section className="gs-interactive-section">
      <div className="gs-section-title"><b>{layer.name || KIND_LABEL[layer.type]}</b><Switch label="Shader layer" checked={!!layer.shader?.enabled} onChange={enabled => updateLayerShader({ enabled })} testId="shader-layer-enabled" /></div>
      <p className="hint">{layer.type === 'mesh'
        ? 'Mesh point colors and positions drive this layer’s shader color field. Enable Shader layer on other visible layers to keep their colors and shapes stacked independently.'
        : 'This layer’s color stops and gradient shape drive its shader. Enable Shader layer on other visible layers to keep their colors and shapes stacked independently.'}</p>
      {(layer.type === 'linear' || layer.type === 'radial' || layer.type === 'conic') && !layer.repeating && <>
        <ValueControl label="CSS / shader mix" value={settings.shaderMix} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.shaderMix} onChange={shaderMix => update({ shaderMix }, 'shader-mix')} testId="shader-mix" />
        <p className="hint">0 keeps the CSS gradient shape and stop ramp; 1 uses the full animated shader. Overlay mode blends shader effects over the CSS layer.</p>
      </>}
      <div className="field-label">Layer shader style</div>
      <Seg value={layer.shader?.style ?? settings.style} options={STYLES} onChange={style => updateLayerShader({ style })} label="Layer shader style" testId="shader-layer-style" />
    </section>

    <div className="gs-shader-tabs" role="tablist" aria-label="Shader controls">
      {SHADER_PANELS.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={panel === item.id}
          aria-controls={`shader-panel-${item.id}`}
          id={`shader-tab-${item.id}`}
          className={`gs-shader-tab ${panel === item.id ? 'active' : ''}`}
          onClick={() => setPanel(item.id)}
          data-testid={`shader-tab-${item.id}`}
        >{item.label}</button>
      ))}
    </div>

    <div id="shader-panel-setup" className="gs-shader-subpanel" role="tabpanel" aria-labelledby="shader-tab-setup" hidden={panel !== 'setup'} data-testid="shader-panel-setup">
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
      <label className="field-label" htmlFor="shader-render-backend">Renderer backend</label>
      <select id="shader-render-backend" className="generate-select" value={settings.renderBackend} onChange={event => update({ renderBackend: event.target.value as InteractiveSettings['renderBackend'] })} data-testid="shader-render-backend">
        <option value="css">CSS renderer</option>
        <option value="webgl">WebGL renderer (CSS fallback)</option>
        <option value="overlay">CSS + WebGL overlay</option>
      </select>
    </section>
    </div>

    <div id="shader-panel-motion" className="gs-shader-subpanel" role="tabpanel" aria-labelledby="shader-tab-motion" hidden={panel !== 'motion'} data-testid="shader-panel-motion">
    <section className="gs-interactive-section">
      <Switch label="Animate" checked={settings.animate} onChange={animate => update({ animate })} testId="shader-animate" />
      <ValueControl label="Animation speed" value={settings.speed} min={0} max={1.5} step={0.01} unit="×" def={DEFAULT_INTERACTIVE_SETTINGS.speed} onChange={speed => update({ speed }, 'speed')} testId="shader-speed" />
      <ValueControl label="Intensity" value={settings.intensity} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.intensity} onChange={intensity => update({ intensity }, 'intensity')} testId="shader-intensity" />
    </section>
    <section className="gs-interactive-section">
      <div className="field-label">Fluid distortion</div>
      <ValueControl label="Distortion" value={settings.distortion} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.distortion} onChange={distortion => update({ distortion }, 'distortion')} testId="shader-distortion" />
      <ValueControl label="Distortion scale" value={settings.distortionScale} min={0.2} max={8} step={0.1} def={DEFAULT_INTERACTIVE_SETTINGS.distortionScale} onChange={distortionScale => update({ distortionScale }, 'distortion-scale')} testId="shader-distortion-scale" />
      <ValueControl label="Turbulence" value={settings.turbulence} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.turbulence} onChange={turbulence => update({ turbulence }, 'turbulence')} testId="shader-turbulence" />
    </section>
    </div>

    <div id="shader-panel-interaction" className="gs-shader-subpanel" role="tabpanel" aria-labelledby="shader-tab-interaction" hidden={panel !== 'interaction'} data-testid="shader-panel-interaction">
    <details className="gs-interactive-section gs-interactive-menu" open data-testid="shader-pointer-menu">
      <summary className="gs-section-title"><b>Pointer &amp; touch</b><span>{settings.interactionEnabled ? 'Enabled' : 'Disabled'}</span></summary>
      <Switch label="Enable pointer and touch" checked={settings.interactionEnabled} onChange={interactionEnabled => update({ interactionEnabled })} testId="shader-interaction" />
      <label className="field-label" htmlFor="shader-pointer-mode">Interaction style</label>
      <select id="shader-pointer-mode" className="generate-select" value={settings.pointerMode} onChange={event => update({ pointerMode: event.target.value as PointerMode })} data-testid="shader-pointer-mode">
        {pointerGroups.map(group => <optgroup key={group} label={group}>
          {POINTER_MODES.filter(mode => mode.group === group).map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
        </optgroup>)}
      </select>
      <p className="hint" data-testid="shader-pointer-mode-description">{POINTER_MODES.find(mode => mode.id === settings.pointerMode)?.description}</p>
      <ValueControl label="Interaction strength" value={settings.interactionStrength} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.interactionStrength} onChange={interactionStrength => update({ interactionStrength }, 'interaction')} testId="shader-interaction-strength" />
      <ValueControl label="Influence radius" value={settings.interactionRadius} min={0.04} max={0.8} step={0.01} unit="×" def={DEFAULT_INTERACTIVE_SETTINGS.interactionRadius} onChange={interactionRadius => update({ interactionRadius }, 'radius')} testId="shader-radius" />
      <label className="field-label" htmlFor="shader-interaction-color-source">Interaction colors</label>
      <select id="shader-interaction-color-source" className="generate-select" value={settings.interactionColorSource} onChange={event => update({ interactionColorSource: event.target.value as InteractiveSettings['interactionColorSource'] })} data-testid="shader-interaction-color-source">
        <option value="layer">Auto · use this layer’s colors</option>
        <option value="custom">Custom multicolor palette</option>
      </select>
      {settings.interactionColorSource === 'layer'
        ? <p className="hint">Each shader layer samples its own gradient stops or mesh point colors, so stacked layers respond in their own palette.</p>
        : <div className="gs-interaction-palette">
          {settings.interactionColors.map((color, index) => <div className="gs-interaction-palette-row" key={`interaction-color-${index}`}>
            <label className="field-label" htmlFor={`shader-interaction-color-${index}`}>Color {index + 1}</label>
            <input id={`shader-interaction-color-${index}`} className="gs-interaction-color" type="color" value={color} onChange={event => {
              const interactionColors = [...settings.interactionColors];
              interactionColors[index] = event.target.value;
              update({ interactionColors, interactionColor: interactionColors[0] });
            }} data-testid={`shader-interaction-color-${index}`} />
            {settings.interactionColors.length > 1 && <button type="button" className="link" onClick={() => {
              const interactionColors = settings.interactionColors.filter((_, colorIndex) => colorIndex !== index);
              update({ interactionColors, interactionColor: interactionColors[0] });
            }} aria-label={`Remove interaction color ${index + 1}`}>Remove</button>}
          </div>)}
          <button type="button" className="btn small" disabled={settings.interactionColors.length >= 5} onClick={() => {
            const interactionColors = [...settings.interactionColors, '#fbbf24'];
            update({ interactionColors, interactionColor: interactionColors[0] });
          }} data-testid="shader-add-interaction-color">Add color</button>
        </div>}
      <ValueControl label="Palette blend" value={settings.interactionColorMix} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.interactionColorMix} onChange={interactionColorMix => update({ interactionColorMix }, 'color-mix')} testId="shader-interaction-color-mix" />
      <ValueControl label="Color animation" value={settings.interactionColorSpeed} min={0} max={2} step={0.01} unit="×" def={DEFAULT_INTERACTIVE_SETTINGS.interactionColorSpeed} onChange={interactionColorSpeed => update({ interactionColorSpeed }, 'color-speed')} testId="shader-interaction-color-speed" />
      <ValueControl label="Gradient distortion" value={settings.interactionDistortion} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.interactionDistortion} onChange={interactionDistortion => update({ interactionDistortion }, 'distortion')} testId="shader-interaction-distortion" />
      <p className="hint">Warps the layer’s gradient coordinates under the pointer, so its color stops and gradient shape distort together.</p>
      <label className="field-label" htmlFor="shader-displacement-mode">Color displacement direction</label>
      <select id="shader-displacement-mode" className="generate-select" value={settings.interactionDisplacementMode} onChange={event => update({ interactionDisplacementMode: event.target.value as InteractiveSettings['interactionDisplacementMode'] })} data-testid="shader-displacement-mode">
        <option value="push">Push colors away</option>
        <option value="pull">Pull colors toward cursor</option>
      </select>
      <ValueControl label="Cursor displacement" value={settings.interactionDisplacement} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.interactionDisplacement} onChange={interactionDisplacement => update({ interactionDisplacement }, 'displacement')} testId="shader-displacement" />
      <ValueControl label="Velocity reaction" value={settings.interactionVelocityReaction} min={0} max={2} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.interactionVelocityReaction} onChange={interactionVelocityReaction => update({ interactionVelocityReaction }, 'velocity-reaction')} testId="shader-velocity-reaction" />
      <p className="hint">Fast cursor movement amplifies displacement, distortion, and glow; slower motion stays subtle.</p>
      <ValueControl label="Pointer response delay" value={settings.interactionDelay} min={0} max={600} step={5} unit="ms" def={DEFAULT_INTERACTIVE_SETTINGS.interactionDelay} onChange={interactionDelay => update({ interactionDelay }, 'interaction-delay')} testId="shader-interaction-delay" />
      <p className="hint">Controls how quickly effects catch up with mouse or touch movement. Set to 0 for immediate response.</p>
      <ValueControl label="Interaction glitch" value={settings.interactionGlitch} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.interactionGlitch} onChange={interactionGlitch => update({ interactionGlitch }, 'interaction-glitch')} testId="shader-interaction-glitch" />
      <p className="hint">Adds cursor-local digital tearing and color-channel separation; movement makes the glitch more pronounced.</p>
      <label className="field-label" htmlFor="shader-interaction-falloff">Influence falloff</label>
      <select id="shader-interaction-falloff" className="generate-select" value={settings.interactionFalloff} onChange={event => update({ interactionFalloff: event.target.value as InteractiveSettings['interactionFalloff'] })} data-testid="shader-interaction-falloff">
        <option value="soft">Soft</option>
        <option value="linear">Linear</option>
        <option value="sharp">Sharp</option>
        <option value="gaussian">Gaussian</option>
      </select>
      <ValueControl label="Glow" value={settings.glow} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.glow} onChange={glow => update({ glow }, 'glow')} testId="shader-glow" />
      <Switch label="Touch interaction" checked={settings.touchEnabled} onChange={touchEnabled => update({ touchEnabled })} testId="shader-touch" />
      <Switch label="Click ripples" checked={settings.ripplesEnabled} onChange={ripplesEnabled => update({ ripplesEnabled })} testId="shader-ripples" />
      {settings.ripplesEnabled && <>
        <ValueControl label="Ripple strength" value={settings.rippleStrength} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.rippleStrength} onChange={rippleStrength => update({ rippleStrength }, 'ripple-strength')} testId="shader-ripple-strength" />
        <ValueControl label="Ripple speed" value={settings.rippleSpeed} min={0.05} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.rippleSpeed} onChange={rippleSpeed => update({ rippleSpeed }, 'ripple-speed')} testId="shader-ripple-speed" />
        <ValueControl label="Maximum ripples" value={settings.maximumRipples} min={1} max={8} step={1} def={DEFAULT_INTERACTIVE_SETTINGS.maximumRipples} onChange={maximumRipples => update({ maximumRipples }, 'max-ripples')} testId="shader-ripple-count" />
      </>}
    </details>
    </div>

    <div id="shader-panel-finish" className="gs-shader-subpanel" role="tabpanel" aria-labelledby="shader-tab-finish" hidden={panel !== 'finish'} data-testid="shader-panel-finish">
    <section className="gs-interactive-section" data-testid="shader-finish">
      <div className="field-label">Finish</div>
      <ValueControl label="Tone mapping" value={settings.toneMapping} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.toneMapping} onChange={toneMapping => update({ toneMapping }, 'tone-mapping')} testId="shader-tone-mapping" />
      <ValueControl label="Vignette" value={settings.vignette} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.vignette} onChange={vignette => update({ vignette }, 'vignette')} testId="shader-vignette" />
      <ValueControl label="Sheen" value={settings.sheen} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.sheen} onChange={sheen => update({ sheen }, 'sheen')} testId="shader-sheen" />
      <ValueControl label="Film grain" value={settings.filmGrain} min={0} max={1} step={0.01} def={DEFAULT_INTERACTIVE_SETTINGS.filmGrain} onChange={filmGrain => update({ filmGrain }, 'film-grain')} testId="shader-film-grain" />
      <Switch label="Idle motion" checked={settings.idleMotion} onChange={idleMotion => update({ idleMotion })} testId="shader-idle-motion" />
      <label className="field-label" htmlFor="shader-palette-wrap">Palette wrapping</label>
      <select id="shader-palette-wrap" className="generate-select" value={settings.paletteWrap} onChange={event => update({ paletteWrap: event.target.value as InteractiveSettings['paletteWrap'] })} data-testid="shader-palette-wrap">
        <option value="mirror">Mirror (seam-free)</option>
        <option value="repeat">Repeat (legacy)</option>
      </select>
    </section>
    </div>

    <div id="shader-panel-performance" className="gs-shader-subpanel" role="tabpanel" aria-labelledby="shader-tab-performance" hidden={panel !== 'performance'} data-testid="shader-panel-performance">
    <section className="gs-interactive-section">
      <div className="field-label">Performance</div>
      <Seg value={settings.quality} options={QUALITY} onChange={quality => update({ quality })} label="Shader quality" testId="shader-quality" />
      <ValueControl label="Resolution scale" value={settings.resolutionScale} min={0.35} max={1.5} step={0.05} unit="×" def={DEFAULT_INTERACTIVE_SETTINGS.resolutionScale} onChange={resolutionScale => update({ resolutionScale }, 'resolution')} testId="shader-resolution" />
    </section>
    </div>

    <button type="button" className="btn wide" onClick={() => update({ ...DEFAULT_INTERACTIVE_SETTINGS })} data-testid="shader-reset"><RotateCcw />Reset shader settings</button>
  </div>;
}
