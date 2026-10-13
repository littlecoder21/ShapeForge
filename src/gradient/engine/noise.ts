import type { NoiseData } from './model';
import { mulberry } from './rng';

/* ═══════════ Grain / noise overlay ═══════════
 * Exported as an SVG feTurbulence tile: used as a CSS data-URI background, inlined in SVG output, and approximated on
 * canvas for PNG. Blend it with overlay / soft-light at low opacity for the classic film-grain look.
 */

const n3 = (v: number) => String(Math.round(v * 1000) / 1000);

export function noiseFilterMarkup(n: NoiseData, id = 'n'): string {
  const k = n.contrast / 100, icpt = 0.5 - 0.5 * k;
  const gray = n.mono ? '<feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1"/>' : '<feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1"/>';
  const contrast = Math.abs(n.contrast - 100) > 0.5 ? `<feComponentTransfer><feFuncR type="linear" slope="${n3(k)}" intercept="${n3(icpt)}"/><feFuncG type="linear" slope="${n3(k)}" intercept="${n3(icpt)}"/><feFuncB type="linear" slope="${n3(k)}" intercept="${n3(icpt)}"/></feComponentTransfer>` : '';
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${n3(n.frequency / 100)}" numOctaves="${Math.round(n.octaves)}" seed="${Math.round(n.seed)}" stitchTiles="stitch"/>${gray}${contrast}</filter>`;
}

/** A self-contained tile image. */
export function noiseTileSvg(n: NoiseData): string {
  const t = Math.round(n.tile);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}">${noiseFilterMarkup(n)}<rect width="100%" height="100%" filter="url(#n)"/></svg>`;
}
/** Compact data-URI: only the characters that must be escaped are encoded, so it stays readable in CSS. */
export const noiseDataUri = (n: NoiseData) => `url("data:image/svg+xml,${noiseTileSvg(n).replace(/"/g, "'").replace(/%/g, '%25').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23')}")`;

/** Canvas approximation for PNG export (value noise, octave-summed, seeded). */
export function noiseCanvas(n: NoiseData): HTMLCanvasElement {
  const t = Math.round(n.tile), c = document.createElement('canvas'); c.width = c.height = t;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(t, t), rnd = mulberry(n.seed * 7919 + 1);
  const cell = Math.max(1, Math.round(1 / Math.max(0.02, n.frequency / 100 * 0.9)));
  const layers: Float32Array[] = [];
  for (let o = 0; o < Math.max(1, n.octaves); o++) {
    const g = Math.max(2, Math.ceil(t / Math.max(1, cell * 2 ** (n.octaves - 1 - o)))), field = new Float32Array(g * g * 3);
    for (let i = 0; i < field.length; i++) field[i] = rnd();
    layers.push(field);
  }
  const k = n.contrast / 100;
  for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) {
    let r = 0, g = 0, b = 0, w = 0;
    layers.forEach((field, o) => {
      const gs = Math.sqrt(field.length / 3), fx = (x / t) * (gs - 1), fy = (y / t) * (gs - 1), ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const at = (a: number, bb: number, ch: number) => field[((Math.min(gs - 1, bb) * gs) + Math.min(gs - 1, a)) * 3 + ch];
      const mix = (ch: number) => (at(ix, iy, ch) * (1 - tx) + at(ix + 1, iy, ch) * tx) * (1 - ty) + (at(ix, iy + 1, ch) * (1 - tx) + at(ix + 1, iy + 1, ch) * tx) * ty;
      const wt = 1 / (o + 1); r += mix(0) * wt; g += mix(1) * wt; b += mix(2) * wt; w += wt;
    });
    r /= w; g /= w; b /= w;
    if (n.mono) { const m = (r + g + b) / 3; r = g = b = m; }
    const i = (y * t + x) * 4;
    img.data[i] = Math.max(0, Math.min(255, ((r - 0.5) * k + 0.5) * 255)); img.data[i + 1] = Math.max(0, Math.min(255, ((g - 0.5) * k + 0.5) * 255)); img.data[i + 2] = Math.max(0, Math.min(255, ((b - 0.5) * k + 0.5) * 255)); img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
