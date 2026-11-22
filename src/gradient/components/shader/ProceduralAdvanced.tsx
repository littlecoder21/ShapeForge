import { Switch } from '../../../shared/controls';
import {
  DEFAULT_FIELD_LAYER, FIELD_BLEND_OPS, INFLUENCE_SHAPES, LAYER_KERNELS, MOTION_EASINGS, POINT_DISTRIBUTIONS, PROC_MAX_FIELDS, PROC_RANGES,
  estimateProceduralCost, fieldFamily, fieldFeatures, normalizeFieldLayer, proceduralNeed, proceduralSignature, proceduralVectorsPerPoint, tierFor,
  type FieldBlendOp, type InfluenceShape, type LayerKernel, type MotionEasing, type ProceduralConfig, type ProceduralFieldLayer, type ProceduralMaterial,
  type StageTarget,
} from '../../../procedural/types';
import { Num, Section, Select } from './parts';

/* The advanced sections of the Procedural panel: Point influence, Field composition (extra fields), Lighting & glow and
 * Performance, plus the small control groups the existing sections (interpolation, colour, distortion, animation, interaction)
 * gain. Everything here edits the one ProceduralConfig through `edit`, exactly like the rest of the panel. */

export type EditConfig = (change: (current: ProceduralConfig) => ProceduralConfig, coalesce?: string) => void;
interface Props { config: ProceduralConfig; edit: EditConfig }

const LABEL = (id: string) => id.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
const labelled = <T extends string>(ids: readonly T[], overrides: Partial<Record<T, string>> = {}) => ids.map(id => ({ id, label: overrides[id] ?? LABEL(id) }));

export const SHAPE_LABEL: Record<InfluenceShape, string> = {
  circle: 'Circle (default)', ellipse: 'Ellipse', 'rounded-rect': 'Rounded rectangle', diamond: 'Diamond', directional: 'Directional (teardrop)', polygon: 'Polygon',
};
export const BLEND_LABEL: Record<FieldBlendOp, string> = {
  mix: 'Mix (normal)', add: 'Add', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', 'soft-light': 'Soft light', difference: 'Difference',
  max: 'Maximum influence', min: 'Minimum influence', weighted: 'Weighted blend',
};
export const KERNEL_LABEL: Record<LayerKernel, string> = {
  gaussian: 'Gaussian', soft: 'Wide Gaussian', smooth: 'Smooth falloff', radial: 'Radial', idw: 'Inverse distance', 'wendland-c2': 'Compact support', 'inverse-multiquadric': 'Inverse multiquadric',
};
export const EASING_LABEL: Record<MotionEasing, string> = {
  smooth: 'Smooth (default)', linear: 'Linear', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in-out', cubic: 'Cubic', spring: 'Spring (overshoot)', elastic: 'Elastic', custom: 'Custom curve',
};
export const TARGET_LABEL: Record<StageTarget, string> = {
  layer: 'Whole layer (everything moves)', field: 'Colour field only', points: 'Colour centres (heavier)', color: 'Colour only (hue / exposure)',
};
const DISTRIBUTION_LABEL = (id: string) => LABEL(id);

const hexValue = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff');

/** Quick starting points for an extra field, so the common "glow / highlight / dark surround" recipes are one click. */
const LAYER_RECIPES: { id: string; label: string; layer: Partial<ProceduralFieldLayer> }[] = [
  { id: 'glow', label: '+ Warm glow', layer: { kernel: 'soft', blend: 'screen', opacity: 0.8, strength: 1.2, radius: 0.6, count: 1, pointRadius: 0.2, colors: ['#ff9a4a'], spread: 0.6 } },
  { id: 'highlight', label: '+ Soft highlight', layer: { kernel: 'gaussian', blend: 'soft-light', opacity: 0.7, falloff: 0.7, count: 1, pointRadius: 0.14, colors: ['#ffffff'], spread: 0.6 } },
  { id: 'surround', label: '+ Dark surround', layer: { kernel: 'soft', blend: 'multiply', opacity: 0.5, count: 3, pointRadius: 0.5, colors: ['#0a1230'], spread: 1 } },
  { id: 'accent', label: '+ Accent spots', layer: { kernel: 'wendland-c2', blend: 'mix', opacity: 0.6, count: 3, pointRadius: 0.16, colors: ['#ff4f9a', '#4fd8ff'], spread: 0.9 } },
];

