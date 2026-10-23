import { TEXTURES, slugify, type TexturePreset } from './texturePresets';
import { describeLayers, type CellsLayer, type Layer, type LayerInfo, type LineSet, type NoiseLayer, type RingsLayer, type ScatterLayer, type StrokesLayer, type TilingLayer, type WavesLayer, type WeaveLayer } from './textureMotifs';
import { clamp, tileableSlope } from './textureMath';

/* ═══════════════════════════ Preset recipes ═══════════════════════════
 * Every preset is an explicit recipe — a list of layers with named numbers — instead of a label lookup buried in a
 * long if-chain. The numbers that used to depend on the preset's list position (`gap`, `stroke`) are computed from
 * `variant` here once, in one place, so re-ordering the library can never silently change a texture.
 * `density` keeps its legacy meaning: more density → tighter pitch, heavier strokes, stronger noise, more specks.
 */

interface RC { d: number; v: number; gap: number; stroke: number }
type Recipe = (c: RC) => Layer[];
type Pair = [number, number];

const N = (freq: number, oct: number, type: NoiseLayer['type'], a: number, extra: Partial<NoiseLayer> = {}): NoiseLayer => ({ k: 'noise', freq, oct, type, a, ...extra });
const S = (o: Omit<ScatterLayer, 'k'>): ScatterLayer => ({ k: 'scatter', ...o });
const ST = (o: Omit<StrokesLayer, 'k'>): StrokesLayer => ({ k: 'strokes', ...o });
const H = (pitch: number, w: number, extra: Partial<LineSet> = {}): LineSet => ({ dir: 'h', pitch, w, ...extra });
const V = (pitch: number, w: number, extra: Partial<LineSet> = {}): LineSet => ({ dir: 'v', pitch, w, ...extra });
const D = (dir: Pair, pitch: number, w: number, extra: Partial<LineSet> = {}): LineSet => ({ dir, pitch, w, ...extra });
const LN = (sets: LineSet[], extra: { cross?: boolean; nodes?: number; glitch?: boolean } = {}): Layer => ({ k: 'lines', sets, ...extra });
const W = (o: Omit<WavesLayer, 'k'>): WavesLayer => ({ k: 'waves', ...o });
const RG = (o: Omit<RingsLayer, 'k'>): RingsLayer => ({ k: 'rings', ...o });
const CE = (o: Omit<CellsLayer, 'k'>): CellsLayer => ({ k: 'cells', ...o });
const TL = (o: Omit<TilingLayer, 'k'>): TilingLayer => ({ k: 'tiling', ...o });
const WV = (o: Omit<WeaveLayer, 'k'>): WeaveLayer => ({ k: 'weave', ...o });
const HEX = 0.866;

const RECIPES = new Map<string, Recipe>();
const def = (family: string, label: string, recipe: Recipe) => { RECIPES.set(`${family}-${slugify(label)}`, recipe); };

/* ───────────── grain ───────────── */
const filmNoise = (fine: boolean, grainy: boolean): Recipe => c => [N(fine ? 0.42 + c.v * 0.001 : 0.12 + c.v * 0.0037, fine ? 1 : 3, grainy ? 'turbulence' : 'fractalNoise', c.d / 100)];
for (const label of ['Film grain', 'Fine film', 'Coarse film', 'Vintage grain', 'Analog grain', '35mm grain', 'Super 8 grain', 'Pushed film']) def('grain', label, filmNoise(false, true));
for (const label of ['Sensor noise', 'Fine Grain']) def('grain', label, filmNoise(true, true));
def('grain', 'Digital Noise', filmNoise(true, false));
def('grain', 'Monochrome Noise', filmNoise(false, false));
def('grain', 'Gaussian Noise', c => [N(0.19, 4, 'fractalNoise', c.d / 100)]);
def('grain', 'Cloud noise', filmNoise(false, false));
def('grain', 'Silver grain', c => [N(0.31, 1, 'turbulence', (c.d / 100) * 0.8), S({ dist: 'random', count: 20 * (c.d / 50), pitch: 14, r: 0.7, rv: [0.45, 1.2], ov: [0.4, 0.9], shape: 'circle' })]);
def('grain', 'Soft noise', c => [N(0.035, 3, 'fractalNoise', c.d / 120)]);
def('grain', 'Dust noise', c => [S({ dist: 'random', count: 36 * (c.d / 50), pitch: 10, r: 0.9, rv: [0.35, 1.5], ov: [0.3, 1], shape: 'circle' })]);
const rgb = (freq: number, oct: number): Recipe => c => [N(freq, oct, 'fractalNoise', Math.min(1, (c.d / 100) * 1.1), { color: '#ff3b4a', seed: 11, cut: 0.42 }), N(freq, oct, 'fractalNoise', Math.min(1, (c.d / 100) * 1.1), { color: '#35ff8a', seed: 23, cut: 0.42 }), N(freq, oct, 'fractalNoise', Math.min(1, (c.d / 100) * 1.1), { color: '#3b8cff', seed: 37, cut: 0.42 })];
def('grain', 'Colour noise', rgb(0.38, 2)); def('grain', 'Color Noise', rgb(0.52, 2)); def('grain', 'RGB Noise', rgb(0.7, 1));
def('grain', 'Paper speckle', c => [S({ dist: 'random', count: 38 * (c.d / 50), pitch: 10, r: 0.8, rv: [0.4, 1.3], ov: [0.35, 0.9], shape: 'circle' })]);
def('grain', 'Fractal Noise', c => [N(0.08, 5, 'fractalNoise', c.d / 100)]);
def('grain', 'Perlin Noise', c => [N(0.06, 4, 'fractalNoise', c.d / 100)]);
def('grain', 'Simplex Noise', c => [N(0.05, 3, 'fractalNoise', c.d / 100)]);
def('grain', 'Cellular Noise (Worley)', c => [CE({ dist: 'random', count: 26 * (c.d / 50) + 8, w: 0.55, o: 0.9, irregular: 0.9 })]);
def('grain', 'Displacement Noise', c => [N(0.04, 2, 'turbulence', c.d / 100)]);
def('grain', 'Pixel Noise', c => [S({ dist: 'grid', pitch: 4, r: 1.7, shape: 'square', ov: [0.1, 1], cover: 0.55 })]);
def('grain', 'Dithering', c => [S({ dist: 'staggered', diamond: true, pitch: 3.4, r: 0.85, shape: 'square', rv: [0.55, 1], ov: [0.5, 1], cover: c.d / 100 + 0.25 })]);
def('grain', 'Chromatic Aberration', c => [LN([H(12, 4 * (0.6 + c.d / 120), { color: '#ff2858', off: 0.34, span: [4, 60], o: 0.85 }), H(12, 2, { color: '#20e8ff', off: 0.66, span: [4, 60], o: 0.8 })])]);
def('grain', 'Glitch Art', c => [LN([H(12, 1.2 + c.d / 90)], { glitch: true })]);

