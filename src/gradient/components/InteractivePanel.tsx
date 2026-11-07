import { useCallback, useMemo, useState } from 'react';
import { Gauge, MousePointerClick, Orbit, Palette, SlidersHorizontal, Sparkles, Wind, ArrowLeft } from 'lucide-react';
import { Switch } from '../../shared/controls';
import { describeRig } from '../interactive/rig/model';
import { SHADER_STYLE_MAP } from '../interactive/styles';
import { normalizeInteractiveSettings, normalizeShaderLayer, type InteractiveSettings, type ShaderLayerConfig } from '../interactive/types';
import { useStore } from '../engine/store';
import { Empty, useStudio } from './ui';
import { ShaderPanelProvider, type ShaderPanelContext } from './shader/context';
import LayerStrip from './shader/LayerStrip';
import StylePanel from './shader/StylePanel';
import SetupPanel from './shader/SetupPanel';
import MotionPanel from './shader/MotionPanel';
import ProceduralPanel from './shader/ProceduralPanel';
import SingleLayerSwitch from './shader/SingleLayerSwitch';
import InteractPanel from './shader/InteractPanel';
import FinishPanel from './shader/FinishPanel';
import '../shader-panel.css';

const SUB_PANELS = [
  { id: 'style', label: 'Style', icon: Palette, Body: StylePanel },
  { id: 'setup', label: 'Setup', icon: SlidersHorizontal, Body: SetupPanel },
  { id: 'motion', label: 'Motion', icon: Wind, Body: MotionPanel },
  { id: 'procedural', label: 'Procedural', icon: Orbit, Body: ProceduralPanel },
  { id: 'interaction', label: 'Interact', icon: MousePointerClick, Body: InteractPanel },
  { id: 'finish', label: 'Finish & quality', icon: Sparkles, Body: FinishPanel },
] as const;
type SubPanelId = typeof SUB_PANELS[number]['id'];

