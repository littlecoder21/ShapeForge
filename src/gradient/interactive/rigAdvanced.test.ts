import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRig, makeRule, normalizeRig, rigSignature } from './rig/model';
import { generateRigGlsl } from './rig/glsl';
import { bakeShapeAtlas, bakeShapeCell, polygonSignedDistance, shapeAtlasKey, shapeCellsBase64 } from './rig/shapeField';
import { TEXTURE_RECIPES, applyTextureRecipe } from './rig/textureRecipes';
import { createPointerEngine, createRigBuffers, evaluateRig } from './rigRuntime';

const square = [{ x: -0.25, y: -0.25 }, { x: 0.25, y: -0.25 }, { x: 0.25, y: 0.25 }, { x: -0.25, y: 0.25 }];

test('editing a custom shape or the fade direction never changes the shader program', () => {
  const rule = makeRule('glow', { shape: 'custom', customPoints: square });
  const before = rigSignature(makeRig('a', [rule]));
  const edited = { ...rule, customPoints: [...square, { x: 0, y: 0.4 }], fadeMode: 'angle' as const, fadeInvert: true };
  assert.equal(rigSignature(makeRig('a', [edited])), before);
  assert.notEqual(rigSignature(makeRig('a', [{ ...rule, falloff: 'ring' }])), before);
});

test('custom shapes are baked into a distance field the shader samples', () => {
  assert.ok(Math.abs(polygonSignedDistance(square, 0, 0) + 0.25) < 1e-9);
  assert.ok(Math.abs(polygonSignedDistance(square, 0.5, 0) - 0.25) < 1e-9);
  const rig = makeRig('s', [makeRule('swirl'), makeRule('glow', { shape: 'custom', customPoints: square })]);
  assert.notEqual(shapeAtlasKey(rig), '');
  assert.equal(bakeShapeAtlas(rig)?.length, 512 * 64 * 4);
  const cell = bakeShapeCell(square);
  assert.equal(bakeShapeAtlas(rig)![(32 * 512 + 64 + 32) * 4], cell[32 * 64 + 32]);
  assert.deepEqual(Object.keys(shapeCellsBase64(rig)), ['1']);
  const glsl = generateRigGlsl(rig).functions;
  assert.match(glsl, /uniform sampler2D uRuleShapeAtlas;/);
  assert.match(glsl, /float rigDistCustom1/);
});

test('a texture brush is a texture and packs its motion for the shader', () => {
  const starfall = applyTextureRecipe(makeRule('texture'), TEXTURE_RECIPES[0]);
  assert.equal(starfall.texture.enabled, true);
  const engine = createPointerEngine({});
  engine.move(1, 0.5, 0.5, 'mouse');
  const frame = engine.advance(0.016, 1);
  const buffers = createRigBuffers();
  evaluateRig(makeRig('r', [starfall]), frame, buffers, { canvasHeight: 800 });
  assert.ok(Math.abs(buffers.h[0] - 90 / 800) < 1e-6);
  assert.equal(buffers.j[3], 1);
  assert.equal(buffers.g[2], 1);
  const glsl = generateRigGlsl(makeRig('r', [starfall])).functions;
  assert.match(glsl, /uniform vec4 uRuleJ\[8\];/);
  assert.match(glsl, /rigAtlas\(texCoord,/);
  assert.match(glsl, /rgW \*= uInputActive;/);
});

test('texture motion survives a round trip and is clamped', () => {
  const rule = applyTextureRecipe(makeRule('texture'), TEXTURE_RECIPES[1]);
  const copy = normalizeRig(JSON.parse(JSON.stringify(makeRig('n', [rule]))))!;
  assert.equal(copy.rules[0].texFx.scrollAngle, 82);
  const broken = normalizeRig({ rules: [{ effect: 'texture', texFx: { scrollSpeed: 99999, anchor: 'nope' } }] })!;
  assert.equal(broken.rules[0].texFx.scrollSpeed, 600);
  assert.equal(broken.rules[0].texFx.anchor, 'pointer');
});

test('idle rules cost one comparison per pixel', () => {
  const glsl = generateRigGlsl(makeRig('x', [makeRule('swirl')])).functions;
  assert.match(glsl, /if \(abs\(rgAmt\) > 0\.0005\) \{/);
});