/* ─────────────── Point influence ─────────────── */

export function InfluenceSection({ config, edit }: Props) {
  const R = PROC_RANGES.influence;
  const def = newInfluence();
  const set = (key: keyof ProceduralConfig['influence'], value: unknown) => edit(current => ({ ...current, influence: { ...current.influence, [key]: value } }), `influence-${key}`);
  const inf = config.influence;
  const family = fieldFamily(config.field.method);
  const round = inf.shape === 'circle';
  return <Section title="Point influence" aside={SHAPE_LABEL[inf.shape].split(' (')[0]} testId="procedural-section-influence">
    <Select id="procedural-influence-shape" label="Reach shape" value={inf.shape} options={INFLUENCE_SHAPES.map(id => ({ id, label: SHAPE_LABEL[id] }))} onChange={value => set('shape', value)} />
    {!round && <>
      <Num label="Rotation" value={inf.rotation} min={R.rotation.min} max={R.rotation.max} step={1} unit="°" def={def.rotation} onChange={value => set('rotation', value)} testId="procedural-influence-rotation" />
      <Num label="Stretch (anisotropy)" value={inf.anisotropy} min={R.anisotropy.min} max={R.anisotropy.max} def={def.anisotropy} onChange={value => set('anisotropy', value)} testId="procedural-influence-anisotropy" />
    </>}
    {inf.shape === 'polygon' && <>
      <Num label="Sides" value={inf.sides} min={R.sides.min} max={R.sides.max} step={1} def={def.sides} onChange={value => set('sides', value)} testId="procedural-influence-sides" />
      <Num label="Corner rounding" value={inf.rounding} min={R.rounding.min} max={R.rounding.max} def={def.rounding} onChange={value => set('rounding', value)} />
    </>}
    <Num label="Flat core (holds full colour)" value={inf.inner} min={R.inner.min} max={R.inner.max} def={def.inner} onChange={value => set('inner', value)} testId="procedural-influence-inner" />
    <Num label="Core boost" value={inf.core} min={R.core.min} max={R.core.max} def={def.core} onChange={value => set('core', value)} testId="procedural-influence-core" />
    {family === 'rbf'
      ? <p className="hint">Exact interpolation (RBF) fits numbers through the points, so the reach shape, flat core and core boost do not apply to it. Pick another method to use them.</p>
      : <p className="hint">Shape changes where each point’s radius ends; the falloff curve is unchanged. Circle with no core is the original look and adds nothing to the shader.</p>}
  </Section>;
}

const newInfluence = () => ({ shape: 'circle' as const, rotation: 0, anisotropy: 1, inner: 0, core: 0, sides: 6, rounding: 0.2 });

/* ─────────────── Field composition (extra fields) ─────────────── */

