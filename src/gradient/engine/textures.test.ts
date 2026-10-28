/* Texture engine tests — no extra dependencies.
 *   npx tsx --test src/gradient/engine/textures.test.ts
 * (`*.test.ts` is excluded from the app's tsconfig, so these never affect `npm run typecheck` / `build`.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEXTURE, newLayer, normalizeProject, newProject, type TextureData } from './model';
import { CONTROLS, TEXTURE_DEFAULTS, normalizeTexture } from './textureControls';
import { falloffAt, tileableSlope } from './textureMath';
import { LEGACY_TEXTURE_IDS, TEXTURES, findTexture, resolveTextureId, textureDataUri, textureOverlay, textureSupport, textureTileSvg } from './textures';

const tex = (pattern: string, patch: Partial<TextureData> = {}): TextureData => ({ ...DEFAULT_TEXTURE, enabled: true, pattern, ...patch });

/** Minimal well-formedness check: balanced tags, quoted attributes, no NaN / undefined leaking into numbers. */
function assertValidSvg(svg: string, label: string) {
  assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'), `${label}: not an <svg> document`);
  assert.ok(!/NaN|undefined|Infinity|\bnull\b/.test(svg), `${label}: contains NaN/undefined/Infinity`);
  const stack: string[] = [];
  for (const match of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (closing) assert.equal(stack.pop(), name, `${label}: mismatched </${name}>`);
    else if (!selfClosing) stack.push(name);
  }
  assert.equal(stack.length, 0, `${label}: unclosed tags ${stack.join(',')}`);
  const tags = (svg.match(/</g) ?? []).length, parsed = (svg.match(/<\/?[a-zA-Z][\w:-]*(?:\s+[\w:-]+="[^"<]*")*\s*\/?>/g) ?? []).length;
  assert.equal(parsed, tags, `${label}: a tag has malformed attributes`);
}
const numbers = (svg: string, tag: string, attr: string) => [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*?\\s${attr}="([^"]+)"`, 'g'))].map(m => Number(m[1]));

test('registry: 214 presets, unique stable ids, every legacy id still resolves to the same preset', () => {
  assert.equal(TEXTURES.length, 214);
  assert.equal(new Set(TEXTURES.map(t => t.id)).size, 214);
  const perFamily: Record<string, number> = {};
  for (const t of TEXTURES) {
    perFamily[t.family] = (perFamily[t.family] ?? 0) + 1;
    assert.equal(LEGACY_TEXTURE_IDS[`${t.family}-${t.variant + 1}`], t.id);
    assert.equal(resolveTextureId(t.id), t.id);
    assert.equal(findTexture(t.legacyId)?.label, t.label);
  }
  assert.deepEqual(perFamily, { grain: 30, dots: 26, lines: 21, crosshatch: 17, grid: 17, waves: 29, geometric: 17, woven: 41, paper: 10, material: 5, organic: 1 });
  // ids used by saved projects / the halftone builder keep their meaning
  const spot: Record<string, string> = { 'grain-1': 'Film grain', 'dots-1': 'Halftone', 'dots-6': 'Stipple', 'dots-10': 'Diamond dots', 'geometric-9': 'Chevron', 'woven-41': 'Grunge', 'paper-10': 'Torn Paper Edges', 'organic-1': 'Plasma Texture' };
  for (const [legacy, label] of Object.entries(spot)) assert.equal(findTexture(legacy)?.label, label, legacy);
  assert.equal(resolveTextureId('nope-1'), undefined);
});

test('every preset renders valid, bounded SVG at defaults', () => {
  for (const preset of TEXTURES) {
    const svg = textureTileSvg(tex(preset.id));
    assertValidSvg(svg, preset.id);
    assert.ok(svg.length < 120_000, `${preset.id}: ${svg.length} chars`);
  }
});

test('rendering is deterministic, and the seed changes randomised presets', () => {
  for (const id of ['grain-dust-noise', 'dots-stipple', 'lines-scratched-surface', 'geometric-voronoi-cells', 'woven-paper-fibers', 'geometric-star-field']) {
    assert.equal(textureTileSvg(tex(id, { seed: 5 })), textureTileSvg(tex(id, { seed: 5 })));
    assert.notEqual(textureTileSvg(tex(id, { seed: 5 })), textureTileSvg(tex(id, { seed: 6 })), id);
  }
});

test('motif size scales the elements but not their positions or spacing', () => {
  const a = textureTileSvg(tex('dots-halftone')), b = textureTileSvg(tex('dots-halftone', { motifSize: 200 }));
  assert.deepEqual(numbers(a, 'circle', 'cx'), numbers(b, 'circle', 'cx'));
  assert.deepEqual(numbers(a, 'circle', 'cy'), numbers(b, 'circle', 'cy'));
  const ra = numbers(a, 'circle', 'r'), rb = numbers(b, 'circle', 'r');
  assert.equal(ra.length, rb.length);
  ra.forEach((r, i) => assert.ok(Math.abs(rb[i] / r - 2) < 0.02));
});

test('spacing X and Y act independently', () => {
  const distinct = (svg: string, attr: string) => new Set(numbers(svg, 'circle', attr).map(v => Math.round(v))).size;
  const base = textureTileSvg(tex('dots-bold-halftone')), wideX = textureTileSvg(tex('dots-bold-halftone', { spacingX: 200 })), wideY = textureTileSvg(tex('dots-bold-halftone', { spacingY: 200 }));
  assert.ok(distinct(wideX, 'cx') < distinct(base, 'cx'));
  assert.equal(distinct(wideX, 'cy'), distinct(base, 'cy'));
  assert.ok(distinct(wideY, 'cy') < distinct(base, 'cy'));
  assert.equal(distinct(wideY, 'cx'), distinct(base, 'cx'));
});

test('lattices use whole repeats, so they tile exactly', () => {
  for (const spacingX of [60, 85, 130, 220]) {
    const xs = [...new Set(numbers(textureTileSvg(tex('dots-pin-dots', { spacingX })), 'circle', 'cx').map(v => Math.round(v * 100) / 100))].sort((a, b) => a - b);
    const pitch = xs[1] - xs[0];
    assert.ok(Math.abs(pitch * Math.round(64 / pitch) - 64) < 0.05, `pitch ${pitch}`);
  }
});

test('elements that cross a tile edge are repeated on the opposite edge (no cut dots)', () => {
  for (const id of ['dots-stipple', 'dots-ink-splatter', 'geometric-star-field', 'grain-dust-noise']) {
    const svg = textureTileSvg(tex(id, { motifSize: 260, seed: 9 }));
    const dots = [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g)].map(m => ({ x: +m[1], y: +m[2], r: +m[3] }));
    const has = (x: number, y: number, r: number) => dots.some(d => Math.abs(d.x - x) < 0.02 && Math.abs(d.y - y) < 0.02 && Math.abs(d.r - r) < 0.02);
    for (const d of dots) {
      if (d.x - d.r < 0 && d.x >= 0) assert.ok(has(d.x + 64, d.y, d.r), `${id}: left edge dot has no copy`);
      if (d.x + d.r > 64 && d.x <= 64) assert.ok(has(d.x - 64, d.y, d.r), `${id}: right edge dot has no copy`);
      if (d.y - d.r < 0 && d.y >= 0) assert.ok(has(d.x, d.y + 64, d.r), `${id}: top edge dot has no copy`);
      if (d.y + d.r > 64 && d.y <= 64) assert.ok(has(d.x, d.y - 64, d.r), `${id}: bottom edge dot has no copy`);
    }
  }
});