/* ───────────── dots ───────────── */
const dotR = (c: RC, bold: boolean, tiny: boolean) => Math.max(0.45, ((bold ? 2 : 1) * c.d) / (tiny ? 90 : 55));
const step = (c: RC, f = 1) => Math.max(3, c.gap * f);
const halftone = (opts: { f?: number; tiny?: boolean; bold?: boolean; diamond?: boolean; rScale?: number; grid?: boolean; jit?: number; rv?: Pair }): Recipe => c => [S({ dist: opts.grid ? 'grid' : 'staggered', diamond: !!opts.diamond, pitch: step(c, opts.f ?? 1), r: dotR(c, !!opts.bold, !!opts.tiny) * (opts.rScale ?? 1), shape: 'circle', jit: opts.jit, rv: opts.rv })];
def('dots', 'Halftone', halftone({})); def('dots', 'Fine halftone', halftone({ f: 0.62, tiny: true, diamond: true })); def('dots', 'Bold halftone', halftone({ bold: true }));
def('dots', 'Micro dots', halftone({ f: 0.62, rScale: 0.7 })); def('dots', 'Wide dots', halftone({ f: 1.45, bold: true }));
def('dots', 'Offset dots', halftone({ diamond: true })); def('dots', 'Pin dots', halftone({ grid: true, rScale: 0.7 })); def('dots', 'Screen print', halftone({ f: 1.1, rScale: 1.2 }));
def('dots', 'Classic Halftone', halftone({ diamond: true })); def('dots', 'Dense Halftone', halftone({ f: 0.62 })); def('dots', 'Circular Dots', halftone({ grid: true, rScale: 1.2 }));
def('dots', 'Microdots', halftone({ f: 0.62, tiny: true })); def('dots', 'Polka Dots', halftone({ f: 1.3, bold: true })); def('dots', 'Ben-Day Dots', halftone({ diamond: true, rScale: 1.3 }));
def('dots', 'Stochastic Halftone', halftone({ jit: 0.7, rv: [0.6, 1.4] }));
const speckle = (count: number, r: number, rv: Pair, ov: Pair = [0.35, 1], burst?: number): Recipe => c => [S({ dist: burst ? 'radial' : 'random', burst, count: count * (c.d / 55), pitch: 8, r, rv, ov, shape: 'circle' })];
def('dots', 'Stipple', speckle(40, 0.75, [0.4, 1.3])); def('dots', 'Dense stipple', speckle(150, 0.6, [0.4, 1.2])); def('dots', 'Sparse stipple', speckle(18, 1.1, [0.6, 1.5]));
def('dots', 'Scatter dots', speckle(40, 1.2, [0.5, 1.6])); def('dots', 'Random Speckles', speckle(60, 0.5, [0.3, 1.4])); def('dots', 'Stone Speckles', speckle(90, 0.6, [0.3, 1.6], [0.3, 0.9]));
def('dots', 'Ink Splatter', speckle(34, 1.2, [0.25, 2.6], [0.6, 1], 1.8)); def('dots', 'Spray Paint', speckle(120, 0.55, [0.3, 1.1], [0.3, 0.9], 1.3));
def('dots', 'Diamond dots', c => [S({ dist: 'staggered', diamond: true, pitch: step(c), r: dotR(c, false, false) * 1.5, shape: 'diamond' })]);
def('dots', 'Roundel', c => [S({ dist: 'grid', pitch: step(c, 1.2), r: 2.4, shape: 'ring' })]);
def('dots', 'Rosette', c => [RG({ n: 4, r0: 7, dr: 5, w: 0.7 * c.stroke * 0.5, spokes: 12 })]);

