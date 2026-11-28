/* Section-background export tests — no extra dependencies.
 *   npx tsx --test src/gradient/engine/backgroundOutput.test.ts
 * (`*.test.ts` is excluded from the app's tsconfig, so these never affect `npm run typecheck` / `build`.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { newLayer, newProject, outputOf } from './model';
import { BG_ATTRIBUTE, DEFAULT_BG_LAYER_PREFIX, DEFAULT_BG_SELECTOR, backgroundHostCss, backgroundProject, backgroundRootCss, backgroundStageCss, sanitizeHostSelector } from './backgroundOutput';

const project = newProject({ canvas: { w: 1200, h: 800 }, layers: [newLayer('linear')] });

test('default names are namespaced, names the author typed are kept', () => {
  const named = backgroundProject(project);
  assert.equal(outputOf(named).selector, DEFAULT_BG_SELECTOR);
  assert.equal(outputOf(named).layerPrefix, DEFAULT_BG_LAYER_PREFIX);
  const custom = backgroundProject({ ...project, output: { selector: 'hero-glow', layerPrefix: 'glow' } });
  assert.equal(outputOf(custom).selector, 'hero-glow');
  assert.equal(outputOf(custom).layerPrefix, 'glow');
  assert.equal(outputOf(project).selector, 'gradient-canvas', 'the source project is not mutated');
});

test('a section selector is accepted only as plain selector syntax', () => {
  for (const ok of ['.hero', '#top > section.a', '[data-section="hero"]', 'main:not(.x)', 'header, footer']) assert.equal(sanitizeHostSelector(ok), ok);
  for (const bad of ['', '   ', '.a { color: red }', '.a; .b', '/* x */ .a', '.a\\', '<script>', '.a\n.b', '@media x']) assert.equal(sanitizeHostSelector(bad), '', JSON.stringify(bad));
  assert.equal(sanitizeHostSelector('.x'.repeat(120)), '');
});

test('the section rule has zero specificity and only fills gaps', () => {
  const css = backgroundHostCss('.sf-bg', '.hero', true);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^}]*\}/g)?.map(rule => rule.trim()) ?? [];
  assert.equal(rules.length, 2);
  for (const rule of rules) {
    assert.match(rule, /^:where\(/);
    assert.doesNotMatch(rule, /!important/);
    assert.deepEqual([...rule.matchAll(/^\s+([a-z-]+):/gm)].map(m => m[1]), ['position', 'isolation'], 'nothing but position + isolation is set on the section');
  }
  assert.match(css, /:where\(:has\(> \.sf-bg\)\)/);
  assert.match(css, /:where\(\.hero\)/);
  assert.doesNotMatch(backgroundHostCss('.sf-bg', '.a{}', false), /\.a\{\}/, 'an unsafe selector is dropped');
});

test('the root is out of flow, behind the content, inert and sizeless', () => {
  for (const staged of [true, false]) {
    const css = backgroundRootCss(project, '.sf-bg', { comments: false, staged, prefix: 'sf-layer' });
    const rule = css.slice(0, css.indexOf('}'));
    for (const expected of ['position: absolute !important', 'inset: 0 !important', 'z-index: -1 !important', 'pointer-events: none !important', 'margin: 0 !important', 'max-width: none !important', 'width: auto !important', 'height: auto !important', 'border-radius: inherit', 'overflow: hidden']) assert.ok(rule.includes(expected), `${expected} (staged=${staged})`);
    for (const forbidden of ['position: relative', 'aspect-ratio', 'min-height: 320', 'width: 100%', 'height: 100%', 'min-height: 100vh']) assert.ok(!rule.includes(forbidden), `${forbidden} (staged=${staged})`);
    assert.equal(rule.includes('container-type: size'), staged, 'the scaled stage needs size queries');
  }
});

test('the scaled stage falls back to a plain fill and scales with container units', () => {
  const css = backgroundStageCss(project, '.sf-bg', 'data-sf-stage', { comments: false, staged: true, prefix: 'sf-layer' });
  assert.match(css, /\.sf-bg > \[data-sf-stage\] \{[^}]*width: 100%;[^}]*height: 100%;/, 'without CSS trig the stage simply fills the box');
  assert.match(css, /@supports \(transform: scale\(tan\(atan2\(100cqw, 1200px\)\)\)\)/);
  assert.match(css, /height: calc\(100cqh \/ var\(--sf-k\)\)/);
  assert.match(css, /\.sf-bg > :where\(\[data-sf-stage\]\) > \.sf-layer/);
  assert.equal(BG_ATTRIBUTE, 'data-sf-bg');
});
