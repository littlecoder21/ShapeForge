import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseOutput, layeredOutput } from './css';
import { newEffect } from './effects';
import { newProject, newTextLayer, normalizeProject } from './model';
import { projectSvg } from './svg';

test('text layers preserve editable content and clamp imported typography settings', () => {
  const layer = newTextLayer();
  const raw = JSON.parse(JSON.stringify(newProject({ layers: [layer] }))) as {
    layers: Array<{ text: Record<string, unknown> }>;
  };
  Object.assign(raw.layers[0].text, {
    content: 'Gradient type',
    fontSize: 4000,
    fontWeight: 750,
    fontFamily: 'url(javascript:alert(1))',
    align: 'diagonal',
    mergeStyle: 'both',
    depth: 100,
  });

  const normalized = normalizeProject(raw).layers[0].text!;
  assert.equal(normalized.content, 'Gradient type');
  assert.equal(normalized.fontSize, 1200);
  assert.equal(normalized.fontWeight, 800);
  assert.equal(normalized.fontFamily, 'Arial, sans-serif');
  assert.equal(normalized.align, 'center');
  assert.equal(normalized.mergeStyle, 'both');
  assert.equal(normalized.depth, 24);
});

test('text layers export as editable HTML with gradient fill and SVG glyph clipping', () => {
  const layer = newTextLayer();
  layer.text!.content = 'A <glow> & "type"';
  layer.text!.mergeStyle = 'both';
  layer.text!.depth = 8;
  layer.effects = [newEffect('blur', { radius: 12 })];
  layer.blend = 'screen';
  const project = newProject({ layers: [layer] });
  const output = layeredOutput(project);
  const svg = projectSvg(project);

  assert.match(output.html, /A &lt;glow&gt; &amp; &quot;type&quot;/);
  assert.match(output.css, /background-clip: text/);
  assert.match(output.css, /mix-blend-mode: screen/);
  assert.match(output.css, /filter: blur\(12px\)/);
  assert.match(output.css, /mix-blend-mode: multiply/);
  assert.match(output.css, /drop-shadow\(0 8px 12px rgba\(0, 0, 0, 0\.6\)\)/);
  assert.match(svg, /<clipPath id="g1-text"/);
  assert.match(svg, /id="g1-text-depth"/);
  assert.match(svg, /mix-blend-mode:multiply/);
  assert.match(svg, /A &lt;glow&gt; &amp; &quot;type&quot;/);
  assert.equal(analyseOutput(project).needsLayers, true);
});

test('color merge automatically adapts glyph colors to the layers beneath', () => {
  const layer = newTextLayer();
  layer.text!.mergeStyle = 'color';
  const project = newProject({ layers: [layer] });
  const css = layeredOutput(project).css;
  const svg = projectSvg(project);

  assert.match(css, /\.g-text \{[\s\S]*mix-blend-mode: multiply/);
  assert.match(svg, /clip-path="url\(#g1-text\)" style="mix-blend-mode:multiply"/);
  assert.doesNotMatch(css, /mix-blend-mode: color/);
});
