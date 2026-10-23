import { clamp } from './color';
import { TEXTURE_DEFAULTS, normalizeTexture, type TextureParams } from './textureControls';

/* ═══════════════════════════ Gradient Studio data model ═══════════════════════════
 * The project is the source of truth. CSS, SVG, PNG and keyframes are all *generated* from it,
 * so everything stays editable. Nothing here knows about React or ShapeForge shapes.
 */

export type GradientKind = 'linear' | 'radial' | 'conic' | 'curve' | 'mesh' | 'noise';
/** Kinds that are true colour-stop gradients (the rest are a mesh of points / a grain texture). */
export const isStopKind = (k: GradientKind) => k === 'linear' || k === 'radial' || k === 'conic' || k === 'curve';
export type ColorSpace = 'srgb' | 'srgb-linear' | 'oklab' | 'oklch';

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light',
  'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export interface ColorStop {
  id: string;
  color: string;      // #rrggbb
  alpha: number;      // 0…1
  pos: number;        // 0…100 along the gradient
  /** Optional cubic-bezier easing for the transition from this stop to the next. */
  curve?: { x1: number; y1: number; x2: number; y2: number };
  /** Hold this colour until the next stop's position, then switch abruptly (hard edge). */
  hard?: boolean;
  /** Transition midpoint toward the next stop, 0…100 (50 = linear). Emitted as a CSS colour hint. */
  mid?: number;
}

export interface RepeatSpec { size: number; unit: 'px' | '%' | 'deg'; offset: number }
export interface Transform { x: number; y: number; scale: number; rotate: number; skewX: number; skewY: number }

export interface EffectInstance { id: string; type: string; enabled: boolean; params: Record<string, number> }
export interface TextureData extends TextureParams {
  enabled: boolean;
  pattern: string;
  scale: number;
  density: number;
  opacity: number;
  angle: number;
  seed: number;
  color: string;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  contrast: number;
  softness: number;
  offsetX: number;
  offsetY: number;
  blend: BlendMode;
}

export type AnimProp = 'x' | 'y' | 'scale' | 'rotate' | 'opacity' | 'angle' | 'hue' | 'stopPos' | 'stopColor' | 'meshX' | 'meshY';
/** `stopId` doubles as the mesh-point id for meshX / meshY tracks. */
export type AnimDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
export interface AnimTrack { id: string; prop: AnimProp; from: number | string; to: number | string; stopId?: string; duration?: number; direction?: AnimDirection }
export interface LayerAnimation { enabled: boolean; duration: number; delay: number; easing: string; direction: AnimDirection; iterations?: number | 'infinite'; tracks: AnimTrack[] }

/** Mesh gradient: soft colour points you can move. Rendered as one radial gradient per point over an optional base colour. */
export interface MeshPoint { id: string; x: number; y: number; color: string; alpha: number; size: number; core?: number; locked?: boolean; group?: string }
export interface MeshData {
  points: MeshPoint[];
  /** solid colour under the points ('' = none) */
  base: string;
  /** how long a point holds its colour before fading, 0…100 (50 = linear fade) */
  core: number;
  /** Reproduces generated positions and mesh effects. */
  seed: number;
}
export interface CurvePoint { x: number; y: number }
export interface CurveData { p0: CurvePoint; p1: CurvePoint; p2: CurvePoint; p3: CurvePoint }
export const DEFAULT_CURVE: CurveData = {
  p0: { x: 8, y: 78 }, p1: { x: 30, y: 85 }, p2: { x: 65, y: 15 }, p3: { x: 92, y: 22 },
};
export interface LayerMask {
  enabled: boolean;
  curved: boolean;
  corners: [CurvePoint, CurvePoint, CurvePoint, CurvePoint];
  controls: [CurvePoint, CurvePoint, CurvePoint, CurvePoint, CurvePoint, CurvePoint, CurvePoint, CurvePoint];
}
export const DEFAULT_LAYER_MASK: LayerMask = {
  enabled: false,
  curved: false,
  corners: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
  controls: [
    { x: 33.3, y: 0 }, { x: 66.7, y: 0 }, { x: 100, y: 33.3 }, { x: 100, y: 66.7 },
    { x: 66.7, y: 100 }, { x: 33.3, y: 100 }, { x: 0, y: 66.7 }, { x: 0, y: 33.3 },
  ],
};
/** Grain / noise overlay (SVG feTurbulence, tiled). */
export interface NoiseData { frequency: number; octaves: number; seed: number; mono: boolean; contrast: number; tile: number }
export const DEFAULT_MESH: MeshData = { points: [], base: '', core: 40, seed: 7 };
export const DEFAULT_NOISE: NoiseData = { frequency: 80, octaves: 3, seed: 4, mono: true, contrast: 120, tile: 220 };
/** The one authoritative default texture (defined next to the control metadata in textureControls.ts; frozen — always copy it). */
export const DEFAULT_TEXTURE: TextureData = TEXTURE_DEFAULTS;

