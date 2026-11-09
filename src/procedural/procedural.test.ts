import { describe, expect, it } from 'vitest';
import { proceduralizeSource, type ProceduralSource } from './convert';
import { PROCEDURAL_PRESETS, applyPreset, isLocked, parsePresetFile, randomizeProcedural, reseed, serializePresetFile } from './presets';
import { bakeColorLut, createProceduralState, forceDisplacement, generatePoints, motionPosition, pointCount, PROC_MAX_POINTS } from './proceduralRuntime';
import {
  DEFAULT_PROCEDURAL, MOTION_TYPES, POINT_DISTRIBUTIONS, newProcedural, normalizeProcedural, parseProcedural, proceduralSignature, serializeProcedural,
  type ProceduralConfig,
} from './types';

const config = (patch: Record<string, unknown> = {}): ProceduralConfig => newProcedural({ enabled: true, ...patch });
const PLAY = { x: 0.5, y: 0.5, vx: 0, vy: 0, active: 0, down: 0, t2x: 0.5, t2y: 0.5, t2active: 0 };

describe('procedural model', () => {
  it('repairs bad input instead of throwing', () => {
    const fixed = normalizeProcedural({ seed: 'x', mode: 'nope', points: { min: 99, max: -4, distribution: 7 }, color: { colors: ['red', '#12ab34'] }, distortion: 'oops' });
    expect(fixed.mode).toBe(DEFAULT_PROCEDURAL.mode);
    expect(fixed.points.min).toBeLessThanOrEqual(PROC_MAX_POINTS);
    expect(fixed.points.max).toBeGreaterThanOrEqual(fixed.points.min);
    expect(fixed.color.colors).toEqual(['#12ab34']);
    expect(fixed.distortion).toHaveLength(3);
    expect(normalizeProcedural(null).version).toBe(1);
  });
  it('clamps numbers to their ranges', () => {
    const c = normalizeProcedural({ motion: { speed: 99, amplitude: -3 }, field: { exponent: 100 }, color: { hue: 1000 } });
    expect(c.motion.speed).toBe(3);
    expect(c.motion.amplitude).toBe(0);
    expect(c.field.exponent).toBe(6);
    expect(c.color.hue).toBe(180);
  });
  it('round-trips through JSON without changing', () => {
    const original = config({ seed: 4242, motion: { type: 'flow' }, anchors: [{ x: 0.2, y: 0.8, color: '#ff0000', radius: 0.3, weight: 1 }] });
    expect(parseProcedural(serializeProcedural(original))).toEqual(original);
    expect(parseProcedural('{ not json')).toBeNull();
  });
  it('only recompiles the shader when the distortion types change', () => {
    const base = config();
    expect(proceduralSignature(base)).toBe('on:warp,none,none');
    const moved = normalizeProcedural({ ...base, motion: { ...base.motion, speed: 2 }, distortion: [{ ...base.distortion[0], intensity: 1.5 }, base.distortion[1], base.distortion[2]] });
    expect(proceduralSignature(moved)).toBe(proceduralSignature(base));
    expect(proceduralSignature({ ...base, enabled: false })).toBe('off');
    expect(proceduralSignature(normalizeProcedural({ ...base, distortion: [{ type: 'wave' }, {}, {}] }))).toBe('on:wave,none,none');
  });
});

