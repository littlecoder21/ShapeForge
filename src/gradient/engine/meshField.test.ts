import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_SPACES, hexToUnit } from './colorScience';
import { prepareMeshField, renderMeshField, sampleMeshField, type MeshFieldInput } from './meshField';
import { MESH_EDGES, MESH_FIELD_METHODS, MESH_STYLES, normalizeMeshField } from './meshFieldSettings';

const four = (over: Partial<MeshFieldInput['points'][number]> = {}): MeshFieldInput => ({
  base: '', core: 40, seed: 7,
  points: [
    { x: 20, y: 25, color: '#ff3366', alpha: 1, size: 55, ...over },
    { x: 80, y: 22, color: '#33aaff', alpha: 1, size: 55 },
    { x: 25, y: 80, color: '#ffd23a', alpha: 1, size: 55 },
    { x: 78, y: 78, color: '#3ddc97', alpha: 1, size: 55 },
  ],
});
const px = (input: MeshFieldInput, settings: object, u: number, v: number, aspect = 1.5, time = 0) => {
  const out = new Float32Array(4); sampleMeshField(prepareMeshField(input, settings, aspect, time), u, v, out); return Array.from(out);
};
const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

test('the same input renders byte-identical output', () => {
  const a = renderMeshField(four(), { enabled: true, warp: 0.5, grain: 0.3 }, 48, 32), b = renderMeshField(four(), { enabled: true, warp: 0.5, grain: 0.3 }, 48, 32);
  assert.deepEqual(a, b);
});

test('moving a point horizontally OR vertically visibly reshapes the field', () => {
  const base = renderMeshField(four(), { enabled: true }, 64, 40);
  const moveX = renderMeshField(four({ x: 45 }), { enabled: true }, 64, 40), moveY = renderMeshField(four({ y: 55 }), { enabled: true }, 64, 40);
  assert.ok(diff(base, moveX) > 1.5, `x move changed ${diff(base, moveX)}`);
  assert.ok(diff(base, moveY) > 1.5, `y move changed ${diff(base, moveY)}`);
});

test('colour varies along both axes (no vertical stripes, no horizontal bands)', () => {
  const w = 60, h = 40, data = renderMeshField(four(), { enabled: true }, w, h);
  const rgb = (x: number, y: number) => [data[(y * w + x) * 4], data[(y * w + x) * 4 + 1], data[(y * w + x) * 4 + 2]].map(c => c / 255);
  // RMS colour distance from the line's own mean colour: 0 means the line is one flat colour (a stripe or a band)
  const spread = (colours: number[][]) => {
    const mean = [0, 1, 2].map(k => colours.reduce((a, c) => a + c[k], 0) / colours.length);
    return Math.sqrt(colours.reduce((a, c) => a + (c[0] - mean[0]) ** 2 + (c[1] - mean[1]) ** 2 + (c[2] - mean[2]) ** 2, 0) / colours.length);
  };
  const columns = Array.from({ length: w }, (_, x) => spread(Array.from({ length: h }, (_, y) => rgb(x, y))));
  const rows = Array.from({ length: h }, (_, y) => spread(Array.from({ length: w }, (_, x) => rgb(x, y))));
  assert.ok(Math.min(...columns) > 0.05, `every column should vary vertically (min ${Math.min(...columns).toFixed(3)})`);
  assert.ok(Math.min(...rows) > 0.05, `every row should vary horizontally (min ${Math.min(...rows).toFixed(3)})`);
});

test('every method × space × edge stays finite and in range, even with extreme points', () => {
  const input: MeshFieldInput = { base: '#101020', seed: 3, points: [
    { x: -20, y: 120, color: '#ffffff', alpha: 1, size: 0.5, strength: 2, aspect: 4, angle: 45 },
    { x: 50, y: 50, color: '#000000', alpha: 0.2, size: 200, strength: 0 },
    { x: 100, y: 0, color: '#ff00ff', alpha: 1, size: 300, aspect: 0.25, angle: -90, core: 100 },
  ] };
  for (const method of MESH_FIELD_METHODS) for (const space of FIELD_SPACES) for (const edge of MESH_EDGES) {
    const data = renderMeshField(input, { enabled: true, method, space, edge, warp: 1, spread: 3, sharpness: 1, saturation: 2, contrast: 1.8 }, 14, 9);
    data.forEach(v => assert.ok(Number.isFinite(v) && v >= 0 && v <= 255, `${method}/${space}/${edge}`));
    for (const [u, v] of [[0, 0], [1, 1], [0.5, 0.5]]) px(input, { method, space, edge }, u, v).forEach(c => assert.ok(Number.isFinite(c), `${method}/${space}/${edge} nan`));
  }
});

