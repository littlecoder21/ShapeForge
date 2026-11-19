/* Trail FX — colour tools. Pure functions (no React): curated palettes, harmony generators, and helpers that resize a palette to
 * whatever number of colours a pass accepts. Used by the colour editor in the builder and by the presets. */

export const TRAILFX_MAX_COLORS = 8;
export const HEX_RE = /^#[0-9a-f]{6}$/i;

export interface TrailFxPalette { id: string; label: string; colors: string[] }

export const TRAILFX_PALETTES: TrailFxPalette[] = [
  { id: 'aurora', label: 'Aurora', colors: ['#0f2027', '#1de9b6', '#7c4dff', '#e0fff4'] },
  { id: 'sunset', label: 'Sunset', colors: ['#2b0a3d', '#ff3d6e', '#ff9a3c', '#ffe29a'] },
  { id: 'ocean', label: 'Ocean', colors: ['#03113a', '#0066ff', '#00c2ff', '#d8fbff'] },
  { id: 'neon-city', label: 'Neon city', colors: ['#12002b', '#ff2bd6', '#00e5ff', '#fff700'] },
  { id: 'candy', label: 'Candy', colors: ['#ff8ad8', '#ffd1f0', '#9be7ff', '#b6a2ff'] },
  { id: 'forest', label: 'Forest', colors: ['#06210f', '#1f7a3a', '#8bd450', '#f4ffd1'] },
  { id: 'ember', label: 'Ember', colors: ['#1a0500', '#b81d00', '#ff6a00', '#ffd36b'] },
  { id: 'ice', label: 'Ice', colors: ['#0b1d3a', '#4aa3ff', '#bfe6ff', '#ffffff'] },
  { id: 'gold-rush', label: 'Gold rush', colors: ['#2a1600', '#a86b00', '#ffc83d', '#fff6c9'] },
  { id: 'vapor', label: 'Vapor', colors: ['#ff71ce', '#b967ff', '#01cdfe', '#05ffa1', '#fffb96'] },
  { id: 'silver', label: 'Silver', colors: ['#0d0f14', '#59616f', '#c8cfdb', '#ffffff'] },
  { id: 'tropical', label: 'Tropical', colors: ['#00a896', '#02c39a', '#f0f3bd', '#ff7b54', '#ff3d81'] },
  { id: 'berry', label: 'Berry', colors: ['#2d0a31', '#7a1fa2', '#e0338d', '#ffb3d9'] },
  { id: 'cyber-lime', label: 'Cyber lime', colors: ['#0a0f0a', '#2bff88', '#d7ff3a', '#ffffff'] },
  { id: 'dusk', label: 'Dusk', colors: ['#1b1b3a', '#693668', '#a74482', '#f84aa7', '#ff3562'] },
  { id: 'pastel', label: 'Pastel', colors: ['#ffd6e0', '#ffefcf', '#d6f5e3', '#d6e6ff', '#e7d6ff'] },
  { id: 'lava', label: 'Lava', colors: ['#100000', '#7a0000', '#ff2a00', '#ff9d00', '#fff2b0'] },
  { id: 'galaxy', label: 'Galaxy', colors: ['#050014', '#2a0a6b', '#7c3aed', '#38bdf8', '#fdf4ff'] },
  { id: 'retro', label: 'Retro', colors: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'] },
  { id: 'mint', label: 'Mint', colors: ['#d4fff0', '#7cf0c9', '#34c7a0', '#0b7a66'] },
  { id: 'mono-white', label: 'Mono white', colors: ['#000000', '#ffffff'] },
  { id: 'rainbow', label: 'Rainbow', colors: ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2'] },
];
export const TRAILFX_PALETTE_MAP = Object.fromEntries(TRAILFX_PALETTES.map(palette => [palette.id, palette])) as Record<string, TrailFxPalette>;
export const paletteColors = (id: string): string[] => [...(TRAILFX_PALETTE_MAP[id]?.colors ?? TRAILFX_PALETTES[0].colors)];

/* ───────────── colour maths ───────────── */

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const normalizeHex = (value: string, fallback = '#ffffff'): string => {
  const text = value.trim();
  if (HEX_RE.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text}`.toLowerCase();
  return fallback;
};

export function hexToRgb(hex: string): [number, number, number] {
  const safe = normalizeHex(hex, '#000000');
  return [1, 3, 5].map(i => parseInt(safe.slice(i, i + 2), 16)) as [number, number, number];
}
export const rgbToHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map(channel => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('');

/** h in degrees, s and l in 0–1 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexToRgb(hex).map(channel => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (d < 1e-6) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}
export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360, sat = clamp01(s), light = clamp01(l);
  const c = (1 - Math.abs(2 * light - 1)) * sat, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = light - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export const mixHex = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = hexToRgb(a), [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
};

/** Sample a palette as a smooth ramp at t (0–1). */
export function sampleRamp(colors: string[], t: number): string {
  if (!colors.length) return '#ffffff';
  if (colors.length === 1) return colors[0];
  const x = clamp01(t) * (colors.length - 1), i = Math.min(colors.length - 2, Math.floor(x));
  return mixHex(colors[i], colors[i + 1], x - i);
}

/** Resize a palette to exactly `count` colours by sampling its ramp (keeps both end colours). */
export function resamplePalette(colors: string[], count: number): string[] {
  const n = Math.max(1, Math.min(TRAILFX_MAX_COLORS, Math.round(count)));
  if (!colors.length) return Array.from({ length: n }, () => '#ffffff');
  if (colors.length === n) return [...colors];
  if (n === 1) return [colors[0]];
  return Array.from({ length: n }, (_, i) => (i < colors.length && colors.length < n ? colors[i] : sampleRamp(colors, i / (n - 1))));
}

/** CSS gradient for the colour bars in the builder. */
export const rampCss = (colors: string[], direction = 'to right'): string =>
  colors.length > 1 ? `linear-gradient(${direction}, ${colors.join(', ')})` : colors[0] ?? 'transparent';

/* ───────────── generators ───────────── */

export type HarmonyId = 'analogous' | 'complementary' | 'triad' | 'split' | 'tetrad' | 'monochrome' | 'warm-cool';
export const HARMONIES: { id: HarmonyId; label: string }[] = [
  { id: 'analogous', label: 'Analogous' }, { id: 'complementary', label: 'Complementary' }, { id: 'triad', label: 'Triad' },
  { id: 'split', label: 'Split complementary' }, { id: 'tetrad', label: 'Tetrad' }, { id: 'monochrome', label: 'Monochrome' }, { id: 'warm-cool', label: 'Warm to cool' },
];

/** A palette of `count` colours built around `base` using a colour-wheel rule. The base colour stays the first colour. */
export function harmony(base: string, kind: HarmonyId, count: number): string[] {
  const n = Math.max(2, Math.min(TRAILFX_MAX_COLORS, Math.round(count)));
  const { h, s, l } = hexToHsl(base);
  const sat = Math.max(0.35, s), light = Math.min(0.7, Math.max(0.35, l));
  const hues: number[] = (() => {
    switch (kind) {
      case 'analogous': return Array.from({ length: n }, (_, i) => h + (i - (n - 1) / 2) * 28 + (n - 1) * 14);
      case 'complementary': return Array.from({ length: n }, (_, i) => h + (i % 2 ? 180 : 0) + Math.floor(i / 2) * 18);
      case 'triad': return Array.from({ length: n }, (_, i) => h + (i % 3) * 120 + Math.floor(i / 3) * 16);
      case 'split': return Array.from({ length: n }, (_, i) => h + [0, 150, 210][i % 3] + Math.floor(i / 3) * 16);
      case 'tetrad': return Array.from({ length: n }, (_, i) => h + (i % 4) * 90 + Math.floor(i / 4) * 14);
      case 'warm-cool': return Array.from({ length: n }, (_, i) => 12 + (i / (n - 1)) * 205);
      default: return Array.from({ length: n }, () => h);
    }
  })();
  return hues.map((hue, i) => {
    if (kind === 'monochrome') return hslToHex(h, sat, 0.12 + (i / (n - 1)) * 0.8);
    if (kind === 'warm-cool') return hslToHex(hue, 0.85, 0.5 + 0.08 * Math.sin(i * 1.7));
    return i === 0 ? normalizeHex(base) : hslToHex(hue, sat, light + (i % 2 ? 0.08 : -0.04));
  });
}

/** A pleasant random palette: a base hue, a rule from the colour wheel and gently varied lightness. */
export function randomPalette(count: number, random: () => number = Math.random): string[] {
  const kinds: HarmonyId[] = ['analogous', 'complementary', 'triad', 'split', 'tetrad', 'warm-cool'];
  const base = hslToHex(random() * 360, 0.6 + random() * 0.35, 0.45 + random() * 0.15);
  return harmony(base, kinds[Math.floor(random() * kinds.length)], count);
}

export const reversePalette = (colors: string[]): string[] => [...colors].reverse();
export const shufflePalette = (colors: string[], random: () => number = Math.random): string[] => {
  const out = [...colors];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
/** Sort dark → light, the order a colour map reads best in. */
export const sortByLightness = (colors: string[]): string[] => [...colors].sort((a, b) => hexToHsl(a).l - hexToHsl(b).l);