describe('point generation', () => {
  it('is deterministic for a seed and different for another', () => {
    const a = generatePoints(config({ seed: 7 }), null);
    const b = generatePoints(config({ seed: 7 }), null);
    const c = generatePoints(config({ seed: 8 }), null);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });
  it('keeps the count between min and max and under the uniform budget', () => {
    for (const density of [0, 0.5, 1]) {
      const cfg = config({ points: { min: 3, max: 9, density } });
      const n = generatePoints(cfg, null).length;
      expect(n).toBe(pointCount(cfg));
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);
    }
    expect(generatePoints(config({ points: { min: 12, max: 12 } }), null).length).toBeLessThanOrEqual(PROC_MAX_POINTS);
  });
  it('places finite points for every distribution', () => {
    for (const distribution of POINT_DISTRIBUTIONS) {
      const points = generatePoints(config({ points: { distribution, min: 8, max: 8 } }), null);
      expect(points).toHaveLength(8);
      for (const p of points) { expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true); expect(Math.abs(p.x - 0.5)).toBeLessThan(1.2); }
    }
  });
  it('spacing pushes points apart', () => {
    const minGap = (spacing: number) => {
      const pts = generatePoints(config({ points: { distribution: 'random', min: 10, max: 10, spacing, spread: 1 } }), null);
      let best = Infinity;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) best = Math.min(best, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
      return best;
    };
    expect(minGap(1)).toBeGreaterThan(minGap(0));
  });
  it('takes colours from the layer palette or from custom colours', () => {
    const lut = bakeColorLut(['#ff0000', '#ff0000']);
    const fromLayer = generatePoints(config({ color: { source: 'layer' } }), lut);
    expect(fromLayer.every(p => p.color[0] === 255 && p.color[1] === 0)).toBe(true);
    const custom = generatePoints(config({ color: { source: 'custom', colors: ['#0000ff', '#0000ff'] } }), lut);
    expect(custom.every(p => p.color[2] === 255 && p.color[0] === 0)).toBe(true);
  });
  it('pins anchors exactly and keeps their colours out of palette cycling', () => {
    const points = generatePoints(config({ points: { min: 2, max: 2 }, anchors: [{ x: 0.1, y: 0.9, color: '#00ff00', radius: 0.3, weight: 1.5 }] }), null);
    expect(points[0].x).toBe(0.1);
    expect(points[0].y).toBe(0.9);
    expect(points[0].color).toEqual([0, 255, 0]);
    expect(points[0].t).toBe(-1);
  });
});

describe('motion', () => {
  const positionsAfter = (cfg: ProceduralConfig, frames: number, dt: number) => {
    const state = createProceduralState(cfg);
    for (let i = 0; i < frames; i++) state.step(dt, PLAY, 1, 1);
    return state.getPositions();
  };
  it('is frame-rate independent for the closed-form motions', () => {
    for (const type of ['orbit', 'circle', 'figure8', 'sine', 'drift', 'noise', 'wander'] as const) {
      const cfg = config({ motion: { type, speed: 1, amplitude: 0.2 } });
      const at60 = positionsAfter(cfg, 120, 1 / 60);
      const at30 = positionsAfter(cfg, 60, 1 / 30);
      const at144 = positionsAfter(cfg, 288, 1 / 144);
      at60.forEach((p, i) => {
        expect(Math.abs(p[0] - at30[i][0])).toBeLessThan(1e-4);
        expect(Math.abs(p[1] - at144[i][1])).toBeLessThan(1e-4);
      });
    }
  });
  it('is frame-rate independent for the flow field (fixed internal step)', () => {
    const cfg = config({ motion: { type: 'flow', speed: 1, amplitude: 0.2 } });
    const at60 = positionsAfter(cfg, 120, 1 / 60);
    const at30 = positionsAfter(cfg, 60, 1 / 30);
    at60.forEach((p, i) => { expect(Math.abs(p[0] - at30[i][0])).toBeLessThan(0.02); expect(Math.abs(p[1] - at30[i][1])).toBeLessThan(0.02); });
  });
  it('static, zero influence and a paused clock all hold the points still', () => {
    for (const patch of [{ type: 'static' }, { influence: 0 }]) {
      const cfg = config({ motion: patch });
      const homes = generatePoints(cfg, null);
      const moved = positionsAfter(cfg, 30, 1 / 60);
      moved.forEach((p, i) => { expect(p[0]).toBeCloseTo(homes[i].x, 6); expect(p[1]).toBeCloseTo(homes[i].y, 6); });
    }
    const state = createProceduralState(config({ motion: { type: 'circle', speed: 1, amplitude: 0.2 } }));
    state.step(1 / 60, PLAY, 1, 1);
    const before = state.getPositions().map(p => [...p]);
    for (let i = 0; i < 30; i++) state.step(1 / 60, PLAY, 1, 0);
    state.getPositions().forEach((p, i) => { expect(p[0]).toBeCloseTo(before[i][0], 9); expect(p[1]).toBeCloseTo(before[i][1], 9); });
  });
  it('advances procedural shader time with its own motion clock', () => {
    const state = createProceduralState(config({ motion: { type: 'circle', speed: 1 } }));
    state.step(1 / 60, PLAY, 1, 1);
    const first = state.buffers.d[1];
    expect(first).toBeGreaterThan(0);
    state.step(1 / 60, PLAY, 1, 0);
    expect(state.buffers.d[1]).toBe(first);
  });
  it('reversing the direction mirrors the travel', () => {
    const cfg = config({ motion: { type: 'circle', speed: 1, amplitude: 0.2, randomness: 0 } });
    const point = generatePoints(cfg, null)[0];
    const forward = motionPosition(point, 2, { direction: 1, smoothness: 0.5, influence: 1 });
    const back = motionPosition(point, 2, { direction: -1, smoothness: 0.5, influence: 1 });
    expect(Math.abs(forward[0] - back[0]) + Math.abs(forward[1] - back[1])).toBeGreaterThan(1e-3);
  });
  it('every motion type stays finite and bounded over a long run', () => {
    for (const type of MOTION_TYPES) {
      const state = createProceduralState(config({ motion: { type, speed: 2, amplitude: 0.5 } }));
      for (let i = 0; i < 600; i++) state.step(1 / 60, { ...PLAY, x: 0.3, y: 0.7, active: 1 }, 1.6, 1);
      for (const p of state.getPositions()) { expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true); expect(Math.abs(p[0])).toBeLessThan(2); }
    }
  });
  it('follow tracks the pointer and returns home when it leaves', () => {
    const cfg = config({ motion: { type: 'follow', speed: 1, amplitude: 0.01, smoothness: 0.2 }, interaction: { force: 'none' } });
    const state = createProceduralState(cfg);
    const mean = () => { const p = state.getPositions(); return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; };
    for (let i = 0; i < 240; i++) state.step(1 / 60, { ...PLAY, x: 0.9, y: 0.9, active: 1 }, 1, 1);
    expect(mean()[0]).toBeGreaterThan(0.75);
    for (let i = 0; i < 600; i++) state.step(1 / 60, PLAY, 1, 1);
    const homes = generatePoints(cfg, null);
    const homeMean = homes.reduce((s, p) => s + p.x, 0) / homes.length;
    expect(Math.abs(mean()[0] - homeMean)).toBeLessThan(0.05);
  });
});

