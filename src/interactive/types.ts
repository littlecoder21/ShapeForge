import { normalizePointerMode, type PointerMode } from '../gradient/interactive/pointerModes';
import { isInteractiveStyle, normalizeStyleParamsFor, SHADER_STYLE_IDS, type InteractiveStyle } from '../gradient/interactive/styles';
import { instantiateRig, normalizeRig, type InteractionRig } from '../gradient/interactive/rig/model';
import { defaultRig, rigFromLegacyMode } from '../gradient/interactive/rig/presets';
import { normalizeProcedural, type ProceduralConfig } from '../procedural/types';

export type { InteractiveStyle } from '../gradient/interactive/styles';
export type ShaderQuality = 'low' | 'medium' | 'high' | 'ultra';
export type { PointerMode } from '../gradient/interactive/pointerModes';
export type { InteractionRig } from '../gradient/interactive/rig/model';
export type { ProceduralConfig } from '../procedural/types';
export type ShaderGradientGeometry = 'linear' | 'radial' | 'conic' | 'curve' | 'mesh' | 'noise';
export type ShaderLayerColorBlend = 'mix' | 'multiply' | 'screen' | 'overlay' | 'add';
export type IdlePath = 'drift' | 'circle' | 'figure8' | 'scan' | 'wander';
export const IDLE_PATHS: IdlePath[] = ['drift', 'circle', 'figure8', 'scan', 'wander'];
export type ShaderLayerControls = Pick<InteractiveSettings,
  'speed' | 'intensity' | 'distortion' | 'distortionScale' | 'turbulence'
  | 'timeOffset' | 'flowAngle' | 'flowDrift' | 'breath' | 'breathRate' | 'rotation' | 'zoom'
  | 'meshDrift' | 'meshSpread' | 'meshBlend'>;

export interface ShaderLayerConfig {
  enabled: boolean;
  style: InteractiveStyle;
  /** values of the style's own parameters (see styles.ts); missing = the style defaults */
  styleParams?: number[];
  controls?: ShaderLayerControls;
  /** false = this layer ignores the pointer completely */
  interact: boolean;
  /** how strongly this layer reacts; negative values react in the opposite direction (parallax) */
  reaction: number;
  mixLayerId: string;
  mixMode: ShaderLayerColorBlend;
  mixStrength: number;
  mixSpeed: number;
  /** the procedural gradient engine (see procedural/). Absent = the layer keeps its manual gradient. */
  procedural?: ProceduralConfig;
}

export interface ShaderGeometry {
  kind: ShaderGradientGeometry;
  angle: number;
  originX: number;
  originY: number;
  radiusX: number;
  radiusY: number;
  space?: 'srgb' | 'srgb-linear' | 'oklab' | 'oklch';
}

export interface ShaderStop {
  color: string;
  position: number;
  alpha?: number;
  hard?: boolean;
  mid?: number;
  curve?: { x1: number; y1: number; x2: number; y2: number };
}

export interface ShaderMeshPoint {
  color: string;
  x: number;
  y: number;
  size: number;
  alpha: number;
}

export interface InteractiveSettings {
  enabled: boolean;
  style: InteractiveStyle;
  shaderMix: number;
  quality: ShaderQuality;
  resolutionScale: number;
  animate: boolean;
  speed: number;
  intensity: number;
  distortion: number;
  distortionScale: number;
  turbulence: number;
  /** advanced motion */
  timeOffset: number;
  flowAngle: number;
  flowDrift: number;
  breath: number;
  breathRate: number;
  rotation: number;
  zoom: number;
  /** extra animated travel for mesh-gradient points, in canvas-height units */
  meshDrift: number;
  /** broadens mesh influence without changing individual point sizes */
  meshSpread: number;
  /** 0 = style field only, 1 = mesh colors only */
  meshBlend: number;
  interactionEnabled: boolean;
  touchEnabled: boolean;
  /** legacy id of the old pointer style. Only used to migrate old projects into `rig`. */
  pointerMode: PointerMode;
  /** the interaction builder: a stack of rules (see rig/model.ts) */
  rig: InteractionRig;
  interactionColorSource: 'layer' | 'custom';
  interactionColor: string;
  interactionColors: string[];
  interactionColorMix: number;
  interactionColorSpeed: number;
  interactionFalloff: 'soft' | 'linear' | 'sharp' | 'gaussian';
  interactionDistortion: number;
  interactionDisplacement: number;
  interactionDisplacementMode: 'push' | 'pull';
  interactionVelocityReaction: number;
  interactionDelay: number;
  interactionGlitch: number;
  interactionRadius: number;
  interactionStrength: number;
  glow: number;
  ripplesEnabled: boolean;
  rippleStrength: number;
  rippleSpeed: number;
  maximumRipples: number;
  toneMapping: number;
  vignette: number;
  sheen: number;
  filmGrain: number;
  idleMotion: boolean;
  idlePath: IdlePath;
  idleSpeed: number;
  idleSize: number;
  paletteWrap: 'mirror' | 'repeat';
  renderBackend: 'css' | 'webgl' | 'overlay';
}

