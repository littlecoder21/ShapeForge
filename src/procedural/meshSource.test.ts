import { describe, expect, it } from 'vitest';
import { generateProceduralGlsl, injectProceduralGlsl, PROC_ANCHORS } from './glsl';
import { proceduralizeSource } from './convert';
import { createProceduralState, cssHintExponent as runtimeHint, generatePoints } from './proceduralRuntime';
import { ALL_PROCEDURAL_PRESETS } from './presetsMore';
import { PROCEDURAL_PRESETS, applyPreset } from './presets';
import {
  anchorsToMeshPoints, cssHintExponent, cssMeshPixel, meshMidStop, meshToAnchors, resolveProceduralMesh, type MeshLike,
} from './meshSource';
import {
  DEFAULT_PROCEDURAL, PROC_MAX_MESH_POINTS, newProcedural, normalizeProcedural, planPointCapacity, proceduralCapacity, proceduralSignature, tierFor,
} from './types';

const point = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `p${i}`, x: (i * 37) % 100, y: (i * 53) % 100, color: ['#ff3366', '#22d3ee', '#fbbf24', '#7c5cff'][i % 4], alpha: 0.5 + (i % 5) / 10, size: 20 + (i % 7) * 4, ...extra,
});
const meshOf = (n: number, extra: Partial<MeshLike> = {}): MeshLike => ({ points: Array.from({ length: n }, (_, i) => point(i)), base: '', core: 40, ...extra });
const source = (mesh: MeshLike | null, legacy: number) => ({
  palette: [{ color: '#ff3366', position: 0 }, { color: '#22d3ee', position: 1 }],
  geometry: { kind: 'mesh', angle: 0, originX: 50, originY: 50, radiusX: 50, radiusY: 50 },
  meshPoints: Array.from({ length: legacy }, (_, i) => ({ color: point(i).color, x: point(i).x, y: point(i).y, size: point(i).size, alpha: point(i).alpha })),
  mesh,
});

describe('CSS mesh maths (mirrors mesh.ts)', () => {
  it('derives the middle stop from the core', () => {
    expect(meshMidStop(0)).toBe(25);
    expect(meshMidStop(40)).toBe(45);
    expect(meshMidStop(100)).toBe(75);
  });
  it('writes no hint (linear fade) at the centre, else ln 0.5 / ln mid', () => {
    expect(cssHintExponent(50)).toBe(1);
    expect(cssHintExponent(0)).toBeCloseTo(Math.log(0.5) / Math.log(0.25), 6);
    expect(cssHintExponent(100)).toBeCloseTo(Math.log(0.5) / Math.log(0.75), 6);
  });
  it('the runtime and the TypeScript twin agree', () => {
    for (const core of [0, 10, 33, 40, 50, 60, 77, 100]) expect(runtimeHint(core)).toBeCloseTo(cssHintExponent(core), 10);
  });
  it('composites a point as alpha · (1 − t^k) in straight alpha', () => {
    const anchors = meshToAnchors({ points: [{ x: 50, y: 50, color: '#ff0000', alpha: 0.8, size: 40 }], core: 50 });
    const options = { aspect: 1.5 };
    expect(cssMeshPixel(anchors, options, 0.5, 0.5)[3]).toBeCloseTo(0.8, 4); // centre
    const half = cssMeshPixel(anchors, options, 0.5 + 0.4 * 0.5, 0.5); // t = 0.5 → 0.8 · 0.5
    expect(half[3]).toBeCloseTo(0.4, 6);
    expect(half.slice(0, 3)).toEqual([1, 0, 0]);
    expect(cssMeshPixel(anchors, options, 0.5 + 0.4, 0.5)[3]).toBe(0); // t = 1 → nothing
  });
  it('stacks the FIRST point on top', () => {
    const anchors = meshToAnchors({ points: [
      { x: 50, y: 50, color: '#ff0000', alpha: 1, size: 40 },
      { x: 50, y: 50, color: '#0000ff', alpha: 1, size: 40 },
    ], core: 50 });
    const [r, , b] = cssMeshPixel(anchors, { aspect: 1 }, 0.5, 0.5);
    expect(r).toBeCloseTo(1, 4);
    expect(b).toBeCloseTo(0, 4);
  });
});

