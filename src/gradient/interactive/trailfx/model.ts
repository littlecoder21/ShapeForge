import { TRAILFX_PRESET_ROWS } from './presets.generated';
import { TRAILFX_EXTRA_PRESET_ROWS } from './presets.extra';
import { HEX_RE, TRAILFX_MAX_COLORS, resamplePalette, sortByLightness } from './palette';
import { FIELD_KIND_DEFS, FIELD_PRESET_ROWS } from './fields';

/* ═══════════════════════ Trail FX — data model ═══════════════════════
 * A multi-pass, pointer-driven effect. Pass order is the pipeline order, so the stack IS the effect:
 *   base → reveal → blur → diffuse → liquify → sheen / grade → rays   (the built-in "Chrome trail" is exactly the original stack)
 *
 * Version 2 adds three kinds of pass:
 *   • emitter  — a particle system: any shape, any motion, any interaction (move, hold, click, ambient, chain, cursor forces)
 *   • ribbon   — a ribbon / comet / lightning thread that follows the pointer
 *   • gradmap  — maps the picture to a colour ramp you choose, which recolours any other effect
 * and variable-length colour lists (2–8 colours) for every pass that reads a palette.
 * Every number is a uniform or a simulation parameter: moving a slider never recompiles a shader. Only adding, removing,
 * reordering or switching a pass rebuilds the pipeline.
 */

export const TRAILFX_MAX_PASSES = 12;
export const TRAILFX_FORMAT_VERSION = 2;

export type TrailFxCoreKind = 'base' | 'reveal' | 'blur' | 'diffuse' | 'liquify' | 'sheen' | 'grade' | 'rays' | 'emitter' | 'ribbon' | 'gradmap';
/** the core passes, plus the 25 field generators and 4 finish passes defined in ./fields (their ids are plain strings) */
export type TrailFxKind = TrailFxCoreKind | (string & {});
export type TrailFxBlend = 'normal' | 'screen' | 'plus-lighter' | 'overlay' | 'soft-light' | 'multiply';
export const TRAILFX_BLENDS: { id: TrailFxBlend; label: string }[] = [
  { id: 'normal', label: 'Normal' }, { id: 'screen', label: 'Screen' }, { id: 'plus-lighter', label: 'Add' },
  { id: 'overlay', label: 'Overlay' }, { id: 'soft-light', label: 'Soft light' }, { id: 'multiply', label: 'Multiply' },
];

export interface TrailFxParamDef {
  key: string; label: string; min: number; max: number; step: number; def: number; options?: string[]; unit?: string;
  /** sub-heading the builder files this control under */
  group?: string;
  /** only shown (and only meaningful) while another parameter of the same pass has one of these values */
  when?: { key: string; in: number[] };
  hint?: string;
}
export interface TrailFxColorDef { label: string; defaults: string[]; min: number; max: number }
export interface TrailFxKindDef {
  id: TrailFxKind;
  label: string;
  icon: string;
  blurb: string;
  /** the group the "Add pass" menu lists it under */
  family: string;
  params: TrailFxParamDef[];
  /** colours this pass reads: how many it starts with and how many it accepts */
  colors?: TrailFxColorDef;
  /** the pass accepts a short run of characters (the "Glyph" particle shape) */
  text?: { label: string; def: string };
}

const p = (key: string, label: string, min: number, max: number, def: number, step = 0.01, unit?: string, extra: Partial<TrailFxParamDef> = {}): TrailFxParamDef => ({ key, label, min, max, def, step, ...(unit ? { unit } : {}), ...extra });
const opt = (key: string, label: string, options: string[], def = 0, extra: Partial<TrailFxParamDef> = {}): TrailFxParamDef => ({ key, label, min: 0, max: options.length - 1, step: 1, def, options, ...extra });
const g = (group: string, defs: TrailFxParamDef[]): TrailFxParamDef[] => defs.map(def => ({ ...def, group }));
const when = (key: string, values: number[], defs: TrailFxParamDef[]): TrailFxParamDef[] => defs.map(def => ({ ...def, when: { key, in: values } }));

