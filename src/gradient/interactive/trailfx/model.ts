import { TRAILFX_PRESET_ROWS } from './presets.generated';

/* ═══════════════════════ Trail FX — data model ═══════════════════════
 * A multi-pass, pointer-driven effect (the "Chrome" look): the pointer paints a direction-coded trail into feedback buffers,
 * a stack of passes turns that trail into the picture. Pass order is the pipeline order, so the stack IS the effect:
 *   base → reveal → blur → diffuse → liquify → sheen / grade → rays   (the built-in "Chrome trail" is exactly the original stack)
 * Every number is a uniform: moving a slider never recompiles a shader. Only adding, removing, reordering or switching a pass
 * rebuilds the pipeline.
 */

export const TRAILFX_MAX_PASSES = 12;

export type TrailFxKind = 'base' | 'reveal' | 'blur' | 'diffuse' | 'liquify' | 'sheen' | 'grade' | 'rays';
export type TrailFxBlend = 'normal' | 'screen' | 'plus-lighter' | 'overlay' | 'soft-light' | 'multiply';
export const TRAILFX_BLENDS: { id: TrailFxBlend; label: string }[] = [
  { id: 'normal', label: 'Normal' }, { id: 'screen', label: 'Screen' }, { id: 'plus-lighter', label: 'Add' },
  { id: 'overlay', label: 'Overlay' }, { id: 'soft-light', label: 'Soft light' }, { id: 'multiply', label: 'Multiply' },
];

export interface TrailFxParamDef { key: string; label: string; min: number; max: number; step: number; def: number; options?: string[]; unit?: string }
export interface TrailFxKindDef {
  id: TrailFxKind;
  label: string;
  icon: string;
  blurb: string;
  params: TrailFxParamDef[];
  /** colours this pass reads (the base gradient uses four; rays and grade one tint) */
  colors?: { label: string; defaults: string[] };
}

const p = (key: string, label: string, min: number, max: number, def: number, step = 0.01, unit?: string): TrailFxParamDef => ({ key, label, min, max, def, step, ...(unit ? { unit } : {}) });

export const BASE_STYLES = ['White', 'Silver', 'Spectrum', 'Reeded glass', 'Ember', 'Aurora', 'Marble', 'Ice', 'Gold', 'Custom gradient'];

