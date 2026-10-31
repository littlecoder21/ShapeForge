import { clamp, hexToRgb, mixColors, toRgba, type Space } from '../engine/color';
import { curveProgress } from '../engine/ramp';
import type { ShaderStop } from './types';

const FALLBACK_SPACE: Space = 'srgb';

function samplePalette(stops: ShaderStop[], t: number, space: Space) {
  if (t <= stops[0].position) return toRgba(stops[0].color, stops[0].alpha ?? 1);
  const last = stops[stops.length - 1];
  if (t >= last.position) return toRgba(last.color, last.alpha ?? 1);
  let index = 0;
  while (index < stops.length - 2 && stops[index + 1].position <= t) index++;
  const from = stops[index];
  const to = stops[index + 1];
  if (from.hard) return toRgba(from.color, from.alpha ?? 1);
  const progress = (t - from.position) / Math.max(1e-9, to.position - from.position);
  const eased = curveProgress({
    id: `${index}`,
    color: from.color,
    alpha: from.alpha ?? 1,
    pos: from.position * 100,
    hard: from.hard,
    mid: from.mid,
    curve: from.curve,
  }, progress);
  return mixColors(
    { ...hexToRgb(from.color), a: from.alpha ?? 1 },
    { ...hexToRgb(to.color), a: to.alpha ?? 1 },
    eased,
    space,
  );
}

export function bakePaletteLut(stops: ShaderStop[], space: Space = FALLBACK_SPACE, size = 512): Uint8Array {
  const valid = stops
    .filter(stop => /^#[0-9a-f]{6}$/i.test(stop.color) && Number.isFinite(stop.position))
    .map(stop => ({
      ...stop,
      position: clamp(stop.position, 0, 1),
      alpha: clamp(Number.isFinite(stop.alpha) ? stop.alpha! : 1, 0, 1),
      mid: stop.mid === undefined ? undefined : clamp(stop.mid, 0, 100),
    }))
    .sort((a, b) => a.position - b.position);
  const palette = valid.length ? valid : [
    { color: '#7c5cff', position: 0, alpha: 1 },
    { color: '#22d3ee', position: 1, alpha: 1 },
  ];
  const count = Math.max(1, Math.floor(size));
  const lut = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const color = samplePalette(palette, count === 1 ? 0 : i / (count - 1), space);
    const offset = i * 4;
    lut[offset] = Math.round(clamp(color.r, 0, 255));
    lut[offset + 1] = Math.round(clamp(color.g, 0, 255));
    lut[offset + 2] = Math.round(clamp(color.b, 0, 255));
    lut[offset + 3] = Math.round(clamp(color.a, 0, 1) * 255);
  }
  return lut;
}

export function encodePaletteLut(lut: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < lut.length; i++) binary += String.fromCharCode(lut[i]);
  return btoa(binary);
}
