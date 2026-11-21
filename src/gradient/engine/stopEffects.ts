import { EFFECTS, type ParamDef } from './effects';
import { uid, type EffectInstance } from './model';

/* ═══════════ Stop effects ═══════════
 * The layer effect library (distortion, grain, vignette …) works on pixels, so it cannot act on a single colour stop — adding
 * one to a stop used to do nothing. A stop supports exactly the effects below, and all of them change the ramp:
 *
 *   Smooth  Blur · Colour bleed · Glow     soften the blend between neighbouring stops (see `smoothedRamp` in ramp.ts)
 *   Colour  Brightness · Contrast · …      change the stop's own colour (see `stopRgba` in ramp.ts)
 *
 * Effect ids are the same ids the layer effects use, so saved projects keep loading; for Smooth effects `radius` is a share of
 * the gradient length (%), not pixels.
 */
export interface StopEffectDef {
  id: string; label: string; hint: string; group: 'smooth' | 'colour';
  params: ParamDef[];
}

const param = (key: string, label: string, min: number, max: number, step: number, unit: string, def: number): ParamDef => ({ key, label, min, max, step, unit, def });
const tone = (id: string): StopEffectDef => ({ id, label: EFFECTS[id].label, hint: EFFECTS[id].hint, group: 'colour', params: EFFECTS[id].params });

export const STOP_EFFECTS: Record<string, StopEffectDef> = {
  blur: {
    id: 'blur', label: 'Blur', group: 'smooth',
    hint: 'Softens the blend around this stop, like a gaussian blur on the colour ramp. Radius is how far the softening reaches; the rest of the gradient stays crisp.',
    params: [param('radius', 'Radius', 0, 60, 0.5, '%', 12)],
  },
  'color-bleed': {
    id: 'color-bleed', label: 'Colour bleed', group: 'smooth',
    hint: 'Spreads this stop’s colour into its neighbours, so multiple stops merge instead of banding.',
    params: [param('radius', 'Reach', 0, 60, 0.5, '%', 14), param('amount', 'Mix', 0, 100, 1, '%', 45)],
  },
  bloom: {
    id: 'bloom', label: 'Glow', group: 'smooth',
    hint: 'A soft, luminous halo: smooths the blend and lightens the colours around this stop.',
    params: [param('radius', 'Radius', 0, 60, 0.5, '%', 14), param('intensity', 'Intensity', 0, 100, 1, '%', 50)],
  },
  brightness: tone('brightness'),
  contrast: tone('contrast'),
  saturate: tone('saturate'),
  hue: tone('hue'),
  grayscale: tone('grayscale'),
  'color-drift': tone('color-drift'),
};
export const STOP_EFFECT_LIST = Object.values(STOP_EFFECTS);
export const isStopEffect = (type: string) => type in STOP_EFFECTS;
export const isSmoothingEffect = (type: string) => STOP_EFFECTS[type]?.group === 'smooth';

export function newStopEffect(type: string): EffectInstance {
  const params: Record<string, number> = {};
  STOP_EFFECTS[type].params.forEach(q => { params[q.key] = q.def; });
  return { id: uid('e'), type, enabled: true, params };
}

/** How far a stop's smoothing reaches along the bar, as a % of the gradient (used for the reach band under the bar). */
export function reachOf(effects: EffectInstance[] | undefined): number {
  return (effects ?? []).reduce((reach, effect) => (effect.enabled && isSmoothingEffect(effect.type) ? Math.max(reach, (effect.params.radius ?? 0) * 1.4) : reach), 0);
}