/* ───────────── lines ───────────── */
const hLines = (pf: number, wf: number, extra: Partial<LineSet> = {}): Recipe => c => [LN([H(step(c, pf), c.stroke * wf, extra)])];
const vLines = (pf: number, wf: number, extra: Partial<LineSet> = {}): Recipe => c => [LN([V(step(c, pf), c.stroke * wf, extra)])];
def('lines', 'Horizontal lines', hLines(1, 1)); def('lines', 'Fine horizontal', hLines(0.55, 0.6)); def('lines', 'Wide horizontal', hLines(1.5, 2));
def('lines', 'Vertical lines', vLines(1, 1)); def('lines', 'Fine vertical', vLines(0.55, 0.6)); def('lines', 'Wide vertical', vLines(1.5, 2));
def('lines', 'Diagonal lines', c => [LN([D([1, 1], step(c), c.stroke)])]); def('lines', 'Fine diagonal', c => [LN([D([1, 1], step(c, 0.55), c.stroke * 0.6)])]);
def('lines', 'Scanlines', c => [LN([H(4, 0.9, { o: 0.4 + c.d / 150 })])]);
def('lines', 'Broken lines', hLines(1, 1, { dash: [8, 5] })); def('lines', 'Long dash', hLines(1, 0.9, { dash: [14, 6] })); def('lines', 'Short dash', hLines(1, 0.9, { dash: [4, 4] }));
def('lines', 'Pinstripe', vLines(1, 0.25, { o: 0.9 }));
def('lines', 'Slanted bands', c => [LN([D([1, 1], step(c, 1.6), c.stroke * 3, { o: 0.7 })])]);
def('lines', 'Parallel strokes', c => [LN([D([2, 1], step(c, 0.8), c.stroke * 0.7)])]);
def('lines', 'Horizontal Stripes', hLines(1.3, 2.2)); def('lines', 'Vertical Stripes', vLines(1.3, 2.2));
def('lines', 'Moiré Lines', c => [LN([D(tileableSlope(4, 12), step(c, 0.45), c.stroke * 0.35, { o: 0.85 }), D(tileableSlope(-4, 12), step(c, 0.45), c.stroke * 0.35, { o: 0.85 })])]);
def('lines', 'Scratched Surface', c => [ST({ dist: 'random', count: 26 * (c.d / 50), len: 14, lv: 0.6, w: 0.35, angle: 20, spread: 35, ov: [0.25, 0.8] })]);
def('lines', 'Worn Ink', c => [ST({ dist: 'random', count: 30 * (c.d / 50), len: 9, lv: 0.7, w: 0.5, angle: 0, spread: 90, ov: [0.3, 0.9] })]);
def('lines', 'Cracked Ink', c => [CE({ dist: 'random', count: 14 * (c.d / 50) + 4, w: 0.5, o: 0.9, irregular: 0.9 })]);

/* ───────────── crosshatch ───────────── */
const hatch = (pf: number, wf: number, extra: Partial<LineSet> = {}): Recipe => c => [LN([D([1, 1], step(c, pf), c.stroke * wf, extra), D([1, -1], step(c, pf), c.stroke * wf, extra)], { cross: true })];
def('crosshatch', 'Crosshatch', hatch(1, 1)); def('crosshatch', 'Fine crosshatch', hatch(0.55, 0.6)); def('crosshatch', 'Loose crosshatch', hatch(1.5, 1));
def('crosshatch', 'Etching', hatch(0.6, 0.45)); def('crosshatch', 'Woven hatch', hatch(0.9, 0.9, { dash: [5, 4] })); def('crosshatch', 'Diagonal mesh', hatch(0.8, 0.5, { o: 0.85 }));
def('crosshatch', 'Dense hatch', hatch(0.45, 0.5));
def('crosshatch', 'Engraving', c => [LN([H(step(c, 0.7), c.stroke * 0.45), D([1, 1], step(c, 0.7), c.stroke * 0.45)])]);
def('crosshatch', 'Copperplate', c => [LN([D([1, 1], step(c, 0.8), c.stroke * 0.4), D([1, -1], step(c, 0.8), c.stroke * 0.4), H(step(c, 0.8), c.stroke * 0.3, { o: 0.7 })], { cross: true })]);
def('crosshatch', 'Double hatch', c => [LN([D([1, 1], step(c), c.stroke * 0.7), D([1, -1], step(c), c.stroke * 0.7), D([1, 1], step(c, 0.5), c.stroke * 0.35, { o: 0.7 })], { cross: true })]);
def('crosshatch', 'Sketch marks', c => [ST({ dist: 'random', count: 24 * (c.d / 50), len: 10, lv: 0.4, w: 0.5, angle: 45, spread: 14, ov: [0.4, 0.9] }), ST({ dist: 'random', count: 24 * (c.d / 50), len: 10, lv: 0.4, w: 0.5, angle: -45, spread: 14, ov: [0.4, 0.9] })]);
def('crosshatch', 'Lattice', c => [LN([H(step(c), c.stroke * 0.5), V(step(c), c.stroke * 0.5)])]);
def('crosshatch', 'Waffle hatch', c => [LN([H(step(c, 1.2), c.stroke * 1.4), V(step(c, 1.2), c.stroke * 1.4)])]);
def('crosshatch', 'Basket hatch', c => [WV({ pitch: step(c, 0.5), w: c.stroke * 1.2, interval: 2, basket: true })]);
def('crosshatch', 'Crisscross', c => [LN([D([1, 2], step(c), c.stroke * 0.8), D([1, -2], step(c), c.stroke * 0.8)], { cross: true })]);
def('crosshatch', 'Diagonal Hatching', c => [LN([D(tileableSlope(60), step(c), c.stroke * 0.8), D(tileableSlope(150), step(c), c.stroke * 0.8)], { cross: true })]);
def('crosshatch', 'Crosshatching', c => [LN([D(tileableSlope(70), step(c), c.stroke * 0.8), D(tileableSlope(160), step(c), c.stroke * 0.8)], { cross: true })]);

