import test from 'node:test';
import assert from 'node:assert/strict';
import { newLayer, newProject } from '../gradient/engine/model';
import { normalizeProcedural, newProcedural } from '../procedural/types';
import { normalizeShaderLayer } from '../gradient/interactive/types';
import { interactiveExports } from './export';

const decode = (value: string) => JSON.parse(value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));

function meshProject() {
  const points = [
    { id: 'a', x: 15, y: 20, color: '#ff3366', alpha: 1, size: 40 },
    { id: 'b', x: 82, y: 28, color: '#33ccff', alpha: 1, size: 44 },
    { id: 'c', x: 40, y: 80, color: '#ffd23f', alpha: 0.9, size: 36 },
  ];
  const procedural = normalizeProcedural({
    ...newProcedural(), enabled: true, mode: 'full',
    mesh: { ...newProcedural().mesh, source: 'layer', render: 'unified-field' },
  });
  const mesh = newLayer('mesh', {
    shader: normalizeShaderLayer({ enabled: true, procedural }),
    mesh: { points, base: '#101820', core: 40, seed: 7 },
  });
  return newProject({ layers: [mesh], shader: { ...newProject().shader, enabled: true } });
}

test('procedural mesh export carries the live mesh points, not just the palette ramp', () => {
  const project = meshProject();
  const markup = interactiveExports(project).markup;
  const settingsAttribute = /data-shader-settings="([^"]*)"/.exec(markup)?.[1];
  assert.ok(settingsAttribute, 'canvas has settings');
  const settings = decode(settingsAttribute!);
  assert.ok(settings.procedural, 'procedural config is exported');
  assert.equal(settings.procedural.mesh.source, 'layer');
  assert.equal(settings.procedural.anchors.length, 3, 'every mesh point becomes an anchor');
  assert.deepEqual(settings.procedural.anchors.map((anchor: { color: string }) => anchor.color), ['#ff3366', '#33ccff', '#ffd23f']);
  assert.equal(settings.procedural.mesh.base, '#101820');
  // the anchors sit where the points are (x in 0…1, y flipped to canvas-up)
  assert.ok(Math.abs(settings.procedural.anchors[0].x - 0.15) < 1e-6);
  assert.ok(Math.abs(settings.procedural.anchors[0].y - 0.8) < 1e-6);
});

test('moving a mesh point changes the exported anchors', () => {
  const project = meshProject();
  const moved = { ...project, layers: project.layers.map(layer => ({ ...layer, mesh: { ...layer.mesh, points: layer.mesh.points.map((p, i) => i === 1 ? { ...p, x: 55, y: 60 } : p) } })) };
  const read = (p: typeof project) => decode(/data-shader-settings="([^"]*)"/.exec(interactiveExports(p).markup)![1]).procedural.anchors[1];
  assert.notDeepEqual(read(project), read(moved));
  assert.ok(Math.abs(read(moved).x - 0.55) < 1e-6);
});
