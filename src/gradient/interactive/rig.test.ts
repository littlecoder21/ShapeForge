import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleFragmentShader, generateRigGlsl, RIG_FUNCTIONS_MARKER } from './rig/glsl';
import {
  RIG_EFFECTS, RIG_EFFECT_MAP, RIG_FALLOFFS, RIG_MAX_RULES, RIG_SHAPES, RIG_SOURCES, RIG_COLOR_MODES, RIG_BLENDS,
  activeRules, makeDrive, makeRig, makeRule, normalizeRig, rigSignature,
} from './rig/model';
import { RIG_PRESETS, RIG_PRESET_MAP, rigFromLegacyMode } from './rig/presets';
import { createPointerEngine, createRigBuffers, evaluateRig, packTrail, RIG_TRAIL_POINTS } from './rigRuntime';
import { resolveStyleParams, SHADER_STYLE_INDEX, SHADER_STYLE_LIST, SHADER_STYLE_IDS } from './styles';
import { POINTER_MODES } from './pointerModes';
import { normalizeInteractiveSettings, normalizeShaderLayer } from './types';

const template = readFileSync(new URL('./shaders/gradient.frag.glsl', import.meta.url), 'utf8');

/** Cheap static checks that catch the usual GLSL ES 1.00 mistakes without a GPU. */
function lintGlsl(source: string) {
  assert.doesNotMatch(source, /#version|fwidth/);
  assert.ok(!source.replace(/\/\*[\s\S]*?\*\//g, '').includes('%'), 'the modulo operator does not exist in GLSL ES 1.00');
  let depth = 0;
  for (const char of source) { if (char === '{') depth++; if (char === '}') depth--; assert.ok(depth >= 0, 'unbalanced braces'); }
  assert.equal(depth, 0, 'unbalanced braces');
  let parens = 0;
  for (const char of source) { if (char === '(') parens++; if (char === ')') parens--; assert.ok(parens >= 0, 'unbalanced parentheses'); }
  assert.equal(parens, 0, 'unbalanced parentheses');
  assert.doesNotMatch(source, /\bRG_(FALL|BLEND)\(/, 'unreplaced macro');
  assert.doesNotMatch(source, /\/\*@RIG_/, 'unreplaced marker');
  for (const match of source.replace(/uniform [^;]*;/g, '').matchAll(/uRule[BCDE]\[(\d+)\]/g)) assert.ok(Number(match[1]) < RIG_MAX_RULES);
}

test('the style registry is the single source of truth: 27 styles, contiguous GLSL indices', () => {
  assert.equal(SHADER_STYLE_LIST.length, 27);
  assert.equal(SHADER_STYLE_LIST.filter(style => style.isNew).length, 15);
  assert.deepEqual(SHADER_STYLE_IDS.map(id => SHADER_STYLE_INDEX[id]), Array.from({ length: 27 }, (_, index) => index));
  assert.equal(SHADER_STYLE_INDEX.smoke, 10);
  assert.equal(SHADER_STYLE_INDEX.fire, 11);
  for (const style of SHADER_STYLE_LIST) {
    assert.ok(style.params.length <= 4, `${style.id} has more than four parameters`);
    if (style.isNew) assert.equal(style.params.length, 4, `${style.id} should expose four controls`);
    // every index has a branch in the shader (the last style is the final else)
    if (style.index < 26) assert.ok(template.includes(`uStyle < ${style.index}.5`), `no branch for style ${style.id}`);
  }
});

test('style parameters clamp into range and fall back to the style defaults', () => {
  assert.deepEqual(resolveStyleParams('marble'), [4, 0.6, 1, 0.5]);
  assert.deepEqual(resolveStyleParams('marble', [99, -5, NaN, 0.25]), [10, 0, 1, 0.25]);
  assert.deepEqual(resolveStyleParams('flow', [1, 2, 3, 4]), [0, 0, 0, 0]);
  const layer = normalizeShaderLayer({ style: 'crystal', styleParams: [50, -1, 0.5, 2] });
  assert.deepEqual(layer.styleParams, [20, 0, 0.5, 1]);
  assert.equal(normalizeShaderLayer({ style: 'crystal' }).styleParams, undefined);
  assert.equal(normalizeShaderLayer({ style: 'galaxy' }).interact, true);
  assert.equal(normalizeShaderLayer({ reaction: 9 }).reaction, 2);
  assert.equal(normalizeShaderLayer({ reaction: -9 }).reaction, -1.5);
  assert.equal(normalizeShaderLayer({ style: 'not-a-style' }).style, 'flow');
});

test('every legacy pointer style id exists as a preset, so old projects keep their look', () => {
  assert.equal(POINTER_MODES.length, 75);
  for (const mode of POINTER_MODES) {
    assert.ok(RIG_PRESET_MAP[mode.id], `missing preset for legacy style ${mode.id}`);
    assert.equal(rigFromLegacyMode(mode.id).presetId, mode.id);
  }
  const migrated = normalizeInteractiveSettings({ enabled: true, pointerMode: 'whirlpool' });
  assert.equal(migrated.rig.presetId, 'whirlpool');
  assert.ok(migrated.rig.rules.length > 0);
  const stored = normalizeInteractiveSettings({ pointerMode: 'whirlpool', rig: makeRig('mine', [makeRule('glow')]) });
  assert.equal(stored.rig.name, 'mine', 'a stored rig wins over the legacy id');
  assert.ok(normalizeInteractiveSettings({}).rig.rules.length > 0, 'new projects start with a working interaction');
  assert.equal(normalizeInteractiveSettings({ rig: { rules: 'nope' } }).rig.rules.length > 0, true);
});

test('presets are valid, unique, within limits and survive normalisation unchanged', () => {
  assert.ok(RIG_PRESETS.length >= 85);
  const ids = new Set<string>();
  for (const preset of RIG_PRESETS) {
    assert.ok(!ids.has(preset.id), `duplicate preset ${preset.id}`);
    ids.add(preset.id);
    const rig = preset.build();
    assert.ok(rig.rules.length >= 1 && rig.rules.length <= RIG_MAX_RULES, preset.id);
    const roundTrip = normalizeRig(JSON.parse(JSON.stringify(rig)));
    assert.ok(roundTrip, preset.id);
    assert.deepEqual(roundTrip.rules.map(rule => [rule.effect, rule.source, rule.shape, rule.falloff]), rig.rules.map(rule => [rule.effect, rule.source, rule.shape, rule.falloff]), preset.id);
    assert.equal(new Set(rig.rules.map(rule => rule.id)).size, rig.rules.length, 'rule ids must be unique');
    assert.notEqual(preset.build().rules[0].id, rig.rules[0].id, 'every build gets fresh ids');
  }
});

test('normalizeRig clamps untrusted input and drops unknown effects', () => {
  const rig = normalizeRig({
    gain: 99,
    physics: { mode: 'spring', stiffness: 5, damping: 99 },
    rules: [
      { effect: 'swirl', amount: 99, radius: -3, p: [99], color: 'red', drives: [{ source: 'press', target: 'amount', depth: 9 }, { source: 'bogus', target: 'nope' }] },
      { effect: 'does-not-exist' },
      null,
    ],
  });
  assert.ok(rig);
  assert.equal(rig.gain, 3);
  assert.equal(rig.physics.mode, 'spring');
  assert.equal(rig.physics.stiffness, 20);
  assert.equal(rig.physics.damping, 2);
  assert.equal(rig.rules.length, 1);
  const [rule] = rig.rules;
  assert.equal(rule.amount, 2);
  assert.equal(rule.radius, 0.1);
  assert.equal(rule.p[0], 1.5);
  assert.equal(rule.color, '#ffffff');
  assert.equal(rule.drives[0].depth, 2);
  assert.equal(rule.drives[1].source, 'press', 'unknown drive values fall back to defaults');
  assert.equal(normalizeRig({ rules: Array.from({ length: 20 }, () => ({ effect: 'glow' })) })?.rules.length, RIG_MAX_RULES);
  assert.equal(normalizeRig('x'), null);
});

test('rigSignature changes with structure but not with slider values', () => {
  const rig = makeRig('a', [makeRule('swirl'), makeRule('glow')]);
  const before = rigSignature(rig);
  rig.rules[0].amount = 1.7;
  rig.rules[0].radius = 2.2;
  rig.rules[0].p[0] = 0.9;
  rig.rules[0].drives.push(makeDrive({ source: 'speed' }));
  rig.rules[1].color = '#ff0000';
  assert.equal(rigSignature(rig), before, 'numbers are uniforms, so no recompilation');
  rig.rules[0].falloff = 'ring';
  assert.notEqual(rigSignature(rig), before);
  const disabled = makeRig('b', [makeRule('swirl'), { ...makeRule('glow'), enabled: false }]);
  assert.equal(activeRules(disabled).length, 1);
  assert.equal(rigSignature(disabled), rigSignature(makeRig('c', [makeRule('swirl')])));
});

test('the generated shader contains only the effects in use', () => {
  assert.match(template, /uniform float uMeshDrift;/);
  assert.match(template, /uniform float uMeshSpread;/);
  assert.match(template, /uMeshDrift;/);
  assert.match(template, /uMeshSpread/);
  const swirlOnly = assembleFragmentShader(template, makeRig('x', [makeRule('swirl')]));
  assert.match(swirlOnly, /vec2 rigWarp\(vec2 pIn\)/);
  assert.ok(swirlOnly.includes('rgPerpUv * rgA'));
  assert.ok(!swirlOnly.includes('rigHue(col'), 'no colour effects were requested');
  assert.ok(!swirlOnly.includes('lightning'), 'no lightning was requested');
  const none = generateRigGlsl(null);
  assert.ok(none.functions.includes('vec3 rigPost'));
  assert.ok(!template.includes('uPointerMode'), 'the 75-way pointer mode chain is gone');
  assert.ok(!template.includes('uOctaves') && !template.includes('uWarpDepth'), 'quality is a compile-time constant now');
  assert.match(assembleFragmentShader(template, null, { octaves: 3, warpDepth: 1 }), /#define RG_OCTAVES 3\n#define RG_WARP_DEPTH 1/);
  assert.ok(template.includes(RIG_FUNCTIONS_MARKER));
});

test('every effect, shape, falloff, source, colour mode and blend assembles into lint-clean GLSL', () => {
  lintGlsl(template.replace(RIG_FUNCTIONS_MARKER, '').replace('/*@RIG_DEFINES*/', '#define RG_OCTAVES 5\n#define RG_WARP_DEPTH 2'));
  for (const effect of RIG_EFFECTS) {
    lintGlsl(assembleFragmentShader(template, makeRig('t', [makeRule(effect.id, { colorMode: 'custom', follow: true })])));
  }
  for (const shape of RIG_SHAPES) for (const falloff of RIG_FALLOFFS) {
    lintGlsl(assembleFragmentShader(template, makeRig('t', [makeRule('attract', { shape: shape.id, falloff: falloff.id })])));
  }
  for (const source of RIG_SOURCES) lintGlsl(assembleFragmentShader(template, makeRig('t', [makeRule('wave', { source: source.id })])));
  for (const mode of RIG_COLOR_MODES) for (const blend of RIG_BLENDS) {
    lintGlsl(assembleFragmentShader(template, makeRig('t', [makeRule('rings', { colorMode: mode.id, blend: blend.id }), makeRule('tint', { colorMode: mode.id, blend: blend.id })])));
  }
  const full = makeRig('full', RIG_EFFECTS.slice(0, RIG_MAX_RULES).map(effect => makeRule(effect.id)));
  lintGlsl(assembleFragmentShader(template, full));
  for (const preset of RIG_PRESETS) lintGlsl(assembleFragmentShader(template, preset.build()));
  assert.ok(RIG_EFFECT_MAP.bump.params.length === 4);
});

test('the template keeps the interaction highlights visible when the CSS ramp mix is zero', () => {
  const cssMix = template.indexOf('color.rgb = mix(cssColor.rgb, color.rgb, shaderMix);');
  const post = template.indexOf('color.rgb = rigPost(color.rgb, vUv, colorPosition);');
  const highlight = template.indexOf('color.rgb = mix(color.rgb, highlight, clamp(rippleGlow, 0.0, 0.85));');
  const alpha = template.indexOf('alpha = 1.0 - (1.0 - alpha) * (1.0 - interactionAlpha);');
  assert.ok(cssMix >= 0 && post > cssMix && highlight > cssMix && alpha > cssMix);
  assert.ok(template.indexOf('p = rigWarp(p);') < template.indexOf('vec2 centered ='), 'the warp runs before the style samples its coordinates');
});

test('pointer engine: smoothing, press envelope, hold charge, trail and multi-touch', () => {
  const engine = createPointerEngine({ delay: 0, holdTime: 1, pressAttack: 0.05, pressRelease: 0.2, trailLife: 1 });
  engine.move(1, 0.2, 0.3, 'mouse');
  let frame = engine.advance(1 / 60, 0.1);
  assert.ok(Math.abs(frame.x - 0.2) < 1e-6 && frame.active > 0.5);
  engine.down(1, 0.2, 0.3, 'mouse');
  for (let i = 0; i < 20; i++) frame = engine.advance(1 / 60, 0.1 + i / 60);
  assert.ok(frame.press > 0.9, 'press attacks quickly');
  assert.ok(frame.hold > 0.2 && frame.hold <= 1, 'hold charges while pressed');
  assert.equal(engine.getClicks().length, 1);
  engine.up(1);
  for (let i = 0; i < 90; i++) frame = engine.advance(1 / 60, 0.5 + i / 60);
  assert.ok(frame.press < 0.05 && frame.hold === 0, 'release decays');
  // trail records the path and fades it
  for (let i = 0; i < 12; i++) { engine.move(1, 0.2 + i * 0.05, 0.3, 'mouse'); engine.advance(1 / 60, 3 + i / 60); }
  assert.ok(engine.getTrail().length >= 3 && engine.getTrail().length <= RIG_TRAIL_POINTS);
  const buffers = createRigBuffers();
  const packed = packTrail(engine, engine.advance(1 / 60, 3.2), buffers, true);
  assert.ok(packed >= 2 && buffers.trail[2] > 0);
  assert.equal(packTrail(engine, frame, buffers, false), 0);
  engine.advance(1 / 60, 9);
  assert.equal(engine.getTrail().length, 0, 'old points expire');
  // second finger
  const touch = createPointerEngine({ delay: 0 });
  touch.down(10, 0.3, 0.5, 'touch');
  touch.down(11, 0.7, 0.5, 'touch');
  let touchFrame = touch.advance(0.1, 0.1);
  assert.ok(touchFrame.t2active > 0.5 && touchFrame.pinch > 0.5);
  touch.move(11, 0.3, 0.9, 'touch');
  for (let i = 0; i < 10; i++) touchFrame = touch.advance(0.05, 0.2 + i * 0.05);
  assert.ok(Math.abs(touchFrame.twist) > 0.3, 'twist follows the relative angle of the two touches');
  const blocked = createPointerEngine({ touchEnabled: false, delay: 0 });
  blocked.move(5, 0.9, 0.9, 'touch');
  assert.equal(blocked.advance(0.1, 0.1).active, 0, 'touch is ignored when disabled');
});

test('spring physics overshoots where smooth following does not', () => {
  const run = (physics: 'smooth' | 'spring') => {
    const engine = createPointerEngine({ physics, stiffness: 200, damping: 0.2, delay: 60 });
    engine.move(1, 0, 0.5, 'mouse');
    for (let i = 0; i < 30; i++) engine.advance(1 / 60, i / 60);
    engine.move(1, 1, 0.5, 'mouse');
    let max = 0;
    for (let i = 0; i < 240; i++) max = Math.max(max, engine.advance(1 / 60, 1 + i / 60).x);
    return max;
  };
  assert.ok(run('spring') > 1.02, 'an under-damped spring overshoots the target');
  assert.ok(run('smooth') <= 1.0001, 'exponential smoothing never overshoots');
});

test('drives scale, boost and swing the numbers that reach the shader', () => {
  const engine = createPointerEngine({ delay: 0 });
  engine.move(1, 0.5, 0.5, 'mouse');
  const idle = engine.advance(0.1, 0.1);
  const buffers = createRigBuffers();
  const rig = makeRig('d', [
    { ...makeRule('attract', { amount: 1 }), drives: [makeDrive({ source: 'press', target: 'amount', mode: 'scale', depth: 1 })] },
    { ...makeRule('attract', { amount: 1 }), drives: [makeDrive({ source: 'press', target: 'amount', mode: 'boost', depth: 1 })] },
    { ...makeRule('attract', { amount: 1 }), drives: [makeDrive({ source: 'pointerX', target: 'radius', mode: 'swing', depth: 1 })] },
    { ...makeRule('attract', { amount: 1, source: 'touch2' }) },
    { ...makeRule('glow', { amount: 1 }), enabled: false },
  ]);
  evaluateRig(rig, idle, buffers, { radiusScale: 0.3, reaction: 1, enabled: true });
  assert.equal(buffers.count, 4, 'disabled rules are skipped, matching the generated shader');
  assert.ok(Math.abs(buffers.b[0]) < 1e-6, 'scale: no press, no force');
  assert.ok(Math.abs(buffers.b[4] - 1) < 1e-6, 'boost: unchanged while not pressed');
  assert.ok(Math.abs(buffers.b[9] - 0.3) < 1e-6, 'swing: pointer X = 0.5 leaves the radius unchanged');
  assert.equal(buffers.b[12], 0, 'the second-finger source is silent without a second finger');
  engine.down(1, 0.5, 0.5, 'mouse');
  let pressed = idle;
  for (let i = 0; i < 30; i++) pressed = engine.advance(1 / 60, 0.2 + i / 60);
  evaluateRig(rig, pressed, buffers, { radiusScale: 0.3, reaction: 1, enabled: true });
  assert.ok(buffers.b[0] > 0.9 && buffers.b[4] > 1.9);
  evaluateRig(rig, pressed, buffers, { radiusScale: 0.3, reaction: -1, enabled: true });
  assert.ok(buffers.b[0] < -0.9, 'a negative layer reaction flips the direction');
  evaluateRig(rig, pressed, buffers, { radiusScale: 0.3, reaction: 1, enabled: false });
  assert.equal(buffers.b[0], 0, 'a layer that ignores the pointer receives nothing');
  const lfo = makeRig('l', [{ ...makeRule('glow'), drives: [makeDrive({ source: 'lfoSine', target: 'amount', mode: 'scale', depth: 1, rate: 1 })] }]);
  const samples = [0, 0.25, 0.5, 0.75].map(clock => { evaluateRig(lfo, { ...idle, clock }, buffers, {}); return buffers.b[0]; });
  assert.ok(Math.max(...samples) > 0.9 && Math.min(...samples) < 0.1, 'an LFO sweeps its target over time');
});

test('settings carry the new motion controls with sane ranges', () => {
  const settings = normalizeInteractiveSettings({ zoom: 99, flowAngle: 500, breathRate: 0, timeOffset: -5, rotation: 3, meshDrift: 4, meshSpread: -1, meshBlend: 2 });
  assert.equal(settings.zoom, 3);
  assert.equal(settings.flowAngle, 180);
  assert.equal(settings.breathRate, 0.02);
  assert.equal(settings.timeOffset, 0);
  assert.equal(settings.rotation, 0.6);
  assert.equal(settings.meshDrift, 1);
  assert.equal(settings.meshSpread, 0);
  assert.equal(settings.meshBlend, 1);
  assert.equal(normalizeInteractiveSettings({}).zoom, 1);
  assert.equal(normalizeInteractiveSettings({}).meshDrift, 0);
  assert.equal(normalizeInteractiveSettings({}).meshSpread, 0);
  assert.equal(normalizeInteractiveSettings({}).meshBlend, 0.82);
  assert.equal(normalizeInteractiveSettings({ idlePath: 'figure8' }).idlePath, 'figure8');
  assert.equal(normalizeInteractiveSettings({ idlePath: 'nope' }).idlePath, 'drift');
  assert.deepEqual(normalizeShaderLayer({ controls: { meshDrift: 0.7, meshSpread: 0.8 } }).controls, {
    speed: 0.35, intensity: 1, distortion: 0.28, distortionScale: 1.8, turbulence: 0.35,
    timeOffset: 0, flowAngle: 0, flowDrift: 0, breath: 0, breathRate: 0.25, rotation: 0, zoom: 1,
    meshDrift: 0.7, meshSpread: 0.8, meshBlend: 0.82,
  });
});
