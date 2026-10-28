import test from 'node:test';
import assert from 'node:assert/strict';
import { curveFromGradient, curvePoint } from './curve';
import { linearLine } from './geom';
import { newLayer } from './model';

test('a curve converted from a linear gradient follows its existing gradient axis', () => {
  const layer = newLayer('linear', { angle: 42 });
  const canvas = { w: 1200, h: 800 };
  const curve = curveFromGradient(layer, canvas);
  const line = linearLine(layer.angle, canvas.w, canvas.h);
  for (const [t, endpoint] of [[0, [line.x1, line.y1]], [1, [line.x2, line.y2]]] as const) {
    const point = curvePoint(curve, t, canvas);
    assert.ok(Math.abs(point.x - endpoint[0]) < 0.01);
    assert.ok(Math.abs(point.y - endpoint[1]) < 0.01);
  }
  const middle = curvePoint(curve, 0.5, canvas);
  assert.ok(Math.abs(middle.x - canvas.w / 2) < 0.01);
  assert.ok(Math.abs(middle.y - canvas.h / 2) < 0.01);
});

test('a curve converted from a radial gradient starts at its existing origin and radius', () => {
  const layer = newLayer('radial', { cx: 28, cy: 64, shape: 'ellipse', ry: 35 });
  const curve = curveFromGradient(layer, { w: 1000, h: 800 });
  assert.deepEqual(curve.p0, { x: 28, y: 64 });
  assert.deepEqual(curve.p3, { x: 28, y: 29 });
});