export const BASE_STYLES = ['White', 'Silver', 'Spectrum', 'Reeded glass', 'Ember', 'Aurora', 'Marble', 'Ice', 'Gold', 'Custom gradient'];
export const BASE_PATTERNS = ['Flowing', 'Radial', 'Angular', 'Clouds', 'Stripes'];
export const PARTICLE_SHAPES = ['Circle', 'Ring', 'Square', 'Diamond', 'Triangle', 'Star', 'Spark', 'Cross', 'Hexagon', 'Heart', 'Crescent', 'Mixed shapes', 'Glyph / emoji', 'Custom SVG / path'];
export const RIBBON_STYLES = ['Smooth', 'Neon', 'Dashed', 'Beads', 'Lightning'];
export const LAYER_MODES = ['Paint over picture', 'Add to picture', 'Reveal the picture', 'Lens the picture'];
export const AMBIENT_AREAS = ['Whole screen', 'Top edge', 'Bottom edge', 'Left edge', 'Right edge', 'Around cursor', 'Centre'];

/** the controls every layer-drawing pass (particles, ribbon) shares: how its layer is stored and how it meets the picture */
const renderParams = (): TrailFxParamDef[] => g('Render', [
  opt('mode', 'Meets the picture', LAYER_MODES, 0, { hint: 'Reveal and Lens need a Base image pass before this one.' }),
  p('lens', 'Lens strength', 0, 1.5, 0.5, 0.01, undefined, { when: { key: 'mode', in: [3] } }),
  opt('blend', 'Drawing blend', ['Normal', 'Add (glow)'], 0),
  p('persistence', 'Afterglow', 0, 0.98, 0, 0.01, undefined, { hint: 'How long what it draws lingers. High values leave smoky or inky streaks.' }),
  p('spread', 'Afterglow spread', 0, 1, 0, 0.01),
  p('driftX', 'Afterglow drift X', -300, 300, 0, 5, 'px/s'),
  p('driftY', 'Afterglow drift Y', -300, 300, 0, 5, 'px/s'),
  p('opacity', 'Pass opacity', 0, 1, 1),
]);

