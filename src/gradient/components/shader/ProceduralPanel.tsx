import { useRef, useState } from 'react';
import '../../../procedural/procedural-panel.css';
import { Switch } from '../../../shared/controls';
import { gradientLayerToShader } from '../../interactive/adapter';
import { useStore } from '../../engine/store';
import { canProceduralize, proceduralizeSource } from '../../../procedural/convert';
import {
  applyPreset, parsePresetFile, randomizeProcedural, reseed, serializePresetFile,
  type RandomizeScope,
} from '../../../procedural/presets';
import { ALL_PROCEDURAL_PRESETS } from '../../../procedural/presetsMore';
import MeshRenderControls from './MeshRenderControls';
import {
  COLOR_SPACES, DEFAULT_PROCEDURAL, DEFAULT_PROCEDURAL_STAGE, DISTORTION_TYPES, FALLOFFS, FIELD_METHODS, FORCE_TYPES, MOTION_TYPES,
  NOISE_KINDS, POINT_DISTRIBUTIONS, PROC_MAX_POINTS, PROC_MODES, PROC_RANGES, newProcedural, normalizeProcedural,
  type ProceduralConfig, type ProceduralStage,
} from '../../../procedural/types';
import { useStudio } from '../ui';
import { useShader } from './context';
import { Num, Section, Select } from './parts';

type Group = 'points' | 'field' | 'motion' | 'color' | 'interaction';
const LABEL = (id: string) => id.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
const options = <T extends string>(ids: readonly T[], overrides: Partial<Record<T, string>> = {}) => ids.map(id => ({ id, label: overrides[id] ?? LABEL(id) }));

const MODE_LABEL = { hybrid: 'Hybrid · over the manual gradient', full: 'Full · replaces the gradient colours' } as const;
const FIELD_LABEL = {
  idw: 'Inverse distance',
  gaussian: 'Gaussian',
  smooth: 'Smooth falloff',
  radial: 'Radial',
  smin: 'Smooth-min (metaballs)',
  soft: 'Wide Gaussian',
  'inverse-multiquadric': 'Inverse multiquadric',
  'wendland-c2': 'Compact support (Wendland C2)',
} as const;
const MOTION_LABEL = { static: 'Static', orbit: 'Orbit the centre', circle: 'Circular', figure8: 'Figure eight', sine: 'Sine wave', drift: 'Organic drift', noise: 'Noise-driven', flow: 'Flow field', wander: 'Random wander', follow: 'Follow the pointer' } as const;
const DIST_LABEL = { none: 'None', fbm: 'FBM noise', warp: 'Domain warp', multiwarp: 'Multi-level warp', turbulence: 'Turbulence', curl: 'Curl-noise flow', polar: 'Polar twist', radial: 'Radial ripple', wave: 'Waves', flow: 'Directional flow', rotate: 'Rotate', scale: 'Scale' } as const;
const FORCE_LABEL = { none: 'No reaction', attract: 'Attract', repel: 'Repel', swirl: 'Swirl', vortex: 'Vortex', push: 'Push with motion', pull: 'Pull against motion', ripple: 'Ripple', wave: 'Wave', fluid: 'Fluid drag' } as const;

/** Which stage controls matter for each distortion type. */
const STAGE_CONTROLS: Record<string, (keyof ProceduralStage)[]> = {
  fbm: ['scale', 'intensity', 'octaves', 'lacunarity', 'persistence', 'turbulence', 'speed', 'direction', 'noise'],
  warp: ['scale', 'intensity', 'octaves', 'lacunarity', 'persistence', 'speed', 'direction', 'noise'],
  multiwarp: ['scale', 'intensity', 'octaves', 'lacunarity', 'persistence', 'speed', 'direction', 'noise'],
  turbulence: ['scale', 'intensity', 'octaves', 'lacunarity', 'persistence', 'turbulence', 'speed', 'direction', 'noise'],
  curl: ['scale', 'intensity', 'octaves', 'lacunarity', 'persistence', 'speed', 'direction', 'noise'],
  flow: ['scale', 'intensity', 'octaves', 'lacunarity', 'persistence', 'speed', 'direction', 'noise'],
  polar: ['intensity', 'frequency', 'speed'],
  radial: ['intensity', 'frequency', 'speed'],
  wave: ['intensity', 'frequency', 'speed', 'direction'],
  rotate: ['intensity', 'speed'],
  scale: ['scale', 'intensity'],
};
const STAGE_LABEL: Record<keyof ProceduralStage, string> = {
  type: 'Type', enabled: 'Enabled', noise: 'Noise', scale: 'Noise scale', intensity: 'Intensity (warp strength)', octaves: 'Octaves',
  lacunarity: 'Lacunarity', persistence: 'Persistence', frequency: 'Frequency', turbulence: 'Turbulence amount', speed: 'Flow speed', direction: 'Direction',
};
const STAGE_STEP: Partial<Record<keyof ProceduralStage, number>> = { octaves: 1, direction: 1, scale: 0.05, frequency: 0.1 };