export function FieldCompositionSection({ config, edit }: Props) {
  const R = PROC_RANGES.layer;
  const css = config.mesh.render === 'css-compatible';
  const setLayer = (index: number, change: Partial<ProceduralFieldLayer>, coalesce?: string) =>
    edit(current => ({ ...current, fields: current.fields.map((layer, i) => i === index ? { ...layer, ...change } : layer) }), coalesce ?? `layer-${index}-${Object.keys(change)[0]}`);
  const add = (patch: Partial<ProceduralFieldLayer> = {}) =>
    edit(current => current.fields.length >= PROC_MAX_FIELDS ? current : { ...current, fields: [...current.fields, normalizeFieldLayer({ ...DEFAULT_FIELD_LAYER, ...patch })] });
  const remove = (index: number) => edit(current => ({ ...current, fields: current.fields.filter((_, i) => i !== index) }));
  const full = config.fields.length >= PROC_MAX_FIELDS;
  return <Section title="Field composition" aside={config.fields.length ? `${config.fields.filter(layer => layer.enabled).length} extra` : 'one field'} testId="procedural-section-fields">
    <p className="hint">The main field above is field 1. Extra fields share the same shader pass and the same motion, pointer and distortion settings — no extra render targets.</p>
    {css && <p className="hint">Extra fields are not drawn while the mesh is rendered CSS-compatibly. Switch “Mesh rendering” to the unified field to see them.</p>}
    {config.fields.map((layer, index) => <div key={index} className="gs-sh-stage" data-testid={`procedural-field-${index}`}>
      <Switch label={`Field ${index + 2}`} checked={layer.enabled} onChange={value => setLayer(index, { enabled: value })} testId={`procedural-field-${index}-enabled`} />
      {layer.enabled && <>
        <Select id={`procedural-field-${index}-blend`} label="Combine with what is below" value={layer.blend} options={FIELD_BLEND_OPS.map(id => ({ id, label: BLEND_LABEL[id] }))} onChange={value => setLayer(index, { blend: value })} />
        <Num label="Opacity" value={layer.opacity} min={R.opacity.min} max={R.opacity.max} def={DEFAULT_FIELD_LAYER.opacity} onChange={value => setLayer(index, { opacity: value })} testId={`procedural-field-${index}-opacity`} />
        <Num label="Strength" value={layer.strength} min={R.strength.min} max={R.strength.max} def={DEFAULT_FIELD_LAYER.strength} onChange={value => setLayer(index, { strength: value })} />
        <Select id={`procedural-field-${index}-kernel`} label="Falloff kernel" value={layer.kernel} options={LAYER_KERNELS.map(id => ({ id, label: KERNEL_LABEL[id] }))} onChange={value => setLayer(index, { kernel: value })} />
        <Num label="Reach" value={layer.radius} min={R.radius.min} max={R.radius.max} def={DEFAULT_FIELD_LAYER.radius} onChange={value => setLayer(index, { radius: value })} />
        <Num label="Falloff (soft → sharp)" value={layer.falloff} min={R.falloff.min} max={R.falloff.max} def={DEFAULT_FIELD_LAYER.falloff} onChange={value => setLayer(index, { falloff: value })} />
        <Num label="Centres" value={layer.count} min={R.count.min} max={R.count.max} step={1} def={DEFAULT_FIELD_LAYER.count} onChange={value => setLayer(index, { count: Math.round(value) })} testId={`procedural-field-${index}-count`} />
        <Select id={`procedural-field-${index}-distribution`} label="Placement" value={layer.distribution} options={POINT_DISTRIBUTIONS.map(id => ({ id, label: DISTRIBUTION_LABEL(id) }))} onChange={value => setLayer(index, { distribution: value })} />
        <Num label="Centre size" value={layer.pointRadius} min={R.pointRadius.min} max={R.pointRadius.max} def={DEFAULT_FIELD_LAYER.pointRadius} onChange={value => setLayer(index, { pointRadius: value })} />
        <Num label="Spread" value={layer.spread} min={R.spread.min} max={R.spread.max} def={DEFAULT_FIELD_LAYER.spread} onChange={value => setLayer(index, { spread: value })} />
        <div className="gs-sh-swatches" data-testid={`procedural-field-${index}-colors`}>
          {layer.colors.map((color, c) => <input key={c} type="color" value={hexValue(color)} aria-label={`Field ${index + 2} colour ${c + 1}`}
            onChange={event => setLayer(index, { colors: layer.colors.map((item, i) => i === c ? event.target.value : item) }, `layer-${index}-colors`)} />)}
          {layer.colors.length < 4 && <button type="button" className="chip" onClick={() => setLayer(index, { colors: [...layer.colors, layer.colors[layer.colors.length - 1]] })}>+ Colour</button>}
          {layer.colors.length > 1 && <button type="button" className="chip" onClick={() => setLayer(index, { colors: layer.colors.slice(0, -1) })}>− Colour</button>}
        </div>
        <Switch label="Follows the distortion" checked={layer.distort} onChange={value => setLayer(index, { distort: value })} testId={`procedural-field-${index}-distort`} />
      </>}
      <div className="gs-sh-actions"><button type="button" className="btn small" onClick={() => remove(index)} data-testid={`procedural-field-${index}-remove`}>Remove field {index + 2}</button></div>
    </div>)}
    <div className="gs-sh-chips" role="group" aria-label="Add an extra field">
      {LAYER_RECIPES.map(recipe => <button key={recipe.id} type="button" className="chip" disabled={full} onClick={() => add(recipe.layer)} data-testid={`procedural-field-add-${recipe.id}`}>{recipe.label}</button>)}
      <button type="button" className="chip" disabled={full} onClick={() => add()} data-testid="procedural-field-add">+ Blank field</button>
    </div>
    {full && <p className="hint">The maximum of {PROC_MAX_FIELDS} extra fields is in use.</p>}
  </Section>;
}