test('there are no dead zones: far from every point the field still has a defined colour', () => {
  for (const method of MESH_FIELD_METHODS) {
    const tiny: MeshFieldInput = { base: '', seed: 1, points: [{ x: 5, y: 5, color: '#ff0000', alpha: 1, size: 4 }, { x: 8, y: 8, color: '#0000ff', alpha: 1, size: 4 }] };
    const [r, , b, a] = px(tiny, { method, sharpness: 0.9 }, 0.95, 0.95);
    assert.ok(Number.isFinite(r + b) && a === 1, `${method} must stay defined`);
    assert.ok(r + b > 0.5, `${method} should resolve to the nearest colours, not black`);
  }
});

test('the field tiles seamlessly in wrap mode, with or without warp', () => {
  for (const warp of [0, 0.6]) for (const v of [0.13, 0.5, 0.87]) {
    const left = px(four(), { edge: 'wrap', warp }, 0.0005, v), right = px(four(), { edge: 'wrap', warp }, 0.9995, v);
    left.forEach((c, i) => assert.ok(Math.abs(c - right[i]) < 0.03, `x seam warp=${warp} v=${v}`));
    const top = px(four(), { edge: 'wrap', warp }, v, 0.0005), bottom = px(four(), { edge: 'wrap', warp }, v, 0.9995);
    top.forEach((c, i) => assert.ok(Math.abs(c - bottom[i]) < 0.03, `y seam warp=${warp} u=${v}`));
  }
});

test('fade mode lets colour dissolve into transparency (or the base) away from the points', () => {
  const input: MeshFieldInput = { base: '', seed: 1, points: [{ x: 50, y: 50, color: '#ff8800', alpha: 1, size: 20 }] };
  const centre = px(input, { edge: 'fade' }, 0.5, 0.5, 1)[3], corner = px(input, { edge: 'fade' }, 0.02, 0.02, 1)[3];
  assert.ok(centre > 0.9 && corner < 0.05, `centre ${centre}, corner ${corner}`);
  assert.deepEqual(px({ ...input, base: '#000000' }, { edge: 'fade' }, 0.02, 0.02, 1).map(v => Math.round(v * 10) / 10), [0, 0, 0, 1]);
});

test('per-point strength and anisotropy change the result', () => {
  const at = (over: object) => px(four(over), { method: 'gaussian' }, 0.5, 0.5);
  const weak = at({ strength: 0.2 }), strong = at({ strength: 2 });
  assert.ok(strong[0] > weak[0] + 0.02, 'a stronger red point should pull the centre redder');
  const stretched = px({ ...four({ aspect: 4, angle: 0 }) }, {}, 0.55, 0.25, 1.5), round = px(four(), {}, 0.55, 0.25, 1.5);
  assert.ok(Math.abs(stretched[0] - round[0]) > 0.01, 'stretching the ellipse along x should change the colour along x');
});

test('a point colour dominates at its own centre, in every kernel', () => {
  for (const method of MESH_FIELD_METHODS) {
    const [r, g, b] = px(four(), { method, sharpness: 0.7 }, 0.2, 0.25 * 1, 1.5);
    const target = hexToUnit('#ff3366');
    assert.ok(Math.hypot(r - target[0], g - target[1], b - target[2]) < 0.45, `${method} centre ${[r, g, b]}`);
  }
});

test('translucent points fade out locally instead of darkening', () => {
  const input = four({ alpha: 0.2 });
  const near = px({ ...input, base: '' }, {}, 0.2, 0.25 / 1.5 * 1.5, 1.5);
  assert.ok(near[3] < 1 && near[3] > 0, 'alpha follows the field');
});

test('settings are validated and styles are deterministic definitions', () => {
  const n = normalizeMeshField({ method: 'nope', space: 'x', spread: 99, sharpness: -4, edge: 'q', warp: 'a', contrast: 9 });
  assert.equal(n.method, 'gaussian'); assert.equal(n.spread, 3); assert.equal(n.sharpness, 0); assert.equal(n.contrast, 1.8);
  assert.equal(MESH_STYLES.length, 11);
  MESH_STYLES.forEach(s => assert.equal(normalizeMeshField({ ...s.field, enabled: true }).enabled, true));
});