test('line presets draw a full set of lines (the old engine drew two)', () => {
  const svg = textureTileSvg(tex('lines-horizontal-lines'));
  const d = (svg.match(/<path d="([^"]+)"/) ?? [])[1] ?? '';
  assert.ok((d.match(/M/g) ?? []).length >= 4, d);
  assert.ok(!d.includes('L'), 'undistorted lines stay exact straight segments');
});

test('opacity is applied exactly once', () => {
  const texture = tex('dots-halftone', { opacity: 40 });
  assert.match(textureTileSvg(texture), /<g opacity="0\.4"/);               // default = the texture's own opacity
  assert.match(textureTileSvg(texture, 100), /<g opacity="1"/);             // explicit override (layer overlay applies it)
  assert.equal((textureTileSvg(texture).match(/opacity="0\.4"/g) ?? []).length, 1);
  assert.match(textureTileSvg(texture, 40 * 0.5), /<g opacity="0\.2"/);     // flat output bakes texture × layer opacity
  const overlay = textureOverlay(texture);
  assert.equal(overlay.opacity, 0.4);
  assert.match(decodeURIComponent(overlay.href), /<g opacity="1"/);         // tile at full strength + overlay opacity once
  assert.equal(overlay.dataUri, textureDataUri(texture, 100, { rotation: 'none' }));
});

