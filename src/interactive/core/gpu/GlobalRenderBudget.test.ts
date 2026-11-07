import { describe, expect, it } from 'vitest';
import { GlobalRenderBudget, MAX_RENDER_PIXELS, allocateScales, layerCap, layerWeight, renderSize, requestedScale, type LayerLoad } from './GlobalRenderBudget';

const load = (id: number, weight = 1, over: Partial<LayerLoad> = {}): LayerLoad => ({ id, cssWidth: 1200, cssHeight: 800, requestedScale: requestedScale(2, 'medium', 1), weight, ...over });
const work = (loads: LayerLoad[], scales: Map<number, number>) => loads.reduce((sum, l) => { const s = scales.get(l.id)!; return sum + l.cssWidth * l.cssHeight * s * s * l.weight; }, 0);

describe('global render budget', () => {
  it('never reduces a lone layer below what it asked for', () => {
    const loads = [load(1, 3)];
    expect(allocateScales(loads).get(1)).toBe(Math.round(layerCap(loads[0]) * 64) / 64);
  });

  it('matches the old per-layer sqrt(count) rule when all layers cost the same', () => {
    const loads = [load(1), load(2), load(3), load(4)];
    const scales = allocateScales(loads);
    // the old rule: every layer at requested / sqrt(4) = 0.75
    loads.forEach(l => expect(Math.abs(scales.get(l.id)! - 0.75)).toBeLessThan(0.02));
  });

  it('gives cheap layers more pixels and heavy layers fewer, for the same total GPU work', () => {
    const loads = [load(1, 1), load(2, 1), load(3, 4), load(4, 4)];
    const scales = allocateScales(loads);
    expect(scales.get(1)!).toBeGreaterThan(scales.get(3)!);
    // total work is the old rule's total (equal scales of 0.75) within 2%
    const old = new Map(loads.map(l => [l.id, 0.75]));
    expect(work(loads, scales) / work(loads, old)).toBeLessThan(1.02);
    expect(work(loads, scales) / work(loads, old)).toBeGreaterThan(0.9);
  });

  it('never exceeds a layer\'s own cap or the per-layer pixel ceiling', () => {
    const loads = [load(1, 1, { cssWidth: 2400, cssHeight: 1600, requestedScale: 2 }), load(2)];
    const scales = allocateScales(loads);
    const big = renderSize(2400, 1600, scales.get(1)!);
    expect(big.width * big.height).toBeLessThan(MAX_RENDER_PIXELS * 1.05);
  });

  it('applies the adaptive factor once for the whole composition, not once per layer', () => {
    const loads = [load(1), load(2), load(3), load(4), load(5), load(6)];
    const full = allocateScales(loads, { globalScale: 1 });
    const slow = allocateScales(loads, { globalScale: 0.8 });
    loads.forEach(l => expect(slow.get(l.id)! / full.get(l.id)!).toBeGreaterThan(0.75));
    loads.forEach(l => expect(slow.get(l.id)! / full.get(l.id)!).toBeLessThan(0.85));
  });

  it('keeps an absolute floor under adaptive reduction', () => {
    const scales = allocateScales([load(1), load(2)], { globalScale: 0.05 });
    scales.forEach(scale => expect(scale).toBeGreaterThanOrEqual(0.5 - 1 / 64));
  });

  it('quantises results so tiny input changes do not resize canvases', () => {
    const a = allocateScales([load(1), load(2, 1.001)]);
    const b = allocateScales([load(1), load(2, 1.002)]);
    expect(a.get(1)).toBe(b.get(1));
    a.forEach(scale => expect(Math.abs(scale * 64 - Math.round(scale * 64))).toBeLessThan(1e-9));
  });

  it('weights procedural layers by their noise cost', () => {
    expect(layerWeight(null)).toBe(1);
    const light = layerWeight({ enabled: true, distortion: [{ type: 'rotate', enabled: true, octaves: 1 }], points: { max: 8 } }, 4);
    const heavy = layerWeight({ enabled: true, distortion: [{ type: 'warp', enabled: true, octaves: 6 }, { type: 'multiwarp', enabled: true, octaves: 6 }], points: { max: 12 } }, 4);
    expect(heavy).toBeGreaterThan(light);
    expect(heavy).toBeLessThanOrEqual(6);
  });

  it('adapts through ONE controller and reports changes once', () => {
    const budget = new GlobalRenderBudget();
    expect(budget.describe()).toBe('');
    expect(budget.observeFrame(0.1)).toBe(true);
    expect(budget.globalScale).toBeLessThan(1);
    expect(budget.describe()).toMatch(/Adaptive resolution reduced/);
    budget.reset();
    expect(budget.globalScale).toBe(1);
  });
});