export const TRAILFX_KINDS: TrailFxKindDef[] = [
  { id: 'base', label: 'Base image', icon: '▣', family: 'Picture', blurb: 'The picture the trail reveals. White gives the original silver wisps; the others give the trail something to bend and split. Custom gradient uses your own colours.',
    params: [
      opt('style', 'Style', BASE_STYLES, 0),
      p('scale', 'Pattern scale', 0.4, 3, 1), p('drift', 'Drift speed', 0, 3, 1),
      ...when('style', [9], [opt('pattern', 'Gradient pattern', BASE_PATTERNS, 0), p('angle', 'Gradient angle', -180, 180, 0, 1, '°')]),
    ],
    colors: { label: 'Gradient colours', defaults: ['#7c5cff', '#22d3ee', '#f472b6', '#ffffff'], min: 2, max: TRAILFX_MAX_COLORS } },
  { id: 'reveal', label: 'Reveal trail', icon: '〰', family: 'Generators', blurb: 'Paints the pointer path into a feedback buffer and uses it to reveal and displace the picture, with RGB fringing.',
    params: [p('displace', 'Displacement', 0, 2, 0.5), p('aberr', 'Colour fringe', 0, 0.6, 0.12), p('strength', 'Trail strength', 0.3, 3, 1.38), p('radius', 'Trail width', 0.01, 0.2, 0.04, 0.005), p('wobble', 'Wobble', 0, 1, 0.56), p('decay', 'Persistence', 0.2, 0.95, 0.73), p('drift', 'Outward drift', 0, 0.5, 0.09), p('momentum', 'Pointer smoothing', 0, 1.5, 0.47)] },
  { id: 'blur', label: 'Directional blur', icon: '⇶', family: 'Generators', blurb: 'Smears the result along the direction you moved, with RGB fringing. Has its own, shorter trail.',
    params: [p('dist', 'Smear length', 0, 1.5, 0.4), p('scale', 'Smear softness', 0.05, 1, 0.25), p('aberr', 'Colour fringe', 0, 0.6, 0.12), p('strength', 'Trail strength', 0.3, 3, 1.16), p('radius', 'Trail width', 0.01, 0.2, 0.04, 0.005), p('wobble', 'Wobble', 0, 1, 0), p('decay', 'Persistence', 0.2, 0.95, 0.5), p('drift', 'Outward drift', 0, 0.5, 0), p('momentum', 'Pointer smoothing', 0, 1.5, 0)] },
  { id: 'emitter', label: 'Particles', icon: '✺', family: 'Generators',
    blurb: 'A particle system. Pick the shape, how it moves, and what makes it appear: moving, holding, clicking, a chain that follows the pointer, or ambient drift. Cursor forces attract, repel or swirl what is already alive.',
    colors: { label: 'Particle colours', defaults: ['#ffd36b', '#ff7a45', '#ff3d81', '#7c5cff'], min: 2, max: TRAILFX_MAX_COLORS },
    text: { label: 'Glyph characters', def: '✦' },
    params: [
      ...g('Shape', [
        opt('shape', 'Shape', PARTICLE_SHAPES, 0),
        p('size', 'Size', 2, 200, 14, 1, 'px'), p('sizeVar', 'Size variation', 0, 1, 0.5),
        p('sizeEnd', 'Size at end of life', 0, 4, 0.2, 0.05, '×', { hint: '0 shrinks to nothing, 1 keeps its size, above 1 grows (rings that expand are ripples).' }),
        p('stretch', 'Stretch along motion', 0, 8, 0, 0.1, '×'),
        p('soft', 'Edge softness / glow', 0, 1, 0.3), p('outline', 'Outline only', 0, 1, 0),
        opt('orient', 'Orientation', ['Random', 'Upright', 'Face motion'], 0),
        p('spin', 'Spin', -720, 720, 0, 5, '°/s'), p('spinVar', 'Spin variation', 0, 1, 0.5),
        ...when('shape', [12], [p('glyphTint', 'Tint glyphs with the palette', 0, 1, 1)]).map(def => ({ ...def, group: 'Shape' })),
      ]),
      ...g('Emission', [
        p('onMove', 'While moving', 0, 300, 24, 1, '/100px', { hint: 'Particles per 100 px of pointer travel. Zero turns it off.' }),
        p('onHold', 'While pressed', 0, 600, 0, 1, '/s'), p('onClick', 'Burst on click / tap', 0, 400, 0, 1),
        p('ambient', 'Ambient', 0, 300, 0, 1, '/s'), opt('area', 'Ambient from', AMBIENT_AREAS, 0),
        p('follow', 'Chain following the pointer', 0, 60, 0, 1, ' beads'), p('followGap', 'Chain spacing', 5, 150, 30, 1, 'ms'),
        p('scatter', 'Scatter around the source', 0, 200, 4, 1, 'px'),
        p('minSpeed', 'Ignore slow movement below', 0, 2000, 0, 10, 'px/s'),
        p('speedSize', 'Faster pointer, bigger particles', 0, 3, 0),
        p('maxCount', 'Particle limit', 50, 3000, 900, 10),
      ]),
      ...g('Motion', [
        opt('dir', 'Launch direction', ['Any direction', 'Up', 'Down', 'Left', 'Right', 'Along pointer motion', 'Against pointer motion', 'Sideways to motion'], 0),
        ...when('dir', [1, 2, 3, 4, 5, 6, 7], [p('cone', 'Spread of the cone', 0, 360, 60, 1, '°')]),
        p('speed', 'Launch speed', 0, 1500, 120, 5, 'px/s'), p('speedVar', 'Speed variation', 0, 1, 0.5),
        p('gravity', 'Gravity', -2000, 2000, 0, 10, 'px/s²'), p('wind', 'Wind', -1000, 1000, 0, 10, 'px/s²'),
        p('drag', 'Air drag', 0, 8, 1.2, 0.05),
        p('turbulence', 'Turbulence', 0, 1500, 0, 10), p('turbScale', 'Turbulence scale', 0.1, 4, 1, 0.05),
        p('inherit', 'Inherit pointer speed', 0, 1.5, 0.25),
        opt('edges', 'At the screen edge', ['Pass through', 'Bounce', 'Wrap around', 'Disappear'], 0),
      ]),
      ...g('Life', [
        p('life', 'Lifetime', 0.1, 12, 1.2, 0.05, 's'), p('lifeVar', 'Lifetime variation', 0, 1, 0.4),
        p('fadeIn', 'Fade in', 0, 0.5, 0.05), p('fadeOut', 'Fade out', 0, 1, 0.6),
      ]),
      ...g('Pointer force', [
        opt('force', 'Force on live particles', ['None', 'Attract', 'Repel', 'Swirl', 'Orbit'], 0),
        ...when('force', [1, 2, 3, 4], [p('forceStrength', 'Force strength', 0, 3000, 600, 10), p('forceRadius', 'Force radius', 20, 800, 220, 5, 'px')]),
      ]),
      ...g('Colour', [
        opt('colorBy', 'Colour by', ['Random per particle', 'Over its life', 'Its speed', 'Its direction', 'Screen position', 'Cycle over time'], 1),
        opt('stepped', 'Palette', ['Smooth blend', 'Hard steps'], 0),
        p('bright', 'Brightness', 0.2, 3, 1), p('core', 'White-hot core', 0, 1, 0),
      ]),
      ...renderParams(),
    ] },
  { id: 'ribbon', label: 'Ribbon', icon: '〜', family: 'Generators',
    blurb: 'A ribbon, comet tail or lightning thread that follows the pointer and retracts when you stop. Wiggle it, split it into several strands, dash it or string it with beads.',
    colors: { label: 'Ribbon colours', defaults: ['#22d3ee', '#7c5cff', '#f472b6'], min: 2, max: TRAILFX_MAX_COLORS },
    params: [
      ...g('Shape', [
        opt('style', 'Style', RIBBON_STYLES, 1),
        p('width', 'Width', 1, 120, 16, 1, 'px'), p('taper', 'Taper to the tail', 0, 1, 1), p('length', 'Length', 0.05, 3, 0.6, 0.05, 's'),
        p('soft', 'Edge softness', 0, 1, 0.45), p('glow', 'Glow', 0, 1, 0.4), p('core', 'White-hot core', 0, 1, 0.5),
        p('copies', 'Strands', 1, 6, 1, 1), ...when('copies', [2, 3, 4, 5, 6], [p('copySpread', 'Strand spacing', 0, 80, 14, 1, 'px')]),
        ...when('style', [2, 3], [p('dash', 'Dash / bead length', 4, 120, 20, 1, 'px'), p('dashGap', 'Gap', 2, 120, 14, 1, 'px'), p('dashSpeed', 'Travel speed', -400, 400, 60, 5, 'px/s')]),
        ...when('style', [4], [p('jitter', 'Lightning jitter', 0, 60, 14, 1, 'px')]),
      ]),
      ...g('Motion', [
        p('smooth', 'Pointer lag', 0, 0.95, 0.35),
        p('wiggle', 'Wiggle', 0, 60, 0, 1, 'px'), p('wiggleFreq', 'Wiggle frequency', 0.2, 12, 3, 0.1), p('wiggleSpeed', 'Wiggle speed', 0, 10, 2, 0.1),
        p('fade', 'Fade along the length', 0, 1, 0.7),
      ]),
      ...g('Interaction', [
        opt('draw', 'Draws', ['While hovering / moving', 'Only while pressed'], 0),
        p('minSpeed', 'Ignore slow movement below', 0, 2000, 0, 10, 'px/s'),
      ]),
      ...g('Colour', [
        opt('colorBy', 'Colour by', ['Along its length', 'Cycle over time', 'Its speed', 'Solid (first colour)'], 0),
        opt('stepped', 'Palette', ['Smooth blend', 'Hard steps'], 0), p('bright', 'Brightness', 0.2, 3, 1),
      ]),
      ...renderParams(),
    ] },
  { id: 'diffuse', label: 'Diffuse', icon: '❖', family: 'Finish', blurb: 'Scatters pixels into a soft grain, strongest away from the centre.', params: [p('amount', 'Amount', 0, 0.4, 0.08)] },
  { id: 'liquify', label: 'Liquify', icon: '≋', family: 'Finish', blurb: 'Slow animated liquid warp that gives the wisps their folds.', params: [p('mix', 'Amount', 0, 1, 0.31)] },
  { id: 'sheen', label: 'Metal sheen', icon: '✦', family: 'Finish', blurb: 'Lights the folds like polished metal: specular highlight and rim light.',
    params: [p('bump', 'Relief', 1, 30, 5, 0.5), p('shine', 'Shine', 2, 60, 20, 1), p('strength', 'Highlight', 0, 1, 0.3), p('rim', 'Rim light', 0, 0.5, 0)] },
  { id: 'gradmap', label: 'Colour map', icon: '◧', family: 'Colour',
    blurb: 'Recolours everything above it: dark parts take the first colour, bright parts the last, with your colours in between. Put it after any effect to choose its colours.',
    colors: { label: 'Map colours (dark → light)', defaults: ['#0b1020', '#5b3df5', '#f472b6', '#ffffff'], min: 2, max: TRAILFX_MAX_COLORS },
    params: [p('amount', 'Amount', 0, 1, 1), p('bias', 'Shift', -0.5, 0.5, 0), p('contrast', 'Contrast', 0.3, 3, 1), opt('invert', 'Direction', ['Dark → light', 'Light → dark'], 0), opt('stepped', 'Palette', ['Smooth blend', 'Hard steps'], 0)] },
  { id: 'grade', label: 'Colour grade', icon: '◐', family: 'Colour', blurb: 'Hue, saturation, contrast, brightness and an optional tint.',
    params: [p('hue', 'Hue shift', -180, 180, 0, 1, '°'), p('saturation', 'Saturation', 0, 2, 1), p('contrast', 'Contrast', 0.5, 2, 1), p('brightness', 'Brightness', -0.5, 0.5, 0), p('tintMix', 'Tint amount', 0, 1, 0)],
    colors: { label: 'Tint', defaults: ['#ffffff'], min: 1, max: 1 } },
];
/* the 25 field generators and the extra finish passes live in ./fields; their definitions join the catalogue here */
TRAILFX_KINDS.push(...FIELD_KIND_DEFS.map<TrailFxKindDef>(def => ({
  id: def.id, label: def.label, icon: def.icon, blurb: def.blurb, family: def.family, params: def.params, ...(def.colors ? { colors: def.colors } : {}),
})));
export const TRAILFX_KIND_MAP = Object.fromEntries(TRAILFX_KINDS.map(kind => [kind.id, kind])) as Record<TrailFxKind, TrailFxKindDef>;
/** the order the "Add pass" menu lists its groups in */
export const TRAILFX_FAMILIES: TrailFxKindDef['family'][] = ['Generators', 'Ink fields', 'Fluid', 'Water', 'Growth', 'Shatter & burn', 'Picture', 'Colour', 'Finish'];