test('distortion: 0 means exact geometry and ignores the other warp settings; >0 changes the shape', () => {
  const base = textureTileSvg(tex('lines-horizontal-lines'));
  assert.equal(textureTileSvg(tex('lines-horizontal-lines', { warpFrequency: 9, warpX: 10, warpY: 90, warpOctaves: 3 })), base);
  const warped = textureTileSvg(tex('lines-horizontal-lines', { warpAmount: 50 }));
  assert.notEqual(warped, base);
  assert.ok((warped.match(/L/g) ?? []).length > 20);
  assert.notEqual(textureTileSvg(tex('lines-horizontal-lines', { warpAmount: 50, warpFrequency: 6 })), warped);
});

test('falloff is normalised, periodic and bounded', () => {
  const P = { ...TEXTURE_DEFAULTS, falloff: 'radial' as const, falloffCenterX: 25, falloffCenterY: 75, falloffRadius: 40 };
  assert.equal(falloffAt(P, 16, 48), 1);                                   // centre
  assert.equal(falloffAt(P, 16 + 0.4 * 64, 48), 0);                        // at the radius
  assert.ok(Math.abs(falloffAt(P, 20, 40) - falloffAt(P, 20 + 64, 40 - 64)) < 1e-9); // periodic
  assert.ok(Math.abs(falloffAt({ ...P, falloff: 'smooth' }, 20, 50) - falloffAt({ ...P, falloff: 'smooth' }, 84, 50)) < 1e-9);
  assert.equal(falloffAt({ ...P, falloff: 'edge' }, 16, 48), 0);
  assert.equal(falloffAt({ ...P, falloff: 'none' }, 3, 3), 1);
  const linear = { ...P, falloff: 'linear' as const };
  assert.ok(Math.abs(falloffAt(linear, 10, 5) - falloffAt(linear, 10 + 64, 5)) < 1e-9);
  for (let i = 0; i < 200; i++) { const v = falloffAt({ ...P, falloff: ['linear', 'radial', 'smooth', 'edge'][i % 4] as never }, (i * 7.3) % 64, (i * 3.1) % 64); assert.ok(v >= 0 && v <= 1); }
  // and it changes the output
  assert.notEqual(textureTileSvg(tex('dots-halftone', { falloff: 'radial', falloffTarget: 'size' })), textureTileSvg(tex('dots-halftone')));
});

test('old projects load: legacy ids migrate, new fields get defaults, existing values survive', () => {
  const legacyTexture = { enabled: true, pattern: 'dots-10', scale: 48, density: 61, opacity: 33, angle: 12, seed: 7, color: '#aabbcc', backgroundEnabled: false, backgroundColor: '#10131a', backgroundOpacity: 100, contrast: 100, softness: 0, offsetX: 3, offsetY: 4, blend: 'multiply' };
  const project = normalizeProject({ ...newProject(), layers: [{ ...newLayer('linear'), texture: legacyTexture }] });
  const t = project.layers[0].texture;
  assert.equal(t.pattern, 'dots-diamond-dots');
  assert.equal(t.scale, 48); assert.equal(t.density, 61); assert.equal(t.opacity, 33); assert.equal(t.blend, 'multiply'); assert.equal(t.color, '#aabbcc');
  for (const control of CONTROLS) assert.equal(t[control.id], control.def, control.id);
  // garbage is repaired, not trusted
  const bad = normalizeTexture({ pattern: 'nope', motifSize: 9999, spacingX: 'x', color: '"/><script>', opacity: -5, falloff: 'weird', extra: 'kept' }) as TextureData & { extra: string };
  assert.equal(bad.pattern, DEFAULT_TEXTURE.pattern); assert.equal(bad.motifSize, 300); assert.equal(bad.spacingX, 100);
  assert.equal(bad.color, '#ffffff'); assert.equal(bad.opacity, 0); assert.equal(bad.falloff, 'none'); assert.equal(bad.extra, 'kept');
  assertValidSvg(textureTileSvg(bad), 'repaired texture');
  assert.ok(!textureTileSvg({ ...DEFAULT_TEXTURE, color: '"/><script>alert(1)</script>' }).includes('script'));
});

test('settings survive JSON export / import, and layers never share default state', () => {
  const layer = newLayer('linear', { texture: { ...DEFAULT_TEXTURE, enabled: true, pattern: 'waves-soft-waves', warpAmount: 33, falloff: 'smooth', motifSize: 150 } });
  const again = normalizeProject(JSON.parse(JSON.stringify({ ...newProject(), layers: [layer] }))).layers[0].texture;
  assert.deepEqual(again, normalizeTexture(layer.texture));
  const a = newLayer('linear'), b = newLayer('linear');
  a.texture.motifSize = 222;
  assert.equal(b.texture.motifSize, 100); assert.equal(DEFAULT_TEXTURE.motifSize, 100);
});

