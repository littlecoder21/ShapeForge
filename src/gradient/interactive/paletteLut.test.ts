import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newLayer, newProject, stop } from '../engine/model';
import { gradientLayerToShader } from './adapter';
import { interactiveHtmlExport } from './export';
import { bakePaletteLut, encodePaletteLut } from './paletteLut';
import { DEFAULT_INTERACTIVE_SETTINGS, normalizeInteractiveSettings } from './types';
import { UNIFORM_NAMES } from './uniforms';

const channel = (lut: Uint8Array, index: number, offset = 0) => lut[index * 4 + offset];

test('new shader settings default and clamp while old project settings remain valid', () => {
  const oldSettings = normalizeInteractiveSettings({ enabled: true, speed: 0.4 });
  assert.equal(oldSettings.enabled, true);
  assert.equal(oldSettings.toneMapping, 0);
  assert.equal(oldSettings.vignette, 0);
  assert.equal(oldSettings.sheen, 0);
  assert.equal(oldSettings.filmGrain, 0);
  assert.equal(oldSettings.idleMotion, false);
  assert.equal(oldSettings.paletteWrap, 'mirror');
  assert.equal(oldSettings.renderBackend, DEFAULT_INTERACTIVE_SETTINGS.renderBackend);
  const clamped = normalizeInteractiveSettings({ toneMapping: 3, vignette: -1, sheen: 0.5, filmGrain: 4 });
  assert.equal(clamped.toneMapping, 1);
  assert.equal(clamped.vignette, 0);
  assert.equal(clamped.sheen, 0.5);
  assert.equal(clamped.filmGrain, 1);
});

test('palette LUT honours hard stops, midpoint hints, curves, spaces, and arbitrary stop counts', () => {
  const hard = bakePaletteLut([
    { color: '#ff0000', position: 0, hard: true },
    { color: '#0000ff', position: 0.5 },
    { color: '#ffffff', position: 1 },
  ], 'srgb', 5);
  assert.equal(channel(hard, 1), 255);
  assert.equal(channel(hard, 2), 0);
  assert.equal(channel(hard, 2, 2), 255);

  const endpoints = [{ color: '#000000', position: 0 }, { color: '#ffffff', position: 1 }];
  const linear = bakePaletteLut(endpoints, 'srgb', 5);
  const hinted = bakePaletteLut([{ ...endpoints[0], mid: 75 }, endpoints[1]], 'srgb', 5);
  const curved = bakePaletteLut([{ ...endpoints[0], curve: { x1: 0.42, y1: 0, x2: 1, y2: 1 } }, endpoints[1]], 'srgb', 5);
  assert.ok(channel(hinted, 2) < channel(linear, 2));
  assert.ok(channel(curved, 2) < channel(linear, 2));

  const colors = [{ color: '#f00020', position: 0 }, { color: '#1030f0', position: 1 }];
  assert.notDeepEqual(bakePaletteLut(colors, 'srgb', 33), bakePaletteLut(colors, 'oklab', 33));
  const manyStops = Array.from({ length: 10 }, (_, index) => ({
    color: `#${index.toString(16).padStart(2, '0')}0000`,
    position: index / 9,
  }));
  const large = bakePaletteLut(manyStops, 'srgb', 101);
  assert.equal(large.length, 101 * 4);
  assert.ok(channel(large, 99) > channel(large, 10));
});

test('project adapter preserves every stop and interpolation setting', () => {
  const layer = newLayer('linear', {
    space: 'oklch',
    stops: Array.from({ length: 10 }, (_, index) => stop('#123456', index * 100 / 9, 1, {
      hard: index === 2,
      mid: index === 3 ? 70 : undefined,
      curve: index === 4 ? { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 } : undefined,
    })),
  });
  const adapted = gradientLayerToShader(layer, newProject({ layers: [layer] }));
  assert.equal(adapted.palette.length, 10);
  assert.equal(adapted.geometry.space, 'oklch');
  assert.equal(adapted.palette[2].hard, true);
  assert.equal(adapted.palette[3].mid, 70);
  assert.deepEqual(adapted.palette[4].curve, { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 });
});

test('HTML export embeds the same LUT and shared uniform list used by the app', () => {
  const layer = newLayer('linear', { space: 'oklab', shader: { enabled: true, style: 'silk' } });
  const project = newProject({ layers: [layer] });
  const html = interactiveHtmlExport(project);
  const embedded = html.match(/data-shader-lut="([^"]+)"/)?.[1];
  assert.ok(embedded);
  const expected = encodePaletteLut(bakePaletteLut(gradientLayerToShader(layer, project).palette, layer.space));
  assert.equal(embedded, expected);
  assert.ok(html.includes(JSON.stringify(UNIFORM_NAMES)));
});

test('fragment shader preserves the ES 1.00 source contract', () => {
  const source = readFileSync(new URL('./shaders/gradient.frag.glsl', import.meta.url), 'utf8');
  assert.match(source, /varying vec2 vUv;/);
  assert.match(source, /gl_FragColor/);
  assert.match(source, /precision highp float;/);
  assert.doesNotMatch(source, /#version|fwidth|%/);
});