/** Values that belong to one layer rather than the whole project. */
export interface InteractiveLayerState {
  styleParams: number[];
  /** 0 = ignores the pointer */
  reaction: number;
}

export interface InteractiveUpdate {
  settings?: Partial<InteractiveSettings>;
  layer?: Partial<InteractiveLayerState>;
  palette?: ShaderStop[];
  layerMix?: { palette: ShaderStop[]; space?: ShaderGeometry['space']; mode: ShaderLayerColorBlend; strength: number; speed: number };
  geometry?: ShaderGeometry;
  meshPoints?: ShaderMeshPoint[];
  meshBase?: string;
  /** the layer's procedural engine; null / disabled = the manual gradient only */
  procedural?: ProceduralConfig | null;
}

export type InteractiveRendererStatus = 'ready' | 'compiling' | 'fallback' | 'context-lost' | 'error';

export const DEFAULT_INTERACTIVE_SETTINGS: Readonly<InteractiveSettings> = Object.freeze({
  enabled: false,
  style: 'flow',
  shaderMix: 1,
  quality: 'medium',
  resolutionScale: 1,
  animate: true,
  speed: 0.35,
  intensity: 1,
  distortion: 0.28,
  distortionScale: 1.8,
  turbulence: 0.35,
  timeOffset: 0,
  flowAngle: 0,
  flowDrift: 0,
  breath: 0,
  breathRate: 0.25,
  rotation: 0,
  zoom: 1,
  meshDrift: 0,
  meshSpread: 0,
  meshBlend: 0.82,
  interactionEnabled: true,
  touchEnabled: true,
  pointerMode: 'swirl',
  rig: defaultRig(),
  interactionColorSource: 'layer',
  interactionColor: '#7c5cff',
  interactionColors: ['#7c5cff', '#22d3ee', '#f472b6'],
  interactionColorMix: 0.75,
  interactionColorSpeed: 0.35,
  interactionFalloff: 'soft',
  interactionDistortion: 0.42,
  interactionDisplacement: 0.35,
  interactionDisplacementMode: 'push',
  interactionVelocityReaction: 0.65,
  interactionDelay: 85,
  interactionGlitch: 0,
  interactionRadius: 0.28,
  interactionStrength: 0.42,
  glow: 0.55,
  ripplesEnabled: true,
  rippleStrength: 0.65,
  rippleSpeed: 0.32,
  maximumRipples: 5,
  toneMapping: 0,
  vignette: 0,
  sheen: 0,
  filmGrain: 0,
  idleMotion: false,
  idlePath: 'drift',
  idleSpeed: 1,
  idleSize: 0.28,
  paletteWrap: 'mirror',
  renderBackend: 'overlay',
});

export const DEFAULT_SHADER_LAYER: Readonly<ShaderLayerConfig> = Object.freeze({
  enabled: false,
  style: 'flow',
  interact: true,
  reaction: 1,
  mixLayerId: '',
  mixMode: 'mix',
  mixStrength: 0.5,
  mixSpeed: 0.35,
});
export const DEFAULT_SHADER_GEOMETRY: Readonly<ShaderGeometry> = Object.freeze({
  kind: 'linear',
  angle: 135,
  originX: 50,
  originY: 50,
  radiusX: 50,
  radiusY: 50,
});

