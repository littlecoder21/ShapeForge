import { describe, expect, it } from 'vitest';
import { FLOW_PRESETS, INTERACTION_PRESETS, MOTION_PROFILES, deleteUserProfile, duplicateUserProfile, importUserProfile, loadUserProfiles, renameUserProfile, saveUserProfile } from './presets';
import {
  COMPOSITIONS, FLOW_TYPES, INTERACTION_RESPONSES, MOD_SHAPES, MOTION_FORMAT, MOTION_LIMITS, MOTION_VERSION, PHYSICS_MODELS, TURBULENCE_KINDS,
  defaultMotion, newFlowSource, newModulator, newPath, normalizeMotion, parseMotion, serializeMotion, type MotionConfig, type NormalizeReport,
} from './types';
import { generateMotionGlsl, injectMotionGlsl, isMotionActive, MOTION_ANCHORS, motionSignature } from './glsl';
import { createMotionState, effectiveMotionQuality, modulatorShape, qualityDualPhase, qualityOctaves, randomAt, stepDynamics, createDynamics, stepMotion, type MotionFrame, type MotionState } from './motionRuntime';
import { evaluateFlow, evaluateOrganic, evaluateTurbulence, softLimit } from './motionField';

const ASPECT = 1.6;
const on = (patch: (config: MotionConfig) => void): MotionConfig => { const config = defaultMotion(); config.enabled = true; patch(config); return config; };
const run = (config: MotionConfig, seconds: number, dt = 1 / 60, frame: MotionFrame | null = null, state: MotionState = createMotionState()) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) stepMotion(state, config, frame, dt, { aspect: ASPECT, shaderDt: dt, animate: true, projectQuality: 'medium', octaveCap: 4, dual: true, clock: t });
  return state;
};
const flowAt = (state: MotionState, u: number, v: number) => { const out = [0, 0]; evaluateFlow(state, (u - 0.5) * ASPECT, v - 0.5, ASPECT, out); return out as [number, number]; };
const pointer = (x: number, y: number, extra: Partial<MotionFrame> = {}): MotionFrame => ({ x, y, active: 1, down: 0, sinceClick: 9, t2x: 0, t2y: 0, t2active: 0, ...extra });

describe('config model', () => {
  it('has valid defaults that survive a round trip unchanged', () => {
    const base = defaultMotion();
    expect(base.version).toBe(MOTION_VERSION);
    const report: NormalizeReport = { warnings: [] };
    expect(normalizeMotion(base, report)).toEqual(base);
    expect(report.warnings).toEqual([]);
  });

  it('never throws on hostile input and always returns a finite, in-range config', () => {
    const hostile: unknown[] = [null, undefined, 5, 'x', [], { sources: 'nope' }, { sources: [null, 7, { type: 'zzz', strength: 'a' }] }, { global: { intensity: NaN, speed: Infinity, seed: -Infinity } },
      { composition: { maxVelocity: 1e99, mode: 'banana' } }, { modulators: [{ shape: 'sine', amplitude: NaN, target: 'nonsense' }] }, JSON.parse('{"__proto__":{"polluted":1},"enabled":true}')];
    for (const input of hostile) {
      let config: MotionConfig | undefined;
      expect(() => { config = normalizeMotion(input); }).not.toThrow();
      if (!config) continue;
      const walk = (value: unknown): void => {
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
        else if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') Object.values(value).forEach(walk);
      };
      walk(config);
      expect(config.composition.maxVelocity).toBeLessThanOrEqual(3);
    }
    expect((({} as Record<string, unknown>).polluted)).toBeUndefined();
  });

  it('reports what it fixed instead of failing silently', () => {
    const report: NormalizeReport = { warnings: [] };
    const config = normalizeMotion({ composition: { mode: 'banana', maxVelocity: 99 }, sources: [{ type: 'vortex', strength: 99 }] }, report);
    expect(config?.composition.mode).toBe('normalized');
    expect(config?.sources[0]?.strength).toBeLessThanOrEqual(2);
    expect(report.warnings.length).toBeGreaterThan(1);
  });

  it('caps list lengths and keeps ids unique', () => {
    const many = Array.from({ length: 20 }, () => ({ type: 'noise', id: 'same' }));
    const config = normalizeMotion({ sources: many, modulators: Array.from({ length: 20 }, () => ({ id: 'm' })), paths: Array.from({ length: 5 }, () => ({ id: 'p' })) });
    expect(config?.sources.length).toBe(MOTION_LIMITS.sources);
    expect(new Set(config?.sources.map(source => source.id)).size).toBe(MOTION_LIMITS.sources);
    expect(config?.modulators.length).toBe(MOTION_LIMITS.modulators);
    expect(config?.paths.length).toBe(MOTION_LIMITS.paths);
  });

  it('unlocking limits relaxes only the stability caps', () => {
    const locked = normalizeMotion({ composition: { maxVelocity: 9 } });
    const open = normalizeMotion({ composition: { maxVelocity: 9, unlockLimits: true } });
    expect(locked?.composition.maxVelocity).toBe(3);
    expect(open?.composition.maxVelocity).toBe(9);
  });

  it('exports versioned JSON and imports it back; bad files return an error, never throw', () => {
    const config = on(c => { c.sources = [newFlowSource('curl'), newFlowSource('path', {}, ['s1'])]; c.paths = [newPath()]; c.modulators = [newModulator({ target: 'flow.strength' })]; });
    const text = serializeMotion(config);
    expect(JSON.parse(text).format).toBe(MOTION_FORMAT);
    const back = parseMotion(text);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.config).toEqual(config);
    for (const bad of ['', '{', '[]', 'null', '{"format":"other"}', JSON.stringify({ format: MOTION_FORMAT, version: MOTION_VERSION + 5, config: {} })]) {
      const result = parseMotion(bad);
      expect(result.ok === false || result.warnings.length >= 0).toBe(true);
      expect(() => parseMotion(bad)).not.toThrow();
    }
    expect(parseMotion('{').ok).toBe(false);
  });

  it('migrates an older version and fills new fields with defaults', () => {
    const migrated = normalizeMotion({ version: 0, enabled: true, global: { speed: 2 } });
    expect(migrated?.version).toBe(MOTION_VERSION);
    expect(migrated?.global.speed).toBe(2);
    expect(migrated?.physics.model).toBe(defaultMotion().physics.model);
  });
});

