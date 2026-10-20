import type { TextureData } from './model';
import { DEFAULT_PATTERN, resolveTextureId, type TextureFamily } from './texturePresets';

/* ═══════════════════════════ Texture control metadata ═══════════════════════════
 * ONE authoritative description of every advanced texture control: label, tooltip, default, range, step, type,
 * which capability a texture must have for the control to apply, and whether it is a Basic or Advanced setting.
 *  • The panel renders controls from this table (nothing is hard-coded per preset in the UI).
 *  • `TEXTURE_DEFAULTS` is derived from it, so defaults live in exactly one place.
 *  • `normalizeTexture()` uses it to clamp / repair saved data and to migrate legacy preset ids.
 * All values are flat primitives, so shallow copies (`{ ...DEFAULT_TEXTURE }`) never share state between layers.
 */

export type TextureShape = 'auto' | 'circle' | 'square' | 'diamond' | 'triangle' | 'polygon' | 'star' | 'ring' | 'cross';
export type TextureDistribution = 'auto' | 'grid' | 'staggered' | 'random' | 'radial' | 'poisson' | 'flow';
export type FalloffMode = 'none' | 'linear' | 'radial' | 'smooth' | 'edge';
export type FalloffTarget = 'opacity' | 'size' | 'density' | 'distortion' | 'detail';

/** Renderer families. A preset is a recipe of one or more layers of these kinds. */
export type TextureKind = 'noise' | 'scatter' | 'strokes' | 'lines' | 'waves' | 'rings' | 'cells' | 'tiling' | 'weave';

/** What a texture can do. A control is only offered when the selected texture has its capability. */
export type TextureCapability =
  | 'size' | 'sx' | 'sy' | 'aspect' | 'shape' | 'dist' | 'sizevar' | 'jitter' | 'anglevar' | 'opvar' | 'cover'
  | 'threshold' | 'octaves' | 'stroke' | 'dash' | 'breakup' | 'cross' | 'secondary' | 'corner' | 'sym' | 'weave'
  | 'phase' | 'warp' | 'falloff' | 'detail';

export interface TextureParams {
  /** Size of each element, % of the preset's own size. Independent of spacing and of the tile scale. */
  motifSize: number;
  /** Horizontal / vertical distance between elements, % of the preset's own pitch (snaps to whole repeats → seamless). */
  spacingX: number;
  spacingY: number;
  /** Width : height of each element, % (100 = unchanged). */
  aspectRatio: number;
  shape: TextureShape;
  distribution: TextureDistribution;
  /** Random per-element variation (stable per seed). */
  sizeVariation: number;
  positionJitter: number;
  angleVariation: number;
  opacityVariation: number;
  /** Share of elements that are present, %. */
  coverage: number;
  /** Cut-off for noise fields, % (0 = off). */
  threshold: number;
  /** Octaves of a noise field (0 = preset). */
  octaves: number;
  /** Stroke / thread / boundary thickness, % of the preset's own. */
  strokeWidth: number;
  /** Dash pattern in tile units (0 = the preset's own). */
  dashLength: number;
  dashGap: number;
  /** Share of each line that is cut away, %. */
  lineBreakup: number;
  /** Angle between hatch directions (snaps to the nearest angle that tiles seamlessly). */
  crossingAngle: number;
  secondaryStrength: number;
  cornerRadius: number;
  /** Corners / points of polygon and star motifs. */
  symmetry: number;
  weaveInterval: number;
  overUnderContrast: number;
  /** Shift of the pattern within one repeat, % of a pitch. */
  phase: number;
  warpAmount: number;
  warpFrequency: number;
  warpX: number;
  warpY: number;
  warpOctaves: number;
  falloff: FalloffMode;
  falloffTarget: FalloffTarget;
  falloffStrength: number;
  falloffCenterX: number;
  falloffCenterY: number;
  falloffRadius: number;
  falloffAngle: number;
  detailAmount: number;
  detailScale: number;
  detailDensity: number;
}

export type TextureControlId = keyof TextureParams;
export type ControlGroup = 'geometry' | 'distribution' | 'distortion' | 'spatial' | 'detail' | 'rendering';

