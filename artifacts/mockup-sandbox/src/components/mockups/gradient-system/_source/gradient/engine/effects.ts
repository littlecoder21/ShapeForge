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
    spread: v => v.scale,
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