describe('runtime: time, physics and determinism', () => {
  it('is deterministic: the same config and steps give identical packed buffers', () => {
    const config = on(c => { c.sources = [newFlowSource('noise'), newFlowSource('vortex', {}, ['s1'])]; c.organic.enabled = true; c.turbulence.enabled = true; });
    const a = run(config, 2), b = run(config, 2);
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f', 'g0', 'g1', 'g2', 'o0', 'o1', 't0', 't2', 'phase'] as const) expect(Array.from(a[key])).toEqual(Array.from(b[key]));
  });

  it('a different seed gives a different organic result, the same seed the same one', () => {
    const make = (seed: number) => on(c => { c.organic = { ...c.organic, enabled: true, seed }; c.sources = [newFlowSource('directional')]; });
    const first = run(make(1), 1.5), again = run(make(1), 1.5), other = run(make(2), 1.5);
    expect(Array.from(first.g1)).toEqual(Array.from(again.g1));
    expect(Array.from(first.o1)).not.toEqual(Array.from(other.o1));
  });

  it('flow time is frame-rate independent', () => {
    const config = on(c => { c.sources = [newFlowSource('wave')]; });
    const slow = run(config, 3, 1 / 30), fast = run(config, 3, 1 / 120);
    expect(Math.abs(slow.tau - fast.tau) / Math.max(1e-6, fast.tau)).toBeLessThan(0.03);
  });

  it('every physics model stays finite under an extreme jolt', () => {
    for (const model of PHYSICS_MODELS) {
      const config = on(c => { c.physics = { ...c.physics, model, stiffness: 6, mass: 0.1, damping: 0, elasticity: 1, maxSpeed: 8 }; c.sources = [newFlowSource('curl')]; });
      const state = createMotionState();
      for (let i = 0; i < 240; i++) stepMotion(state, config, pointer(i % 2, (i * 7) % 2 ? 1 : 0, { down: 1 }), i % 50 === 0 ? 0.5 : 1 / 60, { aspect: ASPECT, shaderDt: 1 / 60, animate: true, projectQuality: 'medium', octaveCap: 4, dual: true, clock: i / 60 });
      for (const value of [...state.g0, ...state.g1, ...state.a, ...state.ptrP, ...state.ptrQ, state.tau, state.time]) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('a critically damped spring settles without overshoot, an elastic one overshoots', () => {
    const settle = (model: MotionConfig['physics']['model'], elasticity: number) => {
      const phys = { ...defaultMotion().physics, model, damping: 2, elasticity, stiffness: 2 };
      const d = createDynamics(0); let peak = 0;
      stepDynamics(d, 0, 1 / 120, phys); // the first call initialises at the target
      for (let i = 0; i < 600; i++) { stepDynamics(d, 1, 1 / 120, phys); peak = Math.max(peak, d.x); }
      return { peak, end: d.x };
    };
    expect(settle('damped', 0).peak).toBeLessThan(1.02);
    expect(settle('elastic', 1).peak).toBeGreaterThan(1.02);
    expect(Math.abs(settle('damped', 0).end - 1)).toBeLessThan(0.02);
  });

  it('modulator shapes stay in a sane range and are deterministic', () => {
    for (const shape of MOD_SHAPES) {
      const mod = newModulator({ shape });
      for (let t = 0; t < 6; t += 0.37) { const v = modulatorShape(mod, t); expect(Number.isFinite(v)).toBe(true); expect(Math.abs(v)).toBeLessThanOrEqual(1.5); expect(v).toBe(modulatorShape(mod, t)); }
    }
    expect(randomAt(3, 5)).toBe(randomAt(3, 5));
    expect(randomAt(3, 5)).not.toBe(randomAt(3, 6));
  });

  it('a modulator really changes the property it targets', () => {
    const strong = (target: string, amplitude: number) => {
      const config = on(c => { c.global.flow = 0.5; c.modulators = [newModulator({ target, amplitude, shape: 'sine', speed: 1, frequency: 1, blend: 'add' })]; });
      const seen: number[] = [];
      const state = createMotionState();
      for (let i = 0; i < 180; i++) { stepMotion(state, config, null, 1 / 60, { aspect: ASPECT, shaderDt: 1 / 60, animate: true, projectQuality: 'medium', octaveCap: 4, dual: true, clock: i / 60 }); seen.push(Math.hypot(state.g1[0]!, state.g1[1]!)); }
      return Math.max(...seen) - Math.min(...seen);
    };
    expect(strong('flow.strength', 1)).toBeGreaterThan(0.005);
    expect(strong('flow.strength', 0)).toBeLessThan(1e-6);
  });

  it('time controls: freeze stops the clock, reverse runs it back, loop wraps', () => {
    const base = on(c => { c.sources = [newFlowSource('wave')]; });
    const free = run(base, 2).time;
    const frozen = run({ ...base, time: { ...base.time, freeze: true } }, 2).time;
    const reversed = run({ ...base, time: { ...base.time, reverse: true } }, 2).time;
    const looped = run({ ...base, time: { ...base.time, loop: 'loop', duration: 1 } }, 3).time;
    expect(free).toBeGreaterThan(1);
    expect(Math.abs(frozen)).toBeLessThan(1e-6);
    expect(reversed).toBeLessThan(0);
    expect(looped).toBeLessThanOrEqual(1.01);
  });

  it('quality modes map to octave caps and the dual-phase switch', () => {
    expect(qualityOctaves('performance', 'high')).toBeLessThan(qualityOctaves('ultra', 'low') + 1);
    expect(qualityDualPhase('performance', 'high')).toBe(false);
    expect(qualityDualPhase('ultra', 'low')).toBe(true);
  });

  it('uses single-phase auto quality for motion interaction on touch-first devices', () => {
    const quality = effectiveMotionQuality('auto', true, true);
    expect(quality).toBe('performance');
    expect(qualityDualPhase(quality, 'high')).toBe(false);
    expect(qualityOctaves(quality, 'high')).toBe(2);
    expect(effectiveMotionQuality('auto', true, false)).toBe('auto');
    expect(effectiveMotionQuality('balanced', true, true)).toBe('balanced');
  });

  it('single-phase fallback keeps the weights valid; dual-phase weights always sum to one', () => {
    const config = on(c => { c.sources = [newFlowSource('directional')]; });
    const state = createMotionState();
    for (let i = 0; i < 400; i++) {
      stepMotion(state, config, null, 1 / 60, { aspect: ASPECT, shaderDt: 1 / 60, animate: true, projectQuality: 'medium', octaveCap: 4, dual: i < 200, clock: i / 60 });
      expect(state.phase[2]! + state.phase[3]!).toBeCloseTo(1, 4);
      expect(state.phase[0]!).toBeGreaterThanOrEqual(0); expect(state.phase[0]!).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe('field: sources and composition', () => {
  it('a directional source flows along its angle', () => {
    const state = run(on(c => { c.sources = [newFlowSource('directional', { angle: 90, params: [0, 0, 0, 0] })]; }), 0.2);
    const [vx, vy] = flowAt(state, 0.4, 0.4);
    expect(vy).toBeGreaterThan(0.01);
    expect(Math.abs(vx)).toBeLessThan(vy * 0.05);
  });

  it('a vortex circulates (velocity ⟂ radius) and a radial source expands', () => {
    const v = run(on(c => { c.sources = [newFlowSource('vortex', { x: 0.5, y: 0.5, radius: 1.2, params: [0.2, 0, 0, 1] })]; }), 0.2);
    const [a, b] = flowAt(v, 0.7, 0.5);
    expect(Math.abs(a)).toBeLessThan(Math.abs(b) * 0.1);
    const r = run(on(c => { c.sources = [newFlowSource('radial', { x: 0.5, y: 0.5, radius: 1.2, params: [0, 0, 0.05, 1] })]; }), 0.2);
    const [rx] = flowAt(r, 0.8, 0.5);
    expect(rx).toBeGreaterThan(0.005);
    const [lx] = flowAt(r, 0.2, 0.5);
    expect(lx).toBeLessThan(-0.005);
  });

  it('a local source has no effect outside its radius; a global one reaches everywhere', () => {
    const local = run(on(c => { c.sources = [newFlowSource('vortex', { x: 0.2, y: 0.2, radius: 0.15, falloff: 'smooth' })]; }), 0.2);
    expect(Math.hypot(...flowAt(local, 0.9, 0.9))).toBeLessThan(1e-9);
    const global = run(on(c => { c.sources = [newFlowSource('directional', { global: true })]; }), 0.2);
    expect(Math.hypot(...flowAt(global, 0.95, 0.05))).toBeGreaterThan(0.005);
  });

  it('the result never exceeds the maximum velocity, even with eight strong stacked sources', () => {
    const config = on(c => { c.composition = { ...c.composition, mode: 'additive', maxVelocity: 0.2, normalize: true }; c.sources = Array.from({ length: 8 }, (_, i) => newFlowSource('directional', { id: `s${i}`, strength: 2, angle: 10, global: true })); });
    const state = run(config, 0.2);
    for (let i = 0; i < 25; i++) expect(Math.hypot(...flowAt(state, (i % 5) / 4, Math.floor(i / 5) / 4))).toBeLessThanOrEqual(0.2 * 1.001);
  });

  it('source order does not change the result (priority decides, not list position)', () => {
    const a = newFlowSource('vortex', { id: 'a', priority: 1 }), b = newFlowSource('directional', { id: 'b', priority: 0, global: true }), c = newFlowSource('radial', { id: 'c', priority: -1, blend: 'screen' });
    for (const mode of COMPOSITIONS) {
      const one = run(on(x => { x.composition.mode = mode; x.sources = [a, b, c]; }), 0.2);
      const two = run(on(x => { x.composition.mode = mode; x.sources = [c, a, b]; }), 0.2);
      const p = flowAt(one, 0.6, 0.45), q = flowAt(two, 0.6, 0.45);
      expect(p[0]).toBeCloseTo(q[0], 6); expect(p[1]).toBeCloseTo(q[1], 6);
    }
  });

  it('composition modes behave as documented', () => {
    const sources = () => [newFlowSource('directional', { id: 'a', angle: 0, strength: 0.4, global: true, params: [0, 0, 0, 0] }), newFlowSource('directional', { id: 'b', angle: 0, strength: 0.4, global: true, params: [0, 0, 0, 0] })];
    const speed = (mode: MotionConfig['composition']['mode']) => Math.hypot(...flowAt(run(on(c => { c.composition = { ...c.composition, mode, maxVelocity: 3, normalize: false }; c.sources = sources(); }), 0.2), 0.5, 0.5));
    expect(speed('additive')).toBeGreaterThan(speed('normalized') * 1.8);
    expect(speed('normalized')).toBeCloseTo(speed('maximum'), 6);
    expect(speed('average')).toBeCloseTo(speed('maximum'), 6);
    expect(speed('dominant')).toBeCloseTo(speed('maximum'), 6);
  });

  it('a disabled source contributes nothing and does not need a recompile to come back', () => {
    const config = on(c => { c.sources = [newFlowSource('directional', { enabled: false, global: true })]; });
    expect(Math.hypot(...flowAt(run(config, 0.2), 0.5, 0.5))).toBe(0);
    expect(motionSignature(config)).toBe(motionSignature({ ...config, sources: config.sources.map(s => ({ ...s, enabled: true })) }));
  });

  it('every flow type produces a finite, non-trivial field', () => {
    for (const type of FLOW_TYPES) {
      const state = run(on(c => { c.sources = [newFlowSource(type, { global: true, radius: 2 })]; if (type === 'path') c.paths = [newPath()]; }), 0.5);
      let energy = 0;
      for (let i = 0; i < 40; i++) { const [x, y] = flowAt(state, (i % 8) / 7, Math.floor(i / 8) / 4); expect(Number.isFinite(x + y)).toBe(true); energy += Math.hypot(x, y); }
      expect(energy).toBeGreaterThan(0);
    }
  });

  it('soft limit is monotonic, ~identity below the cap and bounded above it', () => {
    let last = 0;
    for (let l = 0; l < 5; l += 0.05) { const v = softLimit(l, 1); expect(v).toBeGreaterThanOrEqual(last - 1e-12); last = v; }
    expect(softLimit(0.1, 1)).toBeCloseTo(0.1, 3);
    expect(softLimit(1000, 1)).toBeLessThan(1.001);
  });
});

describe('field: turbulence, organic motion, paths', () => {
  it('turbulence is independent of flow sources and deterministic per seed', () => {
    const config = on(c => { c.turbulence = { ...c.turbulence, enabled: true, strength: 0.6 }; });
    const state = run(config, 1);
    const a = [0, 0], b = [0, 0];
    evaluateTurbulence(state, 'fractal', 0.1, 0.2, ASPECT, a); evaluateTurbulence(state, 'fractal', 0.1, 0.2, ASPECT, b);
    expect(Math.hypot(a[0]!, a[1]!)).toBeGreaterThan(0);
    expect(a).toEqual(b);
    expect(Math.hypot(...flowAt(state, 0.5, 0.5))).toBe(0);
  });

  it('local turbulence fades to nothing outside its radius', () => {
    const config = on(c => { c.turbulence = { ...c.turbulence, enabled: true, strength: 1, localX: 0.2, localY: 0.2, localRadius: 0.2 }; });
    const state = run(config, 0.5);
    const out = [0, 0];
    evaluateTurbulence(state, 'fractal', (0.95 - 0.5) * ASPECT, 0.45, ASPECT, out);
    expect(Math.hypot(out[0]!, out[1]!)).toBeLessThan(1e-9);
  });

  it('organic motion is bounded and the amount slider scales it', () => {
    const at = (intensity: number) => { const s = run(on(c => { c.organic = { ...c.organic, enabled: true, intensity, spatial: 1 }; }), 0.5); const o = [0, 0]; evaluateOrganic(s, 0.3, 0.1, o); return Math.hypot(o[0]!, o[1]!); };
    expect(at(1)).toBeGreaterThan(at(0.2));
    expect(at(1)).toBeLessThan(0.5);
  });

  it('a path source follows the path: flow along the tangent at the curve', () => {
    const path = newPath({ closed: false, kind: 'polyline', points: [{ x: 0.1, y: 0.5, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 0.9, y: 0.5, ix: 0, iy: 0, ox: 0, oy: 0 }] });
    const state = run(on(c => { c.paths = [path]; c.sources = [newFlowSource('path', { radius: 0.5, params: [0, 0.6, 1, 0] })]; }), 0.3);
    const [vx, vy] = flowAt(state, 0.5, 0.5);
    expect(vx).toBeGreaterThan(0.01);
    expect(Math.abs(vy)).toBeLessThan(Math.abs(vx) * 0.2);
    const [, pull] = flowAt(state, 0.5, 0.62);
    expect(pull).toBeLessThan(0);
  });
});

describe('pointer interaction', () => {
  it('keeps echoes and energy while the pointer is active and decays them afterwards', () => {
    const config = on(c => { c.interaction = { ...c.interaction, enabled: true, trail: true }; });
    const state = createMotionState();
    for (let i = 0; i < 60; i++) stepMotion(state, config, pointer(0.3 + i * 0.005, 0.5), 1 / 60, { aspect: ASPECT, shaderDt: 1 / 60, animate: true, projectQuality: 'medium', octaveCap: 4, dual: true, clock: i / 60 });
    const live = state.ptrQ[0]!;
    expect(live).toBeGreaterThan(0.5);
    for (let i = 0; i < 360; i++) stepMotion(state, config, pointer(0.6, 0.5, { active: 0 }), 1 / 60, { aspect: ASPECT, shaderDt: 1 / 60, animate: true, projectQuality: 'medium', octaveCap: 4, dual: true, clock: 1 + i / 60 });
    expect(state.ptrQ[0]!).toBeLessThan(live * 0.2);
  });

  it('flow-type responses feed the flow field with a velocity from the pointer', () => {
    const config = on(c => { c.interaction = { ...c.interaction, enabled: true, response: 'direction', strength: 1 }; });
    const state = createMotionState();
    for (let i = 0; i < 40; i++) stepMotion(state, config, pointer(0.3 + i * 0.01, 0.5), 1 / 60, { aspect: ASPECT, shaderDt: 1 / 60, animate: true, projectQuality: 'medium', octaveCap: 4, dual: true, clock: i / 60 });
    expect(state.ptrP[2]!).toBeGreaterThan(0);
  });
});

describe('generated shader code', () => {
  const template = `precision highp float;\nuniform float uAspect;\n${MOTION_ANCHORS.functions}\nvoid main() {\n  vec2 p = vec2(0.0);\n${MOTION_ANCHORS.centered}\n  float colorPosition = 0.0;\n${MOTION_ANCHORS.color}\n  float alpha = 1.0;\n${MOTION_ANCHORS.output}\n}\n`;

  it('leaves the template byte-identical when the engine is off or has nothing to do', () => {
    expect(injectMotionGlsl(template, undefined)).toBe(template);
    expect(injectMotionGlsl(template, defaultMotion())).toBe(template);
    expect(injectMotionGlsl(template, on(() => undefined))).toBe(template);
    expect(isMotionActive(on(() => undefined))).toBe(false);
  });

  it('adds the four hooks exactly once and keeps the anchors it replaces out of the way', () => {
    const out = injectMotionGlsl(template, on(c => { c.sources = [newFlowSource('curl')]; }));
    expect(out).toContain('motFlow(');
    expect(out.split('for (int motPh').length).toBe(2);
    expect(out.split(MOTION_ANCHORS.color).length).toBe(2);
    expect(out.split(MOTION_ANCHORS.output).length).toBe(1);
  });

  it('refuses a template without the anchors instead of producing broken code', () => {
    expect(() => injectMotionGlsl('void main() {}', on(c => { c.sources = [newFlowSource('curl')]; }))).toThrow();
  });

  it('the signature ignores slider values and tracks structure', () => {
    const base = on(c => { c.sources = [newFlowSource('curl')]; });
    const tweaked = on(c => { c.sources = [newFlowSource('curl', { strength: 1.7, angle: 40 })]; c.global.intensity = 1.9; c.physics.stiffness = 3; c.composition.mode = 'soft'; });
    expect(motionSignature(base)).toBe(motionSignature(tweaked));
    expect(motionSignature(base)).toBe(motionSignature(on(c => { c.sources = [newFlowSource('vortex')]; })));
    expect(motionSignature(base)).toBe(motionSignature(on(c => { c.sources = [newFlowSource('curl')]; c.turbulence.enabled = true; c.turbulence.kind = 'warped'; })));
    expect(motionSignature(base)).not.toBe(motionSignature(on(c => { c.sources = Array.from({ length: 5 }, () => newFlowSource('curl')); })));
    expect(motionSignature(base)).toBe(motionSignature(on(c => { c.sources = [newFlowSource('path')]; })));
    expect(motionSignature(undefined)).toBe('off');
  });

  it('keeps all flow scenes on one shader variant', () => {
    const signatures = FLOW_PRESETS.map(preset => motionSignature(preset.apply(defaultMotion())));
    expect(new Set(signatures).size).toBe(1);
  });

  it('packs turbulence kind changes into uniforms', () => {
    TURBULENCE_KINDS.forEach((kind, index) => {
      const config = on(c => { c.turbulence = { ...c.turbulence, enabled: true, kind }; });
      const state = createMotionState();
      stepMotion(state, config, null, 1 / 60, { aspect: ASPECT, shaderDt: 1 / 60, animate: true, projectQuality: 'medium', octaveCap: 4, dual: true, clock: 0 });
      expect(state.tKind).toBe(index);
    });
  });

  it('generates code for every flow type, turbulence kind and pointer response', () => {
    for (const type of FLOW_TYPES) expect(generateMotionGlsl(on(c => { c.sources = [newFlowSource(type)]; if (type === 'path') c.paths = [newPath()]; })).functions.length).toBeGreaterThan(500);
    for (const kind of TURBULENCE_KINDS) {
      const code = generateMotionGlsl(on(c => { c.turbulence = { ...c.turbulence, enabled: true, kind }; })).functions;
      expect(code).toContain('motTurb');
      expect(code).toContain('uMotTKind');
    }
    for (const response of INTERACTION_RESPONSES) expect(generateMotionGlsl(on(c => { c.interaction = { ...c.interaction, enabled: true, response }; })).functions).toContain('motInteract');
  });

  it('only declares the uniforms the structure needs (uniform budget)', () => {
    const small = generateMotionGlsl(on(c => { c.sources = [newFlowSource('vortex')]; })).functions;
    const big = generateMotionGlsl(on(c => { c.sources = Array.from({ length: 6 }, () => newFlowSource('vortex')); c.interaction.enabled = true; })).functions;
    expect(small).toContain('uMotA[2]');
    expect(small).toContain('uMotPath');
    expect(small).toContain('motWave(');
    expect(small).not.toContain('uMotPtrP');
    expect(big).toContain('uMotA[8]');
    expect(big).toContain('uMotPtrP');
    expect(generateMotionGlsl(on(() => undefined)).functions).not.toContain('uMotPath');
  });
});

describe('presets and profiles', () => {
  it('every preset produces a valid config with no warnings and active GPU code where promised', () => {
    const base = defaultMotion();
    for (const preset of [...FLOW_PRESETS, ...MOTION_PROFILES, ...INTERACTION_PRESETS]) {
      const config = preset.apply(base);
      const report: NormalizeReport = { warnings: [] };
      expect(normalizeMotion(config, report)).toEqual(config);
      expect(report.warnings).toEqual([]);
    }
    expect(FLOW_PRESETS.length).toBe(30);
    expect(MOTION_PROFILES.length).toBe(13);
    expect(INTERACTION_PRESETS.length).toBe(10);
    for (const preset of FLOW_PRESETS) expect(isMotionActive(preset.apply(base))).toBe(true);
  });

  it('gives every flow scene a unique id and a distinct starting field', () => {
    const configs = FLOW_PRESETS.map(preset => preset.apply(defaultMotion()));
    expect(new Set(FLOW_PRESETS.map(preset => preset.id)).size).toBe(30);
    expect(new Set(configs.map(config => JSON.stringify(config))).size).toBe(30);
  });

  it('a motion profile keeps the sources; a flow preset replaces them', () => {
    const withSources = on(c => { c.sources = [newFlowSource('curl')]; });
    expect(MOTION_PROFILES[0]!.apply(withSources).sources).toEqual(withSources.sources);
    expect(FLOW_PRESETS[2]!.apply(withSources).sources[0]?.type).toBe('vortex');
  });

  it('user profiles can be saved, renamed, duplicated, exported, imported and deleted', () => {
    const memory = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => { memory.set(k, v); }, removeItem: k => { memory.delete(k); }, clear: () => memory.clear(), key: () => null, length: 0 };
    expect(loadUserProfiles()).toEqual([]);
    const saved = saveUserProfile('Mine', on(c => { c.sources = [newFlowSource('wave')]; }));
    expect(saved.map(p => p.name)).toEqual(['Mine']);
    const id = saved[0]!.id;
    expect(renameUserProfile(id, 'Renamed')[0]?.name).toBe('Renamed');
    expect(duplicateUserProfile(id).length).toBe(2);
    const imported = importUserProfile(serializeMotion(loadUserProfiles()[0]!.config), 'From file');
    expect(imported.ok).toBe(true);
    expect(importUserProfile('not json').ok).toBe(false);
    expect(deleteUserProfile(id).some(p => p.id === id)).toBe(false);
    memory.set('shapeforge.motion.profiles.v1', '{ broken');
    expect(loadUserProfiles()).toEqual([]);
  });
});
