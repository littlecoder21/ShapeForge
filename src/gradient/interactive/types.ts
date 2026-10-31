export type InteractiveStyle = 'flow' | 'aurora' | 'liquid' | 'holographic' | 'plasma' | 'silk' | 'nebula' | 'ribbons' | 'metaballs' | 'contours';
export type ShaderQuality = 'low' | 'medium' | 'high' | 'ultra';
export type PointerMode =
  | 'attract' | 'repel' | 'swirl' | 'glow' | 'drag' | 'wave' | 'orbit'
  | 'magnet' | 'ripple' | 'pulse' | 'trail' | 'spotlight' | 'hue';
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
}

export interface ShaderStop {
  color: string;
  position: number;
  alpha?: number;
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
  interactionColor: string;
  interactionRadius: number;
  interactionStrength: number;
  glow: number;
  ripplesEnabled: boolean;
  rippleStrength: number;
  rippleSpeed: number;
  maximumRipples: number;
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
  quality: 'high',
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
  interactionColor: '#ffffff',
  interactionRadius: 0.28,
  interactionStrength: 0.42,
  glow: 0.55,
  ripplesEnabled: true,
  rippleStrength: 0.65,
  rippleSpeed: 0.32,
  maximumRipples: 5,
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
  const styles: InteractiveStyle[] = ['flow', 'aurora', 'liquid', 'holographic', 'plasma', 'silk', 'nebula', 'ribbons', 'metaballs', 'contours'];
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
    style: choice('style', ['flow', 'aurora', 'liquid', 'holographic', 'plasma', 'silk', 'nebula', 'ribbons', 'metaballs', 'contours'], DEFAULT_INTERACTIVE_SETTINGS.style),
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
    pointerMode: choice('pointerMode', [
      'attract', 'repel', 'swirl', 'glow', 'drag', 'wave', 'orbit',
      'magnet', 'ripple', 'pulse', 'trail', 'spotlight', 'hue',
    ], DEFAULT_INTERACTIVE_SETTINGS.pointerMode),
    interactionColor: typeof value.interactionColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.interactionColor)
      ? value.interactionColor
      : DEFAULT_INTERACTIVE_SETTINGS.interactionColor,
    interactionRadius: finite('interactionRadius', 0.04, 0.8),
    interactionStrength: finite('interactionStrength', 0, 1),
    glow: finite('glow', 0, 1),
    ripplesEnabled: value.ripplesEnabled !== false,
    rippleStrength: finite('rippleStrength', 0, 1),
    rippleSpeed: finite('rippleSpeed', 0.05, 1),
    maximumRipples: Math.floor(finite('maximumRipples', 1, 8)),
  };
}
