import { hslToHex as H } from './color';
import { buildAurora, auroraPalette, auroraSky } from './aurora';
import { newEffect } from './effects';
import { newLayer, newProject, stop, type GradientLayer, type GradientProject } from './model';
import { mulberry } from './rng';

/* ═══════════ Preset library (220 presets) ═══════════
 * A preset is only a *recipe* that builds an ordinary project (layers, stops, effects, animation).
 * Nothing about it is special — every layer stays fully editable after it is applied.
 */

export const CATEGORIES = ['Aurora', 'Mesh', 'Soft', 'Neon', 'Metallic', 'Atmospheric', 'Glass', 'Light', 'Dark', 'Editorial', 'Abstract', 'Repeating', 'Experimental'] as const;
export type Category = (typeof CATEGORIES)[number];
export interface Preset { id: string; name: string; category: Category; tags: string[]; build: () => GradientProject }

/* ───────── shorthand ───────── */
type SS = [string, number, number?, ('h' | 'm')?, number?];   // colour, pos, alpha, 'h' = hard edge, mid
const st = (a: SS[]) => a.map(([c, p, al = 1, f, mid]) => stop(c, p, al, { ...(f === 'h' ? { hard: true } : {}), ...(mid !== undefined ? { mid } : {}) }));
const lin = (angle: number, s: SS[], o: Partial<GradientLayer> = {}) => newLayer('linear', { angle, stops: st(s), ...o });
const rad = (cx: number, cy: number, rx: number, ry: number, s: SS[], o: Partial<GradientLayer> = {}) => newLayer('radial', { cx, cy, rx, ry, stops: st(s), ...o });
const con = (from: number, cx: number, cy: number, s: SS[], o: Partial<GradientLayer> = {}) => newLayer('conic', { angle: from, cx, cy, stops: st(s), ...o });
const blur = (r: number) => [newEffect('blur', { radius: r })];
/** soft round-looking blob on a 3:2 canvas */
const blob = (cx: number, cy: number, size: number, c: string, a = 0.9, o: Partial<GradientLayer> = {}) => rad(cx, cy, size, size * 1.5, [[c, 0, a], [c, 100, 0, undefined, 45]], o);
const proj = (name: string, bg: string, layers: GradientLayer[]) => newProject({ name, background: bg, layers });
const mk = (category: Category, i: number, name: string, tags: string[], build: () => GradientProject): Preset => ({ id: `${category.toLowerCase()}-${i + 1}`, name, category, tags, build });

const out: Preset[] = [];
let built = false;

/* ───────── Aurora (20) ───────── */
function aurora() {
  const R: [string, number, number, number, number][] = [
    ['Boreal Green', 140, 170, 200, 215], ['Northern Violet', 160, 270, 300, 260], ['Polar Teal', 170, 190, 220, 205], ['Emerald Veil', 150, 130, 175, 170],
    ['Arctic Pink', 320, 170, 280, 245], ['Glacier Night', 190, 210, 250, 225], ['Midnight Ribbon', 200, 260, 320, 240], ['Lunar Mint', 160, 140, 190, 200],
    ['Cosmic Dawn', 330, 280, 40, 260], ['Solar Wind', 120, 60, 170, 210], ['Aqua Curtain', 180, 160, 200, 200], ['Violet Storm', 280, 310, 200, 270],
    ['Crimson Pulse', 340, 300, 20, 300], ['Ice Halo', 195, 175, 260, 215], ['Jade Horizon', 155, 175, 100, 180], ['Deep Sea Glow', 185, 215, 160, 220],
    ['Magenta Mist', 310, 270, 190, 275], ['Golden Aurora', 90, 150, 50, 150], ['Lilac Frost', 260, 200, 320, 250], ['Phantom Green', 135, 165, 285, 170],
  ];
  const V = [
    { curtains: 4, ribbons: 1, glow: true, blur: 55, stars: false, distortion: false }, { curtains: 3, ribbons: 2, glow: true, blur: 45, stars: false, distortion: false },
    { curtains: 5, ribbons: 0, glow: true, blur: 60, stars: false, distortion: true }, { curtains: 2, ribbons: 2, glow: false, blur: 70, stars: true, distortion: false },
    { curtains: 6, ribbons: 1, glow: true, blur: 40, stars: true, distortion: false },
  ];
  R.forEach(([name, a, b, c, sky], i) => out.push(mk('Aurora', i, name, ['aurora', 'night', 'glow', 'animated'], () => proj(name, '', buildAurora({
    palette: auroraPalette(a, b, c), sky: auroraSky(sky), intensity: 58 + (i * 7) % 32, movement: true, seed: 100 + i, ...V[i % 5],
  })))));
}

/* ───────── Mesh-like (20) ───────── */
function mesh() {
  const R: [string, number[], boolean][] = [
    ['Candy Floss', [330, 285, 200, 50, 350], true], ['Neon Garden', [150, 190, 280, 320, 60], false], ['Peach Fizz', [20, 350, 40, 300, 10], true], ['Deep Lagoon', [190, 220, 160, 270, 200], false],
    ['Sorbet', [10, 45, 330, 160, 280], true], ['Violet Hour', [270, 310, 230, 340, 200], false], ['Citrus Splash', [50, 90, 25, 160, 340], true], ['Cosmic Jam', [280, 330, 200, 250, 20], false],
    ['Spring Meadow', [120, 80, 170, 50, 200], true], ['Midnight Bloom', [300, 250, 190, 340, 270], false], ['Rose Quartz', [350, 20, 300, 330, 40], true], ['Ocean Drift', [200, 175, 230, 150, 260], false],
    ['Lavender Haze', [260, 300, 220, 340, 190], true], ['Ember Glow', [15, 40, 350, 320, 60], false], ['Mint Cream', [160, 140, 190, 90, 200], true], ['Electric Dusk', [250, 320, 190, 280, 40], false],
    ['Apricot Sky', [30, 200, 10, 340, 55], true], ['Toxic Smoke', [100, 160, 280, 60, 190], false], ['Pastel Dream', [280, 190, 340, 60, 150], true], ['Nebula Core', [290, 210, 330, 250, 15], false],
  ];
  const LAY: [number, number][][] = [
    [[15, 20], [80, 15], [90, 75], [25, 85], [55, 50]], [[10, 50], [35, 10], [65, 90], [90, 40], [50, 45]],
    [[8, 10], [32, 38], [58, 62], [86, 86], [82, 14]], [[0, 0], [100, 0], [100, 100], [0, 100], [50, 50]],
  ];
  R.forEach(([name, hues, light], i) => out.push(mk('Mesh', i, name, ['mesh', light ? 'light' : 'dark', 'blobs'], () => {
    const rnd = mulberry(300 + i), pos = LAY[i % 4];
    const layers = hues.map((h, k) => blob(pos[k][0] + (rnd() - 0.5) * 8, pos[k][1] + (rnd() - 0.5) * 8, 42 + rnd() * 22, light ? H(h, 88, 74) : H(h, 85, 52), 0.95));
    return proj(name, light ? H(hues[4], 45, 94) : H(hues[4], 50, 8), layers);
  })));
}