describe('mesh → anchors', () => {
  it('keeps every point (not 8, not 12), in order, with alpha / core / size', () => {
    const mesh = meshOf(40, { core: 30 });
    mesh.points = mesh.points.map((p, i) => i === 3 ? { ...p, core: 80 } : p);
    const anchors = meshToAnchors(mesh);
    expect(anchors).toHaveLength(40);
    expect(anchors[3].core).toBe(80);
    expect(anchors[4].core).toBe(30);
    expect(anchors[0].alpha).toBe(mesh.points[0].alpha);
    expect(anchors[5].size).toBe(mesh.points[5].size);
    expect(anchors.map(a => a.color)).toEqual(mesh.points.map(p => p.color));
  });
  it('caps at the 128-point maximum', () => {
    expect(meshToAnchors(meshOf(200))).toHaveLength(PROC_MAX_MESH_POINTS);
  });
  it('folds translate and scale transforms in, and round-trips positions', () => {
    const [a] = meshToAnchors({ points: [{ x: 40, y: 60, color: '#112233', alpha: 1, size: 20, transform: { x: 10, y: -10, scale: 2 } }], core: 40 });
    expect(a.x).toBeCloseTo(0.5, 6);
    expect(a.y).toBeCloseTo(0.5, 6);
    expect(a.size).toBe(40);
    const back = anchorsToMeshPoints(meshToAnchors(meshOf(6)));
    expect(back[2].x).toBeCloseTo(meshOf(6).points[2].x, 1);
    expect(back[2].y).toBeCloseTo(meshOf(6).points[2].y, 1);
  });
  it('resolves a linked config from the live mesh without touching the stored one', () => {
    const stored = normalizeProcedural({ enabled: true, mesh: { source: 'layer', render: 'css-compatible' } });
    const frozen = JSON.stringify(stored);
    const live = meshOf(20, { base: '#101830', core: 70 });
    const resolved = resolveProceduralMesh(stored, live)!;
    expect(resolved.anchors).toHaveLength(20);
    expect(resolved.mesh.base).toBe('#101830');
    expect(resolved.mesh.core).toBe(70);
    expect(JSON.stringify(stored)).toBe(frozen);
    expect(resolveProceduralMesh(normalizeProcedural({ enabled: true }), live)!.anchors).toHaveLength(0);
  });
});

describe('capacity', () => {
  it('uses the smallest tier that fits', () => {
    expect([1, 12, 13, 24, 25, 48, 49, 96, 97, 128, 500].map(tierFor)).toEqual([12, 12, 24, 24, 48, 48, 96, 96, 128, 128, 128]);
  });
  it('keeps the old signature for ordinary configs and adds the tier for big meshes', () => {
    expect(proceduralSignature(newProcedural({ enabled: true }))).toBe('on:warp,none,none');
    const big = newProcedural({ enabled: true, anchors: meshToAnchors(meshOf(30)) });
    expect(proceduralCapacity(big)).toBe(48);
    expect(proceduralSignature(big)).toBe('on:warp,none,none|p48');
    const same = newProcedural({ enabled: true, anchors: meshToAnchors(meshOf(40)) });
    expect(proceduralSignature(same)).toBe(proceduralSignature(big)); // 30 → 40 points: no recompile
  });
  it('plans from the GPU uniform limit and reports overflow instead of truncating', () => {
    expect(planPointCapacity(100, 1024).overflow).toBe(false);
    expect(planPointCapacity(100, 1024).capacity).toBe(128);
    const small = planPointCapacity(100, 221);
    expect(small.overflow).toBe(true);
    expect(small.supported).toBe(12);
    expect(small.message).toContain('100');
    expect(planPointCapacity(8, 221).overflow).toBe(false);
    expect(planPointCapacity(5, 0).overflow).toBe(false);
  });
});

describe('generated shader', () => {
  it('declares arrays and loops at the tier size, never above', () => {
    const cfg = newProcedural({ enabled: true, anchors: meshToAnchors(meshOf(30)) });
    const { functions, capacity } = generateProceduralGlsl(cfg);
    expect(capacity).toBe(48);
    expect(functions).toContain('uniform vec4 uProcPoints[48];');
    expect(functions).toContain('uniform vec4 uProcE;');
    for (const bound of functions.matchAll(/for \(int i = 0; i < (\w+); i\+\+\)/g)) expect(bound[1]).toMatch(/^\d+$/);
    expect(generateProceduralGlsl(newProcedural({ enabled: true })).functions).toContain('uProcPoints[12]');
  });
  it('injects the CSS-compatible hook only when active, and leaves the template alone otherwise', () => {
    const template = `${PROC_ANCHORS.functions}\nvoid main(){\n${PROC_ANCHORS.warp}\n${PROC_ANCHORS.color}\n}`;
    expect(injectProceduralGlsl(template, DEFAULT_PROCEDURAL)).toBe(template);
    const out = injectProceduralGlsl(template, newProcedural({ enabled: true }));
    expect(out).toContain('procSampleCss(p)');
    expect(out).toContain('procSample(warped');
  });
});

