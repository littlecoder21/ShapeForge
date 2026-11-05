/* One place for every shader style: id, label, group, GLSL index and its customisable parameters.
 * The panel, the renderer and the exporter all read this list, so a style can never be missing from one of them. */

export type InteractiveStyle =
  | 'flow' | 'aurora' | 'liquid' | 'holographic' | 'plasma' | 'silk' | 'nebula' | 'ribbons' | 'metaballs' | 'contours' | 'smoke' | 'fire'
  | 'marble' | 'waves' | 'topography' | 'crystal' | 'grid' | 'interference' | 'lava' | 'rays' | 'facets' | 'ink' | 'glass' | 'mist' | 'sunset' | 'pixels' | 'galaxy';

export type ShaderStyleGroup = 'Fluid' | 'Atmosphere' | 'Pattern' | 'Material';

export interface StyleParamDef { label: string; min: number; max: number; step: number; def: number; unit?: string }
export interface ShaderStyleDef {
  id: InteractiveStyle;
  label: string;
  group: ShaderStyleGroup;
  blurb: string;
  /** value of `uStyle` in the fragment shader */
  index: number;
  params: StyleParamDef[];
  isNew?: boolean;
}

const sp = (label: string, min: number, max: number, def: number, step = 0.05, unit?: string): StyleParamDef => ({ label, min, max, def, step, ...(unit ? { unit } : {}) });

export const SHADER_STYLE_LIST: ShaderStyleDef[] = [
  { id: 'flow', label: 'Flow', group: 'Fluid', blurb: 'Soft domain-warped colour drift', index: 0, params: [] },
  { id: 'liquid', label: 'Liquid', group: 'Fluid', blurb: 'Glossy liquid surface', index: 2, params: [] },
  { id: 'plasma', label: 'Plasma', group: 'Fluid', blurb: 'Interfering sine plasma', index: 4, params: [] },
  { id: 'silk', label: 'Silk', group: 'Fluid', blurb: 'Folded satin sheets', index: 5, params: [] },
  { id: 'ribbons', label: 'Ribbons', group: 'Fluid', blurb: 'Sweeping translucent ribbons', index: 7, params: [] },
  { id: 'waves', label: 'Ocean waves', group: 'Fluid', blurb: 'Layered swells with foamy crests', index: 13, isNew: true, params: [sp('Wave count', 1, 12, 5, 0.5), sp('Amplitude', 0, 1, 0.4), sp('Choppiness', 0, 1, 0.3), sp('Foam', 0, 1, 0.3)] },
  { id: 'ink', label: 'Ink bleed', group: 'Fluid', blurb: 'Watercolour pigment pooling in paper', index: 21, isNew: true, params: [sp('Bloom', 0, 1, 0.6), sp('Edge darkening', 0, 1, 0.5), sp('Paper grain', 0, 1, 0.3), sp('Flow', 0, 2, 1)] },

  { id: 'aurora', label: 'Aurora', group: 'Atmosphere', blurb: 'Curtains of northern light', index: 1, params: [] },
  { id: 'nebula', label: 'Nebula', group: 'Atmosphere', blurb: 'Layered space clouds', index: 6, params: [] },
  { id: 'smoke', label: 'Smoke', group: 'Atmosphere', blurb: 'Rising smoke column', index: 10, params: [] },
  { id: 'fire', label: 'Fire', group: 'Atmosphere', blurb: 'Flickering flames', index: 11, params: [] },
  { id: 'mist', label: 'Mist layers', group: 'Atmosphere', blurb: 'Drifting fog banks', index: 23, isNew: true, params: [sp('Layers', 1, 6, 3, 1), sp('Softness', 0, 1, 0.6), sp('Drift', 0, 2, 0.6), sp('Density', 0, 1, 0.55)] },
  { id: 'rays', label: 'Light rays', group: 'Atmosphere', blurb: 'God rays from a light source', index: 19, isNew: true, params: [sp('Rays', 3, 40, 14, 1), sp('Sharpness', 0, 1, 0.5), sp('Ray strength', 0, 1, 0.8), sp('Origin height', -0.8, 0.9, 0.6, 0.02)] },
  { id: 'galaxy', label: 'Galaxy spiral', group: 'Atmosphere', blurb: 'Spiral arms around a bright core', index: 26, isNew: true, params: [sp('Arms', 1, 8, 3, 1), sp('Twist', 0, 10, 4, 0.25), sp('Core size', 0.05, 1, 0.35, 0.01), sp('Spin', -2, 2, 0.5)] },
  { id: 'sunset', label: 'Retro sunset', group: 'Atmosphere', blurb: 'Striped synthwave sun on a gradient sky', index: 24, isNew: true, params: [sp('Horizon', -0.4, 0.4, 0, 0.01), sp('Slit density', 1, 12, 5, 0.5), sp('Sun size', 0.05, 0.5, 0.22, 0.01), sp('Glow', 0, 1, 0.5)] },

  { id: 'contours', label: 'Contours', group: 'Pattern', blurb: 'Gradient iso-lines', index: 9, params: [] },
  { id: 'topography', label: 'Topography', group: 'Pattern', blurb: 'Dense terrain contour map', index: 14, isNew: true, params: [sp('Line density', 4, 40, 14, 1), sp('Line width', 0.05, 0.6, 0.2), sp('Relief', 0, 1, 0.6), sp('Line emphasis', 0, 1, 0.55)] },
  { id: 'grid', label: 'Blueprint grid', group: 'Pattern', blurb: 'Warped technical grid', index: 16, isNew: true, params: [sp('Cells', 4, 40, 14, 1), sp('Line width', 0.01, 0.3, 0.06, 0.01), sp('Warp', 0, 1, 0.35), sp('Glow', 0, 1, 0.4)] },
  { id: 'crystal', label: 'Crystal cells', group: 'Pattern', blurb: 'Voronoi cells with glowing seams', index: 15, isNew: true, params: [sp('Cells', 2, 20, 7, 0.5), sp('Edge glow', 0, 1, 0.5), sp('Jitter', 0, 1, 0.8), sp('Motion', 0, 1, 0.4)] },
  { id: 'facets', label: 'Low-poly facets', group: 'Pattern', blurb: 'Triangulated crystal facets', index: 20, isNew: true, params: [sp('Facets', 2, 20, 8, 0.5), sp('Shade', 0, 1, 0.5), sp('Colour shift', 0, 1, 0.5), sp('Motion', 0, 1, 0.3)] },
  { id: 'pixels', label: 'Pixel mosaic', group: 'Pattern', blurb: 'Shuffling square tiles', index: 25, isNew: true, params: [sp('Tiles', 6, 80, 24, 1), sp('Gap', 0, 0.4, 0.06, 0.01), sp('Shuffle speed', 0, 2, 0.6), sp('Contrast', 0, 1, 0.5)] },
  { id: 'interference', label: 'Interference', group: 'Pattern', blurb: 'Moiré rings from moving sources', index: 17, isNew: true, params: [sp('Sources', 2, 5, 3, 1), sp('Frequency', 4, 40, 16, 1), sp('Speed', 0, 2, 0.5), sp('Contrast', 0, 1, 0.6)] },
  { id: 'marble', label: 'Marble', group: 'Pattern', blurb: 'Veined stone', index: 12, isNew: true, params: [sp('Vein scale', 1, 10, 4, 0.25), sp('Sharpness', 0, 1, 0.6), sp('Turbulence', 0, 2, 1), sp('Contrast', 0, 1, 0.5)] },

  { id: 'holographic', label: 'Holographic', group: 'Material', blurb: 'Iridescent foil', index: 3, params: [] },
  { id: 'metaballs', label: 'Metaballs', group: 'Material', blurb: 'Merging blobs', index: 8, params: [] },
  { id: 'lava', label: 'Lava lamp', group: 'Material', blurb: 'Gooey blobs that rise and merge', index: 18, isNew: true, params: [sp('Blobs', 2, 8, 5, 1), sp('Size', 0.1, 0.5, 0.24, 0.01), sp('Rise speed', 0, 2, 0.5), sp('Gooeyness', 0, 1, 0.45)] },
  { id: 'glass', label: 'Fluted glass', group: 'Material', blurb: 'Reeded glass that refracts the colours', index: 22, isNew: true, params: [sp('Ribs', 4, 60, 22, 1), sp('Refraction', 0, 1, 0.5), sp('Frost', 0, 1, 0.2), sp('Angle', 0, 180, 0, 1, '°')] },
];