/* ───────── Soft (16) ───────── */
function soft() {
  const R: [string, number, number, number][] = [
    ['Cotton Candy', 330, 200, 280], ['Peach Milk', 25, 350, 45], ['Mint Whisper', 160, 190, 100], ['Lilac Cloud', 270, 320, 210], ['Butter Sky', 50, 190, 20], ['Seafoam', 175, 140, 215],
    ['Blush Petal', 345, 20, 300], ['Baby Blue', 205, 260, 170], ['Apricot Cream', 35, 10, 55], ['Orchid Mist', 290, 240, 330], ['Pistachio', 95, 60, 160], ['Dawn Pink', 340, 30, 280],
    ['Powder Aqua', 185, 215, 150], ['Vanilla Rose', 20, 330, 50], ['Moon Lavender', 255, 300, 195], ['Honeydew', 130, 80, 180],
  ];
  R.forEach(([name, a, b, c], i) => out.push(mk('Soft', i, name, ['soft', 'pastel', 'calm'], () => {
    const rnd = mulberry(500 + i);
    return proj(name, '', [
      rad(18 + rnd() * 14, 14 + rnd() * 12, 48, 60, [['#ffffff', 0, 0.65], ['#ffffff', 100, 0]], { blend: 'soft-light' }),
      blob(78 - rnd() * 14, 72 + rnd() * 12, 46 + rnd() * 10, H(c, 85, 84), 0.85, { effects: blur(70) }),
      blob(22 + rnd() * 10, 78 - rnd() * 10, 40 + rnd() * 10, H(a, 80, 86), 0.8, { effects: blur(70) }),
      lin(115 + (i * 11) % 80, [[H(a, 75, 91), 0], [H(b, 72, 89), 100]], { space: 'oklab', name: 'Base' }),
    ]);
  })));
}

/* ───────── Neon (18) ───────── */
function neon() {
  const R: [string, number, number, number][] = [
    ['Laser Grid', 300, 190, 60], ['Synthwave', 320, 270, 190], ['Cyber Lime', 90, 160, 280], ['Electric Orchid', 290, 330, 200], ['Plasma Pink', 335, 280, 20], ['Toxic Glow', 110, 170, 60],
    ['Ultraviolet', 265, 300, 200], ['Hot Circuit', 15, 330, 55], ['Cyan Pulse', 185, 215, 150], ['Night Arcade', 280, 190, 330], ['Magenta Rush', 315, 265, 345], ['Reactor Green', 140, 100, 190],
    ['Blue Plasma', 225, 190, 280], ['Sunset Neon', 350, 25, 290], ['Gamma Ray', 75, 190, 310], ['Retro Wave', 330, 200, 270], ['Flux', 255, 175, 320], ['Overdrive', 8, 300, 190],
  ];
  R.forEach(([name, a, b, c], i) => out.push(mk('Neon', i, name, ['neon', 'dark', 'glow'], () => {
    const rnd = mulberry(700 + i), col = [H(a, 100, 58), H(b, 100, 56), H(c, 100, 60)], v = i % 3;
    const layers: GradientLayer[] = [];
    if (v === 2) layers.push(rad(50, 50, 80, 90, [['#000', 55, 0], ['#000', 100, 0.7]], { name: 'Vignette' }), lin(0, [['#ffffff', 0, 0.06, 'h'], ['#ffffff', 25, 0.06, 'h'], ['#ffffff', 25, 0], ['#ffffff', 100, 0]], { repeating: true, name: 'Scanlines', repeat: { size: 5, unit: 'px', offset: 0 }, blend: 'overlay' }));
    if (v === 1) layers.push(con(rnd() * 360, 62, 40, [[col[1], 0, 0], [col[1], 14, 0.9], [col[0], 28, 0], [col[0], 100, 0]], { name: 'Sweep', blend: 'screen', opacity: 0.7, effects: blur(34) }));
    layers.push(
      blob(24 + rnd() * 10, 30 + rnd() * 12, 38, col[0], 0.9, { name: 'Glow A', blend: 'screen', effects: blur(46) }),
      blob(74 - rnd() * 10, 66 - rnd() * 10, 42, col[1], 0.85, { name: 'Glow B', blend: 'screen', effects: blur(52) }),
      blob(52, 96, 34, col[2], 0.7, { name: 'Glow C', blend: 'screen', effects: blur(40) }),
      lin(180, [[H(a, 65, 5), 0], [H(b, 70, 8), 100]], { name: 'Base' }),
    );
    return proj(name, '', layers);
  })));
}

/* ───────── Metallic (16) ───────── */
function metallic() {
  const M: [string, string, string, string, string][] = [
    ['Gold', '#5c3d0b', '#b8860b', '#f6d365', '#fff8dc'], ['Rose Gold', '#6d3b3b', '#b76e79', '#f4c2c2', '#fff0eb'], ['Silver', '#4a4f57', '#9aa0a8', '#e8ecf1', '#ffffff'],
    ['Chrome', '#1a1f2b', '#6b7a99', '#dfe7f5', '#ffffff'], ['Titanium', '#2f3338', '#6e7681', '#aeb6bf', '#e3e8ee'], ['Copper', '#4a2511', '#b87333', '#f0a56d', '#ffd2a8'],
    ['Bronze', '#3d2a14', '#8c6a3b', '#c9a45f', '#f2dca0'], ['Platinum', '#3a3e44', '#8d93a0', '#d6dae2', '#fafbfc'], ['Gunmetal', '#14181d', '#3a424d', '#6d7886', '#aab4c0'],
    ['Brass', '#4b3a10', '#a8841f', '#e0c05a', '#fff0a8'], ['Steel Blue', '#10202f', '#3b5b7a', '#8fb0cc', '#e1eef9'], ['Pearl', '#bfb9ad', '#e8e2d6', '#fffaf0', '#ffffff'],
    ['Obsidian', '#05060a', '#1d2230', '#4a5368', '#9aa6c0'], ['Champagne', '#6b5a3a', '#cdb47f', '#f7e7bd', '#fffaf0'], ['Iridescent', '#4c1d95', '#06b6d4', '#f0abfc', '#fef08a'], ['Mercury', '#2b2f36', '#8e98a6', '#f4f6f9', '#ffffff'],
  ];
  M.forEach(([name, d, m, l, hi], i) => out.push(mk('Metallic', i, `${name} ${['Sheen', 'Disc', 'Brushed'][i % 3]}`, ['metal', 'shiny', name.toLowerCase()], () => {
    const v = i % 3;
    const sheen: SS[] = [[d, 0], [m, 16], [hi, 30], [l, 42], [m, 56], [d, 70], [m, 84], [hi, 94], [l, 100]];
    if (v === 0) return proj(name, '', [lin(135, sheen, { space: 'oklab' })]);
    if (v === 1) return proj(name, '', [con(20, 50, 50, [[l, 0], [d, 12], [m, 25], [hi, 38], [d, 50], [m, 63], [l, 76], [d, 88], [l, 100]], { space: 'oklab' })]);
    return proj(name, '', [
      lin(90, [['#ffffff', 0, 0.07, 'h'], ['#ffffff', 50, 0.07, 'h'], ['#000000', 50, 0.08, 'h'], ['#000000', 100, 0.08]], { repeating: true, repeat: { size: 4, unit: 'px', offset: 0 }, name: 'Grain', blend: 'overlay' }),
      lin(100, [[d, 0], [m, 22], [hi, 40], [l, 52], [m, 70], [d, 100]], { name: 'Brushed base' }),
    ]);
  })));
}

