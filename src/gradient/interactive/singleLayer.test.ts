import { describe, expect, it } from 'vitest';
import type { GradientLayer, GradientProject } from '../engine/model';
import { layerRepresentativeColor, mergedProcedural, planSingleLayer, resolveRenderProject, singleLayerAvailability } from './singleLayer';

let counter = 0;
const stops = (...colors: string[]) => colors.map((color, i) => ({ id: `s${i}`, color, alpha: 1, pos: colors.length === 1 ? 0 : i / (colors.length - 1) * 100 }));
const procedural = (over: Record<string, unknown> = {}) => ({
  enabled: true, mode: 'full', seed: 7, points: { min: 5, max: 8, density: 0.5 }, color: { source: 'custom', shuffle: false, variance: 0.1 },
  anchors: [{ x: 0.5, y: 0.5, color: '#123456' }], origin: { x: 0.2, y: 0.2 }, distortion: [], ...over,
});
function layer(name: string, colors: string[], shader: Record<string, unknown> | null, over: Record<string, unknown> = {}): GradientLayer {
  counter += 1;
  return {
    id: `l${counter}`, name, visible: true, type: 'linear', repeating: false, stops: stops(...colors), angle: 135,
    opacity: 1, effects: [], cx: 50, cy: 50, shape: 'ellipse', rx: 50, ry: 50,
    mesh: { points: [], base: '' }, shader: shader ?? undefined, ...over,
  } as unknown as GradientLayer;
}
const project = (layers: GradientLayer[], shader: Record<string, unknown> = {}): GradientProject =>
  ({ version: 1, name: 'p', canvas: { w: 1200, h: 800 }, layers, shader: { enabled: true, renderBackend: 'overlay', shaderMix: 0.4, singleLayer: true, ...shader } }) as unknown as GradientProject;
const on = (extra: Record<string, unknown> = {}) => ({ enabled: true, style: 'flow', procedural: procedural(), ...extra });