/** Range of every motion control, shared by the clamping code and the panel sliders. */
export const MOTION_RANGES = {
  speed: { min: 0, max: 2 },
  intensity: { min: 0, max: 1 },
  distortion: { min: 0, max: 1 },
  distortionScale: { min: 0.2, max: 8 },
  turbulence: { min: 0, max: 1 },
  timeOffset: { min: 0, max: 120 },
  flowAngle: { min: -180, max: 180 },
  flowDrift: { min: -2, max: 2 },
  breath: { min: 0, max: 1 },
  breathRate: { min: 0.02, max: 2 },
  rotation: { min: -0.6, max: 0.6 },
  zoom: { min: 0.4, max: 3 },
  meshDrift: { min: 0, max: 1 },
  meshSpread: { min: 0, max: 1 },
  meshBlend: { min: 0, max: 1 },
} as const;
export const LAYER_CONTROL_KEYS = Object.keys(MOTION_RANGES) as (keyof ShaderLayerControls)[];

export function normalizeShaderLayer(raw: unknown): ShaderLayerConfig {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const rawControls = value.controls && typeof value.controls === 'object'
    ? value.controls as Record<string, unknown>
    : null;
  const normalizeControl = (key: keyof ShaderLayerControls) => {
    const { min, max } = MOTION_RANGES[key];
    const candidate = Number(rawControls?.[key]);
    return Number.isFinite(candidate) ? Math.min(max, Math.max(min, candidate)) : DEFAULT_INTERACTIVE_SETTINGS[key];
  };
  const style: InteractiveStyle = isInteractiveStyle(value.style) ? value.style : DEFAULT_SHADER_LAYER.style;
  const reaction = Number(value.reaction);
  return {
    enabled: value.enabled === true,
    style,
    ...(Array.isArray(value.styleParams) ? { styleParams: normalizeStyleParamsFor(style, value.styleParams) } : {}),
    ...(rawControls ? { controls: Object.fromEntries(LAYER_CONTROL_KEYS.map(key => [key, normalizeControl(key)])) as ShaderLayerControls } : {}),
    interact: value.interact !== false,
    reaction: Number.isFinite(reaction) ? Math.min(2, Math.max(-1.5, reaction)) : DEFAULT_SHADER_LAYER.reaction,
    mixLayerId: typeof value.mixLayerId === 'string' ? value.mixLayerId : '',
    mixMode: typeof value.mixMode === 'string' && ['mix', 'multiply', 'screen', 'overlay', 'add'].includes(value.mixMode)
      ? value.mixMode as ShaderLayerColorBlend
      : DEFAULT_SHADER_LAYER.mixMode,
    mixStrength: Number.isFinite(Number(value.mixStrength)) ? Math.min(1, Math.max(0, Number(value.mixStrength))) : DEFAULT_SHADER_LAYER.mixStrength,
    mixSpeed: Number.isFinite(Number(value.mixSpeed)) ? Math.min(2, Math.max(0, Number(value.mixSpeed))) : DEFAULT_SHADER_LAYER.mixSpeed,
    ...(value.procedural && typeof value.procedural === 'object' ? { procedural: normalizeProcedural(value.procedural) } : {}),
  };
}