/** is a parameter currently meaningful, given the pass's other values? */
export const paramVisible = (def: TrailFxParamDef, values: Record<string, number>): boolean => !def.when || def.when.in.includes(Math.round(values[def.when.key] ?? 0));

export interface TrailFxVectorPath { d: string; fillRule: 'nonzero' | 'evenodd' }
export interface TrailFxCustomShape { viewBox: [number, number, number, number]; paths: TrailFxVectorPath[] }
export interface TrailFxPass { id: string; kind: TrailFxKind; enabled: boolean; p: Record<string, number>; colors: string[]; /** characters for the Glyph particle shape */ text?: string; customShape?: TrailFxCustomShape }
export interface TrailFxConfig {
  enabled: boolean;
  presetId: string;
  name: string;
  /** opacity of the whole effect over the gradient (the original uses 0.5) */
  opacity: number;
  blend: TrailFxBlend;
  /** internal resolution scale; the runtime also lowers it on slow GPUs */
  scale: number;
  /** the shared palette of the Colours section; passes keep their own copies, this is what "apply to all" pushes into them */
  palette: string[];
  passes: TrailFxPass[];
}

export const DEFAULT_TRAILFX_PALETTE = ['#7c5cff', '#22d3ee', '#f472b6', '#ffffff'];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const num = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
};
const cleanColors = (raw: unknown, min: number, max: number, fallback: string[]): string[] => {
  const list = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string' && HEX_RE.test(c)).map(c => c.toLowerCase()).slice(0, max) : [];
  if (list.length >= min) return list;
  // too few valid colours: keep the good ones and borrow the rest from the defaults
  return [...list, ...fallback.slice(list.length)].slice(0, Math.max(min, Math.min(max, fallback.length)));
};
const cleanText = (raw: unknown, fallback: string): string => {
  const chars = typeof raw === 'string' ? Array.from(raw.replace(/\s+/g, '')).slice(0, 12).join('') : '';
  return chars || fallback;
};
const cleanCustomShape = (raw: unknown): TrailFxCustomShape | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.viewBox) || value.viewBox.length !== 4 || !Array.isArray(value.paths) || !value.paths.length || value.paths.length > 32) return undefined;
  const box = value.viewBox;
  if (!box.every((n): n is number => typeof n === 'number' && Number.isFinite(n)) || box.some(n => Math.abs(n) > 1_000_000)) return undefined;
  const [x, y, width, height] = box;
  if (width <= 0 || height <= 0) return undefined;
  const paths: TrailFxVectorPath[] = [];
  let totalLength = 0;
  for (const path of value.paths) {
    if (!path || typeof path !== 'object') return undefined;
    const item = path as Record<string, unknown>;
    if (typeof item.d !== 'string' || !item.d.trim() || item.d.length > 16_000) return undefined;
    const d = item.d.trim();
    totalLength += d.length;
    if (totalLength > 32_000) return undefined;
    paths.push({ d, fillRule: item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero' });
  }
  return { viewBox: [x, y, width, height], paths };
};
let counter = 0;
export const newPassId = () => `tp${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 4)}`;

export function makePass(kind: TrailFxKind, over: { p?: Record<string, number>; colors?: string[]; enabled?: boolean; text?: string; customShape?: TrailFxCustomShape } = {}): TrailFxPass {
  const def = TRAILFX_KIND_MAP[kind];
  const values = Object.fromEntries(def.params.map(param => [param.key, over.p?.[param.key] ?? param.def]));
  const colors = def.colors ? cleanColors(over.colors, def.colors.min, def.colors.max, def.colors.defaults) : [];
  const customShape = def.text ? cleanCustomShape(over.customShape) : undefined;
  return { id: newPassId(), kind, enabled: over.enabled !== false, p: values, colors, ...(def.text ? { text: cleanText(over.text, def.text.def) } : {}), ...(customShape ? { customShape } : {}) };
}

export function normalizePass(raw: unknown): TrailFxPass | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const kind = typeof value.kind === 'string' && value.kind in TRAILFX_KIND_MAP ? value.kind as TrailFxKind : null;
  if (!kind) return null;
  const def = TRAILFX_KIND_MAP[kind];
  const rawP = value.p && typeof value.p === 'object' ? value.p as Record<string, unknown> : {};
  const customShape = def.text ? cleanCustomShape(value.customShape) : undefined;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : newPassId(),
    kind,
    enabled: value.enabled !== false,
    p: Object.fromEntries(def.params.map(param => [param.key, num(rawP[param.key], param.min, param.max, param.def)])),
    colors: def.colors ? cleanColors(value.colors, def.colors.min, def.colors.max, def.colors.defaults) : [],
    ...(def.text ? { text: cleanText(value.text, def.text.def) } : {}),
    ...(customShape ? { customShape } : {}),
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
    palette: cleanColors(value.palette, 2, TRAILFX_MAX_COLORS, DEFAULT_TRAILFX_PALETTE),
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

/* ───────────────────────── colour helpers ───────────────────────── */

export const passAcceptsColors = (pass: TrailFxPass): boolean => !!TRAILFX_KIND_MAP[pass.kind].colors;

/** Pushes a palette into one pass. A Base image switches to its Custom gradient so the colours show. */
export function applyPaletteToPass(pass: TrailFxPass, palette: string[]): TrailFxPass {
  const def = TRAILFX_KIND_MAP[pass.kind];
  if (!def.colors) return pass;
  const { min, max } = def.colors;
  // single-colour passes (tints) take the lightest colour; the rest take as many colours as they accept
  const colors = max === 1 ? [sortByLightness(palette)[palette.length - 1]] : resamplePalette(palette, Math.max(min, Math.min(max, palette.length)));
  return { ...pass, colors, p: pass.kind === 'base' ? { ...pass.p, style: 9 } : pass.p };
}
export const applyPaletteToConfig = (config: TrailFxConfig, palette: string[]): TrailFxConfig => ({ ...config, palette: [...palette], passes: config.passes.map(pass => applyPaletteToPass(pass, palette)) });

/** Recolours the whole effect: updates the stack's Colour map pass, or adds one just before Light rays (or at the end). */
export function recolorWithColorMap(config: TrailFxConfig, palette: string[]): TrailFxConfig {
  const colors = sortByLightness(palette);
  const index = config.passes.findIndex(pass => pass.kind === 'gradmap');
  if (index >= 0) return { ...config, palette: [...palette], passes: config.passes.map((pass, i) => (i === index ? { ...pass, enabled: true, colors } : pass)) };
  if (config.passes.length >= TRAILFX_MAX_PASSES) return config;
  const raysAt = config.passes.findIndex(pass => pass.kind === 'rays');
  const at = raysAt >= 0 ? raysAt : config.passes.length;
  const pass = makePass('gradmap', { colors });
  return { ...config, palette: [...palette], passes: [...config.passes.slice(0, at), pass, ...config.passes.slice(at)] };
}

/* ───────────────────────── presets ───────────────────────── */

export interface TrailFxPreset { id: string; label: string; group: string; description: string; build: () => TrailFxConfig }

const stack = (name: string, presetId: string, passes: TrailFxPass[], over: Partial<Pick<TrailFxConfig, 'opacity' | 'blend' | 'palette'>> = {}): TrailFxConfig =>
  ({ enabled: true, presetId, name, opacity: 0.5, blend: 'normal', scale: 1, palette: [...DEFAULT_TRAILFX_PALETTE], passes, ...over });
export const newTrailFx = (name: string, passes: TrailFxPass[], over: Partial<Pick<TrailFxConfig, 'opacity' | 'blend' | 'palette'>> = {}): TrailFxConfig => stack(name, '', passes, over);

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
  ...[...TRAILFX_EXTRA_PRESET_ROWS, ...FIELD_PRESET_ROWS].map<TrailFxPreset>(row => ({
    id: row.id, label: row.label, group: row.group, description: row.description,
    build: () => stack(row.label, row.id, row.passes.map(pass => makePass(pass.kind as TrailFxKind, { ...(pass.p ? { p: pass.p } : {}), ...(pass.colors ? { colors: pass.colors } : {}), ...(pass.text ? { text: pass.text } : {}) })), {
      ...(row.opacity !== undefined ? { opacity: row.opacity } : {}), ...(row.blend ? { blend: row.blend as TrailFxBlend } : {}), ...(row.palette ? { palette: row.palette } : {}),
    }),
  })),
];
export const TRAILFX_PRESET_MAP = Object.fromEntries(TRAILFX_PRESETS.map(preset => [preset.id, preset])) as Record<string, TrailFxPreset>;
export const TRAILFX_PRESET_GROUPS = [...new Set(TRAILFX_PRESETS.map(preset => preset.group))];

