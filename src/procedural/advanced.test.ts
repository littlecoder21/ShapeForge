import { describe, expect, it } from 'vitest';
import { generateProceduralGlsl } from './glsl';
import { ADVANCED_PROCEDURAL_PRESETS } from './presetsAdvanced';
import { ALL_PROCEDURAL_PRESETS } from './presetsMore';
import { applyPreset, parsePresetFile, serializePresetFile } from './presets';
import {
  cubicBezierEase, createProceduralState, easeValue, evaluateRbf, forceDisplacement, generatePoints, hueDelta, motionPosition,
  rbfKernelParameter, rbfRegularization, solveRbf, springStep,
} from './proceduralRuntime';
import {
  DEFAULT_PROCEDURAL, FIELD_METHODS, FORCE_TYPES, MOTION_EASINGS, MOTION_TYPES, PROCEDURAL_VERSION, PROC_MAX_FIELDS, activeFieldLayers,
  estimateProceduralCost, fieldFamily, newProcedural, normalizeProcedural, parseProceduralDetailed, planPointCapacity, proceduralNeed,
  proceduralSignature, proceduralVectorsPerPoint, serializeProcedural, validateProcedural,
  type ProceduralConfig,
} from './types';

const cfg = (patch: Record<string, unknown> = {}): ProceduralConfig => newProcedural({ enabled: true, ...patch });
const PLAY = { x: 0.5, y: 0.5, vx: 0, vy: 0, active: 0, down: 0, t2x: 0.5, t2y: 0.5, t2active: 0 };

describe('schema, defaults, migration and safe loading', () => {
  it('writes the current version and keeps the default look signature unchanged', () => {
    expect(PROCEDURAL_VERSION).toBe(2);
    expect(newProcedural().version).toBe(2);
    expect(proceduralSignature(cfg())).toBe('on:warp,none,none');
    expect(proceduralVectorsPerPoint(cfg())).toBe(2);
  });
  it('treats a version-1 file as a valid version-2 file: every addition takes its default', () => {
    const v1 = { version: 1, enabled: true, seed: 42, field: { method: 'soft', radius: 1.2 }, motion: { type: 'wander', speed: 1 }, color: { interpolation: 'oklab' } };
    const result = validateProcedural(v1);
    expect(result.migratedFrom).toBe(1);
    expect(result.config.version).toBe(2);
    expect(result.config.field.method).toBe('soft');
    expect(result.config.field.global).toBe(0);
    expect(result.config.influence).toEqual(DEFAULT_PROCEDURAL.influence);
    expect(result.config.fields).toEqual([]);
    expect(result.config.material.enabled).toBe(false);
    expect(result.config.motion.easing).toBe('smooth');
    expect(result.config.interaction.affect.position).toBe(1);
    expect(result.issues.some(issue => issue.severity === 'info' && issue.path === 'version')).toBe(true);
    expect(result.issues.filter(issue => issue.severity !== 'info')).toHaveLength(0);
  });
  it('reports unknown options, repaired values and a newer version without throwing', () => {
    const result = validateProcedural({ version: 9, mystery: 1, field: { method: 'nope', radius: 99, sparkle: true }, fields: [{ blend: 'huh' }], motion: { easing: 'wobbly' } });
    const paths = result.issues.map(issue => issue.path);
    expect(paths).toContain('version');
    expect(paths).toContain('mystery');
    expect(paths).toContain('field.sparkle');
    expect(paths).toContain('field.method');
    expect(paths).toContain('field.radius');
    expect(paths).toContain('fields[0].blend');
    expect(paths).toContain('motion.easing');
    expect(result.config.field.method).toBe(DEFAULT_PROCEDURAL.field.method);
    expect(result.config.field.radius).toBe(3);
    expect(result.config.fields[0].blend).toBe('screen');
  });
  it('reports non-objects and broken JSON as errors and still returns a usable config', () => {
    expect(validateProcedural(7).issues[0].severity).toBe('error');
    expect(validateProcedural([1, 2]).config.version).toBe(2);
    const broken = parseProceduralDetailed('{ nope');
    expect(broken.issues[0].severity).toBe('error');
    expect(broken.issues[0].message).toMatch(/JSON/);
    expect(broken.config.version).toBe(2);
  });
  it('round-trips every new setting through JSON', () => {
    const rich = cfg({
      field: { method: 'rbf-multiquadric', global: 0.4, custom: { gaussian: 0.2, compact: 0.5, inverse: 0.3 } },
      influence: { shape: 'polygon', sides: 5, rounding: 0.5, anisotropy: 1.6, inner: 0.3, core: 0.7 },
      color: { interpolation: 'oklch', hueDirection: 'longer', chromaPreserve: 0.6 },
      fields: [{ kernel: 'wendland-c2', blend: 'soft-light', opacity: 0.5, count: 3 }, { blend: 'weighted', colors: ['#112233', '#ffeedd'] }],
      material: { enabled: true, glow: 0.5, light: 1, specular: 0.8 },
      distortion: [{ type: 'curl', target: 'points' }, { type: 'wave', target: 'color' }, { type: 'fbm', target: 'field' }],
      motion: { type: 'spring', easing: 'custom', curve: [0.1, 0.2, 0.3, 1.2], damping: 0.9, loop: 12, delay: 2, sync: 0.4, groups: 3 },
      interaction: { force: 'magnetic', direction: 45, velocity: 1, pressure: 1.2, persistence: 0.5, affect: { position: 0.5, radius: 1, strength: 0.4, saturation: 0.7, hue: 0.2, speed: 0.3 } },
    });
    const again = normalizeProcedural(JSON.parse(serializeProcedural(rich)));
    expect(again).toEqual(rich);
    expect(serializeProcedural(again)).toBe(serializeProcedural(rich));
  });
  it('is idempotent and bounded for hostile input', () => {
    const hostile = normalizeProcedural({
      fields: Array.from({ length: 20 }, () => ({ count: 99, colors: ['x', 7] })), motion: { groups: 99, loop: -5, curve: ['a', 9, null] },
      interaction: { affect: { radius: 50 }, pressure: -3 }, influence: { sides: 100 },
    });
    expect(hostile.fields).toHaveLength(PROC_MAX_FIELDS);
    expect(hostile.fields[0].count).toBe(4);
    expect(hostile.fields[0].colors).toEqual(['#ffd9a0']);
    expect(hostile.motion.groups).toBe(6);
    expect(hostile.motion.loop).toBe(0);
    expect(hostile.motion.curve.every(Number.isFinite)).toBe(true);
    expect(hostile.interaction.affect.radius).toBe(1);
    expect(hostile.interaction.pressure).toBe(0);
    expect(hostile.influence.sides).toBe(8);
    expect(normalizeProcedural(hostile)).toEqual(hostile);
  });
});

