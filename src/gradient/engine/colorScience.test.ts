import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeColor, encodeColor, hexToUnit, mixRgb, unitToHex, luminance, FIELD_SPACES, type Vec3 } from './colorScience';
import { EASINGS, biasMid, buildRampLut, cubicBezier, ease, shapeTransition } from './transitions';

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('every interpolation space round-trips colours', () => {
  for (const space of FIELD_SPACES) {
    for (const hex of ['#000000', '#ffffff', '#ff4d9d', '#22d3ee', '#7c5cff', '#808080']) {
      assert.equal(unitToHex(decodeColor(encodeColor(hexToUnit(hex), space), space)), hex, `${space} ${hex}`);
    }
  }
});

test('OKLab mixing is perceptually even: midpoint lightness is the mean of the endpoints', () => {
  const lightnessOf = (c: Vec3) => encodeColor(c, 'oklab')[0];
  for (const [a, b] of [['#2563eb', '#f97316'], ['#ff0000', '#00ff00'], ['#111827', '#fef3c7']]) {
    const ca = hexToUnit(a), cb = hexToUnit(b);
    near(lightnessOf(mixRgb(ca, cb, 0.5, 'oklab')), (lightnessOf(ca) + lightnessOf(cb)) / 2, 0.01);
  }
  const red = hexToUnit('#ff0000'), green = hexToUnit('#00ff00');
  const srgbError = Math.abs(lightnessOf(mixRgb(red, green, 0.5, 'srgb')) - (lightnessOf(red) + lightnessOf(green)) / 2);
  assert.ok(srgbError > 0.03, 'sRGB mixing drifts away from the perceptual midpoint, which is what OKLab fixes');
  near(luminance(mixRgb(red, green, 0, 'oklab')), luminance(red), 1e-3);
});

test('OKLCH takes the short way round the hue circle', () => {
  const red = hexToUnit('#ff0040'), violet = hexToUnit('#8000ff');
  const mid = mixRgb(red, violet, 0.5, 'oklch');
  assert.ok(mid[0] > 0.3 && mid[2] > 0.3 && mid[1] < 0.35, `expected a magenta between red and violet, got ${mid}`);
});

test('out-of-gamut OKLab colours are chroma-reduced, never produce NaN or out-of-range values', () => {
  for (const L of [0, 0.4, 0.8, 1]) for (const a of [-0.4, 0, 0.4]) for (const b of [-0.4, 0, 0.4]) {
    const rgb = decodeColor([L, a, b], 'oklab');
    rgb.forEach(v => assert.ok(Number.isFinite(v) && v >= 0 && v <= 1));
  }
});

test('easings start at 0, end at 1 and never leave the 0…1 range', () => {
  for (const name of EASINGS) {
    near(ease(name, 0), 0); near(ease(name, 1), 1);
    for (let i = 0; i <= 20; i++) { const v = ease(name, i / 20); assert.ok(v >= -1e-9 && v <= 1 + 1e-9, name); }
  }
});

test('transition curves change the sampled output (they are not decorative)', () => {
  const stops = (shape?: Parameters<typeof shapeTransition>[1]) => [{ pos: 0, color: '#000000', shape }, { pos: 1, color: '#ffffff' }];
  const at = (shape?: Parameters<typeof shapeTransition>[1]) => { const o = new Float32Array(4); buildRampLut(stops(shape), 'srgb', 256).sample(0.25, o); return o[0]; };
  const linear = at(), easeIn = at({ easing: 'ease-in' }), easeOut = at({ easing: 'ease-out' }), mid = at({ mid: 0.25 });
  assert.ok(easeIn < linear && linear < easeOut);
  near(linear, 0.25, 0.01);
  near(mid, 0.5, 0.02);
});

test('midpoint bias puts the 50 % mix exactly at the requested position', () => {
  for (const m of [0.15, 0.3, 0.7, 0.9]) near(biasMid(m, m), 0.5, 1e-6);
});

test('a custom cubic-bezier matches CSS ease-in-out at its control points and is monotonic', () => {
  const f = cubicBezier(0.42, 0, 0.58, 1);
  near(f(0), 0); near(f(1), 1); near(f(0.5), 0.5, 0.01);
  let previous = -1;
  for (let i = 0; i <= 40; i++) { const v = f(i / 40); assert.ok(v >= previous - 1e-9); previous = v; }
});

test('alpha-aware ramps do not darken colours that fade to transparent', () => {
  const lut = buildRampLut([{ pos: 0, color: '#ff0000', alpha: 1 }, { pos: 1, color: '#0000ff', alpha: 0 }], 'srgb', 128);
  const o = new Float32Array(4); lut.sample(0.9, o);
  assert.ok(o[0] > 0.85 && o[2] < 0.2, 'colour should stay red while the alpha fades');
  near(o[3], 0.1, 0.02);
});

test('hard stops hold their colour until the next stop', () => {
  const lut = buildRampLut([{ pos: 0, color: '#ff0000', hard: true }, { pos: 0.5, color: '#00ff00' }, { pos: 1, color: '#0000ff' }], 'srgb', 256);
  const o = new Float32Array(4); lut.sample(0.4, o);
  near(o[0], 1, 0.01); near(o[1], 0, 0.01);
});