test('overlay helper: single source for tile, size, offset, opacity and seamless rotation', () => {
  const plain = textureOverlay(tex('lines-horizontal-lines', { scale: 40, seed: 3, offsetX: 5, offsetY: -2, angle: 0 }));
  assert.equal(plain.rotation, 0); assert.equal(plain.size, 40); assert.equal(plain.offsetX, Math.round(3 * 13 + 5) % 40);
  const turned = textureOverlay(tex('lines-horizontal-lines', { angle: 37 }));
  assert.equal(turned.rotation, 37);
  assert.ok(!decodeURIComponent(turned.href).includes('rotate('), 'the tile stays axis-aligned; the consumer rotates the whole repeat');
  assert.match(textureTileSvg(tex('lines-horizontal-lines', { angle: 37 })), /transform="rotate\(37 32 32\)"/); // flat output still bakes it
});

test('the cache never returns a tile for different settings, but ignores settings that do not change the tile', () => {
  const base = tex('dots-halftone');
  assert.equal(textureTileSvg(base), textureTileSvg({ ...base, offsetX: 40, scale: 90, blend: 'multiply' }));
  assert.notEqual(textureTileSvg(base), textureTileSvg({ ...base, color: '#ff0000' }));
  assert.notEqual(textureTileSvg(base), textureTileSvg({ ...base, density: 80 }));
  assert.notEqual(textureTileSvg(base), textureTileSvg({ ...base, backgroundEnabled: true }));
  assert.notEqual(textureTileSvg(base), textureTileSvg({ ...base, softness: 2 }));
});

test('the controls offered match what the preset can do', () => {
  const ids = (id: string) => textureSupport(tex(id)).controls.map(c => c.control.id);
  assert.ok(!ids('grain-film-grain').includes('distribution') && !ids('grain-film-grain').includes('warpAmount'));
  assert.ok(ids('grain-film-grain').includes('threshold') && ids('grain-film-grain').includes('octaves'));
  assert.ok(ids('dots-halftone').includes('distribution') && ids('dots-halftone').includes('warpAmount') && !ids('dots-halftone').includes('threshold'));
  assert.ok(ids('crosshatch-crosshatch').includes('crossingAngle') && !ids('dots-halftone').includes('crossingAngle'));
  assert.ok(ids('woven-twill').includes('overUnderContrast') && ids('lines-broken-lines').includes('dashLength'));
  assert.ok(!ids('dots-halftone').includes('warpFrequency'), 'distortion sub-controls stay hidden while distortion is 0');
  assert.ok(textureSupport(tex('dots-halftone', { warpAmount: 20 })).controls.some(c => c.control.id === 'warpFrequency'));
  assert.equal(textureSupport(tex('waves-soft-waves')).controls.find(c => c.control.id === 'motifSize')?.label, 'Amplitude');
  assert.ok(textureSupport(tex('grain-film-grain')).notes.length > 0);
  assert.ok(textureSupport(tex('lines-scratched-surface', { falloff: 'radial' })).controls.find(c => c.control.id === 'falloffTarget')?.options?.some(option => option.id === 'stroke'));
});

test('spatial falloff can change stroke width in a manually positioned tile area', () => {
  const base = tex('lines-scratched-surface', {
    strokeWidth: 300, falloff: 'radial', falloffTarget: 'stroke', falloffStrength: 100,
    falloffCenterX: 24, falloffCenterY: 72, falloffRadius: 18,
  });
  const uniform = textureTileSvg({ ...base, falloff: 'none' });
  const localized = textureTileSvg(base);
  const uniformWidths = numbers(uniform, 'path', 'stroke-width');
  const localizedWidths = numbers(localized, 'path', 'stroke-width');
  assert.notDeepEqual(localizedWidths, uniformWidths);
});

