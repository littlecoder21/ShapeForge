import type { EffectInstance } from './model';
import { uid } from './model';

/* ═══════════ Effects registry ═══════════
 * Add a new effect by registering an EffectDef. Everything that renders a layer (CSS, SVG, canvas, UI)
 * reads this table, so a future noise / ripple / warp effect only needs an entry here.
 */
export interface ParamDef { key: string; label: string; min: number; max: number; step: number; unit: string; def: number }
export interface EffectDef {
  id: string; label: string; hint: string;
  params: ParamDef[];
  rasterUnsupported?: boolean;
  /** CSS filter fragment, '' = nothing. `fid` is a unique id for url() filters. */
  css(p: Record<string, number>, fid: string): string;
  /** standalone <filter> definition when css() references url(#fid) */
  defs?(p: Record<string, number>, fid: string): string;
  /** SVG filter primitives (chained). */
  svg(p: Record<string, number>): string;
  /** canvas ctx.filter fragment (not all effects can be rasterised) */
  canvas(p: Record<string, number>): string;
  /** extra pixels the effect spreads content (used for bleed so blurred edges stay filled) */
  spread?(p: Record<string, number>): number;
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);
const p = (key: string, label: string, min: number, max: number, step: number, unit: string, def: number): ParamDef => ({ key, label, min, max, step, unit, def });