describe('compile-time vs uniform: the signature', () => {
  it('only compiles what the config uses, and sliders never change it', () => {
    const base = proceduralSignature(cfg());
    expect(proceduralSignature(cfg({ field: { radius: 2, falloff: 0.9, softness: 0.1 } }))).toBe(base);
    expect(proceduralSignature(cfg({ motion: { speed: 2, type: 'spring', groups: 3 } }))).toBe(base);
    expect(proceduralSignature(cfg({ interaction: { force: 'magnetic', affect: { radius: 1 } } }))).toBe(base);
    expect(proceduralSignature(cfg({ field: { method: 'smooth-voronoi' } }))).toContain('msmooth-voronoi');
    expect(proceduralSignature(cfg({ influence: { shape: 'ellipse' } }))).toContain('shape');
    expect(proceduralSignature(cfg({ influence: { inner: 0.2 } }))).toContain('shape');
    expect(proceduralSignature(cfg({ color: { interpolation: 'oklch' } }))).toContain('lch');
    expect(proceduralSignature(cfg({ color: { interpolation: 'oklab', chromaPreserve: 0.5 } }))).toContain('cp');
    expect(proceduralSignature(cfg({ color: { interpolation: 'oklab', chromaPreserve: 0 } }))).not.toContain('cp');
    expect(proceduralSignature(cfg({ fields: [{}, {}] }))).toContain('fx2');
    expect(proceduralSignature(cfg({ fields: [{ enabled: false }] }))).toBe(base);
    expect(proceduralSignature(cfg({ material: { enabled: true, glow: 0.4 } }))).toContain('mat');
    expect(proceduralSignature(cfg({ material: { enabled: true } }))).toBe(base);
    expect(proceduralSignature(cfg({ material: { enabled: false, glow: 1 } }))).toBe(base);
    expect(proceduralSignature(cfg({ distortion: [{ type: 'warp', target: 'points' }, { type: 'none' }, { type: 'none' }] }))).toBe('on:warp@p,none,none');
    expect(proceduralSignature(cfg({ distortion: [{ type: 'warp', target: 'layer' }, { type: 'none' }, { type: 'none' }] }))).toBe(base);
  });
  it('rbf methods ignore the OKLCH hue path and the shaped-reach code (they interpolate numbers)', () => {
    const sig = proceduralSignature(cfg({ field: { method: 'thin-plate' }, color: { interpolation: 'oklch' }, influence: { shape: 'ellipse' } }));
    expect(sig).toContain('mthin-plate');
    expect(sig).not.toContain('lch');
    expect(sig).not.toContain('shape');
  });
  it('a CSS-compatible mesh uses none of the optional blocks', () => {
    const css = cfg({ mesh: { render: 'css-compatible' }, field: { method: 'rbf-gaussian' }, fields: [{}], material: { enabled: true, glow: 1 }, influence: { shape: 'ellipse' } });
    expect(proceduralSignature(css)).toBe(proceduralSignature(cfg({ mesh: { render: 'css-compatible' } })));
    expect(activeFieldLayers(css)).toHaveLength(0);
  });
});