test('every control changes the output of a preset that supports it', () => {
  const sample: Record<string, string> = {
    motifSize: 'dots-halftone', spacingX: 'dots-halftone', spacingY: 'dots-halftone', aspectRatio: 'dots-halftone', shape: 'dots-halftone', distribution: 'dots-halftone',
    sizeVariation: 'dots-halftone', positionJitter: 'dots-halftone', angleVariation: 'lines-horizontal-lines', opacityVariation: 'dots-halftone', coverage: 'dots-halftone',
    threshold: 'grain-film-grain', octaves: 'grain-film-grain', strokeWidth: 'lines-horizontal-lines', dashLength: 'lines-horizontal-lines', dashGap: 'lines-horizontal-lines',
    lineBreakup: 'lines-horizontal-lines', crossingAngle: 'crosshatch-crosshatch', secondaryStrength: 'crosshatch-crosshatch', cornerRadius: 'geometric-checkerboard',
    symmetry: 'dots-halftone', weaveInterval: 'woven-canvas-weave', overUnderContrast: 'woven-canvas-weave', phase: 'dots-halftone',
    warpAmount: 'lines-horizontal-lines', warpFrequency: 'lines-horizontal-lines', warpX: 'lines-horizontal-lines', warpY: 'lines-horizontal-lines', warpOctaves: 'lines-horizontal-lines',
    falloff: 'dots-halftone', falloffTarget: 'dots-halftone', falloffStrength: 'dots-halftone', falloffCenterX: 'dots-halftone', falloffCenterY: 'dots-halftone', falloffRadius: 'dots-halftone', falloffAngle: 'dots-halftone',
    detailAmount: 'dots-halftone', detailScale: 'dots-halftone', detailDensity: 'dots-halftone',
  };
  const context: Partial<Record<string, Partial<TextureData>>> = {
    dashGap: { dashLength: 6 }, symmetry: { shape: 'star' }, warpFrequency: { warpAmount: 60 }, warpX: { warpAmount: 60, warpY: 0 }, warpY: { warpAmount: 60, warpX: 0 }, warpOctaves: { warpAmount: 60 },
    falloffTarget: { falloff: 'radial', falloffTarget: 'opacity' }, falloffStrength: { falloff: 'radial', falloffTarget: 'size' }, falloffCenterX: { falloff: 'radial', falloffTarget: 'size' },
    falloffCenterY: { falloff: 'radial', falloffTarget: 'size' }, falloffRadius: { falloff: 'radial', falloffTarget: 'size' }, falloffAngle: { falloff: 'linear', falloffTarget: 'size' },
    detailScale: { detailAmount: 70 }, detailDensity: { detailAmount: 70 }, falloff: { falloffTarget: 'size' }, aspectRatio: { shape: 'square' }, weaveInterval: {},
  };
  const alt: Partial<Record<string, number | string>> = { shape: 'star', distribution: 'random', falloff: 'radial', falloffTarget: 'size', weaveInterval: 2, crossingAngle: 60, symmetry: 7, falloffAngle: 90 };
  for (const control of CONTROLS) {
    const id = sample[control.id];
    assert.ok(id, `no sample preset for ${control.id}`);
    const base = { ...(context[control.id] ?? {}) };
    const target = alt[control.id] ?? (typeof control.def === 'number' ? (control.def < (control.max! + control.min!) / 2 ? Math.round(control.max! * 0.7) : Math.round(control.min! + (control.max! - control.min!) * 0.2)) : control.options!.find(o => o.id !== control.def)!.id);
    const before = textureTileSvg(tex(id, base)), after = textureTileSvg(tex(id, { ...base, [control.id]: target } as Partial<TextureData>));
    assert.notEqual(after, before, `${control.id} on ${id} has no effect`);
  }
});

test('extreme control values stay valid and bounded', () => {
  const at = (pick: 'min' | 'max') => Object.fromEntries(CONTROLS.filter(c => c.type === 'range').map(c => [c.id, c[pick]])) as Partial<TextureData>;
  for (const preset of TEXTURES) {
    for (const extra of [at('min'), at('max'), { ...at('max'), falloff: 'smooth', falloffTarget: 'opacity', shape: 'star', distribution: 'poisson' } as Partial<TextureData>, { density: 100, scale: 4096, softness: 20, contrast: 300 }]) {
      const svg = textureTileSvg(tex(preset.id, extra));
      assertValidSvg(svg, preset.id);
      assert.ok(svg.length < 260_000, `${preset.id}: ${svg.length} chars`);
    }
  }
});

test('tileable slopes snap to directions that repeat on the tile', () => {
  assert.deepEqual(tileableSlope(45), [1, 1]);
  assert.deepEqual(tileableSlope(135), [1, -1]);
  const [a, b] = tileableSlope(30);
  assert.ok(Math.abs((Math.atan2(b, a) * 180) / Math.PI - 30) < 3);
});
