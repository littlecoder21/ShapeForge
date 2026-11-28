/* Section-background package tests (plain gradient project).
 * The export pipeline imports Vite-only modules (`?raw`, `.glsl`), so run this file through the app's own bundler setup rather than
 * bare `tsx`; the node:test API below works with any runner that bundles those loaders.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { newLayer, newProject } from './model';
import { buildCodeExportPackage } from './codeExport';

const project = newProject({ canvas: { w: 1200, h: 800 }, layers: [newLayer('radial'), newLayer('linear')] });

test('background package: a clean first-child fragment, scoped CSS, demo and README', () => {
  const pkg = buildCodeExportPackage(project, { mode: 'background', hostSelector: '.hero' });
  assert.deepEqual(Object.keys(pkg.files).sort(), ['README.md', 'demo.html', 'gradient-background.css', 'gradient-background.html'].sort(), 'a plain gradient needs no JavaScript');
  assert.match(pkg.html, /<div class="sf-bg" data-sf-bg aria-hidden="true">/);
  assert.equal(pkg.javascript, '');
  assert.doesNotMatch(pkg.html, /<script/);
  // nothing global: no page resets, no sizes, no generic class names
  assert.doesNotMatch(pkg.css, /html, body|min-height: 100vh|aspect-ratio|min-height: 320px/);
  assert.doesNotMatch(pkg.css, /(^|\n)\.layer\b|\.gradient-canvas/);
  assert.match(pkg.css, /\.sf-bg \.sf-layer-1/);
  assert.match(pkg.css, /:where\(:has\(> \.sf-bg\)\)/);
  assert.match(pkg.css, /:where\(\.hero\)/);
  // the demo shows the fragment as the first child of a section
  const demo = pkg.files['demo.html'];
  assert.match(demo, /<section class="demo-hero">\s*<!--[^>]*-->\s*<div class="sf-bg" data-sf-bg/);
  assert.match(pkg.files['README.md'], /first child/);
});

test('background package: custom class names and file names are honoured', () => {
  const named = { ...project, output: { selector: 'hero-glow', layerPrefix: 'glow' } };
  const pkg = buildCodeExportPackage(named, { mode: 'background', websiteFileNames: { html: 'hero.fragment', css: 'hero.styles.css' } });
  assert.ok(pkg.files['hero.html'] && pkg.files['hero.styles.css'], Object.keys(pkg.files).join(','));
  assert.match(pkg.html, /class="hero-glow" data-sf-bg/);
  assert.match(pkg.css, /\.hero-glow \.glow-1/);
});

test('website and custom packages are unchanged by the background mode', () => {
  const website = buildCodeExportPackage(project, { mode: 'website' });
  assert.match(website.html, /<section class="gradient-canvas"/);
  assert.doesNotMatch(website.html, /data-sf-bg/);
  const custom = buildCodeExportPackage(project, { mode: 'custom' });
  assert.ok(custom.files['index.html'] && custom.files['all-in-one.html']);
  assert.doesNotMatch(custom.css, /sf-bg/);
});