export const TRAILFX_KINDS: TrailFxKindDef[] = [
  { id: 'base', label: 'Base image', icon: '▣', blurb: 'The picture the trail reveals. White gives the original silver wisps; the others give the trail something to bend and split.',
    params: [{ key: 'style', label: 'Style', min: 0, max: BASE_STYLES.length - 1, step: 1, def: 0, options: BASE_STYLES }, p('scale', 'Pattern scale', 0.4, 3, 1), p('drift', 'Drift speed', 0, 3, 1), p('angle', 'Gradient angle', -180, 180, 0, 1, '°')],
    colors: { label: 'Gradient colours', defaults: ['#7c5cff', '#22d3ee', '#f472b6', '#ffffff'] } },
  { id: 'reveal', label: 'Reveal trail', icon: '〰', blurb: 'Paints the pointer path into a feedback buffer and uses it to reveal and displace the picture, with RGB fringing.',
    params: [p('displace', 'Displacement', 0, 2, 0.5), p('aberr', 'Colour fringe', 0, 0.6, 0.12), p('strength', 'Trail strength', 0.3, 3, 1.38), p('radius', 'Trail width', 0.01, 0.2, 0.04, 0.005), p('wobble', 'Wobble', 0, 1, 0.56), p('decay', 'Persistence', 0.2, 0.95, 0.73), p('drift', 'Outward drift', 0, 0.5, 0.09), p('momentum', 'Pointer smoothing', 0, 1.5, 0.47)] },
  { id: 'blur', label: 'Directional blur', icon: '⇶', blurb: 'Smears the result along the direction you moved, with RGB fringing. Has its own, shorter trail.',
    params: [p('dist', 'Smear length', 0, 1.5, 0.4), p('scale', 'Smear softness', 0.05, 1, 0.25), p('aberr', 'Colour fringe', 0, 0.6, 0.12), p('strength', 'Trail strength', 0.3, 3, 1.16), p('radius', 'Trail width', 0.01, 0.2, 0.04, 0.005), p('wobble', 'Wobble', 0, 1, 0), p('decay', 'Persistence', 0.2, 0.95, 0.5), p('drift', 'Outward drift', 0, 0.5, 0), p('momentum', 'Pointer smoothing', 0, 1.5, 0)] },
  { id: 'diffuse', label: 'Diffuse', icon: '❖', blurb: 'Scatters pixels into a soft grain, strongest away from the centre.', params: [p('amount', 'Amount', 0, 0.4, 0.08)] },
  { id: 'liquify', label: 'Liquify', icon: '≋', blurb: 'Slow animated liquid warp that gives the wisps their folds.', params: [p('mix', 'Amount', 0, 1, 0.31)] },
  { id: 'sheen', label: 'Metal sheen', icon: '✦', blurb: 'Lights the folds like polished metal: specular highlight and rim light.',
    params: [p('bump', 'Relief', 1, 30, 5, 0.5), p('shine', 'Shine', 2, 60, 20, 1), p('strength', 'Highlight', 0, 1, 0.3), p('rim', 'Rim light', 0, 0.5, 0)] },
  { id: 'grade', label: 'Colour grade', icon: '◐', blurb: 'Hue, saturation, contrast, brightness and an optional tint.',
    params: [p('hue', 'Hue shift', -180, 180, 0, 1, '°'), p('saturation', 'Saturation', 0, 2, 1), p('contrast', 'Contrast', 0.5, 2, 1), p('brightness', 'Brightness', -0.5, 0.5, 0), p('tintMix', 'Tint amount', 0, 1, 0)],
    colors: { label: 'Tint', defaults: ['#ffffff'] } },
  { id: 'rays', label: 'Light rays', icon: '✴', blurb: 'Bright parts of the picture throw soft rays toward the centre (two passes).',
    params: [p('threshold', 'Threshold', 0, 0.8, 0.2), p('decay', 'Ray length', 0.8, 0.995, 0.972, 0.001), p('gain', 'Intensity', 0, 2, 0.5)],
    colors: { label: 'Ray tint', defaults: ['#ffffff'] } },
];
export const TRAILFX_KIND_MAP = Object.fromEntries(TRAILFX_KINDS.map(kind => [kind.id, kind])) as Record<TrailFxKind, TrailFxKindDef>;

export interface TrailFxPass { id: string; kind: TrailFxKind; enabled: boolean; p: Record<string, number>; colors: string[] }
export interface TrailFxConfig {
  enabled: boolean;
  presetId: string;
  name: string;
  /** opacity of the whole effect over the gradient (the original uses 0.5) */
  opacity: number;
  blend: TrailFxBlend;
  /** internal resolution scale; the runtime also lowers it on slow GPUs */
  scale: number;
  passes: TrailFxPass[];
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const num = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
};
const HEX = /^#[0-9a-f]{6}$/i;
let counter = 0;
export const newPassId = () => `tp${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 4)}`;

export function makePass(kind: TrailFxKind, over: { p?: Record<string, number>; colors?: string[]; enabled?: boolean } = {}): TrailFxPass {
  const def = TRAILFX_KIND_MAP[kind];
  const values = Object.fromEntries(def.params.map(param => [param.key, over.p?.[param.key] ?? param.def]));
  return { id: newPassId(), kind, enabled: over.enabled !== false, p: values, colors: over.colors ?? [...(def.colors?.defaults ?? [])] };
}

