import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { prepareMeshField, renderPreparedMeshField } from './meshField';
import { MESH_EDGES, MESH_FIELD_METHODS } from './meshFieldSettings';
import { FIELD_SPACES } from './colorScience';
import * as runtime from './meshFieldRuntime.js';
import { encodePng, pngDataUri } from './png';
import { meshFieldBakeUri, meshFieldCanvasHtml, meshFieldScript, usesMeshField } from './meshFieldExport';
import { newLayer, newProject } from './model';

const points = [
  { x: 12, y: 18, color: '#ff3366', alpha: 1, size: 42, strength: 1.2, aspect: 1.6, angle: 25 },
  { x: 80, y: 24, color: '#33ccff', alpha: 0.9, size: 48, core: 60 },
  { x: 46, y: 82, color: '#ffd23f', alpha: 1, size: 36, transform: { x: 4, y: -3, scale: 1.2 } },
  { x: 90, y: 88, color: '#7a7a7a', alpha: 0.6, size: 30 },
];

test('the exported JS runtime renders the same pixels as the TypeScript field for every method, space and edge', () => {
  let compared = 0;
  for (const method of MESH_FIELD_METHODS) for (const space of FIELD_SPACES) for (const edge of MESH_EDGES) {
    const settings = { method, space, edge, warp: 0.4, warpScale: 2.4, flow: 0.4, grain: 0.3, saturation: 1.15, contrast: 1.1, spread: 1.2, sharpness: 0.5 };
    const input = { points, base: edge === 'fade' ? '#101820' : undefined, seed: 11, core: 35 };
    const a = prepareMeshField(input, settings, 16 / 9, 1.7);
    const b = runtime.prepareMeshField(input, settings, 16 / 9, 1.7);
    const ta = renderPreparedMeshField(a, 40, 24), tb = runtime.renderPreparedMeshField(b, 40, 24);
    assert.equal(ta.length, tb.length);
    for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) assert.fail(`${method}/${space}/${edge}: byte ${i} differs (${ta[i]} vs ${tb[i]})`);
    compared++;
  }
  assert.equal(compared, MESH_FIELD_METHODS.length * FIELD_SPACES.length * MESH_EDGES.length);
});

test('PNG encoder output is a valid image (zlib + crc) and keeps pixels', () => {
  const rgba = new Uint8ClampedArray(5 * 3 * 4);
  for (let i = 0; i < 15; i++) { rgba[i * 4] = i * 16; rgba[i * 4 + 1] = 255 - i * 10; rgba[i * 4 + 2] = i; rgba[i * 4 + 3] = 255; }
  const png = encodePng(rgba, 5, 3);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(String.fromCharCode(...png.subarray(12, 16)), 'IHDR');
  assert.equal(png[25], 2, 'opaque images are RGB');
  const idatLength = new DataView(png.buffer, png.byteOffset).getUint32(33);
  const raw = inflateSync(Buffer.from(png.subarray(41, 41 + idatLength)));
  assert.equal(raw.length, (5 * 3 + 1) * 3);
  assert.equal(raw[1], rgba[0]);
  assert.equal(raw[raw.length - 1], rgba[14 * 4 + 2]);
  const translucent = new Uint8ClampedArray(rgba); translucent[3] = 100;
  assert.equal(encodePng(translucent, 5, 3)[25], 6, 'translucent images keep alpha');
  assert.match(pngDataUri(rgba, 5, 3), /^data:image\/png;base64,/);
});

function fieldProject() {
  const layer = newLayer('mesh', {
    mesh: { points: points.map((p, i) => ({ id: `p${i}`, ...p })), base: '#101820', core: 40, seed: 7, field: { enabled: true, method: 'gaussian', warp: 0.3 } },
  });
  return { layer, project: newProject({ layers: [layer], canvas: { w: 1600, h: 900 } }) };
}

test('field layers bake a real image and ship a canvas + script', () => {
  const { layer, project } = fieldProject();
  assert.ok(usesMeshField(layer));
  const uri = meshFieldBakeUri(layer, project.canvas);
  assert.match(uri, /^data:image\/png;base64,/);
  assert.ok(uri.length > 2000, 'an actual picture, not a placeholder');
  assert.equal(meshFieldBakeUri(layer, project.canvas), uri, 'deterministic and cached');
  assert.match(meshFieldCanvasHtml(layer, project.canvas), /^<canvas class="mesh-field" data-sf-mesh-field="[^"]+" aria-hidden="true"><\/canvas>$/);
  const script = meshFieldScript(project);
  assert.match(script, /mountMeshFields\(document\)/);
  assert.doesNotMatch(script, /^\s*export /m);
  assert.doesNotThrow(() => new Function(script));
  const plain = newProject({ layers: [newLayer('linear')] });
  assert.equal(meshFieldScript(plain), '');
});

test('moving a point changes the baked image', () => {
  const { layer, project } = fieldProject();
  const moved = { ...layer, mesh: { ...layer.mesh, points: layer.mesh.points.map((p, i) => i === 0 ? { ...p, x: 60, y: 60 } : p) } };
  assert.notEqual(meshFieldBakeUri(layer, project.canvas), meshFieldBakeUri(moved, project.canvas));
});
