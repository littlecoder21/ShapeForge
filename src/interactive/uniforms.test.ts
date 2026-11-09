import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { makeRig, makeRule } from '../gradient/interactive/rig/model';
import { generateRigGlsl } from '../gradient/interactive/rig/glsl';
import { UNIFORM_NAMES as LIVE } from './uniforms';
import { UNIFORM_NAMES as LEGACY } from '../gradient/interactive/uniforms';

/* The regression this guards against: a uniform that the shader declares but UNIFORM_NAMES omits is never looked up, so the
 * renderer uploads nothing to it. `uRuleG` (fade strength) was missing, every rule's influence stayed 0, and every interaction
 * style looked like the same built-in base reaction. */

const template = readFileSync(new URL('../gradient/interactive/shaders/gradient.frag.glsl', import.meta.url), 'utf8');

const declared = (source: string) => [...source.matchAll(/^\s*uniform\s+\w+\s+(\w+)(\s*\[[^\]]*\])?\s*;/gm)].map(match => match[2] ? `${match[1]}[0]` : match[1]);

test('every uniform of the template is listed in UNIFORM_NAMES', () => {
  const names = new Set<string>(LIVE);
  const missing = declared(template).filter(name => !name.startsWith('uProc') && !names.has(name));
  assert.deepEqual(missing, []);
});

test('uniforms declared by generated rule code are listed too', () => {
  const textured = makeRule('texture', { shape: 'custom' });
  const code = generateRigGlsl(makeRig('t', [textured, makeRule('swirl')])).functions;
  const names = new Set<string>(LIVE);
  assert.deepEqual(declared(code).filter(name => !names.has(name)), []);
});

test('the fade, texture and shape uniforms are located', () => {
  for (const name of ['uInputActive', 'uRuleG[0]', 'uRuleH[0]', 'uRuleI[0]', 'uRuleJ[0]', 'uRuleK[0]', 'uRuleTextureAtlas', 'uRuleShapeAtlas']) {
    assert.ok((LIVE as readonly string[]).includes(name), `${name} (live)`);
    assert.ok((LEGACY as readonly string[]).includes(name), `${name} (legacy)`);
  }
});