/** Starting points for "Build from scratch": the original look, or a clean slate for a completely different kind of effect. */
export interface TrailFxStarter { id: string; label: string; blurb: string; build: () => TrailFxConfig }
export const TRAILFX_STARTERS: TrailFxStarter[] = [
  { id: 'trail', label: 'Liquid trail', blurb: 'Base image + reveal trail + liquify (the original family).', build: () => newTrailFx('Custom', [makePass('base'), makePass('reveal'), makePass('liquify')]) },
  { id: 'particles', label: 'Particles', blurb: 'An empty particle system: set the shape, motion and what triggers it.', build: () => newTrailFx('Custom particles', [makePass('emitter')], { opacity: 1 }) },
  { id: 'ribbon', label: 'Ribbon', blurb: 'A neon ribbon that follows the pointer.', build: () => newTrailFx('Custom ribbon', [makePass('ribbon', { p: { style: 1 } })], { opacity: 1 }) },
  { id: 'mix', label: 'Picture + particles', blurb: 'A custom gradient picture that particles lens and reveal.', build: () => newTrailFx('Custom mix', [makePass('base', { p: { style: 9, pattern: 0 } }), makePass('emitter', { p: { mode: 2, persistence: 0.9, size: 70, soft: 0.9, onMove: 40, life: 1.4 } })], { opacity: 1 }) },
];
