import { normalizePointerMode, type PointerMode } from './pointerModes';

export type InteractiveStyle = 'flow' | 'aurora' | 'liquid' | 'holographic' | 'plasma' | 'silk' | 'nebula' | 'ribbons' | 'metaballs' | 'contours';
const SHADER_STYLES: InteractiveStyle[] = ['flow', 'aurora', 'liquid', 'holographic', 'plasma', 'silk', 'nebula', 'ribbons', 'metaballs', 'contours'];
export type ShaderQuality = 'low' | 'medium' | 'high' | 'ultra';
export type { PointerMode } from './pointerModes';
export type ShaderGradientGeometry = 'linear' | 'radial' | 'conic' | 'curve' | 'mesh' | 'noise';

export interface ShaderLayerConfig {
  enabled: boolean;
  style: InteractiveStyle;
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
  interactionEnabled: boolean;
  touchEnabled: boolean;
  pointerMode: PointerMode;
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
  paletteWrap: 'mirror' | 'repeat';
  renderBackend: 'css' | 'webgl' | 'overlay';
}

export interface InteractiveUpdate {
  settings?: Partial<InteractiveSettings>;
  palette?: ShaderStop[];
  geometry?: ShaderGeometry;
  meshPoints?: ShaderMeshPoint[];
  meshBase?: string;
}

export type InteractiveRendererStatus = 'ready' | 'fallback' | 'context-lost' | 'error';

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
  interactionEnabled: true,
  touchEnabled: true,
  pointerMode: 'swirl',
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
  paletteWrap: 'mirror',
  renderBackend: 'overlay',
});

export const DEFAULT_SHADER_LAYER: Readonly<ShaderLayerConfig> = Object.freeze({ enabled: false, style: 'flow' });
export const DEFAULT_SHADER_GEOMETRY: Readonly<ShaderGeometry> = Object.freeze({
  kind: 'linear',
  angle: 135,
  originX: 50,
  originY: 50,
  radiusX: 50,
  radiusY: 50,
});

export function normalizeShaderLayer(raw: unknown): ShaderLayerConfig {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const styles = SHADER_STYLES;
  return {
    enabled: value.enabled === true,
    style: typeof value.style === 'string' && styles.includes(value.style as InteractiveStyle) ? value.style as InteractiveStyle : DEFAULT_SHADER_LAYER.style,
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
  return {
    enabled: value.enabled === true,
    style: choice('style', SHADER_STYLES, DEFAULT_INTERACTIVE_SETTINGS.style),
    shaderMix: finite('shaderMix', 0, 1),
    quality: choice('quality', ['low', 'medium', 'high', 'ultra'], DEFAULT_INTERACTIVE_SETTINGS.quality),
    resolutionScale: finite('resolutionScale', 0.35, 1.5),
    animate: value.animate !== false,
    speed: finite('speed', 0, 2),
    intensity: finite('intensity', 0, 1),
    distortion: finite('distortion', 0, 1),
    distortionScale: finite('distortionScale', 0.2, 8),
    turbulence: finite('turbulence', 0, 1),
    interactionEnabled: value.interactionEnabled !== false,
    touchEnabled: value.touchEnabled !== false,
    pointerMode: normalizePointerMode(value.pointerMode),
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
    paletteWrap: choice('paletteWrap', ['mirror', 'repeat'], DEFAULT_INTERACTIVE_SETTINGS.paletteWrap),
    renderBackend: choice('renderBackend', ['css', 'webgl', 'overlay'], DEFAULT_INTERACTIVE_SETTINGS.renderBackend),
  };
}
