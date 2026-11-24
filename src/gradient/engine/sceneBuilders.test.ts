import { describe, expect, it } from 'vitest';
import { ATMOSPHERES, buildAtmosphere } from './atmosphere';
import { layeredOutput } from './css';
import { newProject } from './model';
import { bandStops, glow, lighten, mixHex, paletteAt, paletteRamp, spectrumStops, streamline } from './sceneMath';
import { VISUAL_BUILDERS, buildVisual, visualConfig } from './visualBuilders';

const strip = (layers: ReturnType<typeof buildVisual>) => JSON.stringify(layers, (key, value) => (key === 'id' ? undefined : value));

describe('scene maths', () => {
  it('mixes in OKLab without leaving the gamut and hits both endpoints', () => {
    expect(mixHex('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(mixHex('#ff0000', '#0000ff', 1)).toBe('#0000ff');
    for (let i = 0; i <= 20; i++) expect(mixHex('#00ffaa', '#ff00ff', i / 20, 'oklch')).toMatch(/^#[0-9a-f]{6}$/);
    expect(lighten('#000000', 1)).toBe('#ffffff');
  });

  it('samples a palette smoothly and returns the palette colours at the ends', () => {
    const colors = ['#102030', '#ff8800', '#00ccff'];
    expect(paletteAt(colors, 0)).toBe('#102030');
    expect(paletteAt(colors, 1)).toBe('#00ccff');
    expect(paletteRamp(colors, 5)).toHaveLength(5);
    expect(paletteAt(['#123456'], 0.4)).toBe('#123456');
  });

  it('builds band ramps that start and end transparent, in order, inside 0…100', () => {
    for (const stops of [bandStops('#fff', 50, 22, 0.55), bandStops('#fff', 3, 20, 0.5), spectrumStops(['#f00', '#0f0', '#00f'], 66, 20, 0.7)]) {
      expect(stops[0].alpha).toBe(0);
      expect(stops[stops.length - 1].alpha).toBe(0);
      for (let i = 1; i < stops.length; i++) expect(stops[i].pos).toBeGreaterThanOrEqual(stops[i - 1].pos);
      for (const s of stops) { expect(s.pos).toBeGreaterThanOrEqual(0); expect(s.pos).toBeLessThanOrEqual(100); }
    }
  });

  it('follows a deterministic, finite streamline that respects its drift', () => {
    const opts = { step: 12, scale: 1.4, drift: 30, turbulence: 0.5 };
    const a = streamline(7, 30, 40, 6, opts), b = streamline(7, 30, 40, 6, opts), c = streamline(8, 30, 40, 6, opts);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const p of a) for (const v of [p.x, p.y, p.angle, p.speed]) expect(Number.isFinite(v)).toBe(true);
    // with no turbulence the path is a straight line along the drift angle
    const straight = streamline(7, 10, 10, 4, { ...opts, turbulence: 0 });
    for (const p of straight) expect(p.angle).toBeCloseTo(30, 5);
    expect(straight[3].x).toBeGreaterThan(straight[0].x);
  });

  it('builds glows whose ramp fades to nothing and that use a falloff curve', () => {
    const layer = glow({ name: 'g', color: '#ff8800', cx: 50, cy: 50, rx: 30, ry: 20, alpha: 0.6, rotate: 40, blur: 4 });
    expect(layer.type).toBe('radial');
    expect(layer.stops[layer.stops.length - 1].alpha).toBe(0);
    expect(layer.shaping?.falloff).toBe('smooth');
    expect(layer.transform.rotate).toBe(40);
    expect(layer.effects.some(effect => effect.type === 'blur')).toBe(true);
    const disc = glow({ name: 'd', color: '#fff', cx: 0, cy: 0, rx: 10, ry: 10, alpha: 1, plateau: 70 });
    expect(disc.shaping?.falloff ?? 'none').toBe('none');
    expect(disc.stops[1].pos).toBe(70);
  });
});

describe('scene builders', () => {
  for (const builder of VISUAL_BUILDERS) {
    describe(builder.id, () => {
      it('is deterministic and every preset yields valid, editable layers', () => {
        for (const preset of builder.presets) {
          const config = visualConfig(builder.id, preset);
          const first = buildVisual(builder.id, config), second = buildVisual(builder.id, config);
          expect(strip(first)).toBe(strip(second));
          expect(first.length).toBeGreaterThan(1);
          expect(first.length).toBeLessThanOrEqual(40);
          for (const layer of first) {
            expect(layer.opacity).toBeGreaterThanOrEqual(0);
            expect(layer.opacity).toBeLessThanOrEqual(1);
            expect(layer.stops.length).toBeGreaterThanOrEqual(2);
            for (const s of layer.stops) { expect(Number.isFinite(s.pos)).toBe(true); expect(s.alpha).toBeGreaterThanOrEqual(0); expect(s.alpha).toBeLessThanOrEqual(1); expect(s.color).toMatch(/^#[0-9a-f]{6}$/i); }
          }
          // the whole stack renders to CSS without throwing or emitting NaN
          const css = layeredOutput(newProject({ layers: first, canvas: { w: 480, h: 300 } })).all;
          expect(css).not.toMatch(/NaN|undefined/);
        }
      });

      it('survives extreme control values', () => {
        for (const extreme of [0, 100]) {
          const config: Record<string, unknown> = { ...visualConfig(builder.id) };
          for (const control of builder.controls) if (!control.options) config[control.key] = extreme === 0 ? control.min : control.max;
          const layers = buildVisual(builder.id, config as never);
          expect(layers.length).toBeGreaterThan(0);
          const css = layeredOutput(newProject({ layers, canvas: { w: 480, h: 300 } })).all;
          expect(css).not.toMatch(/NaN|undefined/);
        }
      });

      it('changes the result when the seed changes', () => {
        const a = buildVisual(builder.id, { ...visualConfig(builder.id), seed: 3 } as never), b = buildVisual(builder.id, { ...visualConfig(builder.id), seed: 11 } as never);
        if (builder.controls.some(control => control.key === 'seed') || builder.id !== 'halftone') expect(strip(a)).not.toBe(strip(b));
      });
    });
  }

  it('keeps older saved configs working: missing new keys fall back to defaults', () => {
    const legacy = { palette: ['#112233', '#ffaa00', '#00ccff'], flowAngle: 30, flow: 50, turbulence: 40, viscosity: 40, swirl: 50, warp: 40, diffusion: 30 };
    expect(buildVisual('fluid', legacy as never).length).toBeGreaterThan(2);
    expect(buildVisual('metallic', { palette: ['#111', '#fff', '#889'].map(c => c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c), angle: 90 } as never).length).toBeGreaterThan(1);
  });

  it('halftone: standard screen angles, common pitch and an optional tone underlay', () => {
    const base = visualConfig('halftone');
    const aligned = buildVisual('halftone', { ...base, angle: 15, channelSeparation: 4, spacing: 16, antiMoire: 'on' } as never).filter(l => l.texture.enabled);
    expect(aligned.map(l => l.texture.angle)).toEqual([15, 75, 0]);
    expect(new Set(aligned.map(l => l.texture.scale)).size).toBe(1);
    const moire = buildVisual('halftone', { ...base, angle: 15, channelSeparation: 4, spacing: 16, antiMoire: 'off' } as never).filter(l => l.texture.enabled);
    expect(new Set(moire.map(l => l.texture.scale)).size).toBeGreaterThan(1);
    expect(buildVisual('halftone', { ...base, tone: 0 } as never).some(l => l.name === 'Halftone tone')).toBe(false);
    expect(buildVisual('halftone', { ...base, tone: 60 } as never).some(l => l.name === 'Halftone tone')).toBe(true);
    // channel separation shifts are a small percentage and the shifted screens are enlarged to cover the canvas edges
    for (const l of aligned) { expect(Math.abs(l.transform.x)).toBeLessThan(2); expect(l.transform.scale).toBeGreaterThan(1); }
  });

  it('metallic: finish selects the layer type and roughness widens reflection transitions', () => {
    const base = visualConfig('metallic');
    const bottom = (finish: string, extra = {}) => buildVisual('metallic', { ...base, finish, ...extra } as never).find(l => l.name.startsWith('Metal ·') && l.name !== 'Metal · polished sheen' && l.name !== 'Metal · ground')!;
    expect(bottom('linear').type).toBe('linear');
    expect(bottom('radial').type).toBe('radial');
    expect(bottom('anisotropic').type).toBe('conic');
    // average width of the transitions (consecutive stops of different colour): rougher metal blurs its reflections
    const transition = (roughness: number) => {
      const stops = bottom('linear', { roughness, reflections: 3 }).stops, gaps = stops.slice(1).map((s, i) => (s.color !== stops[i].color ? s.pos - stops[i].pos : -1)).filter(g => g >= 0);
      return gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    };
    expect(transition(90)).toBeGreaterThan(transition(0));
    // no reflection strip is cut off by the ends of the ramp
    const stops = bottom('linear', { reflections: 8, bandScale: 100 }).stops;
    // strictly increasing: two stops at one position would make a hard step between different tones
    for (let i = 1; i < stops.length; i++) expect(stops[i].pos).toBeGreaterThan(stops[i - 1].pos);
    for (const preset of VISUAL_BUILDERS.find(x => x.id === 'metallic')!.presets) {
      const ramp = buildVisual('metallic', visualConfig('metallic', preset)).find(l => l.name.startsWith('Metal ·') && l.name !== 'Metal · polished sheen' && l.name !== 'Metal · ground')!.stops;
      for (let i = 1; i < ramp.length; i++) expect(ramp[i].pos).toBeGreaterThan(ramp[i - 1].pos);
    }
  });

  it('glass: bevels face the light and thickness controls the rim width', () => {
    const base = visualConfig('glass');
    const edges = (angle: number, thickness = 9) => buildVisual('glass', { ...base, angle, thickness } as never).filter(l => l.name.startsWith('Glass · lit edge') || l.name.startsWith('Glass · shaded edge'));
    const lit = edges(135).filter(l => l.name.includes('lit'));
    expect(lit.map(l => l.name).sort()).toEqual(['Glass · lit edge left', 'Glass · lit edge top']);
    expect(edges(135, 20)[0].stops[1].pos).toBe(20);
    expect(edges(135, 4)[0].stops[1].pos).toBe(4);
  });

  it('light: the falloff model and tightness reach the light sources', () => {
    const base = visualConfig('light');
    const sources = (falloffType: string, falloff: number) => buildVisual('light', { ...base, falloffType, falloff } as never).filter(l => l.name.startsWith('Light source'));
    expect(sources('gaussian', 50)[0].shaping?.falloff).toBe('gaussian');
    expect(sources('exponential', 50)[0].shaping?.falloff).toBe('exponential');
    expect(sources('gaussian', 90)[0].shaping!.falloffStrength!).toBeGreaterThan(sources('gaussian', 10)[0].shaping!.falloffStrength!);
  });

  it('ink: plumes follow streamlines and edge definition widens the flat pigment area', () => {
    const base = visualConfig('ink');
    const bloom = (edge: number) => buildVisual('ink', { ...base, edge } as never).find(l => l.name === 'Pigment bloom 1')!;
    expect(bloom(95).stops[1].pos).toBeGreaterThan(bloom(10).stops[1].pos);
    const rotations = buildVisual('ink', base as never).filter(l => l.name.startsWith('Smoke plume')).map(l => l.transform.rotate);
    expect(rotations.every(Number.isFinite)).toBe(true);
  });

  it('prism: dispersion widens the spectrum and offsets the colour channels', () => {
    const base = visualConfig('prism');
    const spectrum = (dispersion: number) => buildVisual('prism', { ...base, dispersion } as never).find(l => l.name === 'Dispersed spectrum')!;
    expect(spectrum(100).space).toBe('oklch');
    const width = (l: ReturnType<typeof spectrum>) => l.stops.filter(s => s.alpha > 0).at(-1)!.pos - l.stops.filter(s => s.alpha > 0)[0].pos;
    expect(width(spectrum(100))).toBeGreaterThan(width(spectrum(0)));
    expect(buildVisual('prism', { ...base, dispersion: 0 } as never).some(l => l.name.startsWith('Chromatic offset'))).toBe(false);
    expect(buildVisual('prism', { ...base, dispersion: 80 } as never).some(l => l.name.startsWith('Chromatic offset'))).toBe(true);
  });

  it('holographic: closes the spectrum on its first colour so repeats have no seam', () => {
    const spectral = buildVisual('holographic', visualConfig('holographic')).find(l => l.name === 'Holographic spectrum')!;
    expect(spectral.space).toBe('oklch');
    expect(spectral.stops[0].color).toBe(spectral.stops[spectral.stops.length - 1].color);
    expect(spectral.stops[spectral.stops.length - 1].pos).toBe(100);
  });
});

describe('atmosphere', () => {
  it('builds every preset deterministically with soft, fully-faded shafts', () => {
    for (const atmosphere of ATMOSPHERES) {
      const first = buildAtmosphere(atmosphere.opts), second = buildAtmosphere(atmosphere.opts);
      expect(strip(first)).toBe(strip(second));
      for (const layer of first) {
        expect(layer.opacity).toBeGreaterThanOrEqual(0);
        expect(layer.opacity).toBeLessThanOrEqual(1);
        // no hard stops: the shafts used to be hard-edged fans
        if (layer.name.startsWith('Light rays')) expect(layer.stops.some(stop => stop.hard)).toBe(false);
      }
      expect(layeredOutput(newProject({ layers: first, canvas: { w: 480, h: 300 } })).all).not.toMatch(/NaN|undefined/);
    }
  });
});