export interface GradientLayer {
  id: string;
  name: string;
  /** Identifies the scene-builder output this layer belongs to, so it can be updated as a group. */
  builderSource?: string;
  builderGroup?: string;
  visible: boolean;
  type: GradientKind;
  repeating: boolean;
  space: ColorSpace;
  stops: ColorStop[];
  /** linear: CSS angle · conic: "from" angle (deg) */
  angle: number;
  /** origin of radial / conic, % of the canvas */
  cx: number; cy: number;
  /** radial: ellipse radii in % of canvas width/height; circle: rx = radius in % of the shorter side */
  shape: 'circle' | 'ellipse';
  rx: number; ry: number;
  repeat: RepeatSpec;
  opacity: number;          // 0…1
  blend: BlendMode;
  transform: Transform;
  effects: EffectInstance[];
  texture: TextureData;
  anim: LayerAnimation;
  /** used when type === 'mesh' */
  mesh: MeshData;
  /** used when type === 'noise' */
  noise: NoiseData;
  /** used when type === 'curve'; points are percentages of the canvas */
  curve: CurveData;
  /** Optional freeform clipping boundary. Applies to the whole layer, including texture overlays. */
  mask: LayerMask;
  /** A non-gradient base layer. The matching stops keep it compatible with image-only outputs. */
  solidColor?: string;
}

/** How the generated code names and sizes things — all user-editable in the Output panel. */
export interface OutputSettings {
  selectorType: 'class' | 'id' | 'attribute';
  /** class / id name, or the attribute name when selectorType is 'attribute' */
  selector: string;
  /** value for attribute selectors, e.g. data-gradient="hero" */
  attrValue: string;
  /** child element class prefix → .layer, .layer-1, .layer-2 … */
  layerPrefix: string;
  /** Base filename for downloaded code and image files (without extension). */
  downloadName: string;
  width: { value: number; unit: 'auto' | '%' | 'px' | 'vw' | 'rem' | 'em' };
  height: { value: number; unit: 'auto' | 'px' | 'vh' | '%' | 'rem' | 'em'; prop: 'height' | 'min-height' };
  includeSize: boolean;
  responsive: boolean;
  comments: boolean;
}
export const DEFAULT_OUTPUT: OutputSettings = {
  selectorType: 'class', selector: 'gradient-canvas', attrValue: 'hero', layerPrefix: 'layer',
  downloadName: 'gradient',
  width: { value: 100, unit: '%' }, height: { value: 320, unit: 'px', prop: 'min-height' }, includeSize: true, responsive: false, comments: true,
};
export const outputOf = (p: { output?: Partial<OutputSettings> }): OutputSettings => ({ ...DEFAULT_OUTPUT, ...(p.output ?? {}), width: { ...DEFAULT_OUTPUT.width, ...(p.output?.width ?? {}) }, height: { ...DEFAULT_OUTPUT.height, ...(p.output?.height ?? {}) } });

export interface GradientProject {
  version: 1;
  name: string;
  canvas: { w: number; h: number };
  /** Solid colour under all layers ('' = transparent). */
  background: string;
  /** index 0 = TOP layer (same order as CSS `background`). */
  layers: GradientLayer[];
  output?: Partial<OutputSettings>;
}

/* ───────────────────────── factories ───────────────────────── */

