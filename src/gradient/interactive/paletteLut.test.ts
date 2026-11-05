import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newLayer, newProject, stop } from '../engine/model';
import { gradientLayerToShader, interactionColorsForLayer, supportsDirectShaderGeometry } from './adapter';
import { interactiveExports, interactiveHtmlExport, interactiveJavaScriptExport, interactiveReactExport } from './export';
import { bakePaletteLut, encodePaletteLut } from './paletteLut';
import { DEFAULT_INTERACTIVE_SETTINGS, normalizeInteractiveSettings, normalizeShaderLayer } from './types';
import { POINTER_MODES, pointerModeId } from './pointerModes';
import { UNIFORM_NAMES } from './uniforms';
import { pointerSmoothingFactor } from './input/PointerManager';
import { RIG_PRESET_MAP } from './rig/presets';

const channel = (lut: Uint8Array, index: number, offset = 0) => lut[index * 4 + offset];

test('new shader settings default and clamp while old project settings remain valid', () => {
  const oldSettings = normalizeInteractiveSettings({ enabled: true, speed: 0.4 });
  assert.equal(oldSettings.enabled, true);
  assert.equal(oldSettings.shaderMix, 1);
  assert.equal(oldSettings.toneMapping, 0);
  assert.equal(oldSettings.vignette, 0);
  assert.equal(oldSettings.sheen, 0);
  assert.equal(oldSettings.filmGrain, 0);
  assert.equal(oldSettings.idleMotion, false);
  assert.equal(oldSettings.paletteWrap, 'mirror');
  assert.equal(oldSettings.renderBackend, DEFAULT_INTERACTIVE_SETTINGS.renderBackend);
  assert.equal(oldSettings.interactionColorSource, 'layer');
  assert.deepEqual(oldSettings.interactionColors, DEFAULT_INTERACTIVE_SETTINGS.interactionColors);
  assert.equal(oldSettings.interactionDistortion, 0.42);
  assert.equal(oldSettings.interactionDisplacement, 0.35);
  assert.equal(oldSettings.interactionDisplacementMode, 'push');
  assert.equal(oldSettings.interactionVelocityReaction, 0.65);
  assert.equal(oldSettings.interactionDelay, 85);
  assert.equal(oldSettings.interactionGlitch, 0);
  const clamped = normalizeInteractiveSettings({ toneMapping: 3, vignette: -1, sheen: 0.5, filmGrain: 4 });
  assert.equal(clamped.toneMapping, 1);
  assert.equal(clamped.vignette, 0);
  assert.equal(clamped.sheen, 0.5);
  assert.equal(clamped.filmGrain, 1);
  assert.equal(normalizeInteractiveSettings({ shaderMix: -1 }).shaderMix, 0);
  assert.equal(normalizeInteractiveSettings({ interactionDistortion: -1 }).interactionDistortion, 0);
  assert.equal(normalizeInteractiveSettings({ interactionDistortion: 2 }).interactionDistortion, 1);
  const reactive = normalizeInteractiveSettings({ interactionDisplacement: 3, interactionDisplacementMode: 'invalid', interactionVelocityReaction: -1 });
  assert.equal(reactive.interactionDisplacement, 1);
  assert.equal(reactive.interactionDisplacementMode, 'push');
  assert.equal(reactive.interactionVelocityReaction, 0);
  assert.equal(normalizeInteractiveSettings({ interactionVelocityReaction: 3 }).interactionVelocityReaction, 2);
  assert.equal(normalizeInteractiveSettings({ interactionDelay: -1 }).interactionDelay, 0);
  assert.equal(normalizeInteractiveSettings({ interactionDelay: 1200 }).interactionDelay, 600);
  assert.equal(normalizeInteractiveSettings({ interactionGlitch: -1 }).interactionGlitch, 0);
  assert.equal(normalizeInteractiveSettings({ interactionGlitch: 2 }).interactionGlitch, 1);
  assert.equal(pointerSmoothingFactor(0.1, 0), 1);
  assert.ok(pointerSmoothingFactor(0.1, 320) < pointerSmoothingFactor(0.1, 85));
  const legacyColor = normalizeInteractiveSettings({ interactionColor: '#123456' });
  assert.deepEqual(legacyColor.interactionColors, ['#123456']);
  const multicolor = normalizeInteractiveSettings({
    interactionColorSource: 'custom',
    interactionColors: ['#ff0000', 'invalid', '#00ff00', '#0000ff', '#ffffff', '#123456'],
    interactionColorMix: 2,
    interactionColorSpeed: -1,
    interactionFalloff: 'invalid',
  });
  assert.deepEqual(multicolor.interactionColors, ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#123456']);
  assert.equal(multicolor.interactionColorMix, 1);
  assert.equal(multicolor.interactionColorSpeed, 0);
  assert.equal(multicolor.interactionFalloff, 'soft');
});

test('shader layer color mixing settings normalize safely for old and imported projects', () => {
  assert.deepEqual(normalizeShaderLayer({ enabled: true, style: 'flow' }), {
    enabled: true,
    style: 'flow',
    interact: true,
    reaction: 1,
    mixLayerId: '',
    mixMode: 'mix',
    mixStrength: 0.5,
    mixSpeed: 0.35,
  });
  const clamped = normalizeShaderLayer({ mixLayerId: 'source', mixMode: 'invalid', mixStrength: 2, mixSpeed: -1 });
  assert.equal(clamped.mixLayerId, 'source');
  assert.equal(clamped.mixMode, 'mix');
  assert.equal(clamped.mixStrength, 1);
  assert.equal(clamped.mixSpeed, 0);
  const independent = normalizeShaderLayer({
    style: 'smoke',
    controls: { speed: 3, intensity: -1, distortion: 0.6, distortionScale: 12, turbulence: 0.4 },
  });
  assert.equal(independent.style, 'smoke');
  // controls saved before the advanced-motion update fill the new keys with neutral values
  assert.deepEqual(independent.controls, {
    speed: 2,
    intensity: 0,
    distortion: 0.6,
    distortionScale: 8,
    turbulence: 0.4,
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
  });
  assert.equal(normalizeShaderLayer({ style: 'fire' }).style, 'fire');
  assert.equal(normalizeShaderLayer({ style: 'marble' }).style, 'marble');
});

test('the legacy pointer catalog keeps its ids and every one of them maps to an interaction preset', () => {
  assert.equal(POINTER_MODES.length, 75);
  assert.deepEqual(POINTER_MODES.slice(0, 13).map(mode => mode.id), [
    'attract', 'repel', 'swirl', 'glow', 'drag', 'wave', 'orbit', 'magnet', 'ripple', 'pulse', 'trail', 'spotlight', 'hue',
  ]);
  assert.equal(pointerModeId('attract'), 0);
  assert.equal(pointerModeId('hue'), 12);
  assert.equal(pointerModeId('echo-trail'), 62);
  assert.equal(pointerModeId('liquid-silk'), 63);
  assert.equal(pointerModeId('displacement-texture'), 72);
  assert.equal(pointerModeId('tesla-coil'), 73);
  assert.equal(pointerModeId('lightning-bolt'), 74);
  for (const mode of POINTER_MODES) assert.ok(RIG_PRESET_MAP[mode.id], `no preset for ${mode.id}`);
  const materials = POINTER_MODES.filter(mode => mode.group === '3D materials');
  assert.equal(materials.length, 10);
  assert.deepEqual(materials.map(mode => pointerModeId(mode.id)), Array.from({ length: 10 }, (_, index) => 63 + index));
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

test('multi-layer shader exports keep each gradient palette and mesh colors with its own layer', () => {
  const gradient = newLayer('linear', {
    shader: { enabled: true, style: 'flow' },
    stops: [stop('#ff0000', 0), stop('#0000ff', 100)],
  });
  const meshPoints = [
    { id: 'mesh-a', x: 20, y: 25, color: '#00ff00', alpha: 0.9, size: 40 },
    { id: 'mesh-b', x: 80, y: 70, color: '#ff00ff', alpha: 0.7, size: 30 },
  ];
  const mesh = newLayer('mesh', {
    shader: { enabled: true, style: 'metaballs' },
    mesh: { points: meshPoints, base: '#112233', core: 40, seed: 7 },
  });
  const project = newProject({ layers: [gradient, mesh], shader: { ...newProject().shader, enabled: true } });
  const gradientAdapter = gradientLayerToShader(gradient, project);
  const meshAdapter = gradientLayerToShader(mesh, project);

  assert.deepEqual(gradientAdapter.palette.map(item => item.color), ['#ff0000', '#0000ff']);
  assert.deepEqual(meshAdapter.palette.map(item => item.color), ['#00ff00', '#ff00ff']);
  assert.deepEqual(interactionColorsForLayer(gradientAdapter.palette), ['#ff0000', '#0000ff']);
  assert.deepEqual(interactionColorsForLayer(meshAdapter.palette), ['#00ff00', '#ff00ff']);
  assert.deepEqual(meshAdapter.meshPoints, meshPoints.map(({ color, x, y, size, alpha }) => ({ color, x, y, size, alpha })));
  const fragmentShader = readFileSync(new URL('./shaders/gradient.frag.glsl', import.meta.url), 'utf8');
  assert.match(fragmentShader, /color\.rgb = mix\(color\.rgb, meshColor\.rgb, 0\.82\)/);

  const canvases = [...interactiveHtmlExport(project).matchAll(/<canvas data-shader-canvas ([^>]+)>/g)];
  assert.equal(canvases.length, 2);
  assert.match(canvases[0][1], /#00ff00/);
  assert.match(canvases[0][1], /#ff00ff/);
  assert.match(canvases[1][1], /#ff0000/);
  assert.match(canvases[1][1], /#0000ff/);
  assert.match(canvases[0][1], /interactionColors/);
  assert.match(canvases[1][1], /interactionColors/);
});

test('shader geometry matches CSS conic direction and radial circle dimensions', () => {
  const circle = newLayer('radial', { shape: 'circle', cx: 25, cy: 40, rx: 25, ry: 90 });
  const project = newProject({ canvas: { w: 800, h: 400 }, layers: [circle] });
  const adapted = gradientLayerToShader(circle, project);
  assert.equal(adapted.geometry.originX, 25);
  assert.equal(adapted.geometry.originY, 40);
  assert.equal(adapted.geometry.radiusX, 12.5);
  assert.equal(adapted.geometry.radiusY, 25);
  assert.equal(supportsDirectShaderGeometry(circle), true);

  const conic = newLayer('conic');
  assert.equal(supportsDirectShaderGeometry(conic), true);
  assert.equal(supportsDirectShaderGeometry(newLayer('linear', { repeating: true })), false);
  assert.equal(supportsDirectShaderGeometry(newLayer('curve')), false);
  assert.equal(supportsDirectShaderGeometry(newLayer('noise')), false);
});

test('HTML export embeds the same LUT, the shared uniform list and the shared interaction runtime', () => {
  const layer = newLayer('linear', { space: 'oklab', shader: { enabled: true, style: 'silk' } });
  const project = newProject({ layers: [layer] });
  const html = interactiveHtmlExport(project);
  const embedded = html.match(/data-shader-lut="([^"]+)"/)?.[1];
  assert.ok(embedded);
  const expected = encodePaletteLut(bakePaletteLut(gradientLayerToShader(layer, project).palette, layer.space));
  assert.equal(embedded, expected);
  assert.ok(html.includes(JSON.stringify(UNIFORM_NAMES)));
  assert.ok(html.includes('locations.uShaderMix'));
  assert.ok(html.includes("locations['uInteractionColors[0]']"));
  assert.ok(html.includes('locations.uInteractionDistortion'));
  assert.ok(html.includes('uInteractionColorCount'));
  assert.ok(html.includes('locations.uMeshDrift'));
  assert.ok(html.includes('locations.uMeshSpread'));
  assert.ok(html.includes('locations.uMeshBlend'));
  assert.ok(html.includes('.layer-1'));
  assert.ok(html.includes('createPointerEngine'), 'exported pages run the same pointer engine as the editor');
  assert.ok(html.includes('vec2 rigWarp'), 'the generated interaction shader is embedded');
  assert.ok(interactiveReactExport(project).includes('shaderMix?: number;'));
  assert.ok(interactiveReactExport(project).includes("'echo-trail'"));
  const assets = interactiveExports(project);
  assert.ok(assets.html.includes(`<style>${assets.stylesheet}</style>`));
  assert.ok(assets.html.includes(`<script>${assets.runtime}</script>`));
  assert.ok(assets.markup.includes('data-shader-canvas'));
  assert.ok(!assets.markup.includes('<style>'));
  assert.ok(!assets.markup.includes('<script>'));
  assert.ok(assets.stylesheet.includes('.layer-1'));
  assert.ok(assets.runtime.includes("querySelectorAll('[data-shader-canvas]')"));
  assert.doesNotThrow(() => new Function(assets.runtime));
  const javascript = interactiveJavaScriptExport(project);
  assert.ok(javascript.includes('mountShapeForgeGradient'));
  assert.ok(javascript.includes('SHAPEFORGE_GRADIENT_STYLES'));
  assert.ok(javascript.includes('document.currentScript.parentElement'));
  assert.ok(javascript.includes('linear-gradient'));
  assert.doesNotThrow(() => new Function(javascript));
});

test('fragment shader template preserves the ES 1.00 source contract', () => {
  const source = readFileSync(new URL('./shaders/gradient.frag.glsl', import.meta.url), 'utf8');
  assert.match(source, /varying vec2 vUv;/);
  assert.match(source, /gl_FragColor/);
  assert.match(source, /precision highp float;/);
  assert.doesNotMatch(source, /#version|fwidth|%/);
});

test('shader exports preserve cross-layer color mixing and rendered-pixel blend', () => {
  const source = newLayer('radial', { name: 'Source colors', stops: [stop('#ff0000', 0), stop('#00ff00', 100)] });
  const target = newLayer('linear', {
    name: 'Animated target',
    blend: 'screen',
    shader: { enabled: true, style: 'flow', mixLayerId: source.id, mixMode: 'overlay', mixStrength: 0.8, mixSpeed: 0.6 },
  });
  const project = newProject({ layers: [source, target] });
  const html = interactiveHtmlExport(project);
  assert.match(html, /data-shader-mix-settings=/);
  assert.match(html, /data-shader-mix-lut="[A-Za-z0-9+/=]+"/);
  assert.match(html, /uLayerMixMode/);
  assert.match(html, /blendLayerColors/);
  assert.match(html, /mix-blend-mode: screen/);
  const react = interactiveReactExport(project);
  assert.doesNotMatch(react, /__SHADER_MIX_(?:CONFIG|LUT)_\d+__/);
});

test('shader exports preserve per-layer styles, style parameters, reaction and motion overrides', () => {
  const layer = newLayer('linear', {
    shader: {
      enabled: true,
      style: 'smoke',
      controls: { speed: 0.8, intensity: 0.7, distortion: 0.4, distortionScale: 2.2, turbulence: 0.6 },
    },
  });
  const crystal = newLayer('linear', { shader: { enabled: true, style: 'crystal', styleParams: [9, 0.3, 0.7, 0.2], reaction: -0.5 } });
  const project = newProject({ layers: [layer, crystal] });
  const html = interactiveHtmlExport(project);
  assert.match(html, /&quot;style&quot;:&quot;smoke&quot;/);
  assert.match(html, /&quot;speed&quot;:0\.8/);
  assert.match(html, /&quot;turbulence&quot;:0\.6/);
  assert.match(html, /"smoke":10,"fire":11/);
  assert.match(html, /data-shader-layer="[^"]*&quot;styleParams&quot;:\[9,0\.3,0\.7,0\.2\][^"]*&quot;reaction&quot;:-0\.5/);
  const react = interactiveReactExport(project);
  assert.match(react, /style: 'flow'.*'smoke' \| 'fire'/);
  assert.match(react, /"style":"smoke"/);
  assert.match(react, /DEFAULT_LAYER_STATES/);
});