/* ───────────── grid ───────────── */
const grid = (pf: number, wf: number, extra: Partial<LineSet> = {}, layer: { nodes?: number } = {}): Recipe => c => [LN([H(step(c, pf), c.stroke * wf, extra), V(step(c, pf), c.stroke * wf, extra)], layer)];
def('grid', 'Square grid', grid(1, 0.5)); def('grid', 'Fine grid', grid(0.55, 0.35)); def('grid', 'Bold grid', grid(1.3, 1.2));
def('grid', 'Dashed grid', grid(1, 0.5, { dash: [4, 3] })); def('grid', 'Micro grid', c => [LN([H(Math.max(4, c.gap / 2), c.stroke * 0.3), V(Math.max(4, c.gap / 2), c.stroke * 0.3)])]);
def('grid', 'Graph paper', c => [LN([H(step(c, 0.35), c.stroke * 0.5, { major: { every: 4, minor: 0.45 } }), V(step(c, 0.35), c.stroke * 0.5, { major: { every: 4, minor: 0.45 } })])]);
def('grid', 'Blueprint grid', c => [LN([H(step(c, 0.3), c.stroke * 0.5, { major: { every: 5, minor: 0.4 } }), V(step(c, 0.3), c.stroke * 0.5, { major: { every: 5, minor: 0.4 } })])]);
def('grid', 'Major-minor grid', c => [LN([H(step(c, 0.45), c.stroke * 0.6, { major: { every: 4, minor: 0.4 } }), V(step(c, 0.45), c.stroke * 0.6, { major: { every: 4, minor: 0.4 } })])]);
def('grid', 'Isometric grid', c => [LN([V(step(c, 0.9), c.stroke * 0.5), D([2, 1], step(c, 0.9), c.stroke * 0.5), D([2, -1], step(c, 0.9), c.stroke * 0.5)])]);
def('grid', 'Dot grid', c => [S({ dist: 'grid', pitch: step(c, 0.7), r: 0.8, shape: 'circle' })]);
def('grid', 'Rounded grid', c => [TL({ form: 'frames', pitch: step(c, 1.1), w: c.stroke * 0.4 })]);
def('grid', 'Perspective grid', c => [TL({ form: 'rays', pitch: step(c, 1.1), w: c.stroke * 0.35 })]);
def('grid', 'Offset grid', c => [LN([H(step(c), c.stroke * 0.5, { off: 0.5 }), V(step(c), c.stroke * 0.5, { off: 0 })])]);
def('grid', 'Tech grid', c => [LN([H(step(c), c.stroke * 0.4), V(step(c), c.stroke * 0.4)], { nodes: Math.max(0.6, c.stroke * 0.55) })]);
def('grid', 'Hex grid', c => [TL({ form: 'hex', pitch: step(c, 1.3), ratio: HEX, w: c.stroke * 0.5 })]);
def('grid', 'Hexagonal Grid', c => [TL({ form: 'hex', pitch: step(c, 1.0), ratio: HEX, w: c.stroke * 0.4 })]);
def('grid', 'Triangular Pattern', c => [TL({ form: 'tri', pitch: step(c, 1.1), ratio: HEX, w: c.stroke * 0.45 })]);