export function normalizePass(raw: unknown): TrailFxPass | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const kind = typeof value.kind === 'string' && value.kind in TRAILFX_KIND_MAP ? value.kind as TrailFxKind : null;
  if (!kind) return null;
  const def = TRAILFX_KIND_MAP[kind];
  const rawP = value.p && typeof value.p === 'object' ? value.p as Record<string, unknown> : {};
  const rawColors = Array.isArray(value.colors) ? value.colors : [];
  const wanted = def.colors?.defaults ?? [];
  return {
    id: typeof value.id === 'string' && value.id ? value.id : newPassId(),
    kind,
    enabled: value.enabled !== false,
    p: Object.fromEntries(def.params.map(param => [param.key, num(rawP[param.key], param.min, param.max, param.def)])),
    colors: wanted.map((fallback, index) => typeof rawColors[index] === 'string' && HEX.test(rawColors[index] as string) ? rawColors[index] as string : fallback),
  };
}

/** Returns a config from untrusted data, or `null` when `raw` is not one (the project then carries no Trail FX). */
export function normalizeTrailFx(raw: unknown): TrailFxConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.passes)) return null;
  return {
    enabled: value.enabled === true,
    presetId: typeof value.presetId === 'string' ? value.presetId.slice(0, 60) : '',
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : 'Custom',
    opacity: num(value.opacity, 0, 1, 0.5),
    blend: typeof value.blend === 'string' && TRAILFX_BLENDS.some(blend => blend.id === value.blend) ? value.blend as TrailFxBlend : 'normal',
    scale: num(value.scale, 0.4, 1, 1),
    passes: value.passes.map(normalizePass).filter((pass): pass is TrailFxPass => !!pass).slice(0, TRAILFX_MAX_PASSES),
  };
}

export const cloneTrailFx = (config: TrailFxConfig): TrailFxConfig => JSON.parse(JSON.stringify(config)) as TrailFxConfig;

/** Everything that changes the compiled pipeline. Slider values are deliberately absent. */
export const trailFxSignature = (config: Pick<TrailFxConfig, 'passes'>): string => config.passes.filter(pass => pass.enabled).map(pass => pass.kind).join('|');

export const describeTrailFx = (config: TrailFxConfig): string => {
  const active = config.passes.filter(pass => pass.enabled);
  return active.length ? active.map(pass => TRAILFX_KIND_MAP[pass.kind].label).slice(0, 3).join(' + ') + (active.length > 3 ? ` +${active.length - 3}` : '') : 'No passes';
};

/* ───────────────────────── presets ───────────────────────── */

export interface TrailFxPreset { id: string; label: string; group: string; description: string; build: () => TrailFxConfig }

const stack = (name: string, presetId: string, passes: TrailFxPass[]): TrailFxConfig => ({ enabled: true, presetId, name, opacity: 0.5, blend: 'normal', scale: 1, passes });

/** The original "Chroma" effect, pass for pass and value for value. */
const chromeTrail = (): TrailFxConfig => stack('Chrome trail', 'chrome-trail', [
  makePass('base'), makePass('reveal'), makePass('blur'), makePass('diffuse'), makePass('liquify'), makePass('rays'),
]);

export const TRAILFX_PRESETS: TrailFxPreset[] = [
  { id: 'chrome-trail', label: 'Chrome trail', group: 'Original', description: 'The original Chroma effect: silver wisps that follow fast mouse and touch movement, with fringed colour at the folds.', build: chromeTrail },
  ...TRAILFX_PRESET_ROWS.map<TrailFxPreset>(row => ({
    id: row.id, label: row.label, group: row.group, description: row.description,
    build: () => stack(row.label, row.id, row.passes.map(pass => makePass(pass.kind as TrailFxKind, { ...(pass.p ? { p: pass.p } : {}), ...(pass.colors ? { colors: pass.colors } : {}) }))),
  })),
];
export const TRAILFX_PRESET_MAP = Object.fromEntries(TRAILFX_PRESETS.map(preset => [preset.id, preset])) as Record<string, TrailFxPreset>;
export const TRAILFX_PRESET_GROUPS = [...new Set(TRAILFX_PRESETS.map(preset => preset.group))];