export const SHADER_STYLE_GROUPS: ShaderStyleGroup[] = ['Fluid', 'Atmosphere', 'Pattern', 'Material'];
export const SHADER_STYLE_IDS: InteractiveStyle[] = [...SHADER_STYLE_LIST].sort((a, b) => a.index - b.index).map(style => style.id);
export const SHADER_STYLE_MAP = Object.fromEntries(SHADER_STYLE_LIST.map(style => [style.id, style])) as Record<InteractiveStyle, ShaderStyleDef>;
/** style id → value of the `uStyle` uniform */
export const SHADER_STYLE_INDEX = Object.fromEntries(SHADER_STYLE_LIST.map(style => [style.id, style.index])) as Record<InteractiveStyle, number>;

export const isInteractiveStyle = (value: unknown): value is InteractiveStyle => typeof value === 'string' && value in SHADER_STYLE_MAP;

export function defaultStyleParams(style: InteractiveStyle): number[] {
  const params = SHADER_STYLE_MAP[style].params;
  return [0, 1, 2, 3].map(index => params[index]?.def ?? 0);
}

/** Four numbers for `uStyleP`: stored values clamped into range, missing ones filled with the style's defaults. */
export function resolveStyleParams(style: InteractiveStyle, stored?: readonly number[] | null): number[] {
  const params = SHADER_STYLE_MAP[style].params;
  return [0, 1, 2, 3].map(index => {
    const def = params[index];
    if (!def) return 0;
    const candidate = Number(stored?.[index]);
    return Number.isFinite(candidate) ? Math.min(def.max, Math.max(def.min, candidate)) : def.def;
  });
}

export function normalizeStyleParamsFor(style: InteractiveStyle, raw: readonly unknown[]): number[] {
  return resolveStyleParams(style, raw.map(Number));
}