/* ─────────────── Lighting & glow ─────────────── */

const MATERIAL_GROUPS: { title: string; rows: [keyof ProceduralMaterial, string, number?][] }[] = [
  { title: 'Glow', rows: [['glow', 'Glow'], ['bloom', 'Bloom'], ['bloomThreshold', 'Bloom threshold'], ['innerGlow', 'Inner glow'], ['edgeGlow', 'Edge glow'], ['scatter', 'Light scatter']] },
  { title: 'Light', rows: [['ambient', 'Ambient'], ['light', 'Directional light'], ['lightAngle', 'Light angle', 1], ['lightElevation', 'Light height'], ['specular', 'Specular'], ['shininess', 'Shininess', 1], ['shadow', 'Soft shadow']] },
  { title: 'Surface', rows: [['depth', 'Depth (lightness as height)'], ['radius', 'Effect size']] },
];

export function MaterialSection({ config, edit }: Props) {
  const m = config.material;
  const def = DEFAULT_MATERIAL;
  const set = (key: keyof ProceduralMaterial, value: unknown) => edit(current => ({ ...current, material: { ...current.material, [key]: value } }), `material-${key}`);
  const active = fieldFeatures(config).material;
  return <Section title="Lighting & glow" aside={m.enabled ? (active ? 'on' : 'on · no effect set') : 'off'} testId="procedural-section-material">
    <Switch label="Lighting & glow" checked={m.enabled} onChange={value => set('enabled', value)} testId="procedural-material-enabled" />
    {m.enabled && <>
      {MATERIAL_GROUPS.map(group => <div key={group.title} className="gs-sh-stage">
        <b>{group.title}</b>
        {group.rows.map(([key, label, step]) => <Num key={key} label={label} value={m[key] as number} min={PROC_RANGES.material[key as keyof typeof PROC_RANGES.material].min}
          max={PROC_RANGES.material[key as keyof typeof PROC_RANGES.material].max} step={step ?? 0.01} unit={key === 'lightAngle' ? '°' : undefined} def={def[key] as number}
          onChange={value => set(key, value)} testId={`procedural-material-${key}`} />)}
      </div>)}
      <p className="hint">The field’s own lightness is read as a height map, so the light follows the colour shapes. Nothing is added except light. Costs roughly four times the plain field; it is compiled in only while at least one effect is above zero.</p>
    </>}
  </Section>;
}
const DEFAULT_MATERIAL: ProceduralMaterial = { enabled: false, radius: 0.4, glow: 0, bloom: 0, bloomThreshold: 0.6, innerGlow: 0, edgeGlow: 0, ambient: 0.55, light: 0, lightAngle: 135, lightElevation: 0.6, specular: 0, shininess: 28, depth: 1, shadow: 0, scatter: 0 };