/* ───────── Atmospheric (18) ───────── */
function atmospheric() {
  type A = [string, SS[], [number, number, string, number, number] | null, string | null];
  const D: A[] = [
    ['Sunrise Haze', [['#1b2a49', 0], ['#6b5b95', 35], ['#f08a5d', 70], ['#ffd3a5', 100]], [50, 92, '#fff1c9', 45, 0.9], null],
    ['Golden Hour', [['#2d4a7a', 0], ['#d98c5f', 55], ['#ffd98a', 100]], [70, 85, '#fff4c2', 40, 0.95], null],
    ['Blue Hour', [['#0b1d3a', 0], ['#27468a', 50], ['#8aa8d8', 100]], null, '#c3d5f5'],
    ['Twilight', [['#150d33', 0], ['#4b2a7a', 45], ['#c8587a', 80], ['#ffb38a', 100]], [30, 100, '#ffd2a0', 35, 0.6], null],
    ['Dusk Violet', [['#1a1038', 0], ['#5b3a9a', 50], ['#d68fd1', 100]], null, null],
    ['Desert Noon', [['#3a8bd8', 0], ['#8cc4f0', 60], ['#f5e6c4', 100]], [75, 10, '#ffffff', 30, 0.9], null],
    ['Overcast', [['#7c8794', 0], ['#b1bac4', 55], ['#dde2e8', 100]], null, null],
    ['Storm Front', [['#0d1117', 0], ['#2a3445', 40], ['#5d6b82', 75], ['#8a95a8', 100]], null, null],
    ['Foggy Morning', [['#c9d1d6', 0], ['#e6eaed', 60], ['#f7f8f9', 100]], null, '#ffffff'],
    ['Tropical Sunset', [['#3b1c6a', 0], ['#c2379a', 40], ['#ff6b6b', 70], ['#ffd36b', 100]], [50, 88, '#fff0a0', 38, 0.9], null],
    ['Midnight Sky', [['#02030a', 0], ['#0a1230', 60], ['#1a2a5c', 100]], [80, 15, '#dbe8ff', 14, 0.7], null],
    ['Rose Horizon', [['#3a2a5c', 0], ['#b86a8c', 55], ['#ffcfb8', 100]], null, null],
    ['Mountain Dawn', [['#274060', 0], ['#7a8fb0', 45], ['#f0c8a0', 85], ['#fff0d8', 100]], [20, 95, '#ffe2b0', 40, 0.8], null],
    ['Ocean Mist', [['#0e3a4a', 0], ['#3a8a9a', 55], ['#b8e0e0', 100]], null, '#e8f6f6'],
    ['Autumn Dusk', [['#2b1b2e', 0], ['#8a3b2e', 50], ['#e08a3a', 85], ['#ffd08a', 100]], [64, 96, '#ffd9a0', 36, 0.7], null],
    ['Polar Day', [['#6fb0e8', 0], ['#bfe0f5', 60], ['#ffffff', 100]], [60, 20, '#ffffff', 30, 0.8], null],
    ['Smoky Sunset', [['#2a2a33', 0], ['#6a4a5a', 45], ['#c9785a', 80], ['#f2b88a', 100]], [40, 98, '#ffcf99', 40, 0.6], null],
    ['Cloud Layer', [['#5a7fb0', 0], ['#a9c0dc', 50], ['#eef2f7', 100]], null, null],
  ];
  D.forEach(([name, sky, sun, haze], i) => out.push(mk('Atmospheric', i, name, ['sky', 'atmosphere', 'horizon'], () => {
    const layers: GradientLayer[] = [];
    if (name === 'Cloud Layer') layers.push(blob(30, 60, 36, '#ffffff', 0.9, { effects: blur(40), name: 'Cloud 1' }), blob(70, 74, 40, '#ffffff', 0.85, { effects: blur(50), name: 'Cloud 2' }), blob(52, 42, 26, '#ffffff', 0.7, { effects: blur(36), name: 'Cloud 3' }));
    if (sun) layers.push(rad(sun[0], sun[1], sun[3], sun[3] * 1.3, [[sun[2], 0, sun[4]], [sun[2], 30, sun[4] * 0.45], [sun[2], 100, 0]], { name: 'Sun glow', blend: name === 'Midnight Sky' ? 'normal' : 'screen', effects: blur(sun[3] > 30 ? 14 : 4) }));
    if (haze) layers.push(lin(180, [[haze, 0, 0], [haze, 100, 0.55]], { name: 'Horizon haze' }));
    layers.push(lin(180, sky, { name: 'Sky', space: 'oklab' }));
    return proj(name, '', layers);
  })));
}

/* ───────── Glass (14) ───────── */
function glass() {
  const R: [string, number, number][] = [['Frosted Violet', 265, 300], ['Ice Pane', 200, 185], ['Rose Glass', 340, 20], ['Mint Glass', 160, 190], ['Amber Pane', 35, 10], ['Midnight Glass', 235, 270], ['Sea Glass', 175, 205], ['Peony Glass', 320, 280], ['Citrus Glass', 60, 130], ['Lagoon Pane', 190, 160], ['Dusk Glass', 285, 330], ['Smoke Glass', 220, 250], ['Coral Glass', 10, 340], ['Aurora Glass', 150, 280]];
  R.forEach(([name, a, b], i) => out.push(mk('Glass', i, name, ['glass', 'glassmorphism', 'translucent'], () => proj(name, '', [
    rad(14, 10, 30, 40, [['#ffffff', 0, 0.55], ['#ffffff', 100, 0]], { name: 'Edge light', blend: 'overlay', effects: blur(18) }),
    lin(125 + (i % 3) * 8, [['#ffffff', 0, 0.38], ['#ffffff', 38, 0.08], ['#ffffff', 52, 0.2], ['#ffffff', 100, 0.02]], { name: 'Glass sheen' }),
    blob(74, 30 + (i % 4) * 12, 36, H(b + 40, 92, 62), 0.85, { name: 'Inner glow', effects: blur(56) }),
    lin(140, [[H(a, 80, 46), 0], [H(b, 82, 34), 100]], { name: 'Base', space: 'oklab' }),
  ]))));
}

/* ───────── Light (14) ───────── */
function light() {
  const R: [string, number, number, number][] = [['Morning Linen', 40, 20, 200], ['Pearl Cloud', 220, 280, 340], ['Soft Daylight', 200, 50, 330], ['White Peach', 20, 340, 40], ['Airy Mint', 160, 190, 60], ['Porcelain', 210, 30, 280], ['Lemon Milk', 55, 90, 20], ['Sky Paper', 205, 180, 260], ['Cream Rose', 350, 20, 300], ['Spring Mist', 130, 170, 60], ['Opal Light', 190, 300, 60], ['Ivory Glow', 45, 20, 340], ['Silver Dawn', 220, 200, 280], ['Daydream', 270, 200, 340]];
  R.forEach(([name, a, b, c], i) => out.push(mk('Light', i, name, ['light', 'airy', 'clean'], () => {
    const rnd = mulberry(900 + i);
    return proj(name, H(a, 35, 97), [
      rad(50, 0, 70, 50, [['#ffffff', 0, 0.9], ['#ffffff', 100, 0]], { name: 'Top light' }),
      blob(18 + rnd() * 14, 70 + rnd() * 14, 40, H(b, 92, 86), 0.8, { effects: blur(80), name: 'Tint A' }),
      blob(82 - rnd() * 14, 28 + rnd() * 18, 38, H(c, 90, 88), 0.75, { effects: blur(80), name: 'Tint B' }),
      ...(i % 2 ? [lin(160, [[H(a, 60, 96), 0, 0], [H(b, 60, 90), 100, 0.5]], { name: 'Wash' })] : []),
    ]);
  })));
}