export interface TextureControl {
  id: TextureControlId;
  label: string;
  hint: string;
  type: 'range' | 'select';
  group: ControlGroup;
  tier: 'basic' | 'advanced';
  needs: TextureCapability;
  def: number | string;
  min?: number; max?: number; step?: number; unit?: string;
  options?: { id: string; label: string }[];
  /** Extra visibility rule that only depends on the control values (e.g. warp sub-controls need warpAmount > 0). */
  when?: (t: TextureParams) => boolean;
  /** Label overrides by renderer kind / family, so "Motif size" can read "Amplitude" on waves. */
  labels?: Partial<Record<TextureKind, string>>;
  familyLabels?: Partial<Record<TextureFamily, string>>;
}

export const SHAPE_OPTIONS: { id: TextureShape; label: string }[] = [
  { id: 'auto', label: 'Preset default' }, { id: 'circle', label: 'Circle' }, { id: 'square', label: 'Square' }, { id: 'diamond', label: 'Diamond' },
  { id: 'triangle', label: 'Triangle' }, { id: 'polygon', label: 'Polygon' }, { id: 'star', label: 'Star' }, { id: 'ring', label: 'Ring' }, { id: 'cross', label: 'Cross' },
];
export const DISTRIBUTION_OPTIONS: { id: TextureDistribution; label: string }[] = [
  { id: 'auto', label: 'Preset default' }, { id: 'grid', label: 'Grid' }, { id: 'staggered', label: 'Staggered' }, { id: 'random', label: 'Random' },
  { id: 'radial', label: 'Radial' }, { id: 'poisson', label: 'Poisson disc' }, { id: 'flow', label: 'Flow field' },
];
export const FALLOFF_OPTIONS: { id: FalloffMode; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'linear', label: 'Linear' }, { id: 'radial', label: 'Radial' }, { id: 'smooth', label: 'Smooth' }, { id: 'edge', label: 'Edge' },
];
export const FALLOFF_TARGET_OPTIONS: { id: FalloffTarget; label: string }[] = [
  { id: 'opacity', label: 'Opacity' }, { id: 'size', label: 'Element size' }, { id: 'density', label: 'Density' }, { id: 'distortion', label: 'Distortion' }, { id: 'detail', label: 'Detail' },
];

const warpOn = (t: TextureParams) => t.warpAmount > 0;
const falloffOn = (t: TextureParams) => t.falloff !== 'none';
const detailOn = (t: TextureParams) => t.detailAmount > 0;