/* ───────────── waves ───────────── */
const waves = (pf: number, lambda: number, amp: number, wf: number, extra: Partial<WavesLayer> = {}): Recipe => c => [W({ pitch: step(c, pf), lambda, amp, w: c.stroke * wf, ...extra })];
def('waves', 'Soft waves', waves(1, 32, 3.5, 0.55)); def('waves', 'Tight waves', waves(0.6, 16, 2.2, 0.5)); def('waves', 'Wide waves', waves(1.4, 64, 6, 0.6));
def('waves', 'Contour lines', waves(0.9, 32, 4, 0.5, { h2: 0.6, phaseRand: 1 })); def('waves', 'Tide lines', waves(1.1, 64, 2.4, 0.5, { h2: 0.4, ov: [0.5, 1] }));
def('waves', 'Drift waves', waves(1, 64, 5, 0.55, { phaseStep: 0.08 })); def('waves', 'Pulse waves', waves(1.1, 16, 3, 0.55, { form: 'tri' }));
def('waves', 'Sine mesh', c => [W({ pitch: step(c, 1.1), lambda: 32, amp: 3, w: c.stroke * 0.45 }), W({ pitch: step(c, 1.1), lambda: 21.3, amp: 3, w: c.stroke * 0.45, phaseRand: 0.5, o: 0.7 })]);
def('waves', 'Interference', c => [W({ pitch: step(c, 0.8), lambda: 32, amp: 2.6, w: c.stroke * 0.4 }), W({ pitch: step(c, 0.85), lambda: 32, amp: 2.6, w: c.stroke * 0.4, phaseStep: 0.05 })]);
def('waves', 'Moire waves', c => [W({ pitch: step(c, 0.8), lambda: 32, amp: 2.4, w: c.stroke * 0.4 }), W({ pitch: step(c, 0.88), lambda: 32, amp: 2.4, w: c.stroke * 0.4 })]);
def('waves', 'Water ripples', c => [RG({ n: 5, r0: 5, dr: 5, w: c.stroke * 0.5, centers: [[18, 20], [46, 44]] })]);
def('waves', 'Ripple field', c => [RG({ n: 3, r0: 3, dr: 4, w: c.stroke * 0.45, centers: [[16, 16], [48, 20], [20, 48], [46, 46]] })]);
def('waves', 'Sound waves', c => [RG({ n: 7, r0: 6, dr: 6, w: c.stroke * 0.5, centers: [[8, 32]], wobble: 0.02 })]);
def('waves', 'Topographic', c => [RG({ n: 6, r0: 4, dr: 3.6, w: c.stroke * 0.45, centers: [[24, 28], [48, 44]], wobble: 0.12 })]);
def('waves', 'Topographic Contours', c => [RG({ n: 7, r0: 3, dr: 3, w: c.stroke * 0.4, centers: [[22, 22], [46, 46]], wobble: 0.16 })]);
def('waves', 'Flow lines', c => [ST({ dist: 'flow', count: 90 * (c.d / 50), len: 9, w: 0.6, angle: 0, spread: 0, curve: 0.2, ov: [0.5, 1] })]);
def('waves', 'Fluid Swirls', c => [ST({ dist: 'flow', count: 70 * (c.d / 50), len: 14, w: 0.9, angle: 0, spread: 0, curve: 0.6, ov: [0.4, 0.9] })]);
def('waves', 'Marble', c => [N(0.025, 4, 'turbulence', (c.d / 100) * 0.7), W({ pitch: step(c, 1.6), lambda: 64, amp: 5, w: 0.6, h2: 0.7, phaseRand: 1, o: 0.5 })]);
def('waves', 'Marbling', c => [N(0.018, 5, 'turbulence', (c.d / 100) * 0.7), W({ pitch: step(c, 1.4), lambda: 32, amp: 4, w: 0.5, h2: 0.8, phaseRand: 1, o: 0.45 })]);
def('waves', 'Dried Mud Cracks', c => [CE({ dist: 'random', count: 16 * (c.d / 50) + 4, w: 0.7, o: 0.9, irregular: 0.95 })]);
def('waves', 'Wood Grain', c => [W({ pitch: step(c, 0.5), lambda: 64, amp: 2.5, w: c.stroke * 0.4, h2: 0.5, phaseRand: 0.7, ov: [0.5, 1] }), RG({ n: 4, r0: 2, dr: 2.4, w: 0.5, centers: [[40, 22]], ratio: 0.6, wobble: 0.1, o: 0.8 })]);
def('waves', 'Tree Bark', c => [ST({ dist: 'random', count: 46 * (c.d / 50), len: 16, lv: 0.6, w: 0.9, angle: 90, spread: 10, ov: [0.4, 1] })]);
def('waves', 'Cloud Texture', c => [N(0.02, 4, 'fractalNoise', c.d / 100)]);
def('waves', 'Smoke', c => [N(0.015, 5, 'fractalNoise', (c.d / 100) * 0.8)]);
def('waves', 'Fog', c => [N(0.008, 3, 'fractalNoise', c.d / 130)]);
def('waves', 'Fractal Clouds', c => [N(0.012, 6, 'fractalNoise', c.d / 100)]);
def('waves', 'Ink in Water', c => [N(0.02, 5, 'turbulence', (c.d / 100) * 0.7)]);
def('waves', 'Turbulence', c => [N(0.05, 4, 'turbulence', (c.d / 100) * 0.9), W({ pitch: step(c, 1.2), lambda: 32, amp: 2, w: 0.4, o: 0.4 })]);
def('waves', 'Watercolor Bleed', c => [N(0.03, 4, 'fractalNoise', (c.d / 100) * 0.6), S({ dist: 'random', count: 5, pitch: 24, r: 7, rv: [0.5, 1.4], ov: [0.1, 0.3], shape: 'circle' })]);

