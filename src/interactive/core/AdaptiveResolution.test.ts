import { describe, expect, it } from 'vitest';
import { AdaptiveResolution } from './AdaptiveResolution';

interface Change { scale: number; effort: number; reason: string }

/** Runs the controller against a simulated device: `cost` gives the frame time for the current quality. */
function simulate(controller: AdaptiveResolution, frames: number, cost: (scale: number, effort: number) => number) {
  const changes: (Change & { frame: number })[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const change = controller.update(cost(controller.scale, controller.effort));
    if (change) changes.push({ ...change, frame });
  }
  return changes;
}
/** A GPU-bound device: frame time falls as resolution and shader effort fall. */
const gpu = (base: number) => (scale: number, effort: number) => base * (0.25 + 0.75 * scale) * (1 - 0.12 * effort);

describe('AdaptiveResolution', () => {
  it('stays at full quality when frames are healthy', () => {
    const controller = new AdaptiveResolution();
    expect(simulate(controller, 600, () => 1 / 60)).toHaveLength(0);
    expect(controller.scale).toBe(1);
    expect(controller.effort).toBe(0);
  });
  it('steps down on a slow GPU until frames are healthy', () => {
    const controller = new AdaptiveResolution();
    const device = gpu(0.04);
    const changes = simulate(controller, 900, device);
    expect(changes[0].reason).toBe('slow');
    expect(controller.scale).toBeLessThan(1);
    // healthy = no longer slow by the controller's own measure (about 1.45 x the display interval)
    expect(device(controller.scale, controller.effort)).toBeLessThan(0.0245);
  });
  it('does not penalise a display that is capped at 30 Hz', () => {
    const controller = new AdaptiveResolution();
    const changes = simulate(controller, 900, () => 1 / 30);
    expect(controller.scale).toBe(1);
    expect(controller.effort).toBe(0);
    // whatever it tried at the start is undone, and nothing changes after that
    expect(changes.filter(change => change.frame > 120)).toHaveLength(0);
  });
  it('ignores long pauses such as a hidden tab, and bad values', () => {
    const controller = new AdaptiveResolution();
    expect(simulate(controller, 100, () => 1.5)).toHaveLength(0);
    expect(controller.update(0)).toBeNull();
    expect(controller.update(Number.NaN)).toBeNull();
  });
  it('never goes below the floor; then lowers shader effort up to its maximum, and stops', () => {
    const controller = new AdaptiveResolution({ minScale: 0.6, maxEffort: 2 });
    simulate(controller, 4000, gpu(0.2));
    expect(controller.scale).toBeGreaterThanOrEqual(0.6 - 1e-9);
    expect(controller.scale).toBeLessThan(0.7);
    expect(controller.effort).toBe(2);
  });
  it('recovers gradually once the device is healthy again — effort first, then resolution', () => {
    const controller = new AdaptiveResolution({ minScale: 0.5 });
    simulate(controller, 4000, gpu(0.2));
    expect(controller.effort).toBe(2);
    const low = controller.scale;
    const changes = simulate(controller, 8000, gpu(0.012));
    expect(changes.length).toBeGreaterThan(2);
    expect(changes.every(change => change.reason === 'recovered')).toBe(true);
    expect(changes[0].effort).toBeLessThan(2);
    expect(controller.effort).toBe(0);
    expect(controller.scale).toBeGreaterThan(low);
    expect(controller.scale).toBeLessThanOrEqual(1);
    // gradual: one small step at a time, never a jump
    for (let i = 1; i < changes.length; i++) expect(changes[i].scale / (changes[i - 1].scale || 1)).toBeLessThan(1.13);
  });
  it('waits longer to try again each time a recovery is followed by another slowdown', () => {
    const controller = new AdaptiveResolution({ minScale: 0.4 });
    const heavy = gpu(0.05);
    const light = gpu(0.012);
    simulate(controller, 300, heavy);
    const waits: number[] = [];
    for (let round = 0; round < 4; round++) {
      let waited = 0;
      let recovered = false;
      while (!recovered && waited < 6000) {
        waited += 1;
        recovered = controller.update(light(controller.scale, controller.effort)) !== null;
      }
      waits.push(waited);
      // the heavy load comes straight back
      simulate(controller, 200, heavy);
    }
    expect(waits[3]).toBeGreaterThan(waits[0]);
  });
  it('can raise its floor from the renderer, and reset', () => {
    const controller = new AdaptiveResolution();
    simulate(controller, 900, gpu(0.08));
    controller.setMinScale(0.9);
    expect(controller.scale).toBeGreaterThanOrEqual(0.9 - 1e-9);
    controller.reset();
    expect(controller.scale).toBe(1);
    expect(controller.effort).toBe(0);
  });
});