describe('use as single layer', () => {
  it('returns the very same project while the switch is off', () => {
    const p = project([layer('a', ['#ff0000', '#0000ff'], on()), layer('b', ['#00ff00', '#ffffff'], on())], { singleLayer: false });
    expect(resolveRenderProject(p)).toBe(p);
    expect(planSingleLayer(p).active).toBe(false);
  });

  it('keeps every CSS layer intact while combining their colors for the shader field', () => {
    const top = layer('top', ['#ff0000'], on());
    const mid = layer('mid', ['#00ff00'], on({ procedural: undefined }));
    const bottom = layer('bottom', ['#0000ff'], on({ procedural: undefined }));
    const p = project([top, mid, bottom]);
    const plan = planSingleLayer(p);
    expect(plan.active).toBe(true);
    expect(plan.hostId).toBe(top.id);
    expect(plan.colors).toEqual(['#0000ff', '#00ff00', '#ff0000']);
    const view = resolveRenderProject(p);
    const visible = view.layers.filter(l => l.visible);
    expect(visible.length).toBe(3);
    const host = visible.find(layer => layer.id === top.id)!;
    expect(host.id).toBe(top.id);
    expect(host.stops).toBe(top.stops);
    expect(view.layers[1].stops).toBe(mid.stops);
    expect(view.layers[2].stops).toBe(bottom.stops);
  });

  it('uses the top-most procedural settings while preserving original backend and CSS layer properties', () => {
    const a = layer('a', ['#111111'], on({ procedural: undefined }));
    const b = layer('b', ['#222222'], on({ procedural: procedural({ mode: 'hybrid' }) }));
    const c = layer('c', ['#333333'], on({ procedural: procedural({ seed: 99 }) }));
    const view = resolveRenderProject(project([a, b, c]));
    expect(view.shader?.renderBackend).toBe('overlay');
    expect(view.shader?.shaderMix).toBe(0.4);
    const host = view.layers.find(l => l.id === b.id)!;
    expect(host.id).toBe(b.id);
    const merged = host.shader!.procedural as unknown as ReturnType<typeof procedural>;
    expect(merged.seed).toBe(7);
    expect(merged.mode).toBe('hybrid');
    expect(merged.color.source).toBe('custom');
    expect(merged.color.colors).toEqual(['#333333', '#222222', '#111111']);
    expect(merged.anchors).toHaveLength(6);
    expect(merged.anchors.map(anchor => anchor.color)).toEqual(['#333333', '#222222', '#111111', '#333333', '#222222', '#111111']);
    expect(merged.origin).toBe(null);
    expect(merged.points.min).toBe(merged.anchors.length);
    expect(merged.points.max).toBe(merged.anchors.length);
    expect(merged.field.base).toBe('#333333');
    expect(host.shader!.mixLayerId).toBe('');
  });

  it('keeps motion and pointer interaction when only a non-host member enables them', () => {
    const still = on({
      interact: false,
      reaction: 0,
      procedural: procedural({ seed: 1, motion: { type: 'static', speed: 0, influence: 0 } }),
    });
    const moving = on({
      interact: true,
      reaction: 0.7,
      procedural: procedural({ seed: 2, motion: { type: 'orbit', speed: 0.8, influence: 1 } }),
    });
    const top = layer('still host', ['#ff0000'], still);
    const bottom = layer('moving member', ['#0000ff'], moving);
    const view = resolveRenderProject(project([top, bottom]));
    const host = view.layers.find(item => item.id === top.id)!;
    const merged = host.shader!.procedural as unknown as ReturnType<typeof procedural>;

    expect(merged.seed).toBe(2);
    expect(merged.motion.type).toBe('orbit');
    expect(host.shader!.interact).toBe(true);
    expect(host.shader!.reaction).toBe(0.7);
  });

  it('does not replace layer colors, opacity, order or blend modes', () => {
    const top = layer('glow', ['#ff00ff'], on(), { opacity: 0.35, blend: 'screen' });
    const base = layer('base', ['#112233', '#445566'], on({ procedural: undefined }), { opacity: 0.8 });
    const view = resolveRenderProject(project([top, base]));
    expect(view.layers.map(item => item.id)).toEqual([top.id, base.id]);
    expect(view.layers.map(item => item.visible)).toEqual([true, true]);
    expect(view.layers[0].stops).toBe(top.stops);
    expect(view.layers[0].opacity).toBe(top.opacity);
    expect(view.layers[0].blend).toBe(top.blend);
    expect(view.layers[1].stops).toBe(base.stops);
    expect(view.layers[1].opacity).toBe(base.opacity);
    expect(view.layers[1].blend).toBe(base.blend);
  });

  it('keeps a radial glow anchored at its own position and scale above the background colour', () => {
    const glowStops = stops('#ff00ff', '#ff00ff');
    glowStops[1].alpha = 0;
    const glow = layer('glow', ['#ff00ff'], on(), {
      type: 'radial', cx: 20, cy: 30, rx: 20, ry: 20, stops: glowStops,
    });
    const background = layer('background', ['#112233'], on({ procedural: undefined }));
    const view = resolveRenderProject(project([glow, background]));
    const merged = view.layers.find(l => l.id === glow.id)!.shader!.procedural as unknown as ReturnType<typeof procedural>;
    const glowAnchor = merged.anchors.find(anchor => anchor.color === '#ff00ff')!;
    expect(glowAnchor.x).toBeCloseTo(0.2);
    expect(glowAnchor.y).toBeCloseTo(0.7);
    expect(glowAnchor.radius).toBeGreaterThan(0.2);
    expect(glowAnchor.weight).toBeCloseTo(0.5);
    expect(merged.field.base).toBe('#112233');
  });

  it('adds colour centres for many layers but respects the engine limit of 12', () => {
    expect(mergedProcedural(procedural() as never, 3).points.min).toBe(5);
    expect(mergedProcedural(procedural() as never, 9).points.min).toBe(9);
    expect(mergedProcedural(procedural() as never, 30).points.max).toBe(12);
  });

  it('never changes the stored project, so switching off restores every layer', () => {
    const layers = [layer('a', ['#ff0000', '#00ff00'], on()), layer('b', ['#0000ff'], on())];
    const p = project(layers);
    const before = JSON.stringify(p);
    const view = resolveRenderProject(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(view.shader?.renderBackend).toBe('overlay');
    expect(view.shader?.shaderMix).toBe(0.4);
    expect(p.shader?.renderBackend).toBe('overlay');
    expect(layers.every(l => l.visible)).toBe(true);
  });

  it('leaves layers without a shader and hidden layers alone', () => {
    const css = layer('css only', ['#abcdef', '#fedcba'], null);
    const hidden = layer('hidden', ['#999999'], on(), { visible: false });
    const a = layer('a', ['#ff0000'], on()); const b = layer('b', ['#0000ff'], on());
    const view = resolveRenderProject(project([a, css, hidden, b]));
    expect(view.layers.find(l => l.id === css.id)).toBe(css);
    expect(view.layers.find(l => l.id === hidden.id)).toBe(hidden);
    expect(view.layers.find(l => l.id === b.id)?.visible).toBe(true);
    expect(planSingleLayer(project([a, css, hidden, b])).colors.length).toBe(2);
  });

  it('keeps layer identity stable so unchanged layers are not re-rendered', () => {
    const a = layer('a', ['#ff0000'], on()); const b = layer('b', ['#0000ff'], on());
    const first = resolveRenderProject(project([a, b]));
    const second = resolveRenderProject(project([a, b]));   // a new project object (any slider edit), same layers
    expect(second.layers[0]).toBe(first.layers[0]);
    expect(second.layers[1]).toBe(first.layers[1]);
    const a2 = { ...a, stops: stops('#ff00ff') } as GradientLayer;
    expect(resolveRenderProject(project([a2, b])).layers[0]).not.toBe(first.layers[0]);
  });

  it('explains why it is unavailable', () => {
    const a = layer('a', ['#f00000'], on()); const b = layer('b', ['#0000f0'], on({ procedural: undefined }));
    expect(singleLayerAvailability(project([a, b], { enabled: false })).reason).toBe('shader-off');
    expect(singleLayerAvailability(project([a, b], { renderBackend: 'css' })).reason).toBe('css-backend');
    expect(singleLayerAvailability(project([a])).reason).toBe('needs-two-layers');
    expect(singleLayerAvailability(project([layer('x', ['#fff000'], on({ procedural: undefined })), b])).reason).toBe('needs-procedural');
    const ok = singleLayerAvailability(project([a, b]));
    expect(ok.available).toBe(true);
    expect(ok.members).toBe(2);
    expect(ok.hostName).toBe('a');
  });

  it('falls back to the original project when the merge is not possible', () => {
    const p = project([layer('only', ['#ff0000'], on())]);
    expect(resolveRenderProject(p)).toBe(p);
  });

  it('keeps mesh, grain and curve host geometry unchanged', () => {
    const host = layer('mesh host', ['#ff0000'], on(), { type: 'mesh' });
    const view = resolveRenderProject(project([host, layer('b', ['#0000ff'], on())]));
    expect(view.layers.find(l => l.id === host.id)!.type).toBe('mesh');
  });

  describe('representative colour of a layer', () => {
    it('is the solid colour of a solid layer', () => {
      expect(layerRepresentativeColor(layer('s', ['#ffffff'], null, { solidColor: '#336699' }))).toBe('#336699');
    });
    it('averages a gradient in linear light', () => {
      const color = layerRepresentativeColor(layer('g', ['#000000', '#ffffff'], null))!;
      // the linear-light midpoint of black and white is about #bcbcbc, not the sRGB midpoint #808080
      const value = parseInt(color.slice(1, 3), 16);
      expect(value).toBeGreaterThan(170);
      expect(value).toBeLessThan(200);
    });
    it('ignores transparent stops and returns null for a layer that paints nothing', () => {
      const faded = layer('f', ['#ff0000', '#0000ff'], null);
      faded.stops[1].alpha = 0;
      expect(layerRepresentativeColor(faded)).toBe('#ff0000');
      const empty = layer('e', ['#ff0000', '#0000ff'], null);
      empty.stops.forEach(s => { s.alpha = 0; });
      expect(layerRepresentativeColor(empty)).toBe(null);
    });
    it('weights mesh points by opacity and size', () => {
      const mesh = layer('m', ['#000000'], null, { type: 'mesh', mesh: { base: '', points: [{ color: '#ff0000', alpha: 1, size: 60 }, { color: '#0000ff', alpha: 0, size: 60 }] } });
      expect(layerRepresentativeColor(mesh)).toBe('#ff0000');
    });
  });
});