/* ───────────── geometric ───────────── */
def('geometric', 'Checkerboard', c => [TL({ form: 'checker', pitch: 16, w: 0, o: 0.5 + c.d / 200 })]);
def('geometric', 'Fine checker', c => [TL({ form: 'checker', pitch: 8, w: 0, o: 0.5 + c.d / 200 })]);
def('geometric', 'Diamond', c => [TL({ form: 'diamond', pitch: 16, w: c.stroke * 0.5, cross: true })]);
def('geometric', 'Tessellation', c => [TL({ form: 'diamond', pitch: 21.3, w: c.stroke * 0.5 })]);
def('geometric', 'Triangles', c => [TL({ form: 'tri', pitch: 21.3, ratio: HEX, w: c.stroke * 0.5 })]);
def('geometric', 'Honeycomb', c => [TL({ form: 'hex', pitch: 21.3, ratio: HEX, w: c.stroke * 0.5 })]);
def('geometric', 'Isometric cubes', c => [TL({ form: 'cubes', pitch: 26, ratio: HEX, w: c.stroke * 0.45 })]);
def('geometric', 'Scales', c => [TL({ form: 'scales', pitch: 16, w: c.stroke * 0.5 })]);
def('geometric', 'Chevron', c => [W({ pitch: 16, lambda: 21.3, amp: 5, w: c.stroke * 0.7, form: 'tri' })]);
def('geometric', 'Zigzag', c => [W({ pitch: 12.8, lambda: 16, amp: 3.2, w: c.stroke * 0.55, form: 'tri' })]);
def('geometric', 'Confetti', c => [S({ dist: 'random', count: 22 * (c.d / 50), pitch: 12, r: 1.5, rv: [0.7, 1.4], ov: [0.4, 1], shape: 'circle' })]);
def('geometric', 'Star field', c => [S({ dist: 'random', count: 26 * (c.d / 50), pitch: 12, r: 1.8, rv: [0.4, 1.5], ov: [0.4, 1], shape: 'star' })]);
def('geometric', 'Pixel blocks', c => [S({ dist: 'grid', pitch: 8, r: 3.2, shape: 'square', ov: [0.3, 0.9], cover: 0.3 + c.d / 150 })]);
def('geometric', 'Mosaic', c => [S({ dist: 'grid', pitch: 10, r: 4, shape: 'square', ov: [0.25, 0.85] })]);
def('geometric', 'Facet tiles', c => [CE({ dist: 'random', count: 9 * (c.d / 50) + 3, w: 0.8, o: 0.9, fill: 0.16, irregular: 0.8 })]);
def('geometric', 'Organic Blobs', c => [CE({ dist: 'poisson', count: 8 * (c.d / 50) + 3, w: 0.6, o: 0.8, fill: 0.3 })]);
def('geometric', 'Voronoi Cells', c => [CE({ dist: 'random', count: 20 * (c.d / 50) + 4, w: 0.7, o: 0.9 })]);