export const CONTROLS: TextureControl[] = [
  { id: 'motifSize', label: 'Motif size', hint: 'Size of each element. Spacing and the tile scale are not affected.', type: 'range', min: 20, max: 300, step: 5, unit: '%', def: 100, group: 'geometry', tier: 'basic', needs: 'size',
    labels: { noise: 'Grain size', strokes: 'Stroke length', waves: 'Amplitude', rings: 'Ring size' }, familyLabels: { paper: 'Fiber length' } },
  { id: 'spacingX', label: 'Spacing X', hint: 'Horizontal distance between elements. Snaps to whole repeats so the tile stays seamless.', type: 'range', min: 30, max: 300, step: 5, unit: '%', def: 100, group: 'geometry', tier: 'basic', needs: 'sx',
    labels: { waves: 'Wavelength', rings: 'Ring spacing', weave: 'Thread spacing X' } },
  { id: 'spacingY', label: 'Spacing Y', hint: 'Vertical distance between elements. Snaps to whole repeats so the tile stays seamless.', type: 'range', min: 30, max: 300, step: 5, unit: '%', def: 100, group: 'geometry', tier: 'basic', needs: 'sy',
    labels: { waves: 'Line spacing', weave: 'Thread spacing Y' } },
  { id: 'shape', label: 'Shape', hint: 'Motif geometry. “Preset default” keeps the texture’s own shape.', type: 'select', options: SHAPE_OPTIONS, def: 'auto', group: 'geometry', tier: 'basic', needs: 'shape' },
  { id: 'distribution', label: 'Distribution', hint: 'How elements are placed: lattice, scattered, evenly spaced (Poisson disc), radial burst or along a flow field. Same seed + settings = same result.', type: 'select', options: DISTRIBUTION_OPTIONS, def: 'auto', group: 'distribution', tier: 'basic', needs: 'dist' },

  { id: 'aspectRatio', label: 'Aspect ratio', hint: 'Stretch each element horizontally (above 100%) or vertically (below 100%) at constant area.', type: 'range', min: 25, max: 400, step: 5, unit: '%', def: 100, group: 'geometry', tier: 'advanced', needs: 'aspect', labels: { noise: 'Grain stretch' } },
  { id: 'strokeWidth', label: 'Stroke width', hint: 'Line, thread or boundary thickness relative to the preset.', type: 'range', min: 20, max: 400, step: 5, unit: '%', def: 100, group: 'geometry', tier: 'advanced', needs: 'stroke', labels: { weave: 'Thread thickness', cells: 'Boundary thickness' } },
  { id: 'dashLength', label: 'Dash length', hint: 'Dash length in tile units. 0 keeps the preset’s own pattern; a large value makes the line solid.', type: 'range', min: 0, max: 64, step: 1, def: 0, group: 'geometry', tier: 'advanced', needs: 'dash' },
  { id: 'dashGap', label: 'Dash gap', hint: 'Gap between dashes in tile units. 0 = same as the dash length.', type: 'range', min: 0, max: 64, step: 1, def: 0, group: 'geometry', tier: 'advanced', needs: 'dash', when: t => t.dashLength > 0 },
  { id: 'lineBreakup', label: 'Line breakup', hint: 'Randomly cut gaps into horizontal and vertical lines.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 0, group: 'geometry', tier: 'advanced', needs: 'breakup' },
  { id: 'crossingAngle', label: 'Crossing angle', hint: 'Angle between the hatch directions. Snaps to the nearest angle that tiles seamlessly.', type: 'range', min: 15, max: 165, step: 1, unit: '°', def: 90, group: 'geometry', tier: 'advanced', needs: 'cross' },
  { id: 'secondaryStrength', label: 'Secondary lines', hint: 'Strength of the second and third line directions.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 100, group: 'geometry', tier: 'advanced', needs: 'secondary' },
  { id: 'cornerRadius', label: 'Corner radius', hint: 'Round the corners of square motifs.', type: 'range', min: 0, max: 50, step: 1, unit: '%', def: 0, group: 'geometry', tier: 'advanced', needs: 'corner' },
  { id: 'symmetry', label: 'Symmetry', hint: 'Number of corners (polygon) or points (star).', type: 'range', min: 3, max: 12, step: 1, def: 5, group: 'geometry', tier: 'advanced', needs: 'sym' },
  { id: 'weaveInterval', label: 'Weave interval', hint: 'How many threads a thread floats over before going under (1 = plain weave).', type: 'range', min: 1, max: 4, step: 1, def: 1, group: 'geometry', tier: 'advanced', needs: 'weave' },
  { id: 'overUnderContrast', label: 'Over / under contrast', hint: 'How much darker the threads that pass underneath are.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 60, group: 'geometry', tier: 'advanced', needs: 'weave' },
  { id: 'phase', label: 'Phase', hint: 'Slide the pattern inside one repeat (% of a pitch).', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 0, group: 'geometry', tier: 'advanced', needs: 'phase' },

  { id: 'coverage', label: 'Coverage', hint: 'Share of elements that are present. Lower values leave random gaps.', type: 'range', min: 5, max: 100, step: 1, unit: '%', def: 100, group: 'distribution', tier: 'advanced', needs: 'cover' },
  { id: 'positionJitter', label: 'Position jitter', hint: 'Random offset of each element, relative to its spacing.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 0, group: 'distribution', tier: 'advanced', needs: 'jitter', labels: { cells: 'Cell irregularity', rings: 'Ring irregularity' } },
  { id: 'sizeVariation', label: 'Size variation', hint: 'Random size difference between elements.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 0, group: 'distribution', tier: 'advanced', needs: 'sizevar', labels: { lines: 'Width variation', waves: 'Amplitude variation', weave: 'Thread width variation' } },
  { id: 'angleVariation', label: 'Angle variation', hint: 'Random tilt of each element (± degrees). On lines it adds a gentle wobble.', type: 'range', min: 0, max: 90, step: 1, unit: '°', def: 0, group: 'distribution', tier: 'advanced', needs: 'anglevar', labels: { strokes: 'Direction spread', weave: 'Thread waviness' } },
  { id: 'opacityVariation', label: 'Opacity variation', hint: 'Random opacity difference between elements (not the overall opacity).', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 0, group: 'distribution', tier: 'advanced', needs: 'opvar' },

  { id: 'warpAmount', label: 'Distortion amount', hint: 'Domain warp: displaces the geometry with a seamless noise field. 0 leaves shapes sharp and exact.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 0, group: 'distortion', tier: 'advanced', needs: 'warp' },
  { id: 'warpFrequency', label: 'Distortion frequency', hint: 'Number of noise cells across one tile.', type: 'range', min: 1, max: 12, step: 1, def: 3, group: 'distortion', tier: 'advanced', needs: 'warp', when: warpOn },
  { id: 'warpX', label: 'Horizontal distortion', hint: 'Share of the distortion applied sideways.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 100, group: 'distortion', tier: 'advanced', needs: 'warp', when: warpOn },
  { id: 'warpY', label: 'Vertical distortion', hint: 'Share of the distortion applied up / down. Lower one axis to bias the direction.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 100, group: 'distortion', tier: 'advanced', needs: 'warp', when: warpOn },
  { id: 'warpOctaves', label: 'Multiscale', hint: 'Layers of finer distortion added on top of the main one.', type: 'range', min: 1, max: 3, step: 1, def: 1, group: 'distortion', tier: 'advanced', needs: 'warp', when: warpOn },

  { id: 'falloff', label: 'Falloff', hint: 'Fade a property across the tile. The profile is seamless and repeats with every tile — raise the tile scale to spread it over a larger area.', type: 'select', options: FALLOFF_OPTIONS, def: 'none', group: 'spatial', tier: 'advanced', needs: 'falloff' },
  { id: 'falloffTarget', label: 'Affects', hint: 'Which property the falloff changes.', type: 'select', options: FALLOFF_TARGET_OPTIONS, def: 'opacity', group: 'spatial', tier: 'advanced', needs: 'falloff', when: falloffOn },
  { id: 'falloffStrength', label: 'Falloff strength', hint: 'How strongly the property is reduced away from the centre.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 100, group: 'spatial', tier: 'advanced', needs: 'falloff', when: falloffOn },
  { id: 'falloffCenterX', label: 'Center X', hint: 'Horizontal position of the falloff centre, in tile coordinates.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 50, group: 'spatial', tier: 'advanced', needs: 'falloff', when: falloffOn },
  { id: 'falloffCenterY', label: 'Center Y', hint: 'Vertical position of the falloff centre, in tile coordinates.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 50, group: 'spatial', tier: 'advanced', needs: 'falloff', when: falloffOn },
  { id: 'falloffRadius', label: 'Radius', hint: 'Size of the affected region, as a share of the tile.', type: 'range', min: 5, max: 150, step: 1, unit: '%', def: 60, group: 'spatial', tier: 'advanced', needs: 'falloff', when: falloffOn },
  { id: 'falloffAngle', label: 'Direction', hint: 'Direction of a linear falloff. Snaps to 45° steps so the tile stays seamless.', type: 'range', min: 0, max: 315, step: 45, unit: '°', def: 0, group: 'spatial', tier: 'advanced', needs: 'falloff', when: t => t.falloff === 'linear' },

  { id: 'detailAmount', label: 'Detail amount', hint: 'Strength of a second, finer layer of specks, hairlines or noise.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 0, group: 'detail', tier: 'advanced', needs: 'detail' },
  { id: 'detailScale', label: 'Detail scale', hint: 'Size of the fine detail relative to the main texture.', type: 'range', min: 10, max: 200, step: 5, unit: '%', def: 40, group: 'detail', tier: 'advanced', needs: 'detail', when: detailOn },
  { id: 'detailDensity', label: 'Detail density', hint: 'How much fine detail there is.', type: 'range', min: 0, max: 100, step: 1, unit: '%', def: 50, group: 'detail', tier: 'advanced', needs: 'detail', when: detailOn, familyLabels: { paper: 'Fleck density', material: 'Fleck density' } },

  { id: 'threshold', label: 'Threshold', hint: 'Cut a noise field to crisp blobs: everything below the threshold disappears. 0 = off.', type: 'range', min: 0, max: 95, step: 1, unit: '%', def: 0, group: 'rendering', tier: 'advanced', needs: 'threshold' },
  { id: 'octaves', label: 'Fine / coarse detail', hint: 'Octaves of the noise field: more octaves add finer detail on top of the coarse shapes. 0 keeps the preset’s own value.', type: 'range', min: 0, max: 6, step: 1, def: 0, group: 'rendering', tier: 'advanced', needs: 'octaves' },
];

export const CONTROL_BY_ID: Readonly<Record<string, TextureControl>> = Object.freeze(Object.fromEntries(CONTROLS.map(control => [control.id, control])));

export const PARAM_DEFAULTS = Object.freeze(Object.fromEntries(CONTROLS.map(control => [control.id, control.def]))) as unknown as Readonly<TextureParams>;

/** Legacy (pre-advanced-controls) fields: authoritative defaults and ranges. */
const LEGACY_RANGES: Record<string, [number, number]> = {
  scale: [1, 4096], density: [1, 100], opacity: [0, 100], angle: [-3600, 3600], seed: [-1e6, 1e6],
  backgroundOpacity: [0, 100], contrast: [0, 300], softness: [0, 20], offsetX: [-4096, 4096], offsetY: [-4096, 4096],
};

/** The one authoritative default texture (frozen — copy it, never mutate it). */
export const TEXTURE_DEFAULTS: Readonly<TextureData> = Object.freeze({
  enabled: false, pattern: DEFAULT_PATTERN, scale: 36, density: 50, opacity: 18, angle: 0, seed: 17, color: '#ffffff',
  backgroundEnabled: false, backgroundColor: '#10131a', backgroundOpacity: 100, contrast: 100, softness: 0, offsetX: 0, offsetY: 0, blend: 'soft-light',
  ...PARAM_DEFAULTS,
}) as Readonly<TextureData>;

const HEX = /^#[0-9a-f]{6}$/i;
/** `#rrggbb` (3-digit shorthand is expanded). Anything else is rejected so nothing unsafe can reach the SVG. */
export function validColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (HEX.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  return undefined;
}

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Repair / complete any texture-like value: fills missing fields from the defaults, clamps numbers into their ranges,
 * validates enums and colours, and migrates legacy preset ids (`dots-1` → `dots-halftone`).
 * Unknown extra properties are preserved untouched so newer projects survive a round trip.
 */
export function normalizeTexture(raw: unknown): TextureData {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  const defaults = TEXTURE_DEFAULTS as unknown as Record<string, unknown>;
  for (const key of Object.keys(defaults)) {
    const def = defaults[key], value = src[key];
    if (typeof def === 'number') {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
      const control = CONTROL_BY_ID[key];
      const range: [number, number] | undefined = control && control.type === 'range' ? [control.min ?? -Infinity, control.max ?? Infinity] : LEGACY_RANGES[key];
      out[key] = Number.isFinite(n) ? (range ? clampNum(n, range[0], range[1]) : n) : def;
    } else if (typeof def === 'boolean') out[key] = typeof value === 'boolean' ? value : def;
    else out[key] = typeof value === 'string' ? value : def;
  }
  for (const control of CONTROLS) {
    if (control.type !== 'select') continue;
    if (!control.options!.some(option => option.id === out[control.id])) out[control.id] = control.def;
  }
  out.pattern = resolveTextureId(src.pattern) ?? DEFAULT_PATTERN;
  out.color = validColor(src.color) ?? TEXTURE_DEFAULTS.color;
  out.backgroundColor = validColor(src.backgroundColor) ?? TEXTURE_DEFAULTS.backgroundColor;
  return out as unknown as TextureData;
}

/** The control values that are not at their default (used to reset / compare). */
export function changedParams(texture: Partial<TextureParams>): TextureControlId[] {
  return CONTROLS.filter(control => texture[control.id] !== undefined && texture[control.id] !== control.def).map(control => control.id);
}
