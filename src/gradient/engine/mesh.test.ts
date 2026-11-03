import test from 'node:test';
import assert from 'node:assert/strict';
import { layerCss, stableNames } from './css';
import { newLayer, newProject } from './model';
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
  const project = newProject({ layers: [layer] });
  const css = layerCss(layer, project, { rootSel: '.root', names: stableNames });
  const svg = layerSvg(layer, project, 'mesh').body;

  assert.match(css, /isolation: isolate/);
  assert.equal((css.match(/mix-blend-mode: screen/g) ?? []).length, 2);
  assert.match(svg, /style="isolation:isolate"/);
  assert.equal((svg.match(/style="mix-blend-mode:screen"/g) ?? []).length, 2);
});