/* ───────────── woven + surfaces ───────────── */
const weave = (pitch: number, wf: number, extra: Partial<WeaveLayer> = {}): Recipe => c => [WV({ pitch, w: Math.max(1, c.stroke * wf * 0.62), o: 0.45 + c.d / 160, ...extra })];
const fibres = (count: number, len: number, angle: number, spread: number, w = 0.4): Recipe => c => [ST({ dist: 'random', count: count * (c.d / 50), len, lv: 0.5, w, angle, spread, ov: [0.3, 0.8] })];
def('woven', 'Canvas weave', weave(8, 1.1)); def('woven', 'Cotton Weave', weave(9.1, 1.1)); def('woven', 'Canvas Fabric', weave(6.4, 1.2));
def('woven', 'Twill', weave(8, 1, { interval: 2 })); def('woven', 'Carbon fiber', weave(6.4, 1.5, { interval: 2 })); def('woven', 'Denim weave', weave(6.4, 1.1, { interval: 2 }));
def('woven', 'Basket weave', weave(8, 1.2, { interval: 2, basket: true })); def('woven', 'Jute', weave(10.7, 1.7)); def('woven', 'Burlap', weave(12.8, 1.9));
def('woven', 'Silk weave', weave(4, 0.8, { o: 0.6 })); def('woven', 'Denim', c => [WV({ pitch: 6.4, w: Math.max(1, c.stroke * 0.7), o: 0.4 + c.d / 180, interval: 2 }), N(0.3, 2, 'fractalNoise', 0.25)]);
def('woven', 'Linen', c => [WV({ pitch: 6.4, w: Math.max(1, c.stroke * 0.62), o: 0.35 + c.d / 200 }), N(0.12, 2, 'fractalNoise', (c.d / 100) * 0.3)]);
def('woven', 'Paper fibers', fibres(28, 9, 0, 90)); def('woven', 'Crossed fibers', c => [ST({ dist: 'random', count: 26 * (c.d / 50), len: 12, lv: 0.5, w: 0.4, angle: 45, spread: 10, ov: [0.3, 0.8] }), ST({ dist: 'random', count: 26 * (c.d / 50), len: 12, lv: 0.5, w: 0.4, angle: -45, spread: 10, ov: [0.3, 0.8] })]);
def('woven', 'Rough paper', c => [N(0.08, 3, 'turbulence', (c.d / 100) * 0.6), ST({ dist: 'random', count: 14 * (c.d / 50), len: 8, lv: 0.5, w: 0.4, angle: 0, spread: 90, ov: [0.3, 0.7] })]);
def('woven', 'Ribbed cloth', c => [LN([V(6.4, Math.max(1.6, c.stroke * 1.1), { o: 0.8 }), H(3.2, 0.3, { o: 0.4 })])]);
def('woven', 'Felt grain', c => [N(0.3, 2, 'turbulence', (c.d / 100) * 0.6), ST({ dist: 'random', count: 60 * (c.d / 50), len: 3, lv: 0.4, w: 0.5, angle: 0, spread: 90, ov: [0.3, 0.8] })]);
def('woven', 'Herringbone', c => [W({ pitch: 10, lambda: 16, amp: 5, w: Math.max(1.4, c.stroke * 0.9), form: 'tri', phaseStep: 0.5 })]);
def('woven', 'Herringbone Weave', c => [W({ pitch: 8, lambda: 16, amp: 4, w: Math.max(1, c.stroke * 0.7), form: 'tri', phaseStep: 0.5, o: 0.8 })]);
def('woven', 'Knit stitch', c => [TL({ form: 'knit', pitch: 12, w: Math.max(1.1, c.stroke * 0.8) })]);
def('woven', 'Knitted Fabric', c => [TL({ form: 'knit', pitch: 10.7, w: Math.max(1.1, c.stroke * 0.9) })]);
def('woven', 'Wool', c => [TL({ form: 'knit', pitch: 8, w: Math.max(0.9, c.stroke * 0.65), o: 0.8 }), N(0.35, 2, 'fractalNoise', 0.2)]);
def('woven', 'Silk', c => [LN([H(2.5, 0.8, { o: 0.55, ov: [0.3, 1] })])]);
def('woven', 'Velvet', c => [ST({ dist: 'grid', count: 160 * (c.d / 50), len: 3.5, lv: 0.3, w: 0.6, angle: 90, spread: 12, ov: [0.3, 0.9] })]);
def('woven', 'Leather Grain', c => [CE({ dist: 'random', count: 40 * (c.d / 50) + 10, w: 0.4, o: 0.8, irregular: 0.9 }), N(0.2, 2, 'fractalNoise', 0.2)]);
def('woven', 'Suede', c => [N(0.45, 2, 'fractalNoise', (c.d / 100) * 0.5), ST({ dist: 'random', count: 80 * (c.d / 50), len: 2.5, lv: 0.4, w: 0.5, angle: 0, spread: 90, ov: [0.3, 0.8] })]);
def('woven', 'Rubber', c => [N(0.25, 2, 'turbulence', (c.d / 100) * 0.7), S({ dist: 'random', count: 40, pitch: 10, r: 0.6, rv: [0.4, 1.4], ov: [0.3, 0.8], shape: 'circle' })]);
def('woven', 'Brushed Metal', c => [LN([H(1.6, 0.5, { ov: [0.15, 0.7], wv: 0.5 })])]);
def('woven', 'Polished Metal', c => [LN([H(3.2, 0.8, { o: 0.35, ov: [0.2, 0.7] })]), N(0.02, 2, 'fractalNoise', 0.25)]);
def('woven', 'Ceramic Glaze', c => [N(0.035, 3, 'fractalNoise', (c.d / 100) * 0.6), S({ dist: 'random', count: 14, pitch: 14, r: 0.7, rv: [0.4, 1.3], ov: [0.3, 0.8], shape: 'circle' })]);
def('woven', 'Frosted Glass', c => [N(0.5, 2, 'fractalNoise', (c.d / 100) * 0.5), S({ dist: 'random', count: 30, pitch: 10, r: 0.5, rv: [0.4, 1.2], ov: [0.2, 0.6], shape: 'circle' })]);
def('woven', 'Embossed Surface', c => [TL({ form: 'frames', pitch: 16, w: 0.6, cross: true })]);
def('woven', 'Debossed Surface', c => [TL({ form: 'frames', pitch: 16, w: 0.6, o: 0.8, cross: true })]);
def('woven', 'Crushed Foil', c => [CE({ dist: 'random', count: 16 * (c.d / 50) + 4, w: 0.6, o: 0.8, fill: 0.1, irregular: 0.9 }), N(0.1, 2, 'fractalNoise', 0.2)]);
def('woven', 'Rust', c => [N(0.05, 4, 'turbulence', (c.d / 100) * 0.9), S({ dist: 'random', count: 40 * (c.d / 50), pitch: 10, r: 0.8, rv: [0.3, 2], ov: [0.3, 0.9], shape: 'circle' })]);
def('woven', 'Oxidation', c => [N(0.04, 3, 'fractalNoise', (c.d / 100) * 0.8), S({ dist: 'random', count: 24, pitch: 12, r: 0.7, rv: [0.3, 1.6], ov: [0.2, 0.7], shape: 'circle' })]);
def('woven', 'Peeling Paint', c => [CE({ dist: 'random', count: 7 * (c.d / 50) + 3, w: 0.8, o: 0.9, fill: 0.2, irregular: 0.95 })]);
def('woven', 'Faded Paint', c => [N(0.02, 3, 'fractalNoise', (c.d / 100) * 0.5), ST({ dist: 'random', count: 14, len: 10, lv: 0.6, w: 0.5, angle: 0, spread: 20, ov: [0.2, 0.6] })]);
def('woven', 'Weathered Surface', c => [N(0.06, 4, 'turbulence', (c.d / 100) * 0.7), CE({ dist: 'random', count: 10, w: 0.4, o: 0.5, irregular: 0.95 })]);
def('woven', 'Vintage Print', c => [N(0.5, 1, 'turbulence', (c.d / 100) * 0.4), S({ dist: 'grid', pitch: 6.4, r: 0.55, shape: 'circle', ov: [0.4, 0.9] })]);
def('woven', 'Grunge', c => [N(0.1, 4, 'turbulence', (c.d / 100) * 0.8), ST({ dist: 'random', count: 20 * (c.d / 50), len: 12, lv: 0.6, w: 0.35, angle: 25, spread: 40, ov: [0.2, 0.7] }), S({ dist: 'random', count: 30, pitch: 10, r: 0.6, rv: [0.3, 1.5], ov: [0.3, 0.9], shape: 'circle' })]);