describe('runtime', () => {
  const cssConfig = (n: number) => newProcedural({
    enabled: true, mode: 'full', motion: { type: 'static' },
    mesh: { source: 'layer', render: 'css-compatible', composite: 'background', base: '', core: 40, opacity: 1 },
    anchors: meshToAnchors(meshOf(n)),
  });
  it('keeps all anchors as exact points (no random variation)', () => {
    const points = generatePoints(cssConfig(50), null);
    expect(points).toHaveLength(50);
    const mesh = meshOf(50);
    points.forEach((p, i) => {
      expect(p.size).toBe(mesh.points[i].size);
      expect(p.alpha).toBe(mesh.points[i].alpha);
      expect(p.weight).toBeCloseTo(mesh.points[i].alpha, 10);
    });
  });
  it('sizes its buffers to the tier and packs the stack bottom → top with radii from the canvas width', () => {
    const state = createProceduralState(cssConfig(30), {});
    expect(state.buffers.capacity).toBe(48);
    expect(state.buffers.points.length).toBe(48 * 4);
    state.step(0.016, null, 1.5, 1);
    const b = state.buffers, mesh = meshOf(30);
    expect(b.e[0]).toBe(1);
    expect(b.a[1]).toBe(30);
    // record 0 is the LAST mesh point (bottom of the stack)
    expect(b.points[2]).toBeCloseTo(mesh.points[29].size / 100 * 1.5, 5);
    expect(b.points[3]).toBeCloseTo(mesh.points[29].alpha, 5);
    expect(b.colors[3]).toBeCloseTo(runtimeHint(40), 5);
    expect(b.points[29 * 4 + 2]).toBeCloseTo(mesh.points[0].size / 100 * 1.5, 5);
  });
  it('re-packs radii when the aspect ratio changes', () => {
    const state = createProceduralState(cssConfig(3), {});
    state.step(0.016, null, 1, 1);
    const square = state.buffers.points[2];
    state.step(0.016, null, 2, 1);
    expect(state.buffers.points[2]).toBeCloseTo(square * 2, 6);
  });
  it('draws exactly the mesh points: no generated extras, and the count follows the mesh', () => {
    const stale = newProcedural({ ...cssConfig(8), points: { min: 8, max: 8, density: 1 } }); // converted when the mesh had 8 points
    const live = resolveProceduralMesh(stale, meshOf(5))!;
    const state = createProceduralState(live, {});
    expect(state.getPoints()).toHaveLength(5);
    state.step(0.016, null, 1.5, 1);
    expect(state.buffers.a[1]).toBe(5);
    expect(proceduralCapacity(live)).toBe(12);
  });
  it('grows the buffers when a config needs a bigger tier', () => {
    const state = createProceduralState(newProcedural({ enabled: true }), {});
    expect(state.buffers.capacity).toBe(12);
    state.setConfig(cssConfig(60));
    expect(state.buffers.capacity).toBe(96);
    expect(state.buffers.points.length).toBe(96 * 4);
  });
  it('leaves the unified field exactly as before (e.x = 0)', () => {
    const state = createProceduralState(newProcedural({ enabled: true }), {});
    state.step(0.016, null, 1.5, 1);
    expect(state.buffers.e[0]).toBe(0);
  });
});

describe('proceduralize a mesh', () => {
  it('keeps all points, links to the layer and renders CSS-compatible', () => {
    const { config } = proceduralizeSource(source(meshOf(40), 8));
    expect(config.anchors).toHaveLength(40);
    expect(config.mesh.source).toBe('layer');
    expect(config.mesh.render).toBe('css-compatible');
    expect(config.motion.type).toBe('static');
  });
  it('falls back to the legacy capped list as a snapshot', () => {
    const { config } = proceduralizeSource(source(null, 8));
    expect(config.anchors).toHaveLength(8);
    expect(config.mesh.source).toBe('snapshot');
  });
});

describe('presets', () => {
  it('ships unique, valid presets', () => {
    const ids = ALL_PROCEDURAL_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ALL_PROCEDURAL_PRESETS.length).toBe(PROCEDURAL_PRESETS.length + 17);
    for (const preset of ALL_PROCEDURAL_PRESETS) {
      const applied = applyPreset(newProcedural({ enabled: true }), preset);
      expect(applied.enabled).toBe(true);
      expect(proceduralCapacity(applied)).toBe(12);
      expect(applied.color.colors.length).toBeGreaterThanOrEqual(4);
    }
  });
});