describe('point budget', () => {
  it('counts the extra fields’ centres', () => {
    const base = proceduralNeed(cfg({ points: { min: 6, max: 6 } }));
    expect(proceduralNeed(cfg({ points: { min: 6, max: 6 }, fields: [{ count: 3 }, { count: 2 }] }))).toBe(base + 5);
    expect(proceduralNeed(cfg({ points: { min: 6, max: 6 }, fields: [{ count: 3, enabled: false }] }))).toBe(base);
  });
  it('plans capacity with the vec4s each centre really costs', () => {
    expect(planPointCapacity(100, 1024, 2).overflow).toBe(false);
    expect(proceduralVectorsPerPoint(cfg({ field: { method: 'rbf-gaussian' } }))).toBe(3);
    expect(proceduralVectorsPerPoint(cfg({ influence: { shape: 'ellipse' } }))).toBe(3);
    const tight = planPointCapacity(100, 350, 4);
    expect(tight.overflow).toBe(true);
    expect(tight.message).toMatch(/with these settings/);
    expect(planPointCapacity(100, 350, 2).supported).toBeGreaterThan(tight.supported);
  });
});

describe('hue routing (OKLCH)', () => {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  it('increasing and decreasing hue always travel in their own direction', () => {
    expect(hueDelta(rad(350), rad(10), 2)).toBeCloseTo(rad(340), 9);
    expect(hueDelta(rad(10), rad(350), 2)).toBeCloseTo(rad(20), 9);
    expect(hueDelta(rad(350), rad(10), 3)).toBeCloseTo(rad(-20), 9);
    expect(hueDelta(rad(10), rad(350), 3)).toBeCloseTo(rad(-340), 9);
    for (const direction of [2, 3]) expect(hueDelta(rad(77), rad(77), direction)).toBeCloseTo(0, 9);
  });
  it('the longer arc is the complement of the shorter one', () => {
    for (const [h, ref] of [[20, 100], [300, 40], [180, 10]]) {
      const longer = hueDelta(rad(h), rad(ref), 1);
      const short = ((rad(h) - rad(ref) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      expect(Math.abs(Math.abs(longer) - (2 * Math.PI - Math.abs(short)))).toBeLessThan(1e-9);
    }
  });
});

describe('exact RBF interpolation', () => {
  const px = [0.1, 0.5, 0.9, 0.3, 0.7, 0.55];
  const py = [0.2, 0.8, 0.3, 0.5, 0.45, 0.15];
  const colors = new Float32Array(px.length * 4);
  px.forEach((_, i) => { colors[i * 4] = (i * 0.37) % 1; colors[i * 4 + 1] = (i * 0.61 + 0.1) % 1; colors[i * 4 + 2] = (i * 0.83 + 0.2) % 1; });
  for (const method of ['rbf-gaussian', 'rbf-multiquadric', 'thin-plate', 'harmonic']) {
    it(`${method} passes through every point (the fit is exact with no smoothing)`, () => {
      const coef = new Float32Array(px.length * 4);
      const poly = new Float32Array(12);
      const k = rbfKernelParameter(method, 0.45);
      const ok = solveRbf(px, py, colors, { method, scale: 0.4, k, lambda: 1e-9 }, coef, poly);
      expect(ok).toBe(true);
      px.forEach((x, i) => {
        const [r, g, b] = evaluateRbf(method, px, py, coef, poly, 0.4, k, x, py[i]);
        expect(Math.abs(r - colors[i * 4])).toBeLessThan(2e-3);
        expect(Math.abs(g - colors[i * 4 + 1])).toBeLessThan(2e-3);
        expect(Math.abs(b - colors[i * 4 + 2])).toBeLessThan(2e-3);
      });
    });
  }
  it('smoothing trades exactness for a calmer surface', () => {
    const coef = new Float32Array(px.length * 4);
    const poly = new Float32Array(12);
    const k = rbfKernelParameter('rbf-gaussian', 0.45);
    solveRbf(px, py, colors, { method: 'rbf-gaussian', scale: 0.4, k, lambda: rbfRegularization(1) }, coef, poly);
    let worst = 0;
    px.forEach((x, i) => { worst = Math.max(worst, Math.abs(evaluateRbf('rbf-gaussian', px, py, coef, poly, 0.4, k, x, py[i])[0] - colors[i * 4])); });
    expect(worst).toBeGreaterThan(0.01);
    expect(rbfRegularization(0)).toBeLessThan(rbfRegularization(1));
  });
  it('handles one point and duplicate points without NaN', () => {
    const coef = new Float32Array(8);
    const poly = new Float32Array(12);
    solveRbf([0.5], [0.5], new Float32Array([0.2, 0.4, 0.6, 1]), { method: 'thin-plate', scale: 0.4, k: 0, lambda: 1e-6 }, coef, poly);
    expect(Array.from(coef).every(Number.isFinite) && Array.from(poly).every(Number.isFinite)).toBe(true);
    const two = new Float32Array(8);
    solveRbf([0.4, 0.4], [0.4, 0.4], new Float32Array([0, 0, 0, 1, 1, 1, 1, 1]), { method: 'rbf-gaussian', scale: 0.4, k: 1, lambda: 2e-4 }, two, poly);
    expect(Array.from(two).every(Number.isFinite)).toBe(true);
  });
  it('the animated state keeps the solved buffers finite and inside the palette range', () => {
    const state = createProceduralState(cfg({ field: { method: 'rbf-multiquadric' }, motion: { type: 'drift', speed: 1 } }));
    for (let i = 0; i < 90; i++) state.step(1 / 60, PLAY, 1.6, 1);
    expect(Array.from(state.buffers.rbf).every(Number.isFinite)).toBe(true);
    for (let c = 0; c < 3; c++) expect(state.buffers.rbfR[c]).toBeLessThan(state.buffers.rbfR[4 + c]);
  });
});

describe('generated shaders', () => {
  it('every interpolation method generates a self-contained, constant-bounded shader with only its own code', () => {
    for (const method of FIELD_METHODS) {
      const out = generateProceduralGlsl(cfg({ field: { method } }));
      const text = out.functions;
      const loops = [...text.matchAll(/for \(int i = 0; i < (\w+); i\+\+\)/g)].map(match => match[1]);
      expect(loops.length).toBeGreaterThan(0);
      for (const bound of loops) expect(/^\d+$/.test(bound)).toBe(true);
      expect(text).not.toMatch(/\bwhile\b/);
      expect(text).toContain('vec4 procSample(vec2 uv)');
      expect(out.signature).toBeTruthy();
      expect(proceduralSignature(cfg({ field: { method } }))).toContain(method === 'gaussian' ? 'on:' : `m${method}`);
    }
    expect(fieldFamily('thin-plate')).toBe('rbf');
    expect(fieldFamily('smooth-voronoi')).toBe('cells');
    expect(fieldFamily('custom-weighted')).toBe('kernel');
    const plain = generateProceduralGlsl(cfg()).functions;
    for (const absent of ['procReach', 'procLchResolve', 'procChromaResolve', 'procMaterial', 'procLayerBlend', 'procWendland', 'uProcRbf']) {
      expect(plain.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain(absent);
    }
  });
  it('the optional blocks appear exactly when their feature is on', () => {
    const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(strip(generateProceduralGlsl(cfg({ influence: { shape: 'diamond' } })).functions)).toContain('float procReach(');
    expect(strip(generateProceduralGlsl(cfg({ color: { interpolation: 'oklch' } })).functions)).toContain('procLchResolve');
    expect(strip(generateProceduralGlsl(cfg({ color: { interpolation: 'oklab', chromaPreserve: 1 } })).functions)).toContain('procChromaResolve');
    const layered = strip(generateProceduralGlsl(cfg({ fields: [{ blend: 'overlay' }] })).functions);
    expect(layered).toContain('procLayerBlend');
    expect(layered).toContain('procKernelRt');
    expect(strip(generateProceduralGlsl(cfg({ material: { enabled: true, light: 1 } })).functions)).toContain('procMaterial');
    expect(strip(generateProceduralGlsl(cfg({ field: { method: 'custom-weighted' } })).functions)).toContain('procCustomKernel');
  });
  it('distortion targets put each stage’s code only in the chain of its own target', () => {
    const chain = (text: string, name: string) => (text.match(new RegExp(`vec2 ${name}\\(vec2 sIn, float t\\) \\{[\\s\\S]*?\\n\\}`)) ?? [''])[0];
    const stages = (type: string, target: string) => generateProceduralGlsl(cfg({ distortion: [{ type, target }, { type: 'none' }, { type: 'none' }] })).functions;
    const points = stages('curl', 'points');
    expect(chain(points, 'procDistortPoints')).toContain('procStage_curl');
    expect(chain(points, 'procDistort')).not.toContain('procStage_');
    expect(chain(points, 'procDistortField')).not.toContain('procStage_');
    expect(points).toContain('procMovePoint(uProcPoints[i].xy)');
    const color = stages('wave', 'color');
    expect(chain(color, 'procDistortColor')).toContain('procStage_wave');
    expect(chain(color, 'procDistortPoints')).not.toContain('procStage_');
    expect(color).not.toContain('procMovePoint(uProcPoints[i].xy)');
    const field = stages('warp', 'field');
    expect(chain(field, 'procDistortField')).toContain('procStage_warp');
    const layer = generateProceduralGlsl(cfg()).functions;
    expect(chain(layer, 'procDistort')).toContain('procStage_warp');
    expect(layer).not.toContain('procMovePoint(uProcPoints[i].xy)');
  });
});

describe('animation', () => {
  const point = (patch: Record<string, unknown> = {}) => generatePoints(cfg({ motion: { randomness: 0, ...patch } }), null)[0];
  const motion = (patch: Record<string, unknown> = {}) => ({ ...cfg().motion, ...patch });
  const near = (a: number[], b: number[], tolerance = 1e-9) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < tolerance;

  it('easing curves start at 0, end at 1 and `smooth` is the original smoothstep', () => {
    for (const easing of MOTION_EASINGS) {
      const m = { easing, curve: [0.3, 0.1, 0.2, 1] as [number, number, number, number] };
      expect(easeValue(m, 'wander', 0)).toBeCloseTo(0, 9);
      expect(easeValue(m, 'wander', 1)).toBeCloseTo(1, 9);
      for (let f = 0.05; f < 1; f += 0.1) expect(Number.isFinite(easeValue(m, 'wander', f))).toBe(true);
    }
    for (const f of [0.1, 0.35, 0.5, 0.8]) expect(easeValue({ easing: 'smooth' }, 'wander', f)).toBeCloseTo(f * f * (3 - 2 * f), 12);
    expect(easeValue({ easing: 'smooth' }, 'elastic', 0.5)).not.toBeCloseTo(0.5, 3);
    expect(easeValue({ easing: 'linear' }, 'elastic', 0.25)).toBeCloseTo(0.25, 12);
    expect(easeValue({ easing: 'ease-in' }, 'wander', 0.3)).toBeLessThan(0.3);
    expect(easeValue({ easing: 'ease-out' }, 'wander', 0.3)).toBeGreaterThan(0.3);
    expect(easeValue({ easing: 'elastic' }, 'wander', 0.15)).toBeGreaterThan(1);
  });
  it('a cubic-bezier with collinear control points is linear, and is monotone for a normal curve', () => {
    for (const f of [0.1, 0.4, 0.77]) expect(cubicBezierEase(1 / 3, 1 / 3, 2 / 3, 2 / 3, f)).toBeCloseTo(f, 4);
    let last = 0;
    for (let f = 0; f <= 1.0001; f += 0.05) { const v = cubicBezierEase(0.42, 0, 0.58, 1, Math.min(f, 1)); expect(v).toBeGreaterThanOrEqual(last - 1e-9); last = v; }
    expect(cubicBezierEase(0.1, 1.6, 0.3, 1, 0.5)).toBeGreaterThan(1);
  });
  it('the spring lands exactly on the target, is continuous, and damping controls the overshoot', () => {
    expect(springStep(0, 0.5)).toBe(0);
    expect(springStep(1, 0.5)).toBe(1);
    for (const damping of [0, 0.5, 1]) {
      let worstJump = 0, previous = 0;
      for (let f = 0.001; f <= 1; f += 0.001) { const v = springStep(f, damping); worstJump = Math.max(worstJump, Math.abs(v - previous)); previous = v; }
      expect(worstJump).toBeLessThan(0.08);
    }
    const peak = (damping: number) => { let best = 0; for (let f = 0; f <= 1; f += 0.005) best = Math.max(best, springStep(f, damping)); return best; };
    expect(peak(0)).toBeGreaterThan(1.1);
    expect(peak(1)).toBeLessThan(peak(0));
    expect(peak(1)).toBeLessThan(1.06);
  });
  it('loop repeats exactly after `loop` seconds for time-pure motions, with no jump at the seam', () => {
    for (const type of ['orbit', 'circle', 'figure8', 'sine', 'drift', 'noise', 'wander', 'spring', 'elastic', 'float', 'magnetic']) {
      const p = point({ type, speed: 1, amplitude: 0.2 });
      const m = motion({ type, speed: 1, loop: 8 });
      expect(near(motionPosition(p, 0, m), motionPosition(p, 8, m), 1e-9)).toBe(true);
      expect(near(motionPosition(p, 3.3, m), motionPosition(p, 11.3, m), 1e-9)).toBe(true);
      const before = motionPosition(p, 8 - 1e-4, m);
      const after = motionPosition(p, 8 + 1e-4, m);
      expect(Math.abs(before[0] - after[0]) + Math.abs(before[1] - after[1])).toBeLessThan(2e-3);
    }
    const free = point({ type: 'sine', speed: 1, amplitude: 0.2 });
    expect(near(motionPosition(free, 0, motion({ type: 'sine', loop: 0 })), motionPosition(free, 8, motion({ type: 'sine', loop: 0 })), 1e-6)).toBe(false);
  });
  it('every new motion type moves, stays bounded, and `influence: 0` pins the point home', () => {
    for (const type of ['spring', 'elastic', 'float', 'magnetic']) {
      const p = point({ type, speed: 1, amplitude: 0.15 });
      let travelled = 0, lx = p.x, ly = p.y;
      for (let t = 0; t < 60; t += 0.1) {
        const [x, y] = motionPosition(p, t, motion({ type, speed: 1 }));
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(Math.abs(x - p.x)).toBeLessThan(1);
        travelled += Math.abs(x - lx) + Math.abs(y - ly); lx = x; ly = y;
      }
      expect(travelled).toBeGreaterThan(0.05);
      expect(motionPosition(p, 12.3, motion({ type, influence: 0 }))).toEqual([p.x, p.y]);
    }
  });
  it('the default easing leaves wander exactly as it was; another easing changes it', () => {
    const p = point({ type: 'wander', speed: 1, amplitude: 0.2 });
    const smooth = motionPosition(p, 3.7, motion({ type: 'wander', easing: 'smooth' }));
    const linear = motionPosition(p, 3.7, motion({ type: 'wander', easing: 'linear' }));
    expect(near(smooth, linear, 1e-6)).toBe(false);
    expect(near(motionPosition(p, 3.7, motion({ type: 'wander' })), smooth)).toBe(true);
  });
  it('delay holds a point home and eases it in; later points wait longer', () => {
    const c = cfg({ motion: { type: 'circle', speed: 1, amplitude: 0.2, randomness: 0, delay: 4 }, points: { min: 5, max: 5 } });
    const pts = generatePoints(c, null);
    const delays = pts.map(p => p.motion.delay ?? 0);
    expect(delays[0]).toBe(0);
    expect(delays[delays.length - 1]).toBeCloseTo(4, 9);
    expect(delays.every((d, i) => i === 0 || d >= delays[i - 1])).toBe(true);
    const last = pts[pts.length - 1];
    expect(motionPosition(last, 2, c.motion)).toEqual([last.x, last.y]);
    expect(near(motionPosition(last, 8, c.motion), [last.x, last.y], 1e-3)).toBe(false);
    expect(Math.abs(motionPosition(pts[0], 0.5, c.motion)[0] - pts[0].x) + Math.abs(motionPosition(pts[0], 0.5, c.motion)[1] - pts[0].y)).toBeGreaterThan(0);
  });
  it('sync = 1 puts every point in the same phase, speed and amplitude; sync = 0 does not', () => {
    const spread = (sync: number) => {
      const pts = generatePoints(cfg({ motion: { randomness: 1, sync, mixed: false }, points: { min: 6, max: 6 } }), null);
      return { phases: new Set(pts.map(p => p.motion.phase.toFixed(9))).size, speeds: new Set(pts.map(p => p.motion.speed.toFixed(9))).size, amps: new Set(pts.map(p => p.motion.amplitude.toFixed(9))).size };
    };
    expect(spread(1)).toEqual({ phases: 1, speeds: 1, amps: 1 });
    expect(spread(0).phases).toBeGreaterThan(1);
    expect(spread(0).speeds).toBeGreaterThan(1);
  });
  it('groups make points share phase, speed and seed, and different groups differ', () => {
    const pts = generatePoints(cfg({ motion: { randomness: 1, groups: 3 }, points: { min: 9, max: 9 } }), null);
    const key = (p: typeof pts[number]) => `${p.motion.phase}|${p.motion.speed}|${p.motion.seed}`;
    for (let i = 3; i < pts.length; i++) expect(key(pts[i])).toBe(key(pts[i % 3]));
    expect(new Set([key(pts[0]), key(pts[1]), key(pts[2])]).size).toBe(3);
    const staggered = generatePoints(cfg({ motion: { groups: 3, delay: 2 }, points: { min: 9, max: 9 } }), null);
    expect([0, 1, 2].map(i => staggered[i].motion.delay)).toEqual([0, 1, 2]);
  });
  it('groups, sync and delay never change a project that does not use them', () => {
    const plain = generatePoints(cfg({ seed: 99, motion: { randomness: 0.7 } }), null);
    const withZero = generatePoints(cfg({ seed: 99, motion: { randomness: 0.7, groups: 0, sync: 0, delay: 0 } }), null);
    expect(withZero).toEqual(plain);
    expect(plain.every(p => (p.motion.delay ?? 0) === 0)).toBe(true);
  });
  it('is deterministic for every motion type and independent of the frame rate for the closed-form ones', () => {
    for (const type of MOTION_TYPES.filter(item => !['flow', 'follow'].includes(item))) {
      const run = (fps: number) => {
        const state = createProceduralState(cfg({ seed: 5, motion: { type, speed: 1, loop: type === 'float' ? 10 : 0 } }));
        for (let i = 0; i < 2 * fps; i++) state.step(1 / fps, PLAY, 1, 1);
        return state.getPositions().map(p => [...p]);
      };
      const a = run(60), b = run(120);
      a.forEach((p, i) => { expect(p[0]).toBeCloseTo(b[i][0], 3); expect(p[1]).toBeCloseTo(b[i][1], 3); });
      expect(run(60)).toEqual(a);
    }
  });
});

describe('interaction', () => {
  const POINTER = (patch: Record<string, unknown> = {}) => ({ ...PLAY, x: 0.5, y: 0.5, active: 1, ...patch });
  const setup = (interaction: Record<string, unknown>, extra: Record<string, unknown> = {}) => cfg({
    motion: { type: 'static' }, points: { min: 1, max: 1, distribution: 'random', spread: 0.05 }, color: { source: 'custom', colors: ['#3366ff', '#ff3366'] },
    interaction: { radius: 0.8, strength: 1, response: 12, ...interaction }, ...extra,
  });
  const settle = (state: ReturnType<typeof createProceduralState>, frames: number, pointer = POINTER()) => { for (let i = 0; i < frames; i++) state.step(1 / 60, pointer, 1, 1); };

  it('every force is finite, and the new ones have the expected character', () => {
    for (const force of FORCE_TYPES) {
      const [x, y] = forceDisplacement(force, 0.1, 0.05, 0.11, 1, 0.4, -0.2, 3);
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
    const [mx] = forceDisplacement('magnetic', 0.3, 0, 0.3, 1, 0, 0, 0);
    expect(mx).toBeLessThan(0);
    const near = Math.abs(forceDisplacement('magnetic', 0.05, 0, 0.05, 1, 0, 0, 0)[0]);
    const far = Math.abs(forceDisplacement('magnetic', 0.4, 0, 0.4, 1, 0, 0, 0)[0]);
    expect(near).toBeGreaterThan(far);
    expect(forceDisplacement('drag', 0.2, 0, 0.2, 1, 0.5, 0, 0)[0]).toBeGreaterThan(0);
    const d1 = forceDisplacement('disturb', 0.2, 0.1, 0.22, 1, 0, 0, 1);
    const d2 = forceDisplacement('disturb', 0.2, 0.1, 0.22, 1, 0, 0, 2);
    expect(d1[0] === d2[0] && d1[1] === d2[1]).toBe(false);
  });
  it('direction rotates the reaction: an attract rotated by 180° repels', () => {
    const pointer = POINTER({ x: 0.8, y: 0.5 });
    const run = (direction: number) => { const state = createProceduralState(setup({ force: 'attract', direction })); const home = state.getPoints()[0]; settle(state, 120, pointer); return state.getPositions()[0][0] - home.x; };
    expect(run(0)).toBeGreaterThan(0.001);
    expect(run(180)).toBeLessThan(-0.001);
    expect(Math.abs(run(90))).toBeLessThan(Math.abs(run(0)) + 1e-9);
  });
  it('pressure and velocity strengthen the reaction; the default pressure keeps the original response', () => {
    const reach = (interaction: Record<string, unknown>, pointer: Record<string, unknown>) => {
      const state = createProceduralState(setup({ force: 'attract', ...interaction }));
      const home = state.getPoints()[0];
      settle(state, 90, POINTER({ x: 0.7, y: 0.5, ...pointer }));
      return state.getPositions()[0][0] - home.x;
    };
    expect(reach({ pressure: 1.5 }, { down: 1 })).toBeGreaterThan(reach({ pressure: 0 }, { down: 1 }));
    expect(reach({ velocity: 2 }, { vx: 0.8 })).toBeGreaterThan(reach({ velocity: 0 }, { vx: 0.8 }));
    expect(newProcedural().interaction.pressure).toBeCloseTo(0.6, 12);
  });
  it('persistence makes the reaction linger after the pointer leaves', () => {
    const left = (persistence: number) => {
      const state = createProceduralState(setup({ force: 'attract', persistence }));
      const home = state.getPoints()[0];
      settle(state, 90, POINTER({ x: 0.7, y: 0.5 }));
      const grabbed = Math.abs(state.getPositions()[0][0] - home.x);
      settle(state, 20, PLAY);
      return Math.abs(state.getPositions()[0][0] - home.x) / grabbed;
    };
    expect(left(0)).toBeLessThan(0.2);
    expect(left(0.9)).toBeGreaterThan(left(0) + 0.3);
  });
  it('affect drives radius, strength and colour independently, and never moves the saved points', () => {
    const state = createProceduralState(setup({ force: 'attract', affect: { position: 0, radius: 1, strength: 1, saturation: 1, hue: 0 } }));
    const saved = JSON.stringify(state.getPoints());
    settle(state, 1, PLAY);
    const rest = { radius: state.buffers.points[2], weight: state.buffers.points[3], color: Array.from(state.buffers.colors.slice(0, 3)) };
    const home = [state.buffers.points[0], state.buffers.points[1]];
    settle(state, 60, POINTER());
    expect(state.buffers.points[2]).toBeGreaterThan(rest.radius * 1.2);
    expect(state.buffers.points[3]).toBeGreaterThan(rest.weight * 1.3);
    expect(Array.from(state.buffers.colors.slice(0, 3))).not.toEqual(rest.color);
    expect([state.buffers.points[0], state.buffers.points[1]]).toEqual(home);
    expect(JSON.stringify(state.getPoints())).toBe(saved);
    settle(state, 400, PLAY);
    expect(state.buffers.points[2]).toBeCloseTo(rest.radius, 4);
    expect(state.isSettling()).toBe(false);
  });
  it('affect.hue rotates colour and affect.speed speeds up the shared motion clock', () => {
    const hue = createProceduralState(setup({ force: 'attract', affect: { position: 0, hue: 1 } }));
    settle(hue, 1, PLAY);
    const before = Array.from(hue.buffers.colors.slice(0, 3));
    settle(hue, 60, POINTER());
    expect(Array.from(hue.buffers.colors.slice(0, 3))).not.toEqual(before);
    const clock = (speed: number, pointer: ReturnType<typeof POINTER>) => {
      const state = createProceduralState(setup({ force: 'attract', affect: { position: 0, speed } }, { motion: { type: 'circle', speed: 1 } }));
      settle(state, 120, pointer);
      return state.buffers.d[1];
    };
    expect(clock(1, POINTER())).toBeGreaterThan(clock(0, POINTER()) * 1.3);
    expect(clock(1, PLAY)).toBeCloseTo(clock(0, PLAY), 9);
  });
  it('position affect 0 stops the points from moving', () => {
    const state = createProceduralState(setup({ force: 'repel', affect: { position: 0 } }));
    const home = state.getPoints()[0];
    settle(state, 90, POINTER({ x: 0.55, y: 0.5 }));
    expect(state.getPositions()[0][0]).toBeCloseTo(home.x, 9);
  });
});

describe('cost readout', () => {
  it('grows with the features that really cost something', () => {
    const base = estimateProceduralCost(cfg()).score;
    expect(estimateProceduralCost(cfg({ field: { method: 'smooth-voronoi' } })).score).toBeGreaterThan(base);
    expect(estimateProceduralCost(cfg({ influence: { shape: 'ellipse' } })).score).toBeGreaterThan(base);
    expect(estimateProceduralCost(cfg({ fields: [{}, {}] })).score).toBeGreaterThan(base);
    const lit = estimateProceduralCost(cfg({ material: { enabled: true, glow: 1, light: 1 } }));
    expect(lit.score).toBeGreaterThan(base * 3);
    const heavy = estimateProceduralCost(cfg({
      points: { min: 12, max: 12 }, fields: [{}, {}, {}], material: { enabled: true, glow: 1 },
      distortion: [{ type: 'multiwarp', target: 'points' }, { type: 'curl', target: 'points' }, { type: 'none' }],
    }));
    expect(heavy.level).toBe('extreme');
    expect(estimateProceduralCost(cfg()).level).toBe('low');
  });
});

describe('advanced presets', () => {
  const NEW_IDS = ['liquid-atmosphere', 'organic-bloom', 'deep-nebula', 'crystal-flow', 'soft-glass', 'fluid-color-field', 'dream-gradient', 'magnetic-color-field', 'atmospheric-light'];
  it('has the ten section-11 examples with unique ids', () => {
    const ids = ALL_PROCEDURAL_PRESETS.map(preset => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of NEW_IDS) expect(ids).toContain(id);
    expect(ADVANCED_PROCEDURAL_PRESETS.length).toBeGreaterThanOrEqual(10);
  });
  it('every preset is a real configuration: valid, idempotent, uses an engine feature and compiles', () => {
    for (const preset of ADVANCED_PROCEDURAL_PRESETS) {
      const applied = applyPreset(cfg(), preset);
      expect(normalizeProcedural(applied)).toEqual(applied);
      const result = validateProcedural({ ...applied, version: 2 });
      expect(result.issues.filter(issue => issue.severity !== 'info')).toHaveLength(0);
      const signature = proceduralSignature(applied);
      const usesFeature = signature !== proceduralSignature(cfg()) || applied.motion.type !== cfg().motion.type || applied.interaction.force !== cfg().interaction.force || applied.motion.groups > 0 || applied.motion.loop > 0;
      expect(usesFeature).toBe(true);
      expect(generateProceduralGlsl(applied).functions).toContain('procSample');
      const state = createProceduralState(applied);
      for (let i = 0; i < 30; i++) state.step(1 / 60, PLAY, 1.6, 1);
      expect(Array.from(state.buffers.points).every(Number.isFinite)).toBe(true);
    }
  });
  it('the section-11 look names map onto the features they claim', () => {
    const by = (id: string) => applyPreset(cfg(), ADVANCED_PROCEDURAL_PRESETS.find(preset => preset.id === id)!);
    expect(fieldFamily(by('liquid-atmosphere').field.method)).not.toBe('kernel');
    expect(by('atmospheric-light').fields.length).toBeGreaterThanOrEqual(2);
    expect(by('soft-glass').material.enabled).toBe(true);
    expect(by('organic-bloom').material.bloom).toBeGreaterThan(0);
    expect(by('dream-gradient').color.interpolation).toBe('oklch');
    expect(by('magnetic-color-field').interaction.force).toBe('magnetic');
    expect(by('deep-nebula').distortion.some(stage => stage.target !== 'layer' && stage.type !== 'none')).toBe(true);
  });
  it('preset files carry the version and still load files written by the previous version', () => {
    const text = serializePresetFile('Mine', cfg({ field: { method: 'harmonic' }, fields: [{}] }));
    const parsed = parsePresetFile(text);
    expect(JSON.parse(text).version).toBe(2);
    expect(parsed?.config.field?.method).toBe('harmonic');
    expect(parsed?.issues.filter(issue => issue.severity === 'warning')).toHaveLength(0);
    const old = JSON.stringify({ format: 'shapeforge-procedural-preset', version: 1, name: 'Old', config: { version: 1, field: { method: 'soft' }, mystery: 3 } });
    const loaded = parsePresetFile(old);
    expect(loaded?.config.field?.method).toBe('soft');
    expect(loaded?.issues.map(issue => issue.path)).toContain('mystery');
  });
});