/* ───────────── paper / material / organic ───────────── */
def('paper', 'Handmade Paper', c => [N(0.09, 3, 'turbulence', c.d / 140), ST({ dist: 'random', count: 24 * (c.d / 50), len: 9, lv: 0.5, w: 0.4, angle: 0, spread: 90, ov: [0.3, 0.8] })]);
def('paper', 'Recycled Paper', c => [N(0.12, 3, 'turbulence', c.d / 130), S({ dist: 'random', count: 44 * (c.d / 50), pitch: 9, r: 0.7, rv: [0.4, 1.4], ov: [0.3, 0.9], shape: 'circle' }), ST({ dist: 'random', count: 14, len: 8, lv: 0.5, w: 0.4, angle: 0, spread: 90, ov: [0.3, 0.7] })]);
def('paper', 'Parchment', c => [N(0.03, 4, 'fractalNoise', (c.d / 100) * 0.6), ST({ dist: 'random', count: 10, len: 8, lv: 0.5, w: 0.35, angle: 0, spread: 90, ov: [0.2, 0.6] })]);
def('paper', 'Newsprint', c => [N(0.35, 2, 'turbulence', (c.d / 100) * 0.4), LN([H(3, 0.3, { o: 0.3 })]), S({ dist: 'random', count: 30, pitch: 10, r: 0.55, rv: [0.4, 1.3], ov: [0.3, 0.8], shape: 'circle' })]);
def('paper', 'Cardstock', c => [N(0.45, 1, 'turbulence', (c.d / 100) * 0.5)]);
def('paper', 'Watercolor Paper', c => [N(0.06, 3, 'turbulence', (c.d / 100) * 0.55), ST({ dist: 'random', count: 14, len: 7, lv: 0.5, w: 0.4, angle: 0, spread: 90, ov: [0.2, 0.6] })]);
def('paper', 'Cotton Paper', fibres(36, 8, 0, 90, 0.35));
def('paper', 'Rice Paper', c => [ST({ dist: 'random', count: 22 * (c.d / 50), len: 14, lv: 0.4, w: 0.3, angle: 0, spread: 90, curve: 0.3, ov: [0.2, 0.6] })]);
def('paper', 'Crumpled Paper', c => [N(0.045, 5, 'turbulence', (c.d / 100) * 0.8), CE({ dist: 'random', count: 12, w: 0.4, o: 0.5, irregular: 0.95 })]);
def('paper', 'Torn Paper Edges', c => [N(0.07, 3, 'turbulence', (c.d / 100) * 0.4), W({ pitch: 32, lambda: 21.3, amp: 3, w: 0.6, h2: 0.8, phaseRand: 1, o: 0.8 })]);
def('material', 'Granite', c => [S({ dist: 'random', count: 140 * (c.d / 55), pitch: 6, r: 0.6, rv: [0.3, 1.6], ov: [0.25, 0.9], shape: 'circle' })]);
def('material', 'Limestone', c => [N(0.06, 3, 'fractalNoise', (c.d / 100) * 0.6), S({ dist: 'random', count: 40, pitch: 10, r: 0.6, rv: [0.3, 1.5], ov: [0.2, 0.7], shape: 'circle' })]);
def('material', 'Sandstone', c => [W({ pitch: 6, lambda: 64, amp: 1.2, w: 0.4, h2: 0.5, phaseRand: 1, o: 0.6 }), N(0.1, 3, 'turbulence', (c.d / 100) * 0.5)]);
def('material', 'Concrete', c => [N(0.09, 3, 'turbulence', (c.d / 100) * 0.7), S({ dist: 'random', count: 60 * (c.d / 50), pitch: 8, r: 0.6, rv: [0.3, 1.6], ov: [0.3, 0.9], shape: 'circle' })]);
def('material', 'Clay', c => [CE({ dist: 'random', count: 12, w: 0.5, o: 0.6, irregular: 0.8 }), N(0.12, 3, 'fractalNoise', (c.d / 100) * 0.4)]);
def('organic', 'Plasma Texture', c => [N(0.035, 4, 'turbulence', c.d / 100)]);

/* ───────────── public API ───────────── */

for (const preset of TEXTURES) if (!RECIPES.has(preset.id)) throw new Error(`Texture preset without a recipe: ${preset.id}`);

/** Context the legacy engine used, so density keeps its meaning (`gap` shrinks and `stroke` grows with density). */
const context = (preset: TexturePreset, density: number): RC => {
  const d = clamp(density, 1, 100), v = preset.variant;
  return { d, v, gap: Math.max(4, 28 - d * 0.22 + (v % 3) * 2), stroke: Math.max(0.35, (0.45 + d / 32) * (1 + (v % 4) * 0.25)) };
};

export const recipeLayers = (preset: TexturePreset, density: number): Layer[] => RECIPES.get(preset.id)!(context(preset, density));

const INFO = new Map<string, LayerInfo>();
/** Which renderer kind and which controls a preset supports. */
export function presetInfo(preset: TexturePreset): LayerInfo {
  let info = INFO.get(preset.id);
  if (!info) { info = describeLayers(recipeLayers(preset, 50)); INFO.set(preset.id, info); }
  return info;
}