describe('pointer forces', () => {
  const run = (force: string, pointer = { ...PLAY, x: 0.5, y: 0.5, active: 1 }) => {
    const cfg = config({ motion: { type: 'static' }, points: { min: 1, max: 1, distribution: 'random', spread: 0.1 }, interaction: { force, radius: 0.8, strength: 1 } });
    const state = createProceduralState(cfg);
    const home = generatePoints(cfg, null)[0];
    for (let i = 0; i < 120; i++) state.step(1 / 60, pointer, 1, 1);
    return { home, now: state.getPositions()[0] };
  };
  it('attract pulls a point toward the pointer, repel pushes it away', () => {
    const toward = run('attract', { ...PLAY, x: 0.8, y: 0.5, active: 1 });
    const away = run('repel', { ...PLAY, x: 0.8, y: 0.5, active: 1 });
    expect(toward.now[0]).toBeGreaterThan(toward.home.x);
    expect(away.now[0]).toBeLessThan(away.home.x);
  });
  it('does nothing without a pointer, and settles back after it leaves', () => {
    const idle = run('swirl', PLAY);
    expect(idle.now[0]).toBeCloseTo(idle.home.x, 6);
    const cfg = config({ motion: { type: 'static' }, interaction: { force: 'attract', radius: 0.8, strength: 1, response: 8 } });
    const state = createProceduralState(cfg);
    for (let i = 0; i < 60; i++) state.step(1 / 60, { ...PLAY, x: 0.6, y: 0.5, active: 1 }, 1, 1);
    expect(state.isSettling()).toBe(true);
    for (let i = 0; i < 400; i++) state.step(1 / 60, PLAY, 1, 1);
    expect(state.isSettling()).toBe(false);
  });
  it('has a finite response for every force type', () => {
    for (const type of ['attract', 'repel', 'swirl', 'vortex', 'push', 'pull', 'ripple', 'wave', 'fluid']) {
      const [x, y] = forceDisplacement(type, 0.1, 0.05, 0.11, 1, 0.4, -0.2, 3);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
    expect(forceDisplacement('none', 1, 1, 1.4, 1, 0, 0, 0)).toEqual([0, 0]);
  });
});

describe('packing for the shader', () => {
  it('reports mode, count and method, and uploads zero when disabled', () => {
    const state = createProceduralState(config({ mode: 'hybrid', points: { min: 6, max: 6 }, field: { method: 'smin' } }));
    state.step(1 / 60, PLAY, 1, 1);
    expect(state.buffers.a[0]).toBe(1);
    expect(state.buffers.a[1]).toBe(6);
    expect(state.buffers.a[2]).toBe(4);
    state.setConfig({ ...state.getConfig(), enabled: false });
    state.step(1 / 60, PLAY, 1, 1);
    expect(state.buffers.a[0]).toBe(0);
    expect(state.buffers.a[1]).toBe(0);
  });
  it('encodes colours in the requested blend space', () => {
    const white = (interpolation: string) => {
      const state = createProceduralState(config({ points: { min: 1, max: 1 }, color: { source: 'custom', colors: ['#ffffff', '#ffffff'], interpolation } }));
      state.step(1 / 60, PLAY, 1, 1);
      return [state.buffers.colors[0], state.buffers.colors[1], state.buffers.colors[2]];
    };
    expect(white('srgb')).toEqual([1, 1, 1]);
    const lin = white('linear');
    expect(lin[0]).toBeCloseTo(1, 4);
    const lab = white('oklab');
    expect(lab[0]).toBeCloseTo(1, 2);
    expect(Math.abs(lab[1])).toBeLessThan(0.01);
  });
  it('palette cycling changes colours over time and a fixed config does not', () => {
    const cycling = createProceduralState(config({ motion: { type: 'static' }, color: { source: 'custom', colors: ['#ff0000', '#0000ff'], cycleSpeed: 2, variance: 0 } }));
    cycling.step(1 / 60, PLAY, 1, 1);
    const first = Array.from(cycling.buffers.colors.slice(0, 3));
    for (let i = 0; i < 120; i++) cycling.step(1 / 60, PLAY, 1, 1);
    expect(Array.from(cycling.buffers.colors.slice(0, 3))).not.toEqual(first);
    const fixed = createProceduralState(config({ motion: { type: 'static' }, color: { source: 'custom', colors: ['#ff0000', '#0000ff'], cycleSpeed: 0 } }));
    fixed.step(1 / 60, PLAY, 1, 1);
    const f1 = Array.from(fixed.buffers.colors.slice(0, 3));
    for (let i = 0; i < 120; i++) fixed.step(1 / 60, PLAY, 1, 1);
    expect(Array.from(fixed.buffers.colors.slice(0, 3))).toEqual(f1);
  });
  it('lowers the octave cap without rebuilding', () => {
    const state = createProceduralState(config());
    state.setQuality({ octaveCap: 2 });
    expect(state.buffers.c[3]).toBe(2);
    state.setQuality({ octaveCap: 99 });
    expect(state.buffers.c[3]).toBe(6);
  });
});

describe('proceduralize', () => {
  const source = (patch: Partial<ProceduralSource> & { kind?: string } = {}): ProceduralSource => ({
    palette: [{ color: '#ff0000', position: 0 }, { color: '#00ff00', position: 0.5 }, { color: '#0000ff', position: 1 }],
    geometry: { kind: 'linear', angle: 90, originX: 50, originY: 50, radiusX: 50, radiusY: 50, ...(patch.kind ? { kind: patch.kind } : {}) },
    meshPoints: [],
    ...patch,
  });
  it('converts mesh points to anchors at the same place, flipping y to canvas-up', () => {
    const { config: c } = proceduralizeSource(source({ kind: 'mesh', meshPoints: [{ color: '#112233', x: 25, y: 20, size: 40, alpha: 1 }, { color: '#445566', x: 75, y: 90, size: 30, alpha: 0.8 }] }));
    expect(c.anchors).toHaveLength(2);
    expect(c.anchors[0].x).toBeCloseTo(0.25, 6);
    expect(c.anchors[0].y).toBeCloseTo(0.8, 6);
    expect(c.anchors[1].color).toBe('#445566');
    expect(c.points.min).toBe(2);
    expect(c.enabled).toBe(true);
  });
  it('places linear stops along the axis in order, keeping their colours', () => {
    const { config: c, approximation } = proceduralizeSource(source());
    expect(c.anchors.map(a => a.color)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
    // angle 90° runs left → right
    expect(c.anchors[0].x).toBeLessThan(c.anchors[1].x);
    expect(c.anchors[1].x).toBeLessThan(c.anchors[2].x);
    expect(approximation.length).toBeGreaterThan(10);
  });
  it('handles radial and conic gradients within the point budget', () => {
    for (const kind of ['radial', 'conic']) {
      const { config: c } = proceduralizeSource(source({ kind, palette: Array.from({ length: 9 }, (_, i) => ({ color: '#ff8800', position: i / 8 })) }));
      expect(c.anchors.length).toBeGreaterThan(1);
      expect(c.anchors.length).toBeLessThanOrEqual(PROC_MAX_POINTS);
    }
  });
  it('never modifies its input, and falls back cleanly without colours', () => {
    const input = source({ kind: 'mesh', meshPoints: [{ color: '#112233', x: 25, y: 20, size: 40, alpha: 1 }] });
    const frozen = JSON.stringify(input);
    proceduralizeSource(input);
    expect(JSON.stringify(input)).toBe(frozen);
    const none = proceduralizeSource({ palette: [], geometry: { kind: 'noise', angle: 0, originX: 50, originY: 50, radiusX: 50, radiusY: 50 }, meshPoints: [] });
    expect(none.config.anchors).toHaveLength(0);
    expect(none.config.enabled).toBe(true);
  });
  it('supports hybrid mode with a strength below 1', () => {
    expect(proceduralizeSource(source(), { mode: 'hybrid' }).config.mix).toBeLessThan(1);
  });
});

describe('presets, randomize and locks', () => {
  it('ships valid built-in presets', () => {
    const count = PROCEDURAL_PRESETS.length;
    expect(PROCEDURAL_PRESETS).toHaveLength(count);
    for (const preset of PROCEDURAL_PRESETS) {
      const applied = applyPreset(config(), preset);
      expect(applied.enabled).toBe(true);
      expect(applied.color.colors.length).toBeGreaterThanOrEqual(2);
      expect(generatePoints(applied, null).length).toBeGreaterThan(0);
    }
    expect(new Set(PROCEDURAL_PRESETS.map(preset => preset.id)).size).toBe(count);
  });
  it('randomize is reproducible and stays inside valid ranges', () => {
    const a = randomizeProcedural(config(), 'all', 5);
    const b = randomizeProcedural(config(), 'all', 5);
    const c = randomizeProcedural(config(), 'all', 6);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
    expect(normalizeProcedural(a)).toEqual(a);
  });
  it('randomize only touches the chosen scope', () => {
    const base = config();
    const motion = randomizeProcedural(base, 'motion', 3);
    expect(motion.motion).not.toEqual(base.motion);
    expect(motion.color).toEqual(base.color);
    expect(motion.field).toEqual(base.field);
    expect(motion.points).toEqual(base.points);
    expect(motion.seed).toBe(base.seed);
  });
  it('locked groups and single properties survive randomize and presets', () => {
    const base = config({ locks: ['color', 'motion.speed', 'seed'], motion: { speed: 1.7 } });
    const random = randomizeProcedural(base, 'all', 11);
    expect(random.color).toEqual(base.color);
    expect(random.motion.speed).toBe(1.7);
    expect(random.seed).toBe(base.seed);
    expect(random.field).not.toEqual(base.field);
    const preset = applyPreset(base, PROCEDURAL_PRESETS[2]);
    expect(preset.color).toEqual(base.color);
    expect(preset.motion.speed).toBe(1.7);
    expect(preset.locks).toEqual(base.locks);
    expect(isLocked(['motion'], 'motion.speed')).toBe(true);
    expect(isLocked(['motion.speed'], 'motion.amplitude')).toBe(false);
  });
  it('a preset keeps the layer on/off state, mode and seed, and clears conversion pins', () => {
    const pinned = config({ mode: 'hybrid', seed: 99, anchors: [{ x: 0.5, y: 0.5, color: '#ffffff', radius: 0.3, weight: 1 }], origin: { from: 'mesh', note: 'x' } });
    const applied = applyPreset(pinned, PROCEDURAL_PRESETS[0]);
    expect(applied.mode).toBe('hybrid');
    expect(applied.seed).toBe(99);
    expect(applied.anchors).toHaveLength(0);
    expect(applied.origin).toBeNull();
  });
  it('reseed changes only the seed', () => {
    const base = config();
    const next = reseed(base, 4321);
    expect(next.seed).toBe(4321);
    expect({ ...next, seed: base.seed }).toEqual(base);
  });
  it('preset files round-trip and reject other JSON', () => {
    const text = serializePresetFile('My look', config({ seed: 77, motion: { type: 'wander' } }));
    const parsed = parsePresetFile(text);
    expect(parsed?.name).toBe('My look');
    expect((parsed?.config as ProceduralConfig).motion.type).toBe('wander');
    expect(parsePresetFile('{"format":"other"}')).toBeNull();
    expect(parsePresetFile('nope')).toBeNull();
  });
});