/** A rough count of noise evaluations per pixel, used for the cost readout (not a benchmark). */
const STAGE_COST: Record<string, number> = { fbm: 2, warp: 4, multiwarp: 6, turbulence: 2, curl: 4, flow: 2, polar: 0.2, radial: 0.2, wave: 0.2, rotate: 0.1, scale: 0.1 };
export function proceduralCost(config: ProceduralConfig): 'Low' | 'Medium' | 'High' {
  const noise = config.distortion.reduce((sum, stage) => stage.type === 'none' || !stage.enabled ? sum : sum + (STAGE_COST[stage.type] ?? 0) * stage.octaves, 0);
  const points = config.points.max * (config.field.method === 'smin' ? 2 : 1);
  const score = noise + points * 0.5;
  return score <= 14 ? 'Low' : score <= 34 ? 'Medium' : 'High';
}

const STORE_KEY = 'shapeforge.procedural.presets';
interface UserPreset { name: string; config: ReturnType<typeof normalizeProcedural> }
function loadUserPresets(): UserPreset[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '[]') as { name?: unknown; config?: unknown }[];
    return raw.filter(item => typeof item.name === 'string').slice(0, 24).map(item => ({ name: String(item.name), config: normalizeProcedural(item.config) }));
  } catch { return []; }
}
function saveUserPresets(list: UserPreset[]) {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* storage unavailable: presets just do not persist */ }
}