/* ─────────────── Performance ─────────────── */

const LEVEL_LABEL = { low: 'Low', medium: 'Medium', high: 'High', extreme: 'Extreme' } as const;

export function PerformanceSection({ config }: { config: ProceduralConfig }) {
  const cost = estimateProceduralCost(config);
  const features = fieldFeatures(config);
  const need = proceduralNeed(config);
  const perPoint = proceduralVectorsPerPoint(config);
  const compiled: string[] = [`${LABEL(features.method)} interpolation (${features.family})`];
  if (features.shaped) compiled.push('shaped reach');
  if (features.lch) compiled.push('OKLCH hue path');
  if (features.chroma) compiled.push('chroma preservation');
  if (features.layers) compiled.push(`${features.layers} extra field${features.layers === 1 ? '' : 's'}`);
  if (features.material) compiled.push('lighting & glow');
  const perPointStages = config.distortion.filter(stage => stage.enabled && stage.type !== 'none' && stage.target === 'points').length;
  const tips: string[] = [];
  if (features.material) tips.push('Lighting & glow re-samples the field several times per pixel. Lower the effect size or turn off unused effects on slow devices.');
  if (perPointStages) tips.push('A distortion that moves the colour centres runs once per centre per pixel. Use it on one stage and keep the octaves low.');
  if (features.family === 'cells') tips.push('Cell-based methods need two passes over the centres in one shader. Fewer centres keeps them cheap.');
  if (features.family === 'rbf') tips.push('Exact interpolation solves a small linear system every frame on the CPU; it is cheap up to about 24 centres and still fine at 128.');
  if (cost.level === 'extreme') tips.push('This combination is very heavy. Preview density is lowered automatically, but consider fewer fields, centres or effects.');
  return <Section title="Performance" aside={`${LEVEL_LABEL[cost.level]} cost`} testId="procedural-section-performance">
    <dl className="gs-sh-facts" data-testid="procedural-performance">
      <div><dt>Relative cost</dt><dd data-testid="procedural-cost-score">{cost.score}× a single Gaussian field · {LEVEL_LABEL[cost.level]}</dd></div>
      <div><dt>Centres drawn</dt><dd>{need} (compiled for {tierFor(need)}, {perPoint} uniform vectors each)</dd></div>
      <div><dt>Compiled into the shader</dt><dd>{compiled.join(' · ')}</dd></div>
    </dl>
    {tips.map(tip => <p key={tip} className="hint">{tip}</p>)}
    <p className="hint">Only the choices listed above rebuild the shader (once). Every slider, colour and toggle inside them is a uniform and changes instantly. Everything is drawn in one pass with one WebGL context.</p>
    <p className="hint"><code data-testid="procedural-signature">{proceduralSignature(config)}</code></p>
  </Section>;
}

/* ─────────────── small groups the existing sections gain ─────────────── */