/* ───────── Dark (16) ───────── */
function dark() {
  const R: [string, number, number][] = [['Void Violet', 265, 300], ['Abyss Teal', 185, 165], ['Ink Blue', 225, 200], ['Carbon Ember', 15, 35], ['Midnight Rose', 330, 300], ['Deep Forest', 150, 120], ['Black Orchid', 290, 320], ['Space Navy', 230, 260], ['Eclipse', 20, 280], ['Obsidian Glow', 200, 160], ['Nightshade', 275, 235], ['Dark Matter', 250, 180], ['Charcoal Wine', 345, 20], ['Storm Slate', 215, 190], ['Noir Gold', 40, 20], ['Polar Night', 210, 170]];
  R.forEach(([name, a, b], i) => out.push(mk('Dark', i, name, ['dark', 'subtle', 'background'], () => {
    const rnd = mulberry(1100 + i);
    return proj(name, H(a, 50, 4), [
      ...(i % 2 ? [lin(0, [['#ffffff', 0, 0.035, 'h'], ['#ffffff', 50, 0.035, 'h'], ['#ffffff', 50, 0], ['#ffffff', 100, 0]], { repeating: true, repeat: { size: 36, unit: 'px', offset: 0 }, name: 'Lines' })] : []),
      lin(180, [['#000', 0, 0], ['#000', 100, 0.6]], { name: 'Vignette' }),
      blob(20 + rnd() * 20, 24 + rnd() * 14, 42, H(b, 80, 32), 0.7, { effects: blur(70), name: 'Glow A', blend: 'screen' }),
      blob(80 - rnd() * 20, 76 - rnd() * 14, 38, H(a, 75, 30), 0.65, { effects: blur(70), name: 'Glow B', blend: 'screen' }),
      lin(160, [[H(a, 55, 9), 0], [H(b, 55, 4), 100]], { name: 'Base' }),
    ]);
  })));
}

/* ───────── Editorial (14) ───────── */
function editorial() {
  const P: [string, string, string, string, string][] = [
    ['Paper & Ink', '#f4efe6', '#111111', '#d94f30', '#e8d9b5'], ['Riso Pink', '#f7efe4', '#ff5c8a', '#1f3b8a', '#ffd166'], ['Bauhaus', '#f2ead8', '#e63946', '#1d3557', '#f4a261'],
    ['Museum Teal', '#eae6da', '#0b6e6e', '#d4a017', '#222222'], ['Matcha Press', '#efeadc', '#7a9a5a', '#2f4a2b', '#e0c9a6'], ['Sunday Paper', '#f6f1e7', '#2a2a2a', '#b5493a', '#c9b99a'],
    ['Mono Blue', '#eef1f4', '#1a3a8a', '#6a88d6', '#101828'], ['Terracotta', '#f2e4d4', '#c4592f', '#6e3b2a', '#e9b872'], ['Plum Cream', '#f5ece3', '#5a2a4a', '#d8758a', '#e6c9a0'],
    ['Forest Gazette', '#ece8dc', '#1f4a36', '#c9a227', '#1a1a1a'], ['Citrus Press', '#fbf5e0', '#ffb703', '#fb5607', '#023047'], ['Slate Rose', '#e9e5e0', '#334155', '#e11d48', '#f59e0b'],
    ['Ocean Print', '#eef3f4', '#0e7490', '#f97316', '#0f172a'], ['Mint Ledger', '#eff5ef', '#2f9e7a', '#1b2a3a', '#f2c14e'],
  ];
  P.forEach(([name, bg, a, b, c], i) => out.push(mk('Editorial', i, name, ['editorial', 'flat', 'hard-edge', 'poster'], () => {
    const v = i % 4;
    if (v === 0) return proj(name, '', [lin(115, [[a, 0, 1, 'h'], [a, 52, 1, 'h'], [b, 52, 1], [b, 100]], { name: 'Split' })]);
    if (v === 1) return proj(name, '', [lin(90, [[a, 0, 1, 'h'], [b, 33, 1, 'h'], [c, 66, 1, 'h'], [bg, 100]], { name: 'Bands' })]);
    if (v === 2) return proj(name, '', [rad(66, 44, 26, 39, [[b, 0, 1, 'h'], [b, 78, 1, 'h'], [b, 78, 0], [b, 100, 0]], { name: 'Disc' }), rad(66, 44, 40, 60, [[c, 0, 1, 'h'], [c, 100, 1]], { name: 'Halo', opacity: 0, visible: false }), lin(180, [[bg, 0], [c, 100]], { name: 'Paper' })]);
    return proj(name, '', [con(0, 50, 50, [[a, 0, 1, 'h'], [b, 25, 1, 'h'], [c, 50, 1, 'h'], [bg, 75, 1, 'h'], [bg, 100]], { name: 'Quarters' })]);
  })));
}

/* ───────── Abstract (18) ───────── */
function abstract() {
  const R: [string, number, number, number][] = [['Prism Whirl', 280, 190, 340], ['Orbit', 20, 220, 300], ['Kaleido Bloom', 330, 50, 200], ['Tidal Spiral', 190, 250, 40], ['Solar Dial', 40, 330, 270], ['Echo Ring', 260, 170, 20], ['Cosmic Pinwheel', 300, 210, 60], ['Paper Sun', 15, 45, 340], ['Glass Orbit', 200, 280, 330], ['Fold', 150, 20, 270], ['Spectrum Disc', 0, 120, 240], ['Moire Bloom', 320, 180, 50], ['Dream Compass', 250, 330, 160], ['Atlas', 30, 200, 290], ['Halo Drift', 180, 300, 40], ['Vortex', 265, 15, 185], ['Petal Wheel', 345, 40, 200], ['Zenith', 215, 320, 55]];
  R.forEach(([name, a, b, c], i) => out.push(mk('Abstract', i, name, ['abstract', 'conic', 'geometric'], () => {
    const ca = H(a, 85, 58), cb = H(b, 82, 56), cc = H(c, 88, 62), v = i % 3, rnd = mulberry(1300 + i);
    if (v === 0) return proj(name, '', [rad(50, 50, 38, 57, [['#ffffff', 0, 0.8], ['#ffffff', 100, 0]], { blend: 'overlay', name: 'Core' }), con(i * 20, 50, 50, [[ca, 0], [cb, 33], [cc, 66], [ca, 100]], { space: 'oklab', name: 'Wheel' })]);
    if (v === 1) return proj(name, H(a, 45, 10), [con(rnd() * 90, 30, 40, [[ca, 0], [cb, 50, 1], [ca, 100]], { blend: 'hard-light', opacity: 0.8, name: 'Wheel B' }), con(rnd() * 90, 72, 62, [[cc, 0], [cb, 50], [cc, 100]], { name: 'Wheel A' })]);
    return proj(name, '', [con(0, 50, 50, [['#ffffff', 0, 0.22, 'h'], ['#ffffff', 50, 0.22, 'h'], ['#ffffff', 50, 0], ['#ffffff', 100, 0]], { repeating: true, repeat: { size: 12, unit: 'deg', offset: 0 }, blend: 'overlay', name: 'Rays' }), rad(50 + (rnd() - .5) * 20, 50, 60, 90, [[cc, 0], [cb, 55], [ca, 100]], { name: 'Radial', space: 'oklch' })]);
  })));
}