export function normalizeInteractiveSettings(raw: unknown): InteractiveSettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const finite = (key: keyof InteractiveSettings, min: number, max: number) => {
    const candidate = Number(value[key]);
    const fallback = DEFAULT_INTERACTIVE_SETTINGS[key] as number;
    return Number.isFinite(candidate) ? Math.min(max, Math.max(min, candidate)) : fallback;
  };
  const choice = <T extends string>(key: keyof InteractiveSettings, options: readonly T[], fallback: T): T => {
    const candidate = value[key];
    return typeof candidate === 'string' && options.includes(candidate as T) ? candidate as T : fallback;
  };
  const motion = (key: keyof typeof MOTION_RANGES) => finite(key, MOTION_RANGES[key].min, MOTION_RANGES[key].max);
  const pointerMode = normalizePointerMode(value.pointerMode);
  const rig = normalizeRig(value.rig)
    ?? (value.pointerMode !== undefined ? rigFromLegacyMode(pointerMode) : instantiateRig(DEFAULT_INTERACTIVE_SETTINGS.rig));
  return {
    enabled: value.enabled === true,
    style: choice('style', SHADER_STYLE_IDS, DEFAULT_INTERACTIVE_SETTINGS.style),
    shaderMix: finite('shaderMix', 0, 1),
    quality: choice('quality', ['low', 'medium', 'high', 'ultra'], DEFAULT_INTERACTIVE_SETTINGS.quality),
    resolutionScale: finite('resolutionScale', 0.35, 1.5),
    animate: value.animate !== false,
    speed: motion('speed'),
    intensity: motion('intensity'),
    distortion: motion('distortion'),
    distortionScale: motion('distortionScale'),
    turbulence: motion('turbulence'),
    timeOffset: motion('timeOffset'),
    flowAngle: motion('flowAngle'),
    flowDrift: motion('flowDrift'),
    breath: motion('breath'),
    breathRate: motion('breathRate'),
    rotation: motion('rotation'),
    zoom: motion('zoom'),
    meshDrift: motion('meshDrift'),
    meshSpread: motion('meshSpread'),
    meshBlend: motion('meshBlend'),
    interactionEnabled: value.interactionEnabled !== false,
    touchEnabled: value.touchEnabled !== false,
    pointerMode,
    rig,
    interactionColorSource: choice('interactionColorSource', ['layer', 'custom'], DEFAULT_INTERACTIVE_SETTINGS.interactionColorSource),
    interactionColor: typeof value.interactionColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.interactionColor)
      ? value.interactionColor
      : DEFAULT_INTERACTIVE_SETTINGS.interactionColor,
    interactionColors: (() => {
      const source = Array.isArray(value.interactionColors)
        ? value.interactionColors
        : value.interactionColor && value.interactionColor !== DEFAULT_INTERACTIVE_SETTINGS.interactionColor
          ? [value.interactionColor]
          : DEFAULT_INTERACTIVE_SETTINGS.interactionColors;
      const colors = source
        .filter((color): color is string => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
        .slice(0, 5);
      return colors.length ? colors : [...DEFAULT_INTERACTIVE_SETTINGS.interactionColors];
    })(),
    interactionColorMix: finite('interactionColorMix', 0, 1),
    interactionColorSpeed: finite('interactionColorSpeed', 0, 2),
    interactionFalloff: choice('interactionFalloff', ['soft', 'linear', 'sharp', 'gaussian'], DEFAULT_INTERACTIVE_SETTINGS.interactionFalloff),
    interactionDistortion: finite('interactionDistortion', 0, 1),
    interactionDisplacement: finite('interactionDisplacement', 0, 1),
    interactionDisplacementMode: choice('interactionDisplacementMode', ['push', 'pull'], DEFAULT_INTERACTIVE_SETTINGS.interactionDisplacementMode),
    interactionVelocityReaction: finite('interactionVelocityReaction', 0, 2),
    interactionDelay: finite('interactionDelay', 0, 600),
    interactionGlitch: finite('interactionGlitch', 0, 1),
    interactionRadius: finite('interactionRadius', 0.04, 0.8),
    interactionStrength: finite('interactionStrength', 0, 1),
    glow: finite('glow', 0, 1),
    ripplesEnabled: value.ripplesEnabled !== false,
    rippleStrength: finite('rippleStrength', 0, 1),
    rippleSpeed: finite('rippleSpeed', 0.05, 1),
    maximumRipples: Math.floor(finite('maximumRipples', 1, 8)),
    toneMapping: finite('toneMapping', 0, 1),
    vignette: finite('vignette', 0, 1),
    sheen: finite('sheen', 0, 1),
    filmGrain: finite('filmGrain', 0, 1),
    idleMotion: value.idleMotion === true,
    idlePath: choice('idlePath', IDLE_PATHS, DEFAULT_INTERACTIVE_SETTINGS.idlePath),
    idleSpeed: finite('idleSpeed', 0.1, 3),
    idleSize: finite('idleSize', 0.05, 0.48),
    paletteWrap: choice('paletteWrap', ['mirror', 'repeat'], DEFAULT_INTERACTIVE_SETTINGS.paletteWrap),
    renderBackend: choice('renderBackend', ['css', 'webgl', 'overlay'], DEFAULT_INTERACTIVE_SETTINGS.renderBackend),
  };
}
