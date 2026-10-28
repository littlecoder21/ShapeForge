import test from 'node:test';
import assert from 'node:assert/strict';
import { previewDurationMs } from './animation';
import { newLayer, newProject, NO_ANIM } from './model';

const animatedLayer = (patch: Partial<ReturnType<typeof newLayer>['anim']> = {}) => newLayer('linear', {
  anim: { ...NO_ANIM, enabled: true, tracks: [{ id: 'track', prop: 'x', from: 0, to: 10 }], ...patch },
});

test('preview repeat counts stop after their requested finite iterations', () => {
  for (const count of [1, 2, 3]) {
    const project = newProject({ layers: [animatedLayer({ duration: 4, delay: 1, iterations: count })] });
    assert.equal(previewDurationMs(project), (1 + 4 * count) * 1000);
  }
});

test('preview timing includes per-point durations and negative delays', () => {
  const project = newProject({ layers: [newLayer('mesh', {
    anim: {
      ...NO_ANIM, enabled: true, duration: 8, delay: -2, iterations: 2,
      tracks: [
        { id: 'x1', prop: 'meshX', stopId: 'point-1', from: 10, to: 20, duration: 3 },
        { id: 'y1', prop: 'meshY', stopId: 'point-1', from: 10, to: 20, duration: 3 },
        { id: 'x2', prop: 'meshX', stopId: 'point-2', from: 10, to: 20, duration: 6 },
      ],
    },
  })] });
  assert.equal(previewDurationMs(project), 10_000);
});

test('preview keeps looping for infinite animations and ignores hidden or disabled animations', () => {
  const infinite = animatedLayer({ iterations: 'infinite' });
  const finite = animatedLayer({ iterations: 2 });
  const project = newProject({ layers: [infinite, newLayer('linear', { ...finite, visible: false }), newLayer('linear', { ...finite, anim: { ...finite.anim, enabled: false } })] });
  assert.equal(previewDurationMs(project), null);
});