/** The Shader tab. It opens on an overview (layer list + sub-panel cards); each card opens one focused sub-panel. */
export default function InteractivePanel({ layerId }: { layerId: string | null }) {
  const { store, announce } = useStudio();
  const project = useStore(store, state => state.project);
  const [view, setView] = useState<SubPanelId | 'home'>('home');
  const [selectedRaw, setSelected] = useState<string[]>([]);

  const settings = useMemo(() => normalizeInteractiveSettings(project.shader), [project.shader]);
  const layers = useMemo(() => [...project.layers].reverse(), [project.layers]);
  const selected = useMemo(() => selectedRaw.filter(id => project.layers.some(layer => layer.id === id)), [selectedRaw, project.layers]);
  const primary = useMemo(() => {
    const focused = layers.find(layer => layer.id === layerId) ?? null;
    if (selected.length && (!focused || !selected.includes(focused.id))) return layers.find(layer => layer.id === selected[0]) ?? focused ?? layers[0] ?? null;
    return focused ?? layers[0] ?? null;
  }, [layers, layerId, selected]);
  const targets = useMemo(() => selected.length ? layers.filter(layer => selected.includes(layer.id)) : primary ? [primary] : [], [layers, selected, primary]);
  const targetIds = useMemo(() => targets.map(layer => layer.id), [targets]);

  const update = useCallback((patch: Partial<InteractiveSettings>, coalesce?: string) => store.update(
    current => ({ ...current, shader: normalizeInteractiveSettings({ ...current.shader, ...patch }) }),
    coalesce ? { coalesce: `shader-${coalesce}` } : {},
  ), [store]);
  const updateRig = useCallback<ShaderPanelContext['updateRig']>((change, coalesce) => store.update(
    current => ({ ...current, shader: normalizeInteractiveSettings({ ...current.shader, rig: change(normalizeInteractiveSettings(current.shader).rig) }) }),
    coalesce ? { coalesce: `shader-rig-${coalesce}` } : {},
  ), [store]);
  const patchLayers = useCallback((patch: Partial<ShaderLayerConfig> | ((layer: typeof project.layers[number]) => Partial<ShaderLayerConfig>), ids: string[] = targetIds, coalesce?: string) => {
    const wanted = new Set(ids);
    store.update(current => {
      let enableProjectShader = false;
      const layers = current.layers.map(layer => {
        if (!wanted.has(layer.id)) return layer;
        const layerPatch = typeof patch === 'function' ? patch(layer) : patch;
        if (layerPatch.enabled === true) enableProjectShader = true;
        if (Object.keys(layerPatch).length === 0) return layer;
        return { ...layer, shader: normalizeShaderLayer({ ...layer.shader, ...layerPatch }) };
      });
      return {
        ...current,
        shader: enableProjectShader ? normalizeInteractiveSettings({ ...current.shader, enabled: true }) : current.shader,
        layers,
      };
    }, coalesce ? { coalesce: `shader-layer-${coalesce}` } : {});
  }, [store, targetIds]);
  const focusLayer = useCallback((id: string) => store.select(id), [store]);

  const context = useMemo<ShaderPanelContext>(() => ({
    settings, layers, primary, targets, selected, setSelected, update, updateRig, patchLayers, focusLayer, announce,
  }), [settings, layers, primary, targets, selected, update, updateRig, patchLayers, focusLayer, announce]);

  if (!project.layers.length) return <Empty>Add a gradient layer before enabling shader effects.</Empty>;
  const enabledCount = project.layers.filter(layer => layer.shader?.enabled).length;
  const procedural = primary?.shader?.procedural;
  const summary: Record<SubPanelId, string> = {
    style: primary ? SHADER_STYLE_MAP[primary.shader?.style ?? settings.style].label : '—',
    setup: `${enabledCount} of ${project.layers.length} layers`,
    motion: `${settings.animate ? 'Animated' : 'Still'} · ${settings.speed.toFixed(2)}×`,
    procedural: settings.singleLayer === true
      ? 'Single layer · all layers merged'
      : procedural?.enabled ? `${procedural.mode === 'full' ? 'Full' : 'Hybrid'} · up to ${procedural.points.max} points` : 'Off',
    interaction: describeRig(settings.rig),
    finish: `${settings.quality[0].toUpperCase()}${settings.quality.slice(1)} quality`,
  };
  const active = SUB_PANELS.find(item => item.id === view);

  return <ShaderPanelProvider value={context}>
    <div className="gs-interactive gs-shader" data-testid="interactive-panel">
      <div className="gs-section-title"><b>Shader</b><Switch label={settings.enabled ? 'On' : 'Off'} checked={settings.enabled} onChange={enabled => update({ enabled })} testId="shader-enabled" /></div>
      <LayerStrip />
      {!active && <>
        <nav className="gs-shader-cards" aria-label="Shader sub-panels">
          {SUB_PANELS.map(item => {
            const Icon = item.icon;
            return <button key={item.id} type="button" className="gs-shader-card" onClick={() => setView(item.id)} data-testid={`shader-card-${item.id}`}>
              <Icon aria-hidden="true" />
              <span><b>{item.label}</b><small>{summary[item.id]}</small></span>
            </button>;
          })}
        </nav>
        <p className="hint">Hover the preview to try the interaction. Switch on Touch mode in the preview for touch input, and back to Edit layer to work with stops, mesh points and Bézier handles.</p>
      </>}
      {active && <section className="gs-shader-sub" aria-label={active.label} data-testid={`shader-sub-${active.id}`}>
        <div className="gs-shader-sub-head">
          <button type="button" className="btn small" onClick={() => setView('home')} data-testid="shader-back"><ArrowLeft />Shader</button>
          <b>{active.label}</b>
          <span className="gs-shader-sub-tabs" role="tablist" aria-label="Jump to sub-panel">
            {SUB_PANELS.filter(item => item.id !== active.id).map(item => <button key={item.id} type="button" role="tab" aria-selected={false} className="chip" onClick={() => setView(item.id)}>{item.label.split(' ')[0]}</button>)}
          </span>
        </div>
        {active.id === 'procedural' && <SingleLayerSwitch />}
        <active.Body />
      </section>}
    </div>
  </ShaderPanelProvider>;
}