let counter = 0;
export const uid = (p = 'x') => `${p}${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const IDENTITY: Transform = { x: 0, y: 0, scale: 1, rotate: 0, skewX: 0, skewY: 0 };
export const NO_ANIM: LayerAnimation = { enabled: false, duration: 12, delay: 0, easing: 'ease-in-out', direction: 'alternate', iterations: 'infinite', tracks: [] };

export const stop = (color: string, pos: number, alpha = 1, extra: Partial<ColorStop> = {}): ColorStop => ({ id: uid('s'), color, alpha, pos, ...extra });

export function newLayer(type: GradientKind = 'linear', over: Partial<GradientLayer> = {}): GradientLayer {
  const base: GradientLayer = {
    id: uid('l'), name: '', visible: true, type, repeating: false, space: 'srgb',
    stops: [stop('#7c5cff', 0), stop('#22d3ee', 100)],
    angle: type === 'conic' ? 0 : 135, cx: 50, cy: 50,
    shape: 'ellipse', rx: 50, ry: 50,
    repeat: { size: type === 'conic' ? 45 : 40, unit: type === 'conic' ? 'deg' : 'px', offset: 0 },
    opacity: 1, blend: 'normal', transform: { ...IDENTITY }, effects: [], texture: { ...DEFAULT_TEXTURE }, anim: { ...NO_ANIM, tracks: [] },
    mesh: { ...DEFAULT_MESH, points: [] }, noise: { ...DEFAULT_NOISE }, curve: { ...DEFAULT_CURVE, p0: { ...DEFAULT_CURVE.p0 }, p1: { ...DEFAULT_CURVE.p1 }, p2: { ...DEFAULT_CURVE.p2 }, p3: { ...DEFAULT_CURVE.p3 } },
    mask: { ...DEFAULT_LAYER_MASK, corners: DEFAULT_LAYER_MASK.corners.map(p => ({ ...p })) as LayerMask['corners'], controls: DEFAULT_LAYER_MASK.controls.map(p => ({ ...p })) as LayerMask['controls'] },
  };
  const defined = Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) as Partial<GradientLayer>;
  const layer = { ...base, ...defined };
  if (!layer.name) layer.name = defaultName(layer);
  return layer;
}
export function newSolidLayer(color = '#ffffff'): GradientLayer {
  return newLayer('linear', {
    name: 'Solid Color',
    solidColor: color,
    repeating: false,
    stops: [stop(color, 0), stop(color, 100)],
  });
}
export const KIND_LABEL: Record<GradientKind, string> = { linear: 'Linear', radial: 'Radial', conic: 'Conic', curve: 'Curve', mesh: 'Mesh', noise: 'Grain' };
export const defaultName = (l: Pick<GradientLayer, 'type' | 'repeating'>) => `${l.repeating ? 'Repeating ' : ''}${KIND_LABEL[l.type]}`;

export function newProject(over: Partial<GradientProject> = {}): GradientProject {
  return {
    version: 1, name: 'Untitled gradient', canvas: { w: 1200, h: 800 }, background: '',
    layers: [
      newLayer('radial', { name: 'Glow', cx: 28, cy: 30, rx: 55, ry: 60, stops: [stop('#ff7ad9', 0, 0.9), stop('#ff7ad9', 100, 0)], blend: 'normal' }),
      newLayer('linear', { name: 'Base', angle: 135, stops: [stop('#4f46e5', 0), stop('#06b6d4', 100)] }),
    ],
    ...over,
  };
}

export const CANVAS_PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: '3:2', label: '3 : 2', w: 1200, h: 800 }, { id: '16:9', label: '16 : 9', w: 1280, h: 720 }, { id: '4:3', label: '4 : 3', w: 1200, h: 900 },
  { id: '1:1', label: '1 : 1', w: 1000, h: 1000 }, { id: '9:16', label: '9 : 16', w: 720, h: 1280 }, { id: '21:9', label: '21 : 9', w: 1400, h: 600 },
];

/* ───────────────────────── helpers ───────────────────────── */

export const sortedStops = (stops: ColorStop[]) => [...stops].sort((a, b) => a.pos - b.pos);

export function cloneLayer(l: GradientLayer, keepId = false): GradientLayer {
  const c: GradientLayer = JSON.parse(JSON.stringify(l));
  if (!keepId) {
    c.id = uid('l');
    delete c.builderSource;
    delete c.builderGroup;
    const map = new Map<string, string>();
    c.stops.forEach(s => { const n = uid('s'); map.set(s.id, n); s.id = n; });
    c.mesh.points.forEach(p => { const n = uid('m'); map.set(p.id, n); p.id = n; });
    c.effects.forEach(e => { e.id = uid('e'); });
    c.anim.tracks.forEach(t => { t.id = uid('t'); if (t.stopId) t.stopId = map.get(t.stopId) ?? t.stopId; });
  }
  return c;
}
export const cloneProject = (p: GradientProject): GradientProject => JSON.parse(JSON.stringify(p));

/** Give every id in a project fresh values (used when a preset is instantiated). */
export function freshIds(p: GradientProject): GradientProject {
  return { ...p, layers: p.layers.map(l => cloneLayer(l)) };
}

/** Validate / repair an imported project. Throws a readable error when it is not usable. */
export function normalizeProject(raw: unknown): GradientProject {
  if (!raw || typeof raw !== 'object') throw new Error('Not a gradient project');
  const r = raw as Partial<GradientProject>;
  if (!Array.isArray(r.layers) || !r.layers.length) throw new Error('Project has no layers');
  const layers = r.layers.map((l, i) => {
    const t = (['linear', 'radial', 'conic', 'curve', 'mesh', 'noise'] as const).includes(l.type as GradientKind) ? l.type : 'linear';
    const merged = newLayer(t, { ...l, id: l.id || uid('l'), transform: { ...IDENTITY, ...(l.transform ?? {}) }, anim: { ...NO_ANIM, ...(l.anim ?? {}), tracks: l.anim?.tracks ?? [] }, repeat: { ...newLayer(t).repeat, ...(l.repeat ?? {}) }, effects: l.effects ?? [] });
    merged.effects = merged.effects.map(effect => effect.type === 'iridescence' ? {
      ...effect,
      params: {
        ...effect.params,
        hue: effect.params.hue ?? effect.params.angle ?? 20,
        intensity: effect.params.intensity ?? effect.params.amount ?? 55,
        angle: effect.params.hue !== undefined || effect.params.sheen !== undefined ? effect.params.angle ?? 35 : 35,
        sheen: effect.params.sheen ?? 55,
      },
    } : effect);
    if (!Array.isArray(merged.stops) || merged.stops.length < 2) merged.stops = newLayer(t).stops;
    merged.mesh = { ...DEFAULT_MESH, ...(l.mesh ?? {}), points: (l.mesh?.points ?? []).map(p => ({
      ...p,
      id: p.id || uid('m'),
      core: p.core === undefined ? undefined : clamp(Number(p.core), 0, 100),
      locked: p.locked ?? false,
      group: typeof p.group === 'string' && p.group.trim() ? p.group.trim() : undefined,
    })) };
    merged.noise = { ...DEFAULT_NOISE, ...(l.noise ?? {}) };
    const curve = l.curve ?? DEFAULT_CURVE;
    const curveValue = (value: number | undefined, fallback: number) => {
      const number = Number(value ?? fallback);
      return Number.isFinite(number) ? clamp(number, -25, 125) : fallback;
    };
    merged.curve = {
      p0: { x: curveValue(curve.p0?.x, DEFAULT_CURVE.p0.x), y: curveValue(curve.p0?.y, DEFAULT_CURVE.p0.y) },
      p1: { x: curveValue(curve.p1?.x, DEFAULT_CURVE.p1.x), y: curveValue(curve.p1?.y, DEFAULT_CURVE.p1.y) },
      p2: { x: curveValue(curve.p2?.x, DEFAULT_CURVE.p2.x), y: curveValue(curve.p2?.y, DEFAULT_CURVE.p2.y) },
      p3: { x: curveValue(curve.p3?.x, DEFAULT_CURVE.p3.x), y: curveValue(curve.p3?.y, DEFAULT_CURVE.p3.y) },
    };
    const mask = l.mask ?? DEFAULT_LAYER_MASK;
    merged.mask = {
      enabled: mask.enabled === true,
      curved: mask.curved === true,
      corners: DEFAULT_LAYER_MASK.corners.map((fallback, i) => ({
        x: curveValue(mask.corners?.[i]?.x, fallback.x),
        y: curveValue(mask.corners?.[i]?.y, fallback.y),
      })) as LayerMask['corners'],
      controls: DEFAULT_LAYER_MASK.controls.map((fallback, i) => ({
        x: curveValue(mask.controls?.[i]?.x, fallback.x),
        y: curveValue(mask.controls?.[i]?.y, fallback.y),
      })) as LayerMask['controls'],
    };
    merged.texture = normalizeTexture(l.texture);
    if (!(BLEND_MODES as readonly string[]).includes(merged.texture.blend)) merged.texture.blend = DEFAULT_TEXTURE.blend;
    if (merged.solidColor !== undefined && !/^#[0-9a-f]{6}$/i.test(merged.solidColor)) merged.solidColor = '#ffffff';
    merged.stops = merged.stops.map(s => {
      const curve = s.curve;
      const validCurve = curve && [curve.x1, curve.y1, curve.x2, curve.y2].every(Number.isFinite)
        ? { x1: clamp(curve.x1, 0, 1), y1: clamp(curve.y1, 0, 1), x2: clamp(curve.x2, 0, 1), y2: clamp(curve.y2, 0, 1) }
        : undefined;
      return { ...s, id: s.id || uid('s'), alpha: clamp(Number(s.alpha ?? 1), 0, 1), pos: clamp(Number(s.pos ?? 0), 0, 100), curve: validCurve };
    });
    if (merged.solidColor !== undefined) {
      merged.stops = merged.stops.slice(0, 2);
      while (merged.stops.length < 2) merged.stops.push(stop(merged.solidColor, 100));
      merged.stops = merged.stops.map((s, index) => ({ ...s, color: merged.solidColor!, alpha: 1, pos: index === 0 ? 0 : 100 }));
    }
    if (!merged.name) merged.name = `Layer ${i + 1}`;
    return merged;
  });
  return { version: 1, output: r.output, name: r.name || 'Imported gradient', canvas: { w: clamp(Number(r.canvas?.w) || 1200, 64, 4096), h: clamp(Number(r.canvas?.h) || 800, 64, 4096) }, background: r.background ?? '', layers };
}