/** Interpolation extras: global influence, and the custom kernel mix. */
export function InterpolationExtras({ config, edit }: Props) {
  const R = PROC_RANGES.field;
  const set = (key: string, value: unknown) => edit(current => ({ ...current, field: { ...current.field, [key]: value } }), `field-${key}`);
  const setCustom = (key: 'gaussian' | 'compact' | 'inverse', value: number) => edit(current => ({ ...current, field: { ...current.field, custom: { ...current.field.custom, [key]: value } } }), `field-custom-${key}`);
  const family = fieldFamily(config.field.method);
  return <>
    {config.field.method === 'custom-weighted' && <div className="gs-sh-stage" data-testid="procedural-custom-mix">
      <Num label="Gaussian share" value={config.field.custom.gaussian} min={R.custom.min} max={R.custom.max} def={0.6} onChange={value => setCustom('gaussian', value)} testId="procedural-custom-gaussian" />
      <Num label="Compact-support share" value={config.field.custom.compact} min={R.custom.min} max={R.custom.max} def={0.3} onChange={value => setCustom('compact', value)} testId="procedural-custom-compact" />
      <Num label="Inverse-multiquadric share" value={config.field.custom.inverse} min={R.custom.min} max={R.custom.max} def={0.1} onChange={value => setCustom('inverse', value)} testId="procedural-custom-inverse" />
      <p className="hint">Shares are normalised by their sum, so only their ratio matters.</p>
    </div>}
    {family !== 'rbf' && <Num label="Global influence (fill empty space)" value={config.field.global} min={R.global.min} max={R.global.max} def={0} onChange={value => set('global', value)} testId="procedural-field-global" />}
    {family === 'rbf' && <p className="hint">Exact interpolation passes through every centre’s colour. “Softness” smooths the fit (0 = exact) and the result is kept inside the palette’s own range.</p>}
    {family === 'cells' && <p className="hint">“Overlap” controls how soft the cell borders are: 0 = hard regions, 1 = fully blended.</p>}
  </>;
}

/** OKLCH hue path and chroma preservation (shown under the colour-space select). */
export function ColorProcessingExtras({ config, edit }: Props) {
  const set = (key: string, value: unknown) => edit(current => ({ ...current, color: { ...current.color, [key]: value } }), `color-${key}`);
  const space = config.color.interpolation;
  const rbf = fieldFamily(config.field.method) === 'rbf';
  return <>
    {space === 'oklch' && !rbf && <Select id="procedural-hue-direction" label="Hue travels" value={config.color.hueDirection}
      options={[{ id: 'shorter', label: 'The short way round' }, { id: 'longer', label: 'The long way round' }, { id: 'increasing', label: 'Forward through the spectrum' }, { id: 'decreasing', label: 'Backward through the spectrum' }]}
      onChange={value => set('hueDirection', value)} />}
    {space === 'oklch' && rbf && <p className="hint">Exact interpolation fits numbers, not angles, so OKLCH blends as OKLab there.</p>}
    {space === 'oklab' && !rbf && <Num label="Keep colourfulness (chroma)" value={config.color.chromaPreserve} min={PROC_RANGES.color.chromaPreserve.min} max={PROC_RANGES.color.chromaPreserve.max} def={0} onChange={value => set('chromaPreserve', value)} testId="procedural-chroma-preserve" />}
  </>;
}

