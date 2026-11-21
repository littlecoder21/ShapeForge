import { describe, expect, it } from 'vitest';
import { stop, type ColorStop, type GradientLayer } from './model';
import { rampStops, smoothedRamp, stopRgba } from './ramp';
import { newStopEffect, reachOf } from './stopEffects';

const layerOf = (stops: ColorStop[], space = 'srgb') => ({ space, stops } as unknown as GradientLayer);
const withFx = (s: ColorStop, type: string, params: Record<string, number> = {}, enabled = true): ColorStop => {
  const effect = newStopEffect(type);
  return { ...s, effects: [...(s.effects ?? []), { ...effect, enabled, params: { ...effect.params, ...params } }] };
};
const nearest = (ramp: NonNullable<ReturnType<typeof smoothedRamp>>, pos: number) => ramp.reduce((best, s) => (Math.abs(s.pos - pos) < Math.abs(best.pos - pos) ? s : best));

describe('stop colour effects', () => {
  it('keeps a valid colour when hue follows brightness', () => {
    // brightness leaves fractional channels; the hue step used to turn them into a malformed hex string (dark blue)
    const tinted = stopRgba(withFx(withFx(stop('#ff7a1a', 0, 1), 'brightness', { amount: 113 }), 'hue', { angle: 40 }));
    expect(tinted.b).toBeLessThan(80);
    expect(tinted.r + tinted.g).toBeGreaterThan(300);
  });
});

describe('stop smoothing', () => {
  const plain = () => [stop('#0b0b3b', 0, 1), stop('#ff2fb3', 30, 1), stop('#2ff3d6', 55, 1), stop('#ffffff', 100, 1)];

  it('leaves the ramp untouched when no stop smooths', () => {
    expect(smoothedRamp(layerOf(plain()))).toBeNull();
  });

  it('ignores disabled and zero-radius effects, and effects that cannot act on a stop', () => {
    const stops = plain();
    stops[1] = withFx(stops[1], 'blur', { radius: 12 }, false);
    stops[2] = withFx(stops[2], 'blur', { radius: 0 });
    stops[3] = { ...stops[3], effects: [{ id: 'legacy', type: 'grain', enabled: true, params: { amount: 20 } }] };
    expect(smoothedRamp(layerOf(stops))).toBeNull();
  });

  it('bakes an ordered ramp that keeps the end colours', () => {
    const stops = plain();
    stops[2] = withFx(stops[2], 'blur', { radius: 14 });
    const ramp = smoothedRamp(layerOf(stops))!;
    expect(ramp.length).toBeGreaterThan(20);
    expect(ramp.every((s, i) => i === 0 || s.pos >= ramp[i - 1].pos)).toBe(true);
    expect(ramp[0].pos).toBe(0);
    expect(ramp[ramp.length - 1].pos).toBe(100);
    expect(ramp[0].color.b).toBeCloseTo(0x3b, 0);                       // far from the blurred stop: unchanged
    expect(ramp[ramp.length - 1].color.r).toBeCloseTo(255, 0);
  });

  it('turns a hard edge into a soft blend', () => {
    const hard = { ...stop('#ff0000', 0, 1), hard: true };
    const stops = [hard, stop('#0000ff', 50, 1), stop('#0000ff', 100, 1)];
    const sharp = smoothedRamp(layerOf([hard, withFx(stops[1], 'blur', { radius: 0 }), stops[2]]));
    expect(sharp).toBeNull();
    const soft = smoothedRamp(layerOf([hard, withFx(stops[1], 'blur', { radius: 10 }), stops[2]]))!;
    const mid = nearest(soft, 50).color;
    expect(mid.r).toBeGreaterThan(40);
    expect(mid.r).toBeLessThan(215);
    expect(mid.b).toBeGreaterThan(40);
  });

  it('colour bleed pulls the neighbouring colours toward the stop', () => {
    const stops = plain();
    stops[2] = withFx(stops[2], 'color-bleed', { radius: 20, amount: 100 });
    const ramp = smoothedRamp(layerOf(stops))!;
    const beside = nearest(ramp, 48).color, reference = stopRgba(stops[2]);
    expect(Math.abs(beside.g - reference.g)).toBeLessThan(25);
  });

  it('glow lightens the colours around the stop', () => {
    const stops = plain();
    const before = smoothedRamp(layerOf([stops[0], withFx(stops[1], 'blur', { radius: 1 }), stops[2], stops[3]]))!;
    const lit = smoothedRamp(layerOf([stops[0], withFx(stops[1], 'bloom', { radius: 15, intensity: 100 }), stops[2], stops[3]]))!;
    const at = (r: typeof before) => nearest(r, 30).color;
    expect(at(lit).r + at(lit).g + at(lit).b).toBeGreaterThan(at(before).r + at(before).g + at(before).b);
  });

  it('feeds SVG / canvas with the same ramp (offsets 0…1, never decreasing)', () => {
    const stops = plain();
    stops[1] = withFx(stops[1], 'blur', { radius: 10 });
    const out = rampStops(layerOf(stops));
    expect(out[0].offset).toBe(0);
    expect(out[out.length - 1].offset).toBe(1);
    expect(out.every((s, i) => i === 0 || s.offset >= out[i - 1].offset)).toBe(true);
  });

  it('reports how far a stop’s smoothing reaches', () => {
    expect(reachOf(undefined)).toBe(0);
    expect(reachOf(withFx(stop('#fff', 10, 1), 'blur', { radius: 10 }).effects)).toBeCloseTo(14, 5);
    expect(reachOf(withFx(stop('#fff', 10, 1), 'brightness').effects)).toBe(0);
  });
});