/** The Procedural sub-panel: a seeded colour-centre field with motion, distortion and pointer forces, on top of the layer. */
export default function ProceduralPanel() {
  const { primary, targets, selected, layers, patchLayers, announce } = useShader();
  const { store } = useStudio();
  const project = useStore(store, state => state.project);
  const [userPresets, setUserPresets] = useState<UserPreset[]>(loadUserPresets);
  const rollRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const config = primary?.shader?.procedural ?? null;
  const active = !!config?.enabled;

  /** applies a change to every target layer that has a procedural config (each keeps its own values) */
  const edit = (change: (current: ProceduralConfig) => ProceduralConfig, coalesce?: string) => {
    patchLayers(layer => {
      const current = layer.shader?.procedural;
      return current ? { procedural: normalizeProcedural(change(current)) } : {};
    }, undefined, coalesce ? `procedural-${coalesce}` : undefined);
  };
  const setField = <G extends Group>(group: G, key: keyof ProceduralConfig[G] & string, value: unknown, coalesce?: string) =>
    edit(current => ({ ...current, [group]: { ...current[group], [key]: value } }) as ProceduralConfig, coalesce ?? `${group}-${key}`);
  const setStage = (index: number, key: keyof ProceduralStage, value: unknown, coalesce?: string) =>
    edit(current => ({ ...current, distortion: current.distortion.map((stage, i) => i === index ? { ...stage, [key]: value } : stage) }) as ProceduralConfig, coalesce ?? `stage-${index}-${key}`);

  const proceduralizeLayer = (layer: typeof layers[number], mode: 'hybrid' | 'full') => {
    const adapted = gradientLayerToShader(layer, project);
    if (!canProceduralize(adapted)) return null;
    return proceduralizeSource(adapted, { mode, seed: 1000 + layers.indexOf(layer) * 97 });
  };
  const proceduralizeTargets = (mode: 'hybrid' | 'full') => {
    const results = new Map(targets.map(layer => [layer.id, proceduralizeLayer(layer, mode)]));
    patchLayers(layer => {
      const result = results.get(layer.id);
      return result ? { enabled: true, procedural: result.config } : {};
    });
    const count = [...results.values()].filter(Boolean).length;
    announce(count ? `Proceduralized ${count} layer${count === 1 ? '' : 's'}. The original gradients are untouched.` : 'These layers have no colours to convert, so start from a preset instead.');
  };
  const startFresh = (presetId?: string) => {
    const values = new Map(targets.map(layer => {
      const base = newProcedural({ enabled: true, mode: 'full', seed: 1337 + layers.indexOf(layer) * 131 });
      const preset = ALL_PROCEDURAL_PRESETS.find(item => item.id === presetId);
      return [layer.id, preset ? applyPreset(base, preset) : base] as const;
    }));
    patchLayers(layer => ({ enabled: true, procedural: values.get(layer.id) ?? layer.shader?.procedural }));
  };
  const remove = () => {
    patchLayers({ procedural: undefined });
    announce('Procedural engine removed. The manual gradient is back exactly as it was.');
  };

  const toggleLock = (group: string) => edit(current => ({ ...current, locks: current.locks.includes(group) ? current.locks.filter(item => item !== group) : [...current.locks, group] }), `lock-${group}`);
  const randomize = (scope: RandomizeScope) => {
    rollRef.current += 1;
    const roll = (Date.now() % 100000) + rollRef.current;
    edit(current => randomizeProcedural(current, scope, roll));
    announce(scope === 'all' ? 'Randomized every unlocked setting.' : `Randomized ${scope}.`);
  };

  const savePreset = () => {
    if (!config) return;
    const name = window.prompt('Name this preset', 'My procedural look')?.trim();
    if (!name) return;
    const next = [{ name: name.slice(0, 60), config }, ...userPresets.filter(item => item.name !== name)].slice(0, 24);
    setUserPresets(next);
    saveUserPresets(next);
    announce(`Saved preset “${name}”.`);
  };
  const exportPreset = () => {
    if (!config) return;
    const blob = new Blob([serializePresetFile('Procedural preset', config)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'procedural-preset.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  const importPreset = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parsePresetFile(await file.text());
    if (!parsed) { announce('That file is not a procedural preset.'); return; }
    edit(current => applyPreset(current, parsed.config));
    announce(`Applied preset “${parsed.name}”.`);
  };

  if (!primary) return <p className="hint">Add a gradient layer first.</p>;
  const canConvert = canProceduralize(gradientLayerToShader(primary, project));
  const allTargetsProcedural = targets.length > 0 && targets.every(layer => layer.shader?.procedural?.enabled);
  const targetLabel = selected.length ? `${targets.length} selected layer${targets.length === 1 ? '' : 's'}` : 'focused layer';

  if (!config || !active) {
    return <div data-testid="shader-panel-procedural">
      <Section title="Procedural gradient">
        <Switch
          label={`Procedural on ${targetLabel}`}
          checked={allTargetsProcedural}
          onChange={enabled => patchLayers(layer => ({
            enabled: enabled ? true : layer.shader?.enabled ?? false,
            procedural: enabled
              ? normalizeProcedural({ ...(layer.shader?.procedural ?? newProcedural()), enabled: true })
              : layer.shader?.procedural ? { ...layer.shader.procedural, enabled: false } : undefined,
          }))}
          testId="procedural-enable-targets"
        />
        <p className="hint">A seeded field of colour centres that move, blend and react to the pointer — the whole look comes from one seed. Your manual gradient is never changed: you can switch this off and get it back exactly.</p>
        <div className="gs-sh-actions">
          <button type="button" className="btn" disabled={!canConvert} onClick={() => proceduralizeTargets('full')} data-testid="procedural-convert-full">Proceduralize this gradient</button>
          <button type="button" className="btn" disabled={!canConvert} onClick={() => proceduralizeTargets('hybrid')} data-testid="procedural-convert-hybrid">Add over the gradient (hybrid)</button>
          <button type="button" className="btn" onClick={() => startFresh()} data-testid="procedural-new">Start from scratch</button>
        </div>
        {!canConvert && <p className="hint">This layer has no colour stops to convert, so “Start from scratch” or a preset is the way in.</p>}
        {config && <p className="hint">Procedural is off for this layer; your settings are kept. <button type="button" className="chip" onClick={() => edit(current => ({ ...current, enabled: true }))}>Turn it back on</button></p>}
      </Section>
      <Section title="Start from a preset">
        <div className="gs-sh-chips">
          {ALL_PROCEDURAL_PRESETS.map(preset => <button key={preset.id} type="button" className="chip" title={preset.description} onClick={() => startFresh(preset.id)} data-testid={`procedural-start-${preset.id}`}>{preset.name}</button>)}
        </div>
      </Section>
    </div>;
  }

  const def = DEFAULT_PROCEDURAL;
  const R = PROC_RANGES;
  const cost = proceduralCost(config);
  const lockChips: [string, string][] = [['color', 'Colours'], ['motion', 'Motion'], ['field', 'Field'], ['distortion', 'Distortion'], ['points', 'Points'], ['seed', 'Seed']];

  return <div data-testid="shader-panel-procedural">
    <Section title="Procedural engine" aside={`${cost} cost`}>
      <Switch label={`Procedural on ${targetLabel}`} checked={allTargetsProcedural} onChange={enabled => patchLayers(layer => ({
        enabled: enabled ? true : layer.shader?.enabled ?? false,
        procedural: enabled
          ? normalizeProcedural({ ...(layer.shader?.procedural ?? newProcedural()), enabled: true })
          : layer.shader?.procedural ? { ...layer.shader.procedural, enabled: false } : undefined,
      }))} testId="procedural-enabled" />
      <Select id="procedural-mode" label="Mode" value={config.mode} options={PROC_MODES.map(id => ({ id, label: MODE_LABEL[id] }))} onChange={mode => edit(current => ({ ...current, mode }), 'mode')} />
      {config.mode === 'hybrid' && <Num label="Procedural strength" value={config.mix} min={R.mix.min} max={R.mix.max} def={def.mix} onChange={mix => edit(current => ({ ...current, mix }), 'mix')} testId="procedural-mix" />}
      <Num label="Seed" value={config.seed} min={R.seed.min} max={R.seed.max} step={1} def={def.seed} onChange={seed => edit(current => reseed(current, seed), 'seed')} testId="procedural-seed" />
      <div className="gs-sh-actions">
        <button type="button" className="btn small" onClick={() => edit(current => reseed(current, Math.floor(Math.random() * 999999)))} data-testid="procedural-reseed">New seed</button>
        <button type="button" className="btn small" onClick={remove} data-testid="procedural-remove">Remove &amp; restore gradient</button>
      </div>
      {config.origin && <p className="hint" data-testid="procedural-origin">Converted from a {config.origin.from} gradient. {config.origin.note}</p>}
      {(config.origin?.from === 'mesh' || config.mesh.source === 'layer') && (
        <Section title="Mesh rendering">
          <MeshRenderControls value={config} onChange={next => edit(() => next, 'mesh')} pointCount={primary?.mesh?.points.length ?? 0} />
        </Section>
      )}
      {cost === 'High' &&       <p className="hint">This combination is heavy. Lower the distortion octaves or point count if it stutters; preview pixel density is automatically shared across visible shader layers.</p>}
    </Section>

    <Section title="Colour centres">
      <Select id="procedural-distribution" label="Distribution" value={config.points.distribution} options={options(POINT_DISTRIBUTIONS)} onChange={value => setField('points', 'distribution', value)} />
      <Num label="Minimum points" value={config.points.min} min={1} max={PROC_MAX_POINTS} step={1} def={def.points.min} onChange={value => setField('points', 'min', value)} testId="procedural-points-min" />
      <Num label="Maximum points" value={config.points.max} min={1} max={PROC_MAX_POINTS} step={1} def={def.points.max} onChange={value => setField('points', 'max', value)} testId="procedural-points-max" />
      <Num label="Density (min → max)" value={config.points.density} min={0} max={1} def={def.points.density} onChange={value => setField('points', 'density', value)} testId="procedural-density" />
      <Num label="Spacing" value={config.points.spacing} min={0} max={1} def={def.points.spacing} onChange={value => setField('points', 'spacing', value)} />
      <Num label="Spread" value={config.points.spread} min={R.points.spread.min} max={R.points.spread.max} def={def.points.spread} onChange={value => setField('points', 'spread', value)} />
      <Num label="Radius" value={config.points.radius} min={R.points.radius.min} max={R.points.radius.max} def={def.points.radius} onChange={value => setField('points', 'radius', value)} />
      <Num label="Weight" value={config.points.weight} min={R.points.weight.min} max={R.points.weight.max} def={def.points.weight} onChange={value => setField('points', 'weight', value)} />
      <Num label="Influence" value={config.points.influence} min={R.points.influence.min} max={R.points.influence.max} def={def.points.influence} onChange={value => setField('points', 'influence', value)} />
      <Num label="Per-point variation" value={config.points.variance} min={0} max={1} def={def.points.variance} onChange={value => setField('points', 'variance', value)} />
      {config.anchors.length > 0 && <>
        <p className="hint">{config.anchors.length} points are pinned to the converted gradient. Raise “Maximum points” to add generated ones, or release the pins to generate everything from the seed.</p>
        <button type="button" className="btn small" onClick={() => edit(current => ({ ...current, anchors: [], origin: null }))} data-testid="procedural-release-anchors">Release pinned points</button>
      </>}
    </Section>

    <Section title="Colour field">
      <Select id="procedural-method" label="Blend method" value={config.field.method} options={FIELD_METHODS.map(id => ({ id, label: FIELD_LABEL[id] }))} onChange={value => setField('field', 'method', value)} />
      <Num label="Radius" value={config.field.radius} min={R.field.radius.min} max={R.field.radius.max} def={def.field.radius} onChange={value => setField('field', 'radius', value)} />
      <Num label="Strength" value={config.field.strength} min={R.field.strength.min} max={R.field.strength.max} def={def.field.strength} onChange={value => setField('field', 'strength', value)} />
      <Num label="Falloff (soft → sharp)" value={config.field.falloff} min={0} max={1} def={def.field.falloff} onChange={value => setField('field', 'falloff', value)} />
      <Num label="Softness" value={config.field.softness} min={0} max={1} def={def.field.softness} onChange={value => setField('field', 'softness', value)} />
      <Num label="Influence exponent" value={config.field.exponent} min={R.field.exponent.min} max={R.field.exponent.max} def={def.field.exponent} onChange={value => setField('field', 'exponent', value)} />
      <Num label="Overlap" value={config.field.overlap} min={0} max={1} def={def.field.overlap} onChange={value => setField('field', 'overlap', value)} />
    </Section>

    <Section title="Point motion">
      <Select id="procedural-motion" label="Motion" value={config.motion.type} options={MOTION_TYPES.map(id => ({ id, label: MOTION_LABEL[id] }))} onChange={value => setField('motion', 'type', value)} />
      <Switch label="Give every point its own motion" checked={config.motion.mixed} onChange={value => setField('motion', 'mixed', value)} testId="procedural-mixed" />
      <Num label="Speed" value={config.motion.speed} min={R.motion.speed.min} max={R.motion.speed.max} def={def.motion.speed} onChange={value => setField('motion', 'speed', value)} testId="procedural-speed" />
      <Switch label="Reverse direction" checked={config.motion.direction < 0} onChange={value => setField('motion', 'direction', value ? -1 : 1)} testId="procedural-reverse" />
      <Num label="Amplitude" value={config.motion.amplitude} min={R.motion.amplitude.min} max={R.motion.amplitude.max} def={def.motion.amplitude} onChange={value => setField('motion', 'amplitude', value)} />
      <Num label="Frequency" value={config.motion.frequency} min={R.motion.frequency.min} max={R.motion.frequency.max} def={def.motion.frequency} onChange={value => setField('motion', 'frequency', value)} />
      <Num label="Phase" value={config.motion.phase} min={0} max={360} step={1} unit="°" def={def.motion.phase} onChange={value => setField('motion', 'phase', value)} />
      <Num label="Smoothness" value={config.motion.smoothness} min={0} max={1} def={def.motion.smoothness} onChange={value => setField('motion', 'smoothness', value)} />
      <Num label="Randomness" value={config.motion.randomness} min={0} max={1} def={def.motion.randomness} onChange={value => setField('motion', 'randomness', value)} />
      <Num label="Motion influence" value={config.motion.influence} min={0} max={1} def={def.motion.influence} onChange={value => setField('motion', 'influence', value)} />
    </Section>

    <Section title="Distortion" aside={`${config.distortion.filter(stage => stage.type !== 'none' && stage.enabled).length} of 3 on`}>
      {config.distortion.map((stage, index) => <div key={index} className="gs-sh-stage" data-testid={`procedural-stage-${index}`}>
        <Select id={`procedural-stage-${index}-type`} label={`Stage ${index + 1}`} value={stage.type} options={DISTORTION_TYPES.map(id => ({ id, label: DIST_LABEL[id] }))} onChange={value => setStage(index, 'type', value)} />
        {stage.type !== 'none' && <>
          <Switch label="Enabled" checked={stage.enabled} onChange={value => setStage(index, 'enabled', value)} testId={`procedural-stage-${index}-enabled`} />
          {(STAGE_CONTROLS[stage.type] ?? []).map(key => key === 'noise'
            ? <Select key={key} id={`procedural-stage-${index}-noise`} label="Noise" value={stage.noise} options={options(NOISE_KINDS, { gradient: 'Gradient (smooth)', value: 'Value (blocky)' })} onChange={value => setStage(index, 'noise', value)} />
            : <Num key={key} label={STAGE_LABEL[key]} value={stage[key] as number} min={R.stage[key as keyof typeof R.stage].min} max={R.stage[key as keyof typeof R.stage].max}
              step={STAGE_STEP[key] ?? 0.01} def={DEFAULT_PROCEDURAL_STAGE[key] as number} onChange={value => setStage(index, key, value)} />)}
        </>}
      </div>)}
      <p className="hint">Stages run in order. Octaves are capped automatically when the preview has to lower its quality.</p>
    </Section>

    <Section title="Colour">
      <Select id="procedural-color-source" label="Colours come from" value={config.color.source} options={[{ id: 'layer', label: 'This layer’s palette' }, { id: 'custom', label: 'Custom colours' }]} onChange={value => setField('color', 'source', value)} />
      {config.color.source === 'custom' && <div className="gs-sh-swatches" data-testid="procedural-colors">
        {config.color.colors.map((color, index) => <input key={index} type="color" value={color} aria-label={`Colour ${index + 1}`}
          onChange={event => setField('color', 'colors', config.color.colors.map((item, i) => i === index ? event.target.value : item), 'colors')} />)}
        {config.color.colors.length < 8 && <button type="button" className="chip" onClick={() => setField('color', 'colors', [...config.color.colors, config.color.colors[config.color.colors.length - 1]])}>+ Add</button>}
        {config.color.colors.length > 2 && <button type="button" className="chip" onClick={() => setField('color', 'colors', config.color.colors.slice(0, -1))}>− Remove</button>}
      </div>}
      <Select id="procedural-space" label="Blend in" value={config.color.interpolation} options={options(COLOR_SPACES, { srgb: 'sRGB', linear: 'Linear light', oklab: 'OKLab (perceptual)' })} onChange={value => setField('color', 'interpolation', value)} />
      <Switch label="Shuffle colour order" checked={config.color.shuffle} onChange={value => setField('color', 'shuffle', value)} testId="procedural-shuffle" />
      <Num label="Colour variance" value={config.color.variance} min={0} max={1} def={def.color.variance} onChange={value => setField('color', 'variance', value)} />
      <Switch label="Animate between colour stops" checked={config.color.cycleSpeed !== 0} onChange={enabled => setField('color', 'cycleSpeed', enabled ? (def.color.cycleSpeed || 0.5) : 0)} testId="procedural-palette-animation" />
      {config.color.cycleSpeed !== 0 && <Num label="Animation speed" value={config.color.cycleSpeed} min={R.color.cycleSpeed.min} max={R.color.cycleSpeed.max} def={def.color.cycleSpeed} onChange={value => setField('color', 'cycleSpeed', value)} testId="procedural-palette-speed" />}
      <Num label="Hue shift" value={config.color.hue} min={-180} max={180} step={1} unit="°" def={def.color.hue} onChange={value => setField('color', 'hue', value)} />
      <Num label="Saturation" value={config.color.saturation} min={R.color.saturation.min} max={R.color.saturation.max} def={def.color.saturation} onChange={value => setField('color', 'saturation', value)} />
      <Num label="Exposure" value={config.color.exposure} min={R.color.exposure.min} max={R.color.exposure.max} def={def.color.exposure} onChange={value => setField('color', 'exposure', value)} />
      <Num label="Contrast" value={config.color.contrast} min={R.color.contrast.min} max={R.color.contrast.max} def={def.color.contrast} onChange={value => setField('color', 'contrast', value)} />
      <Num label="Temperature" value={config.color.temperature} min={-1} max={1} def={def.color.temperature} onChange={value => setField('color', 'temperature', value)} />
    </Section>

    <Section title="Pointer reaction">
      <Select id="procedural-force" label="Points react by" value={config.interaction.force} options={FORCE_TYPES.map(id => ({ id, label: FORCE_LABEL[id] }))} onChange={value => setField('interaction', 'force', value)} />
      {config.interaction.force !== 'none' && <>
        <Num label="Reach" value={config.interaction.radius} min={R.interaction.radius.min} max={R.interaction.radius.max} def={def.interaction.radius} onChange={value => setField('interaction', 'radius', value)} />
        <Num label="Strength" value={config.interaction.strength} min={R.interaction.strength.min} max={R.interaction.strength.max} def={def.interaction.strength} onChange={value => setField('interaction', 'strength', value)} />
        <Select id="procedural-falloff" label="Falloff" value={config.interaction.falloff} options={options(FALLOFFS)} onChange={value => setField('interaction', 'falloff', value)} />
        <Num label="Response speed" value={config.interaction.response} min={R.interaction.response.min} max={R.interaction.response.max} step={0.5} unit="/s" def={def.interaction.response} onChange={value => setField('interaction', 'response', value)} />
      </>}
      <p className="hint">Uses the same pointer, touch and idle-pointer input as the Interact tab. Turn a layer’s interaction off there to silence it.</p>
    </Section>

    <Section title="Presets & randomize">
      <div className="gs-sh-chips" data-testid="procedural-presets">
        {ALL_PROCEDURAL_PRESETS.map(preset => <button key={preset.id} type="button" className="chip" title={preset.description} onClick={() => edit(current => applyPreset(current, preset))} data-testid={`procedural-preset-${preset.id}`}>{preset.name}</button>)}
      </div>
      <p className="hint">Lock what you want to keep. Presets and randomize leave locked groups alone.</p>
      <div className="gs-sh-chips" role="group" aria-label="Locks">
        {lockChips.map(([id, label]) => <button key={id} type="button" className="chip" aria-pressed={config.locks.includes(id)} onClick={() => toggleLock(id)} data-testid={`procedural-lock-${id}`}>{config.locks.includes(id) ? '🔒 ' : ''}{label}</button>)}
      </div>
      <div className="gs-sh-chips" role="group" aria-label="Randomize">
        {(['all', 'color', 'motion', 'field', 'distortion', 'points'] as RandomizeScope[]).map(scope => <button key={scope} type="button" className="chip" onClick={() => randomize(scope)} data-testid={`procedural-random-${scope}`}>🎲 {scope === 'all' ? 'Everything' : LABEL(scope)}</button>)}
      </div>
      <div className="gs-sh-actions">
        <button type="button" className="btn small" onClick={savePreset} data-testid="procedural-save-preset">Save as preset</button>
        <button type="button" className="btn small" onClick={exportPreset} data-testid="procedural-export-preset">Export file</button>
        <button type="button" className="btn small" onClick={() => fileRef.current?.click()} data-testid="procedural-import-preset">Import file</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={event => { void importPreset(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
      {userPresets.length > 0 && <div className="gs-sh-chips" data-testid="procedural-user-presets">
        {userPresets.map(preset => <span key={preset.name} className="gs-sh-userpreset">
          <button type="button" className="chip" onClick={() => edit(current => applyPreset(current, preset.config))}>{preset.name}</button>
          <button type="button" className="chip" aria-label={`Delete preset ${preset.name}`} onClick={() => { const next = userPresets.filter(item => item.name !== preset.name); setUserPresets(next); saveUserPresets(next); }}>×</button>
        </span>)}
      </div>}
    </Section>
  </div>;
}