/* ───────── Repeating (20) ───────── */
const band = (colors: string[], widths: number[]): SS[] => {
  const total = widths.reduce((a, b) => a + b, 0); let acc = 0; const s: SS[] = [];
  colors.forEach((c, i) => { const p0 = (acc / total) * 100; acc += widths[i]; s.push([c, p0, 1, 'h']); });
  s.push([colors[colors.length - 1], 100, 1]);
  return s;
};
const stripes = (angle: number, colors: string[], widths: number[], o: Partial<GradientLayer> = {}) => lin(angle, band(colors, widths), { repeating: true, repeat: { size: widths.reduce((a, b) => a + b, 0), unit: 'px', offset: 0 }, ...o });
function repeating() {
  const R: [string, () => GradientProject][] = [
    ['Candy Stripe', () => proj('Candy Stripe', '', [stripes(45, ['#ff4d6d', '#ffffff'], [24, 24])])],
    ['Hazard Tape', () => proj('Hazard Tape', '', [stripes(45, ['#111111', '#ffd400'], [30, 30])])],
    ['Barber Pole', () => proj('Barber Pole', '', [stripes(135, ['#e63946', '#ffffff', '#1d4ed8', '#ffffff'], [18, 18, 18, 18])])],
    ['Navy Pinstripe', () => proj('Navy Pinstripe', '', [stripes(90, ['#0b1b3a', '#1a2f66'], [17, 3])])],
    ['Zebra', () => proj('Zebra', '', [stripes(62, ['#f5f5f5', '#111111'], [40, 26])])],
    ['Mint Ticking', () => proj('Mint Ticking', '', [stripes(90, ['#bfe9d6', '#f4fff9'], [10, 10])])],
    ['Rainbow Bands', () => proj('Rainbow Bands', '', [stripes(0, ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'], [16, 16, 16, 16, 16])])],
    ['Blueprint Grid', () => proj('Blueprint Grid', '#0b3d91', [stripes(90, ['rgba', '#ffffff'], [1, 1], { stops: st([['#ffffff', 0, 0.18, 'h'], ['#ffffff', 4, 0.18, 'h'], ['#ffffff', 4, 0], ['#ffffff', 100, 0]]), repeat: { size: 28, unit: 'px', offset: 0 }, name: 'Vertical' }), stripes(0, ['x', 'y'], [1, 1], { stops: st([['#ffffff', 0, 0.18, 'h'], ['#ffffff', 4, 0.18, 'h'], ['#ffffff', 4, 0], ['#ffffff', 100, 0]]), repeat: { size: 28, unit: 'px', offset: 0 }, name: 'Horizontal' })])],
    ['Graph Paper', () => proj('Graph Paper', '#fbfbf7', [lin(90, [['#9ec5e8', 0, 0.8, 'h'], ['#9ec5e8', 3, 0.8, 'h'], ['#9ec5e8', 3, 0], ['#9ec5e8', 100, 0]], { repeating: true, repeat: { size: 24, unit: 'px', offset: 0 }, name: 'V' }), lin(0, [['#9ec5e8', 0, 0.8, 'h'], ['#9ec5e8', 3, 0.8, 'h'], ['#9ec5e8', 3, 0], ['#9ec5e8', 100, 0]], { repeating: true, repeat: { size: 24, unit: 'px', offset: 0 }, name: 'H' })])],
    ['Diagonal Hatch', () => proj('Diagonal Hatch', '#f0e6d2', [lin(45, [['#2b2b2b', 0, 0.55, 'h'], ['#2b2b2b', 6, 0.55, 'h'], ['#2b2b2b', 6, 0], ['#2b2b2b', 100, 0]], { repeating: true, repeat: { size: 9, unit: 'px', offset: 0 }, name: 'Hatch' })])],
    ['Tartan Plaid', () => proj('Tartan Plaid', '#a4161a', [stripes(90, ['#0b3d2e', '#00000000'], [16, 44], { stops: st([['#0b3d2e', 0, 0.6, 'h'], ['#0b3d2e', 27, 0.6, 'h'], ['#0b3d2e', 27, 0], ['#0b3d2e', 100, 0]]), blend: 'multiply', name: 'Warp' }), stripes(0, ['#0b3d2e', '#00000000'], [16, 44], { stops: st([['#0b3d2e', 0, 0.6, 'h'], ['#0b3d2e', 27, 0.6, 'h'], ['#0b3d2e', 27, 0], ['#0b3d2e', 100, 0]]), blend: 'multiply', name: 'Weft' })])],
    ['Sunburst', () => proj('Sunburst', '', [con(0, 50, 60, [['#ffd166', 0, 1, 'h'], ['#ff9f1c', 50, 1, 'h'], ['#ff9f1c', 100]], { repeating: true, repeat: { size: 20, unit: 'deg', offset: 0 }, name: 'Rays' })])],
    ['Radar Rings', () => proj('Radar Rings', '#021a10', [rad(50, 50, 70, 105, [['#2dff9d', 0, 0.55, 'h'], ['#2dff9d', 4, 0.55, 'h'], ['#2dff9d', 4, 0], ['#2dff9d', 100, 0]], { repeating: true, repeat: { size: 38, unit: 'px', offset: 0 }, name: 'Rings' }), con(0, 50, 50, [['#2dff9d', 0, 0], ['#2dff9d', 24, 0.45], ['#2dff9d', 25, 0], ['#2dff9d', 100, 0]], { name: 'Sweep', angle: 40 })])],
    ['Bullseye', () => proj('Bullseye', '', [rad(50, 50, 80, 120, [['#ff4d6d', 0, 1, 'h'], ['#ffffff', 50, 1, 'h'], ['#ffffff', 100]], { repeating: true, repeat: { size: 60, unit: 'px', offset: 0 }, name: 'Target' })])],
    ['Water Ripple', () => proj('Water Ripple', '', [rad(50, 50, 80, 120, [['#0ea5e9', 0], ['#7dd3fc', 50], ['#0ea5e9', 100]], { repeating: true, repeat: { size: 64, unit: 'px', offset: 0 }, name: 'Ripple' })])],
    ['Pastel Candy', () => proj('Pastel Candy', '', [lin(100, [['#ffd6e8', 0], ['#d6e8ff', 50], ['#ffd6e8', 100]], { repeating: true, repeat: { size: 90, unit: 'px', offset: 0 }, name: 'Waves', space: 'oklab' })])],
    ['Fading Stripes', () => proj('Fading Stripes', '#0f172a', [lin(90, [['#38bdf8', 0, 0], ['#38bdf8', 50, 0.9], ['#38bdf8', 100, 0]], { repeating: true, repeat: { size: 60, unit: 'px', offset: 0 }, name: 'Fade' })])],
    ['Dune Lines', () => proj('Dune Lines', '', [lin(178, [['#7a4a22', 0, 0.5, 'h'], ['#7a4a22', 3, 0.5, 'h'], ['#7a4a22', 3, 0], ['#7a4a22', 100, 0]], { repeating: true, repeat: { size: 14, unit: 'px', offset: 0 }, name: 'Lines' }), lin(180, [['#f3d9a8', 0], ['#e7a76b', 100]], { name: 'Sand' })])],
    ['Speed Lines', () => proj('Speed Lines', '#ffe45e', [con(0, 50, 50, [['#111111', 0, 0.9, 'h'], ['#111111', 2, 0.9, 'h'], ['#111111', 2, 0], ['#111111', 100, 0]], { repeating: true, repeat: { size: 7, unit: 'deg', offset: 0 }, name: 'Lines' }), rad(50, 50, 28, 42, [['#ffe45e', 0], ['#ffe45e', 100, 0]], { name: 'Clear centre' })])],
    ['Retro Stripes', () => proj('Retro Stripes', '', [lin(0, band(['#ff6b35', '#f7c59f', '#efefd0', '#004e89', '#1a659e'], [30, 30, 30, 30, 30]), { name: 'Bands' })])],
    ['Moire Waves', () => proj('Moire Waves', '#101828', [rad(30, 40, 80, 120, [['#e0e7ff', 0, 0.55, 'h'], ['#e0e7ff', 6, 0.55, 'h'], ['#e0e7ff', 6, 0], ['#e0e7ff', 100, 0]], { repeating: true, repeat: { size: 14, unit: 'px', offset: 0 }, name: 'Rings A' }), rad(70, 60, 80, 120, [['#e0e7ff', 0, 0.55, 'h'], ['#e0e7ff', 6, 0.55, 'h'], ['#e0e7ff', 6, 0], ['#e0e7ff', 100, 0]], { repeating: true, repeat: { size: 14, unit: 'px', offset: 0 }, name: 'Rings B' })])],
  ];
  // 4 colourway variants of the first stripe families make the list reach 20 distinct, useful presets
  const W: [string, string, string, number, number][] = [['Lime Pop Stripe', '#c6ff00', '#111111', 60, 20], ['Coral Tide Stripe', '#ff7b72', '#fff4e6', 120, 14], ['Ocean Awning', '#1d4ed8', '#f8fafc', 90, 22], ['Cocoa Ticking', '#5b3a29', '#f1e4d3', 90, 8]];
  W.forEach(([name, a, b, ang, w]) => R.push([name, () => proj(name, '', [stripes(ang, [a, b], [w, w])])]));
  R.forEach(([name, f], i) => out.push(mk('Repeating', i, name, ['repeating', 'pattern', 'stripes'], f)));
}


/* ───────── Repeating · 75 more background patterns (100 repeating presets in total) ───────── */
const hair = (angle: number, color: string, alpha: number, t: number, period: number, name = 'Line', blend: GradientLayer['blend'] = 'normal') =>
  lin(angle, [[color, 0, alpha, 'h'], [color, (t / period) * 100, alpha, 'h'], [color, (t / period) * 100, 0], [color, 100, 0]], { repeating: true, repeat: { size: period, unit: 'px', offset: 0 }, name, blend });
const ringSet = (cx: number, cy: number, c1: string, c2: string, size: number, name = 'Rings') => rad(cx, cy, 80, 120, [[c1, 0, 1, 'h'], [c2, 50, 1, 'h'], [c2, 100]], { repeating: true, repeat: { size, unit: 'px', offset: 0 }, name });
const rays = (cx: number, cy: number, a: string, b: string, deg: number, name = 'Rays') => con(0, cx, cy, [[a, 0, 1, 'h'], [b, 50, 1, 'h'], [b, 100]], { repeating: true, repeat: { size: deg, unit: 'deg', offset: 0 }, name });

function repeatingMore() {
  const R: [string, () => GradientProject][] = [];
  const add = (name: string, f: () => GradientProject) => R.push([name, f]);

  ([['Pinstripe Ink', '#0b1220', '#2a3a5c', 2, 14], ['Pinstripe Sage', '#e9efe6', '#9bb59a', 2, 12], ['Pinstripe Rose', '#fbeaec', '#e7a1ab', 2, 12], ['Pinstripe Sand', '#f4ead7', '#c8b48a', 2, 16], ['Pinstripe Slate', '#1e2530', '#566174', 3, 18]] as [string, string, string, number, number][])
    .forEach(([n, bg, c, t, p]) => add(n, () => proj(n, bg, [hair(90, c, 1, t, p, 'Pinstripe')])));
  ([['Awning Navy', '#1e3a8a', '#f8fafc', 40], ['Awning Coral', '#ff6b6b', '#fff7f0', 36], ['Awning Forest', '#14532d', '#f0fdf4', 44], ['Awning Mustard', '#f4b400', '#fff8e1', 38], ['Awning Plum', '#6b21a8', '#faf5ff', 42]] as [string, string, string, number][])
    .forEach(([n, a, b, w]) => add(n, () => proj(n, '', [stripes(90, [a, b], [w, w], { name: 'Awning' })])));
  ([['Peppermint', '#e11d48', '#ffffff', 22, 45], ['Mint Twist', '#34d399', '#ecfdf5', 20, 45], ['Blueberry Cane', '#3b82f6', '#eff6ff', 22, 135], ['Lemon Cane', '#facc15', '#fffbeb', 22, 45], ['Grape Cane', '#a855f7', '#faf5ff', 22, 135]] as [string, string, string, number, number][])
    .forEach(([n, a, b, w, ang]) => add(n, () => proj(n, '', [stripes(ang, [a, b], [w, w], { name: 'Cane' })])));
  ([['Blueprint', '#0b3d91', '#ffffff', 0.18, 28], ['Paper Grid', '#fbfbf7', '#9ec5e8', 0.8, 24], ['Mint Grid', '#ecfdf5', '#34d399', 0.35, 26], ['Night Grid', '#0b1020', '#60a5fa', 0.18, 32], ['Sand Grid', '#f6efe0', '#b59b6a', 0.4, 22]] as [string, string, string, number, number][])
    .forEach(([n, bg, c, a, sz]) => add(`${n} Lines`, () => proj(n, bg, [hair(90, c, a, 1.5, sz, 'Vertical'), hair(0, c, a, 1.5, sz, 'Horizontal')])));
  ([['Target Red', '#ef4444', '#ffffff', 44, 50, 50], ['Ripple Mono', '#111827', '#f9fafb', 36, 50, 50], ['Offset Rings', '#fb923c', '#fff7ed', 48, 22, 30], ['Ocean Rings', '#0369a1', '#e0f2fe', 40, 72, 64], ['Plum Rings', '#7e22ce', '#f3e8ff', 52, 30, 70], ['Mint Rings', '#059669', '#ecfdf5', 34, 60, 36]] as [string, string, string, number, number, number][])
    .forEach(([n, a, b, sz, cx, cy]) => add(n, () => proj(n, '', [ringSet(cx, cy, a, b, sz)])));
  ([['Pond Ripple', '#0ea5e9', '#e0f2fe', 70], ['Lavender Ripple', '#a78bfa', '#ede9fe', 80], ['Peach Ripple', '#fb7185', '#ffe4e6', 64], ['Jade Ripple', '#10b981', '#d1fae5', 76], ['Amber Ripple', '#f59e0b', '#fef3c7', 68]] as [string, string, string, number][])
    .forEach(([n, a, b, sz], i) => add(n, () => proj(n, '', [rad(30 + i * 10, 40 + (i % 2) * 20, 80, 120, [[a, 0], [b, 50], [a, 100]], { repeating: true, repeat: { size: sz, unit: 'px', offset: 0 }, space: 'oklab', name: 'Ripple' })])));
  ([['Retro Sun', '#ffcf56', '#ff8c42', 20, 50, 62], ['Radiant Blue', '#3b82f6', '#bfdbfe', 16, 50, 50], ['Pink Burst', '#fb7185', '#fecdd3', 24, 50, 40], ['Mono Burst', '#111827', '#374151', 12, 50, 50], ['Emerald Rays', '#10b981', '#6ee7b7', 18, 30, 60], ['Violet Rays', '#8b5cf6', '#ddd6fe', 22, 70, 40]] as [string, string, string, number, number, number][])
    .forEach(([n, a, b, d, cx, cy]) => add(n, () => proj(n, '', [rays(cx, cy, a, b, d)])));
  ([['Etching Cream', '#f4ecd8', '#3b3025', 0.5, 9], ['Etching Blue', '#e8f0fa', '#1e3a8a', 0.4, 8], ['Etching Rose', '#fdecef', '#9f1239', 0.38, 10], ['Chalkboard Hatch', '#1c2b25', '#e6f4ea', 0.22, 10], ['Kraft Hatch', '#d9b98a', '#5a3e1b', 0.35, 8]] as [string, string, string, number, number][])
    .forEach(([n, bg, ink, a, sz]) => add(n, () => proj(n, bg, [hair(45, ink, a, 1.2, sz, 'Hatch ↗'), hair(135, ink, a, 1.2, sz, 'Hatch ↘')])));
  ([['Tartan Red', '#a4161a', '#0b3d2e', '#f5f5f4'], ['Tartan Blue', '#1d3a7a', '#0b1f3a', '#e8c547'], ['Tartan Green', '#14532d', '#052e16', '#fde68a'], ['Tartan Mono', '#9ca3af', '#111827', '#ffffff']] as [string, string, string, string][])
    .forEach(([n, bg, c1, c2]) => add(n, () => proj(n, bg, [hair(90, c2, 0.6, 3, 40, 'Fine warp', 'screen'), hair(0, c2, 0.6, 3, 40, 'Fine weft', 'screen'), hair(90, c1, 0.55, 24, 80, 'Wide warp', 'multiply'), hair(0, c1, 0.55, 24, 80, 'Wide weft', 'multiply')])));
  ([['Silk Waves', '#fbc2eb', '#a6c1ee', 120], ['Peach Silk', '#ffd1ba', '#ffe9d6', 140], ['Aqua Silk', '#a1f0e0', '#c4ddff', 110], ['Dusk Silk', '#3b2a73', '#d16ba5', 130], ['Citrus Silk', '#ffe29f', '#ffa99f', 150], ['Forest Silk', '#1f4037', '#99f2c8', 120]] as [string, string, string, number][])
    .forEach(([n, a, b, sz], i) => add(n, () => proj(n, '', [lin(100 + i * 12, [[a, 0], [b, 50], [a, 100]], { repeating: true, repeat: { size: sz, unit: 'px', offset: 0 }, space: 'oklab', name: 'Bands' })])));
  ([['Neon Fade', '#22d3ee', '#0b1020', 70, 90], ['Rose Fade', '#fb7185', '#1b0f14', 60, 100], ['Lime Fade', '#a3e635', '#0f1a07', 80, 80], ['Gold Fade', '#fbbf24', '#1a1405', 64, 0]] as [string, string, string, number, number][])
    .forEach(([n, c, bg, sz, ang]) => add(n, () => proj(n, bg, [lin(ang, [[c, 0, 0], [c, 50, 0.9], [c, 100, 0]], { repeating: true, repeat: { size: sz, unit: 'px', offset: 0 }, name: 'Fade' })])));
  ([['Seventies Bands', ['#ff6b35', '#f7c59f', '#efefd0', '#004e89', '#1a659e']], ['Sorbet Bands', ['#ff9a9e', '#fad0c4', '#fbc2eb', '#a6c1ee']], ['Ocean Bands', ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8']], ['Sunset Bands', ['#ff7b00', '#ff9500', '#ffb700', '#ffd000', '#ffea00']], ['Forest Bands', ['#081c15', '#1b4332', '#2d6a4f', '#52b788', '#95d5b2']]] as [string, string[]][])
    .forEach(([n, cols], i) => add(n, () => proj(n, '', [stripes(i % 2 ? 90 : 0, cols, cols.map(() => 20 + i * 2), { name: 'Bands' })])));
  ([['Ticking Navy', '#1e3a8a', '#f8fafc', 3, 16], ['Ticking Red', '#b91c1c', '#fff7ed', 3, 14], ['Ticking Olive', '#4d5d2a', '#fafaf0', 4, 16], ['Ticking Charcoal', '#1f2937', '#f3f4f6', 3, 18]] as [string, string, string, number, number][])
    .forEach(([n, a, b, t, w]) => add(n, () => proj(n, '', [stripes(90, [a, b], [t, w], { name: 'Ticking' })])));
  ([['Tri Pie', ['#f97316', '#fde68a', '#fb7185'], 60], ['Pinwheel', ['#111827', '#f9fafb'], 30], ['Fan Blades', ['#0ea5e9', '#e0f2fe'], 45], ['Cog Teeth', ['#6366f1', '#e0e7ff'], 15]] as [string, string[], number][])
    .forEach(([n, cols, deg]) => add(n, () => proj(n, '', [con(0, 50, 50, [...cols.map((c, k) => [c, (k / cols.length) * 100, 1, 'h'] as SS), [cols[cols.length - 1], 100]], { repeating: true, repeat: { size: deg, unit: 'deg', offset: 0 }, name: 'Segments' })])));
  ([['Moire Blue', '#0b1220', '#bfdbfe', 14], ['Moire Rose', '#1b0f14', '#fecdd3', 16], ['Moire Mono', '#f5f5f4', '#111827', 12]] as [string, string, string, number][])
    .forEach(([n, bg, c, sz]) => add(n, () => proj(n, bg, [rad(30, 40, 80, 120, [[c, 0, 0.55, 'h'], [c, 6, 0.55, 'h'], [c, 6, 0], [c, 100, 0]], { repeating: true, repeat: { size: sz, unit: 'px', offset: 0 }, name: 'Rings A' }), rad(70, 60, 80, 120, [[c, 0, 0.55, 'h'], [c, 6, 0.55, 'h'], [c, 6, 0], [c, 100, 0]], { repeating: true, repeat: { size: sz, unit: 'px', offset: 0 }, name: 'Rings B' })])));
  ([['Twill Denim', '#1e3a8a', '#3b82f6'], ['Twill Sand', '#c8b48a', '#e9dfc7'], ['Twill Sage', '#6b8f71', '#cfe3d0']] as [string, string, string][])
    .forEach(([n, a, b]) => add(n, () => proj(n, '', [lin(45, [[a, 0], [b, 50], [a, 100]], { repeating: true, repeat: { size: 14, unit: 'px', offset: 0 }, name: 'Twill ↗', blend: 'multiply' }), lin(135, [[a, 0], [b, 50], [a, 100]], { repeating: true, repeat: { size: 14, unit: 'px', offset: 0 }, name: 'Twill ↘', blend: 'multiply' })])));
  const base = out.filter(p => p.category === 'Repeating').length;
  R.forEach(([name, f], i) => out.push(mk('Repeating', base + i, name, ['repeating', 'pattern', 'background', 'seamless'], f)));
}

/* ───────── Experimental (16) ───────── */
function experimental() {
  const R: [string, () => GradientProject][] = [
    ['Oil Slick', () => proj('Oil Slick', '#07070d', [con(40, 55, 45, [['#ff4fd8', 0], ['#4fe3ff', 20], ['#b6ff6b', 40], ['#ffb347', 60], ['#a064ff', 80], ['#ff4fd8', 100]], { space: 'oklch', effects: [newEffect('blur', { radius: 24 }), newEffect('saturate', { amount: 150 })], blend: 'screen', opacity: 0.85, name: 'Film' })])],
    ['Prism Split', () => proj('Prism Split', '#000', [lin(205, [['#ff2d55', 0, 0], ['#ff2d55', 45, 0.9], ['#ff2d55', 70, 0]], { blend: 'screen', name: 'R' }), lin(180, [['#2dff8c', 0, 0], ['#2dff8c', 50, 0.9], ['#2dff8c', 78, 0]], { blend: 'screen', name: 'G' }), lin(155, [['#2d7bff', 0, 0], ['#2d7bff', 55, 0.9], ['#2d7bff', 85, 0]], { blend: 'screen', name: 'B' })])],
    ['RGB Drift', () => proj('RGB Drift', '#000', [blob(40, 42, 34, '#ff0033', 1, { blend: 'screen', name: 'Red' }), blob(58, 40, 34, '#00ff66', 1, { blend: 'screen', name: 'Green' }), blob(49, 62, 34, '#0044ff', 1, { blend: 'screen', name: 'Blue' })])],
    ['Heat Map', () => proj('Heat Map', '', [rad(50, 50, 60, 90, [['#ffffff', 0], ['#ffe600', 14], ['#ff7b00', 32], ['#d6246e', 52], ['#7a0f7a', 72], ['#1a0033', 88], ['#000000', 100]], { space: 'oklab', name: 'Heat' })])],
    ['Infrared', () => proj('Infrared', '', [lin(160, [['#ff3d00', 0], ['#ffea00', 40], ['#00e5ff', 75], ['#651fff', 100]], { effects: [newEffect('hue', { angle: 300 }), newEffect('contrast', { amount: 130 })], name: 'Spectrum' })])],
    ['Solar Flare', () => proj('Solar Flare', '#120400', [con(0, 50, 50, [['#ffffff', 0, 0.28, 'h'], ['#ffffff', 50, 0.28, 'h'], ['#ffffff', 50, 0], ['#ffffff', 100, 0]], { repeating: true, repeat: { size: 9, unit: 'deg', offset: 0 }, blend: 'overlay', name: 'Rays', effects: blur(3) }), rad(50, 50, 38, 57, [['#ffffff', 0], ['#ffe08a', 12], ['#ff8a1f', 34], ['#a3200a', 62], ['#120400', 100]], { name: 'Sun' })])],
    ['Kaleido', () => proj('Kaleido', '', [con(0, 50, 50, [['#ff5fa2', 0, 1, 'h'], ['#ffd166', 33, 1, 'h'], ['#06d6a0', 66, 1, 'h'], ['#118ab2', 100]], { repeating: true, repeat: { size: 60, unit: 'deg', offset: 0 }, name: 'Segments', effects: blur(2) })])],
    ['Topographic', () => proj('Topographic', '#0b2a2a', [rad(28, 40, 70, 105, [['#7be0c3', 0, 0.5, 'h'], ['#7be0c3', 3, 0.5, 'h'], ['#7be0c3', 3, 0], ['#7be0c3', 100, 0]], { repeating: true, repeat: { size: 22, unit: 'px', offset: 0 }, name: 'Contours A' }), rad(75, 66, 60, 90, [['#7be0c3', 0, 0.35, 'h'], ['#7be0c3', 3, 0.35, 'h'], ['#7be0c3', 3, 0], ['#7be0c3', 100, 0]], { repeating: true, repeat: { size: 18, unit: 'px', offset: 0 }, name: 'Contours B' })])],
    ['Vapor Grid', () => proj('Vapor Grid', '', [lin(0, [['#ff7ad9', 0, 0.6, 'h'], ['#ff7ad9', 3, 0.6, 'h'], ['#ff7ad9', 3, 0], ['#ff7ad9', 100, 0]], { repeating: true, repeat: { size: 34, unit: 'px', offset: 0 }, name: 'Horizontal' }), lin(90, [['#ff7ad9', 0, 0.6, 'h'], ['#ff7ad9', 3, 0.6, 'h'], ['#ff7ad9', 3, 0], ['#ff7ad9', 100, 0]], { repeating: true, repeat: { size: 34, unit: 'px', offset: 0 }, name: 'Vertical' }), lin(180, [['#2b0a5c', 0], ['#7a1fa2', 55], ['#ff6ec7', 100]], { name: 'Sky' })])],
    ['Liquid Chrome', () => proj('Liquid Chrome', '', [con(30, 50, 50, [['#e8ecf1', 0], ['#2a303a', 14], ['#aab4c0', 28], ['#ffffff', 40], ['#1a1f2b', 56], ['#9aa3b0', 72], ['#ffffff', 86], ['#e8ecf1', 100]], { space: 'oklab', effects: [newEffect('distort', { scale: 70, freq: 6, seed: 5 })], name: 'Chrome' })])],
    ['Event Horizon', () => proj('Event Horizon', '#000', [con(200, 50, 50, [['#7a1fa2', 0, 0], ['#ffb04a', 20, 0.8], ['#7a1fa2', 45, 0], ['#7a1fa2', 100, 0]], { blend: 'screen', name: 'Accretion', effects: blur(18), opacity: 0.8 }), rad(50, 50, 26, 39, [['#000000', 0, 1, 'h'], ['#000000', 52, 1], ['#ffb04a', 56, 1], ['#7a1fa2', 74, 0.55], ['#7a1fa2', 100, 0]], { name: 'Ring' })])],
    ['Chromatic Edge', () => proj('Chromatic Edge', '#101010', [lin(100, [['#00e5ff', 0, 0], ['#00e5ff', 50, 1], ['#00e5ff', 100, 0]], { blend: 'difference', transform: { x: 3, y: 0, scale: 1, rotate: 0, skewX: 0, skewY: 0 }, name: 'Cyan' }), lin(100, [['#ff2e63', 0, 0], ['#ff2e63', 50, 1], ['#ff2e63', 100, 0]], { blend: 'difference', transform: { x: -3, y: 0, scale: 1, rotate: 0, skewX: 0, skewY: 0 }, name: 'Magenta' })])],
    ['Gel Light', () => proj('Gel Light', '#111827', [blob(25, 30, 36, '#ff5d8f', 0.95, { blend: 'exclusion', effects: blur(60), name: 'Gel A' }), blob(70, 35, 36, '#4cc9f0', 0.95, { blend: 'difference', effects: blur(60), name: 'Gel B' }), blob(55, 75, 38, '#ffd166', 0.9, { blend: 'screen', effects: blur(60), name: 'Gel C' })])],
    ['Deep Field', () => proj('Deep Field', '#02030a', [rad(50, 50, 38, 40, [['#ffffff', 0, 0.9, 'h'], ['#ffffff', 5, 0.9, 'h'], ['#ffffff', 5, 0], ['#ffffff', 100, 0]], { repeating: true, repeat: { size: 61, unit: 'px', offset: 17 }, name: 'Stars A', opacity: 0.8 }), rad(30, 40, 55, 70, [['#ffffff', 0, 0.7, 'h'], ['#ffffff', 4, 0.7, 'h'], ['#ffffff', 4, 0], ['#ffffff', 100, 0]], { repeating: true, repeat: { size: 37, unit: 'px', offset: 5 }, name: 'Stars B', opacity: 0.6 }), blob(62, 38, 40, '#7c3aed', 0.65, { effects: blur(90), blend: 'screen', name: 'Nebula' })])],
    ['Glitch Bands', () => proj('Glitch Bands', '#0a0a12', [lin(0, [['#00fff0', 0, 0.9, 'h'], ['#00fff0', 8, 0.9, 'h'], ['#ff00a8', 8, 0.9, 'h'], ['#ff00a8', 14, 0.9, 'h'], ['#ffffff', 14, 0, 'h'], ['#ffffff', 100, 0]], { repeating: true, repeat: { size: 140, unit: 'px', offset: 0 }, blend: 'screen', name: 'Bands' }), lin(90, [['#6d28d9', 0, 0.5], ['#0a0a12', 100, 0]], { name: 'Wash' })])],
    ['Neon Tunnel', () => proj('Neon Tunnel', '#05010f', [rad(50, 50, 90, 135, [['#05010f', 0, 1], ['#05010f', 100, 0]], { name: 'Centre fade' }), rad(50, 50, 80, 120, [['#ff2fd1', 0, 0.95, 'h'], ['#ff2fd1', 6, 0.95, 'h'], ['#ff2fd1', 6, 0], ['#ff2fd1', 100, 0]], { repeating: true, repeat: { size: 52, unit: 'px', offset: 0 }, blend: 'screen', name: 'Rings', effects: blur(2) })])],
  ];
  R.forEach(([name, f], i) => out.push(mk('Experimental', i, name, ['experimental', 'blend', 'effects'], f)));
}

export function getPresets(): Preset[] {
  if (!built) { built = true; aurora(); mesh(); soft(); neon(); metallic(); atmospheric(); glass(); light(); dark(); editorial(); abstract(); repeating(); repeatingMore(); experimental(); }
  return out;
}
export const presetCount = () => getPresets().length;