export const EFFECTS: Record<string, EffectDef> = {
  blur: {
    id: 'blur', label: 'Blur', hint: 'Gaussian blur — the base of every glow and aurora.',
    params: [p('radius', 'Radius', 0, 200, 1, 'px', 24)],
    css: v => (v.radius > 0 ? `blur(${num(v.radius)}px)` : ''),
    svg: v => `<feGaussianBlur stdDeviation="${num(v.radius)}"/>`,
    canvas: v => `blur(${num(v.radius)}px)`,
    spread: v => v.radius * 2.5,
  },
  brightness: {
    id: 'brightness', label: 'Brightness', hint: 'Lighten or darken the layer.',
    params: [p('amount', 'Amount', 0, 250, 1, '%', 120)],
    css: v => `brightness(${num(v.amount / 100)})`,
    svg: v => { const k = num(v.amount / 100); return `<feComponentTransfer><feFuncR type="linear" slope="${k}"/><feFuncG type="linear" slope="${k}"/><feFuncB type="linear" slope="${k}"/></feComponentTransfer>`; },
    canvas: v => `brightness(${num(v.amount / 100)})`,
  },
  contrast: {
    id: 'contrast', label: 'Contrast', hint: 'Push or flatten tonal range.',
    params: [p('amount', 'Amount', 0, 250, 1, '%', 120)],
    css: v => `contrast(${num(v.amount / 100)})`,
    svg: v => { const k = v.amount / 100, i = num(0.5 - 0.5 * k); return `<feComponentTransfer><feFuncR type="linear" slope="${num(k)}" intercept="${i}"/><feFuncG type="linear" slope="${num(k)}" intercept="${i}"/><feFuncB type="linear" slope="${num(k)}" intercept="${i}"/></feComponentTransfer>`; },
    canvas: v => `contrast(${num(v.amount / 100)})`,
  },
  saturate: {
    id: 'saturate', label: 'Saturation', hint: 'Boost or drain colour.',
    params: [p('amount', 'Amount', 0, 300, 1, '%', 140)],
    css: v => `saturate(${num(v.amount / 100)})`,
    svg: v => `<feColorMatrix type="saturate" values="${num(v.amount / 100)}"/>`,
    canvas: v => `saturate(${num(v.amount / 100)})`,
  },
  hue: {
    id: 'hue', label: 'Hue rotate', hint: 'Shift every colour around the wheel.',
    params: [p('angle', 'Angle', 0, 360, 1, '°', 40)],
    css: v => `hue-rotate(${num(v.angle)}deg)`,
    svg: v => `<feColorMatrix type="hueRotate" values="${num(v.angle)}"/>`,
    canvas: v => `hue-rotate(${num(v.angle)}deg)`,
  },
  grayscale: {
    id: 'grayscale', label: 'Grayscale', hint: 'Remove colour.',
    params: [p('amount', 'Amount', 0, 100, 1, '%', 100)],
    css: v => `grayscale(${num(v.amount / 100)})`,
    svg: v => `<feColorMatrix type="saturate" values="${num(1 - v.amount / 100)}"/>`,
    canvas: v => `grayscale(${num(v.amount / 100)})`,
  },
  distort: {
    id: 'distort', label: 'Distortion', hint: 'Turbulence displacement — bends edges like drifting curtains. Renders in CSS/SVG, not in PNG.',
    params: [p('scale', 'Strength', 0, 200, 1, 'px', 60), p('freq', 'Frequency', 1, 60, 1, '‰', 8), p('seed', 'Seed', 1, 99, 1, '', 3)],
    css: (_v, fid) => `url(#${fid})`,
    defs: (v, fid) => `<filter id="${fid}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${num(v.freq / 1000)}" numOctaves="2" seed="${Math.round(v.seed)}" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="${num(v.scale)}" xChannelSelector="R" yChannelSelector="G"/></filter>`,
    svg: v => `<feTurbulence type="fractalNoise" baseFrequency="${num(v.freq / 1000)}" numOctaves="2" seed="${Math.round(v.seed)}" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="${num(v.scale)}" xChannelSelector="R" yChannelSelector="G"/>`,
    canvas: () => '',
    rasterUnsupported: true,
    spread: v => v.scale,
  },
  grain: {
    id: 'grain', label: 'Grain', hint: 'Fine, film-like texture with a reproducible seed.',
    params: [p('amount', 'Amount', 0, 100, 1, '%', 18), p('frequency', 'Grain size', 10, 300, 1, '%', 110), p('seed', 'Seed', 1, 999, 1, '', 17)],
    css: (_v, fid) => `url(#${fid})`,
    svg: v => `<feTurbulence type="fractalNoise" baseFrequency="${num(v.frequency / 1000)}" numOctaves="2" seed="${Math.round(v.seed)}" result="grain"/><feColorMatrix in="grain" type="saturate" values="0" result="grainMono"/><feComponentTransfer in="grainMono" result="grainAlpha"><feFuncA type="table" tableValues="0 ${num(v.amount / 100)}"/></feComponentTransfer><feBlend in="SourceGraphic" in2="grainAlpha" mode="soft-light"/>`,
    canvas: () => '',
    rasterUnsupported: true,
  },
  turbulence: {
    id: 'turbulence', label: 'Turbulence', hint: 'Organic, cloud-like color variations.',
    params: [p('strength', 'Strength', 0, 160, 1, 'px', 24), p('frequency', 'Scale', 1, 80, 1, '‰', 12), p('seed', 'Seed', 1, 999, 1, '', 23)],
    css: (_v, fid) => `url(#${fid})`,
    svg: v => `<feTurbulence type="fractalNoise" baseFrequency="${num(v.frequency / 1000)}" numOctaves="3" seed="${Math.round(v.seed)}" result="turbulence"/><feDisplacementMap in="SourceGraphic" in2="turbulence" scale="${num(v.strength)}" xChannelSelector="R" yChannelSelector="G"/>`,
    canvas: () => '',
    rasterUnsupported: true,
  },
  noise: {
    id: 'noise', label: 'Noise', hint: 'Adds seeded random variation to the color field.',
    params: [p('amount', 'Amount', 0, 100, 1, '%', 14), p('scale', 'Scale', 1, 100, 1, '%', 35), p('seed', 'Seed', 1, 999, 1, '', 31)],
    css: (_v, fid) => `url(#${fid})`,
    svg: v => `<feTurbulence type="fractalNoise" baseFrequency="${num(v.scale / 1000)}" numOctaves="2" seed="${Math.round(v.seed)}" result="noise"/><feComponentTransfer in="noise" result="noiseAlpha"><feFuncA type="table" tableValues="0 ${num(v.amount / 100)}"/></feComponentTransfer><feBlend in="SourceGraphic" in2="noiseAlpha" mode="overlay"/>`,
    canvas: () => '',
    rasterUnsupported: true,
  },
  bloom: {
    id: 'bloom', label: 'Bloom', hint: 'Soft, luminous highlights mixed back over the mesh.',
    params: [p('radius', 'Radius', 0, 120, 1, 'px', 24), p('intensity', 'Intensity', 0, 200, 1, '%', 75)],
    css: v => `blur(${num(v.radius / 3)}px) brightness(${num(1 + v.intensity / 200)})`,
    svg: v => `<feGaussianBlur in="SourceGraphic" stdDeviation="${num(v.radius)}" result="bloomBlur"/><feComponentTransfer in="bloomBlur" result="bloomBright"><feFuncA type="linear" slope="${num(v.intensity / 100)}"/></feComponentTransfer><feBlend in="SourceGraphic" in2="bloomBright" mode="screen"/>`,
    canvas: v => `blur(${num(v.radius / 3)}px) brightness(${num(1 + v.intensity / 200)})`,
    spread: v => v.radius * 2.5,
  },
  vignette: {
    id: 'vignette', label: 'Vignette', hint: 'Darkens the edges while leaving the center clear.',
    params: [p('amount', 'Amount', 0, 100, 1, '%', 40), p('softness', 'Feather', 10, 100, 1, '%', 65)],
    css: (_v, fid) => `url(#${fid})`,
    svg: v => `<feImage href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'%3E%3Cdefs%3E%3CradialGradient id='v'%3E%3Cstop offset='${num(100 - v.softness)}%25' stop-color='white'/%3E%3Cstop offset='100%25' stop-color='rgb(${Math.round(255 * (1 - v.amount / 100))},${Math.round(255 * (1 - v.amount / 100))},${Math.round(255 * (1 - v.amount / 100))})'/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23v)'/%3E%3C/svg%3E" preserveAspectRatio="none" result="vignette"/><feBlend in="SourceGraphic" in2="vignette" mode="multiply"/>`,
    canvas: () => '',
    rasterUnsupported: true,
  },
  'color-bleed': {
    id: 'color-bleed', label: 'Color Bleeding', hint: 'Softly spreads neighboring colors across the mesh.',
    params: [p('radius', 'Spread', 0, 80, 1, 'px', 12), p('amount', 'Mix', 0, 100, 1, '%', 45)],
    css: v => `blur(${num(v.radius / 3)}px)`,
    svg: v => `<feGaussianBlur in="SourceGraphic" stdDeviation="${num(v.radius)}" result="bleed"/><feComponentTransfer in="bleed" result="bleedAlpha"><feFuncA type="table" tableValues="0 ${num(v.amount / 100)}"/></feComponentTransfer><feBlend in="SourceGraphic" in2="bleedAlpha" mode="normal"/>`,
    canvas: v => `blur(${num(v.radius / 3)}px)`,
    spread: v => v.radius * 2,
  },
  dithering: {
    id: 'dithering', label: 'Dithering', hint: 'Reduces visible color banding with controlled quantization.',
    params: [p('levels', 'Color levels', 2, 32, 1, '', 12), p('amount', 'Amount', 0, 100, 1, '%', 45)],
    css: (_v, fid) => `url(#${fid})`,
    svg: v => {
      const levels = Math.max(2, Math.round(v.levels));
      const table = Array.from({ length: levels }, (_, i) => num(i / (levels - 1))).join(' ');
      return `<feComponentTransfer result="quantized"><feFuncR type="discrete" tableValues="${table}"/><feFuncG type="discrete" tableValues="${table}"/><feFuncB type="discrete" tableValues="${table}"/></feComponentTransfer><feComponentTransfer in="quantized" result="ditherMix"><feFuncA type="table" tableValues="0 ${num(v.amount / 100)}"/></feComponentTransfer><feBlend in="SourceGraphic" in2="ditherMix" mode="normal"/>`;
    },
    canvas: () => '',
    rasterUnsupported: true,
  },
  iridescence: {
    id: 'iridescence', label: 'Iridescence', hint: 'Adds colorful, rainbow-like reflections.',
    params: [p('angle', 'Hue angle', 0, 360, 1, '°', 150), p('amount', 'Intensity', 0, 100, 1, '%', 42)],
    css: v => `hue-rotate(${num(v.angle)}deg) saturate(${num(1 + v.amount / 100)})`,
    svg: v => `<feColorMatrix type="hueRotate" values="${num(v.angle)}"/>`,
    canvas: v => `hue-rotate(${num(v.angle)}deg) saturate(${num(1 + v.amount / 100)})`,
  },
  'color-drift': {
    id: 'color-drift', label: 'Color Drift', hint: 'Shifts the mesh palette through neighboring hues.',
    params: [p('angle', 'Hue shift', 0, 360, 1, '°', 24), p('amount', 'Saturation', 0, 200, 1, '%', 100)],
    css: v => `hue-rotate(${num(v.angle)}deg) saturate(${num(v.amount / 100)})`,
    svg: v => `<feColorMatrix type="hueRotate" values="${num(v.angle)}"/>`,
    canvas: v => `hue-rotate(${num(v.angle)}deg) saturate(${num(v.amount / 100)})`,
  },
  displacement: {
    id: 'displacement', label: 'Displacement', hint: 'Shifts pixels using seeded turbulence as a displacement map.',
    params: [p('scale', 'Strength', 0, 180, 1, 'px', 35), p('frequency', 'Map scale', 1, 80, 1, '‰', 10), p('seed', 'Seed', 1, 999, 1, '', 41)],
    css: (_v, fid) => `url(#${fid})`,
    svg: v => `<feTurbulence type="fractalNoise" baseFrequency="${num(v.frequency / 1000)}" numOctaves="2" seed="${Math.round(v.seed)}" result="displacementMap"/><feDisplacementMap in="SourceGraphic" in2="displacementMap" scale="${num(v.scale)}" xChannelSelector="R" yChannelSelector="G"/>`,
    canvas: () => '',
    rasterUnsupported: true,
    spread: v => v.scale,
  },
  'chromatic-aberration': {
    id: 'chromatic-aberration', label: 'Chromatic Aberration', hint: 'Separates color channels for a lens-like fringe.',
    params: [p('offset', 'Separation', 0, 24, 0.5, 'px', 3), p('angle', 'Direction', 0, 360, 1, '°', 0)],
    css: (_v, fid) => `url(#${fid})`,
    svg: v => {
      const dx = num(Math.cos(v.angle * Math.PI / 180) * v.offset), dy = num(Math.sin(v.angle * Math.PI / 180) * v.offset);
      return `<feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red"/><feOffset in="red" dx="${dx}" dy="${dy}" result="redOffset"/><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green"/><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="blue"/><feOffset in="blue" dx="${num(-dx)}" dy="${num(-dy)}" result="blueOffset"/><feMerge><feMergeNode in="redOffset"/><feMergeNode in="green"/><feMergeNode in="blueOffset"/></feMerge>`;
    },
    canvas: () => '',
    rasterUnsupported: true,
    spread: v => v.offset,
  },
  'light-sweep': {
    id: 'light-sweep', label: 'Light Sweep', hint: 'Adds a directional, moving-style highlight.',
    params: [p('angle', 'Sweep angle', 0, 360, 1, '°', 35), p('intensity', 'Intensity', 0, 200, 1, '%', 75), p('width', 'Width', 1, 80, 1, '‰', 18)],
    css: (_v, fid) => `url(#${fid})`,
    svg: v => `<feTurbulence type="fractalNoise" baseFrequency="${num(v.width / 1000)} 0.001" numOctaves="1" seed="2" result="sweepNoise"/><feSpecularLighting in="sweepNoise" surfaceScale="2" specularConstant="${num(v.intensity / 100)}" specularExponent="18" lighting-color="white" result="sweepLight"><feDistantLight azimuth="${num(v.angle)}" elevation="55"/></feSpecularLighting><feComposite in="sweepLight" in2="SourceAlpha" operator="in" result="sweepMasked"/><feBlend in="SourceGraphic" in2="sweepMasked" mode="screen"/>`,
    canvas: () => '',
    rasterUnsupported: true,
  },
};
export const EFFECT_LIST = Object.values(EFFECTS);

export function newEffect(type: string, over: Record<string, number> = {}): EffectInstance {
  const def = EFFECTS[type];
  const params: Record<string, number> = {};
  def.params.forEach(q => { params[q.key] = over[q.key] ?? q.def; });
  return { id: uid('e'), type, enabled: true, params };
}

/** Enabled effects, with distortion first (it must read the untouched source in SVG filter chains). */
export const activeEffects = (effects: EffectInstance[]) => effects.filter(e => e.enabled && EFFECTS[e.type]).sort((a, b) => Number(b.type === 'distort') - Number(a.type === 'distort'));
export const blurOf = (effects: EffectInstance[]) => activeEffects(effects).reduce((s, e) => s + (EFFECTS[e.type].spread?.(e.params) ?? 0), 0);
