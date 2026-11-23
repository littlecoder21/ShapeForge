import test from 'node:test';
import assert from 'node:assert/strict';
import { layerCss, stableNames } from './css';
import { newLayer, newProject, normalizeProject } from './model';
import { layerSvg } from './svg';

test('mesh colors blend together in layered CSS and SVG output', () => {
  const layer = newLayer('mesh', {
    mesh: {
      base: '#0b1020',
      core: 40,
      points: [
        { id: 'point-1', x: 30, y: 40, color: '#ff0000', alpha: 1, size: 54, locked: false },
        { id: 'point-2', x: 70, y: 60, color: '#0000ff', alpha: 1, size: 54, locked: false },
      ],
    },
  });

  test('legacy mesh projects gain disabled field defaults and imported field settings are bounded', () => {
    const project = newProject({ layers: [newLayer('mesh')] });
    const raw = JSON.parse(JSON.stringify(project)) as { layers: Array<{ mesh: { field?: unknown; points: Array<Record<string, unknown>> } }> };
    delete raw.layers[0].mesh.field;
    raw.layers[0].mesh.points = [{ id: 'p', x: 50, y: 50, color: '#ffffff', alpha: 1, size: 40, strength: 8, aspect: 0 }];

    const normalized = normalizeProject(raw);
    const mesh = normalized.layers[0].mesh;
    assert.equal(mesh.field.enabled, false);
    assert.equal(mesh.field.method, 'gaussian');
    assert.equal(mesh.points[0].strength, 2);
    assert.equal(mesh.points[0].aspect, 0.25);
  });
  const project = newProject({ layers: [layer] });
  const css = layerCss(layer, project, { rootSel: '.root', names: stableNames });
  const svg = layerSvg(layer, project, 'mesh').body;

  assert.match(css, /isolation: isolate/);
  assert.equal((css.match(/mix-blend-mode: screen/g) ?? []).length, 2);
  assert.match(svg, /style="isolation:isolate"/);
  assert.equal((svg.match(/style="mix-blend-mode:screen"/g) ?? []).length, 2);
});