/** Animation extras: easing, spring damping, loop, delay, synchronisation and groups. */
export function AnimationExtras({ config, edit }: Props) {
  const R = PROC_RANGES.motion;
  const m = config.motion;
  const set = (key: string, value: unknown) => edit(current => ({ ...current, motion: { ...current.motion, [key]: value } }), `motion-${key}`);
  const setCurve = (index: number, value: number) => edit(current => ({ ...current, motion: { ...current.motion, curve: current.motion.curve.map((item, i) => i === index ? value : item) as typeof current.motion.curve } }), `motion-curve-${index}`);
  const travels = m.type === 'wander' || m.type === 'elastic';
  return <>
    {(travels || m.mixed) && <Select id="procedural-easing" label="Travel curve" value={m.easing} options={MOTION_EASINGS.map(id => ({ id, label: EASING_LABEL[id] }))} onChange={value => set('easing', value)} />}
    {(travels || m.mixed) && m.easing === 'custom' && <div className="gs-sh-stage" data-testid="procedural-curve">
      <Num label="Curve x1" value={m.curve[0]} min={R.curve.x.min} max={R.curve.x.max} def={0.42} onChange={value => setCurve(0, value)} />
      <Num label="Curve y1" value={m.curve[1]} min={R.curve.y.min} max={R.curve.y.max} def={0} onChange={value => setCurve(1, value)} />
      <Num label="Curve x2" value={m.curve[2]} min={R.curve.x.min} max={R.curve.x.max} def={0.58} onChange={value => setCurve(2, value)} />
      <Num label="Curve y2" value={m.curve[3]} min={R.curve.y.min} max={R.curve.y.max} def={1} onChange={value => setCurve(3, value)} />
    </div>}
    {m.type === 'spring' && <Num label="Spring damping (bouncy → settled)" value={m.damping} min={R.damping.min} max={R.damping.max} def={0.5} onChange={value => set('damping', value)} testId="procedural-damping" />}
    <Num label="Loop length (0 = never repeats)" value={m.loop} min={R.loop.min} max={R.loop.max} step={0.5} unit="s" def={0} onChange={value => set('loop', value)} testId="procedural-loop" />
    <Num label="Start delay stagger" value={m.delay} min={R.delay.min} max={R.delay.max} step={0.1} unit="s" def={0} onChange={value => set('delay', value)} testId="procedural-delay" />
    <Num label="Synchronisation" value={m.sync} min={R.sync.min} max={R.sync.max} def={0} onChange={value => set('sync', value)} testId="procedural-sync" />
    <Num label="Animation groups (0 = none)" value={m.groups} min={R.groups.min} max={R.groups.max} step={1} def={0} onChange={value => set('groups', Math.round(value))} testId="procedural-groups" />
    <p className="hint">Loop cross-fades the last fifth of the loop into the start, so it repeats without a seam (not for “Flow field” or “Follow”). Points in the same group share phase, speed and seed. Elastic is “Wander” with an overshooting curve.</p>
  </>;
}

/** Interaction extras: direction, velocity, pressure, persistence and what the reaction drives. */
export function InteractionExtras({ config, edit }: Props) {
  const R = PROC_RANGES.interaction;
  const ic = config.interaction;
  const set = (key: string, value: unknown) => edit(current => ({ ...current, interaction: { ...current.interaction, [key]: value } }), `interaction-${key}`);
  const setAffect = (key: keyof typeof ic.affect, value: number) => edit(current => ({ ...current, interaction: { ...current.interaction, affect: { ...current.interaction.affect, [key]: value } } }), `interaction-affect-${key}`);
  const drives: [keyof typeof ic.affect, string][] = [['position', 'Point positions'], ['radius', 'Point reach'], ['strength', 'Field strength'], ['saturation', 'Saturation'], ['hue', 'Hue'], ['speed', 'Animation speed']];
  return <>
    <Num label="Direction" value={ic.direction} min={R.direction.min} max={R.direction.max} step={1} unit="°" def={0} onChange={value => set('direction', value)} testId="procedural-force-direction" />
    <Num label="Pointer-speed response" value={ic.velocity} min={R.velocity.min} max={R.velocity.max} def={0} onChange={value => set('velocity', value)} testId="procedural-force-velocity" />
    <Num label="Press / touch response" value={ic.pressure} min={R.pressure.min} max={R.pressure.max} def={0.6} onChange={value => set('pressure', value)} testId="procedural-force-pressure" />
    <Num label="Persistence (lingers after release)" value={ic.persistence} min={R.persistence.min} max={R.persistence.max} def={0} onChange={value => set('persistence', value)} testId="procedural-force-persistence" />
    <div className="gs-sh-stage" data-testid="procedural-affect">
      <b>The reaction drives</b>
      {drives.map(([key, label]) => <Num key={key} label={label} value={ic.affect[key]} min={R.affect.min} max={R.affect.max} def={key === 'position' ? 1 : 0} onChange={value => setAffect(key, value)} testId={`procedural-affect-${key}`} />)}
      <p className="hint">All of these follow the same pointer weight. They are applied on top while the pointer is near and eased back after, so the saved mesh and its positions are never changed.</p>
    </div>
  </>;
}
