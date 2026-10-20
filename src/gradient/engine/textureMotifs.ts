import type { TextureData } from './model';
import type { FalloffTarget, TextureCapability, TextureKind, TextureShape } from './textureControls';
import { CH, TILE, clamp, distribute, falloffAt, flowAngle, makeRand, makeWarp, tileableSlope, wrap, type Dist, type Rand, type WarpFn } from './textureMath';

/* ═══════════════════════════ Texture renderers ═══════════════════════════
 * A texture preset is a RECIPE: a short list of layers (see textureRecipes.ts). This file turns a layer + the user's
 * control values into SVG markup for one 64×64 tile. Rules every renderer follows:
 *  • the tile is periodic — lattices use whole numbers of repeats, elements that cross an edge are drawn again on
 *    the opposite side, noise is stitched — so repeating it never shows a seam;
 *  • per-element randomness comes from a stateless hash (one stream per property), so unrelated controls never
 *    reshuffle each other;
 *  • with distortion at 0 the exact, sharp geometry is emitted (no sampling, no extra vertices);
 *  • output size is bounded (see MAX_LEN / MAX_ITEMS) whatever the control values are.
 */

export type ShapeId = Exclude<TextureShape, 'auto'>;
type Pair = [number, number];

export interface NoiseLayer { k: 'noise'; freq: number; oct: number; type: 'fractalNoise' | 'turbulence'; a: number; color?: string; seed?: number; /** built-in threshold (0…1) used while the Threshold control is 0 */ cut?: number }
export interface ScatterLayer { k: 'scatter'; dist: Dist; allow?: Dist[]; pitch: number; count?: number; r: number; shape: ShapeId; diamond?: boolean; rv?: Pair; ov?: Pair; color?: string; burst?: number; rot?: number; jit?: number; cover?: number }
export interface StrokesLayer { k: 'strokes'; dist: Dist; allow?: Dist[]; count: number; len: number; lv?: number; w: number; wv?: number; angle: number; spread: number; curve?: number; ov?: Pair; color?: string; cover?: number }
export interface LineSet { dir: 'h' | 'v' | Pair; pitch: number; w: number; o?: number; dash?: Pair; off?: number; color?: string; major?: { every: number; minor: number }; wv?: number; ov?: Pair; span?: Pair }
export interface LinesLayer { k: 'lines'; sets: LineSet[]; cross?: boolean; nodes?: number; glitch?: boolean; color?: string }
export interface WavesLayer { k: 'waves'; pitch: number; lambda: number; amp: number; w: number; o?: number; form?: 'sin' | 'tri'; h2?: number; l2?: number; phaseStep?: number; phaseRand?: number; ov?: Pair; color?: string }
export interface RingsLayer { k: 'rings'; n: number; r0: number; dr: number; ratio?: number; w: number; o?: number; wobble?: number; centers?: Pair[]; spokes?: number; ov?: Pair; color?: string }
export interface CellsLayer { k: 'cells'; dist: Dist; allow?: Dist[]; count: number; w: number; o?: number; fill?: number; irregular?: number; ov?: Pair; color?: string }
export interface TilingLayer { k: 'tiling'; form: 'checker' | 'hex' | 'cubes' | 'tri' | 'diamond' | 'scales' | 'knit' | 'frames' | 'rays'; pitch: number; ratio?: number; w: number; o?: number; cross?: boolean; ov?: Pair; color?: string; cover?: number }
export interface WeaveLayer { k: 'weave'; pitch: number; w: number; o?: number; interval?: number; shift?: number; basket?: boolean; ov?: Pair; color?: string }
export type Layer = NoiseLayer | ScatterLayer | StrokesLayer | LinesLayer | WavesLayer | RingsLayer | CellsLayer | TilingLayer | WeaveLayer;

export interface Ctx {
  P: TextureData;
  seed: number; ls: number;
  color: string; cur: string;
  d: number;
  out: string[]; defs: string[];
  n: number; len: number;
  /** extra margin drawn around the tile so blur / softness stays seamless */
  pad: number;
  R: Rand;
  warp: WarpFn | null;
  flow: (x: number, y: number) => number;
  uid: number;
}

const MAX_LEN = 110_000;
const MAX_ITEMS = 2600;
/** Largest distance the domain warp can move a point (tile units) — geometry this close to the tile is still drawn. */
const WR = 15;
const ALL_DISTS: Dist[] = ['grid', 'staggered', 'random', 'radial', 'poisson', 'flow'];

export const f2 = (v: number) => { const r = Math.round(v * 100) / 100; return String(r === 0 ? 0 : r); };

export function createCtx(P: TextureData): Ctx {
  const seed = Math.abs(Math.round(P.seed)) || 1;
  return {
    P, seed, ls: seed, color: P.color, cur: P.color, d: clamp(P.density, 1, 100), out: [], defs: [], n: 0, len: 0,
    pad: P.softness > 0 ? Math.min(12, Math.ceil(P.softness * 3)) : 0,
    R: makeRand(seed), warp: makeWarp(P, seed), flow: flowAngle(seed), uid: 0,
  };
}

const room = (c: Ctx) => c.len < MAX_LEN && c.n < MAX_ITEMS;
const add = (c: Ctx, s: string) => { c.out.push(s); c.len += s.length; c.n++; };
const open = (c: Ctx, tag: string) => { c.out.push(tag); c.len += tag.length; };

/** Multiplier (0…1) the falloff applies to a property at (x, y); 1 when the falloff does not target it. */
function fm(c: Ctx, x: number, y: number, target: FalloffTarget): number {
  const P = c.P;
  if (P.falloff === 'none' || P.falloffTarget !== target) return 1;
  return 1 - (P.falloffStrength / 100) * (1 - falloffAt(P, x, y));
}

/** Translations (multiples of the tile) at which a bounding box touches the visible tile (plus the blur margin). */
function copies(c: Ctx, x0: number, y0: number, x1: number, y1: number): Pair[] {
  const res: Pair[] = [], lo = -c.pad, hi = TILE + c.pad;
  for (const sx of [-TILE, 0, TILE]) for (const sy of [-TILE, 0, TILE]) {
    if (x1 + sx > lo && x0 + sx < hi && y1 + sy > lo && y0 + sy < hi) res.push([sx, sy]);
  }
  return res;
}

const effDist = (c: Ctx, base: Dist, allow?: Dist[]): Dist => {
  const user = c.P.distribution;
  if (user === 'auto') return base;
  return (allow ?? ALL_DISTS).includes(user as Dist) ? (user as Dist) : base;
};

const mix = (range: Pair | undefined, r: number) => (range ? range[0] + (range[1] - range[0]) * r : 1);
/** Preset-intrinsic variation combined with the user's variation control. */
const vary = (base: number, user: number) => base + user * (1 - base);

/* ───────────── shapes ───────────── */

function polygon(shape: ShapeId, rx: number, ry: number, sym: number): Pair[] {
  switch (shape) {
    case 'square': return [[-rx, -ry], [rx, -ry], [rx, ry], [-rx, ry]];
    case 'diamond': return [[0, -ry * 1.25], [rx * 1.25, 0], [0, ry * 1.25], [-rx * 1.25, 0]];
    case 'triangle': return [0, 1, 2].map(i => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3; return [Math.cos(a) * rx * 1.2, Math.sin(a) * ry * 1.2] as Pair; });
    case 'polygon': { const n = clamp(Math.round(sym), 3, 12); return Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [Math.cos(a) * rx * 1.1, Math.sin(a) * ry * 1.1] as Pair; }); }
    case 'star': { const n = clamp(Math.round(sym), 3, 12); return Array.from({ length: n * 2 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / n, k = i % 2 ? 0.45 : 1.25; return [Math.cos(a) * rx * k, Math.sin(a) * ry * k] as Pair; }); }
    case 'cross': { const t = 0.36; return ([[-t, -1], [t, -1], [t, -t], [1, -t], [1, t], [t, t], [t, 1], [-t, 1], [-t, t], [-1, t], [-1, -t], [-t, -t]] as Pair[]).map(([x, y]) => [x * rx * 1.2, y * ry * 1.2] as Pair); }
    default: return [];
  }
}

function emitShape(c: Ctx, shape: ShapeId, x: number, y: number, r: number, angle: number, opacity: number, corner: number): void {
  const P = c.P, ar = clamp(P.aspectRatio / 100, 0.25, 4), rx = r * Math.sqrt(ar), ry = r / Math.sqrt(ar);
  const ext = Math.max(rx, ry) * (shape === 'circle' || shape === 'ring' ? 1.05 : 1.5) + 0.5;
  const op = opacity < 0.995 ? ` opacity="${f2(opacity)}"` : '';
  const verts = polygon(shape, rx, ry, P.symmetry);
  const rad = (angle * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  for (const [sx, sy] of copies(c, x - ext, y - ext, x + ext, y + ext)) {
    if (!room(c)) return;
    const cx = x + sx, cy = y + sy;
    if (shape === 'circle') {
      if (Math.abs(ar - 1) < 0.01) add(c, `<circle cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}"${op}/>`);
      else add(c, `<ellipse cx="${f2(cx)}" cy="${f2(cy)}" rx="${f2(rx)}" ry="${f2(ry)}"${angle ? ` transform="rotate(${f2(angle)} ${f2(cx)} ${f2(cy)})"` : ''}${op}/>`);
    } else if (shape === 'ring') {
      add(c, `<ellipse cx="${f2(cx)}" cy="${f2(cy)}" rx="${f2(rx * 0.8)}" ry="${f2(ry * 0.8)}" fill="none" stroke="${c.cur}" stroke-width="${f2(Math.max(0.3, r * 0.36))}"${angle ? ` transform="rotate(${f2(angle)} ${f2(cx)} ${f2(cy)})"` : ''}${op}/>`);
    } else if (shape === 'square' && !angle) {
      add(c, `<rect x="${f2(cx - rx)}" y="${f2(cy - ry)}" width="${f2(rx * 2)}" height="${f2(ry * 2)}"${corner > 0 ? ` rx="${f2((corner / 100) * Math.min(rx, ry) * 2)}"` : ''}${op}/>`);
    } else {
      const d = verts.map(([vx, vy], i) => `${i ? 'L' : 'M'}${f2(cx + vx * cs - vy * sn)} ${f2(cy + vx * sn + vy * cs)}`).join('') + 'Z';
      add(c, `<path d="${d}"${op}/>`);
    }
  }
}

/* ───────────── scatter (dots, specks, blocks, stars …) ───────────── */

function renderScatter(L: ScatterLayer, c: Ctx): void {
  const P = c.P, R = c.R, sx = P.spacingX / 100, sy = P.spacingY / 100;
  const dist = effDist(c, L.dist, L.allow);
  const shape: ShapeId = P.shape === 'auto' ? L.shape : P.shape;
  const diamond = !!L.diamond && dist === 'staggered';
  const px = L.pitch * sx * (diamond ? Math.SQRT2 : 1), py = L.pitch * sy * (diamond ? Math.SQRT1_2 : 1);
  const cols = clamp(Math.round(TILE / px), 1, 24);
  let rows = clamp(Math.round(TILE / py), 1, diamond ? 40 : 24);
  if (dist === 'staggered') rows = Math.max(2, Math.round(rows / 2) * 2);
  const count = clamp(Math.round((L.count ?? (TILE * TILE) / (L.pitch * L.pitch)) / (sx * sy)), 1, 700);
  const pts = distribute(dist, {
    seed: c.ls, cols, rows, count, phase: P.phase / 100, cx: 32, cy: 32, burst: L.burst ?? 1.8,
    minDist: 0.8 * Math.sqrt((TILE * TILE) / count), flow: c.flow, step: clamp(L.pitch * 0.9, 2, 12),
  });
  const jitterBase = L.jit ?? 0, sizeBase = L.rv ? 1 : 0, cover = (L.cover ?? 1) * (P.coverage / 100);
  open(c, `<g fill="${c.cur}">`);
  for (const p of pts) {
    if (!room(c)) break;
    const i = p.i;
    if (cover < 1 && R(i, 0, CH.cover) >= cover) continue;
    const density = fm(c, p.x, p.y, 'density');
    if (density < 1 && R(i, 0, CH.fall) > density) continue;
    const jit = vary(jitterBase, P.positionJitter / 100);
    let x = p.x, y = p.y;
    if (jit > 0) { x += (R(i, 0, CH.jx) - 0.5) * jit * px; y += (R(i, 0, CH.jy) - 0.5) * jit * py; }
    if (c.warp) { const [dx, dy] = c.warp(x, y, fm(c, x, y, 'distortion')); x += dx; y += dy; }
    x = wrap(x); y = wrap(y);
    const base = sizeBase ? mix(L.rv, R(i, 0, CH.sizeBase)) : 1;
    const r = L.r * (P.motifSize / 100) * base * (1 - (P.sizeVariation / 100) * R(i, 0, CH.size)) * fm(c, x, y, 'size');
    if (r < 0.12) continue;
    const opacity = mix(L.ov, R(i, 0, CH.opBase)) * (1 - (P.opacityVariation / 100) * R(i, 0, CH.opacity)) * fm(c, x, y, 'opacity');
    if (opacity < 0.02) continue;
    const angle = (L.rot ?? 0) + (R(i, 0, CH.angle) - 0.5) * 2 * P.angleVariation;
    emitShape(c, shape, x, y, r, angle, opacity, P.cornerRadius);
  }
  open(c, '</g>');
}

/* ───────────── strokes (fibres, scratches, hair, marks) ───────────── */

function renderStrokes(L: StrokesLayer, c: Ctx): void {
  const P = c.P, R = c.R, sx = P.spacingX / 100, sy = P.spacingY / 100;
  const dist = effDist(c, L.dist, L.allow);
  const count = clamp(Math.round(L.count / (sx * sy)), 1, 420);
  const cols = clamp(Math.round(Math.sqrt(count)), 1, 24), rows = dist === 'staggered' ? Math.max(2, Math.round(Math.sqrt(count) / 2) * 2) : cols;
  const pts = distribute(dist, {
    seed: c.ls, cols, rows, count, phase: P.phase / 100, cx: 32, cy: 32, burst: 1, minDist: 0.7 * Math.sqrt((TILE * TILE) / count), flow: c.flow, step: clamp(L.len * 0.6, 2, 12),
  });
  const cover = (L.cover ?? 1) * (P.coverage / 100), spread = L.spread + P.angleVariation;
  open(c, `<g fill="none" stroke="${c.cur}" stroke-linecap="round">`);
  for (const p of pts) {
    if (!room(c)) break;
    const i = p.i;
    if (cover < 1 && R(i, 0, CH.cover) >= cover) continue;
    const density = fm(c, p.x, p.y, 'density');
    if (density < 1 && R(i, 0, CH.fall) > density) continue;
    let x = p.x, y = p.y;
    if (P.positionJitter > 0) { x += (R(i, 0, CH.jx) - 0.5) * (P.positionJitter / 100) * 12; y += (R(i, 0, CH.jy) - 0.5) * (P.positionJitter / 100) * 12; }
    const heading = dist === 'flow' ? (c.flow(x, y) * 180) / Math.PI : L.angle;
    const angle = ((heading + (R(i, 0, CH.angle) - 0.5) * 2 * spread) * Math.PI) / 180;
    const len = L.len * (P.motifSize / 100) * (1 - (L.lv ?? 0) * R(i, 0, CH.len)) * (1 - (P.sizeVariation / 100) * R(i, 0, CH.size)) * fm(c, x, y, 'size');
    const width = Math.max(0.2, L.w * (P.strokeWidth / 100) * (1 - (L.wv ?? 0) * R(i, 0, CH.width)));
    const opacity = mix(L.ov, R(i, 0, CH.opBase)) * (1 - (P.opacityVariation / 100) * R(i, 0, CH.opacity)) * fm(c, x, y, 'opacity');
    if (len < 0.3 || opacity < 0.02) continue;
    const ca = Math.cos(angle), sa = Math.sin(angle), curve = (L.curve ?? 0.15) * len * (R(i, 0, CH.curve) - 0.5) * 2;
    let ax = x - ca * len / 2, ay = y - sa * len / 2, bx = x + ca * len / 2, by = y + sa * len / 2, mx = x - sa * curve, my = y + ca * curve;
    if (c.warp) {
      const k = fm(c, x, y, 'distortion');
      let w = c.warp(ax, ay, k); ax += w[0]; ay += w[1];
      w = c.warp(bx, by, k); bx += w[0]; by += w[1];
      w = c.warp(mx, my, k); mx += w[0]; my += w[1];
    }
    const minX = Math.min(ax, bx, mx), maxX = Math.max(ax, bx, mx), minY = Math.min(ay, by, my), maxY = Math.max(ay, by, my);
    const cx = wrap(x) - x, cy = wrap(y) - y; // canonical position of the stroke centre
    for (const [ox, oy] of copies(c, minX + cx - width, minY + cy - width, maxX + cx + width, maxY + cy + width)) {
      if (!room(c)) break;
      const tx = ox + cx, ty = oy + cy;
      add(c, `<path d="M${f2(ax + tx)} ${f2(ay + ty)}Q${f2(mx + tx)} ${f2(my + ty)} ${f2(bx + tx)} ${f2(by + ty)}" stroke-width="${f2(width)}"${opacity < 0.995 ? ` opacity="${f2(opacity)}"` : ''}/>`);
    }
  }
  open(c, '</g>');
}

/* ───────────── noise (SVG turbulence, stitched so it tiles) ───────────── */

/** A soft luminance mask that carries the falloff profile across the tile (sampled, so it is periodic by construction). */
function falloffMask(c: Ctx, target: FalloffTarget): string | undefined {
  const P = c.P;
  if (P.falloff === 'none' || P.falloffTarget !== target) return undefined;
  const id = `fm${c.uid++}`, margin = 12, size = TILE + margin * 2, cells = 16, step = size / cells;
  let rects = '';
  for (let iy = 0; iy < cells; iy++) for (let ix = 0; ix < cells; ix++) {
    const v = fm(c, -margin + (ix + 0.5) * step, -margin + (iy + 0.5) * step, target), g = Math.round(clamp(v, 0, 1) * 255);
    rects += `<rect x="${f2(-margin + ix * step)}" y="${f2(-margin + iy * step)}" width="${f2(step + 0.05)}" height="${f2(step + 0.05)}" fill="rgb(${g},${g},${g})"/>`;
  }
  c.defs.push(`<filter id="${id}b" filterUnits="userSpaceOnUse" x="${-margin}" y="${-margin}" width="${size}" height="${size}"><feGaussianBlur stdDeviation="${f2(step * 0.45)}"/></filter><mask id="${id}" maskUnits="userSpaceOnUse" x="${-margin}" y="${-margin}" width="${size}" height="${size}"><g filter="url(#${id}b)">${rects}</g></mask>`);
  return id;
}

function noisePrimitives(c: Ctx, type: string, fx: number, fy: number, oct: number, seed: number, color: string, extra = ''): string {
  const pad = Math.ceil(c.pad), size = TILE + pad * 2;
  let s = `<feTurbulence type="${type}" baseFrequency="${f2(fx * 1000) === '0' ? '0.001' : String(Math.round(fx * 1e4) / 1e4)} ${String(Math.round(fy * 1e4) / 1e4)}" numOctaves="${oct}" seed="${seed}" stitchTiles="stitch" x="0" y="0" width="${TILE}" height="${TILE}" result="t"/>`;
  // feTile repeats the stitched tile into the margin, so blur / softness sees the neighbouring tile instead of transparency
  if (pad) s += `<feTile in="t" x="${-pad}" y="${-pad}" width="${size}" height="${size}" result="t"/>`;
  s += '<feColorMatrix in="t" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .33 .34 .33 0 0" result="m"/>';
  if (extra) s += extra;
  s += `<feFlood flood-color="${color}" result="f"/><feComposite in="f" in2="m" operator="in"/>`;
  return s;
}

function renderNoise(L: NoiseLayer, c: Ctx): void {
  const P = c.P, pad = Math.ceil(c.pad), size = TILE + pad * 2, ar = clamp(P.aspectRatio / 100, 0.25, 4);
  const freq = clamp(L.freq / (P.motifSize / 100), 0.004, 1.3);
  const fx = clamp(freq / ar, 0.003, 1.5), oct = P.octaves > 0 ? P.octaves : L.oct;
  const seed = Math.abs(Math.round((L.seed ?? c.ls) % 100000)) || 1, color = L.color ?? c.color;
  const region = `filterUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${size}" height="${size}"`;
  const thr = P.threshold > 0 ? P.threshold / 100 : L.cut ?? 0;
  const cut = thr > 0 ? `<feComponentTransfer in="m" result="m"><feFuncA type="linear" slope="10" intercept="${f2(-thr * 10)}"/></feComponentTransfer>` : '';
  const id = `n${c.uid++}`, mask = falloffMask(c, 'opacity');
  c.defs.push(`<filter id="${id}" ${region}>${noisePrimitives(c, L.type, fx, freq, oct, seed, color, cut)}</filter>`);
  add(c, `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}" filter="url(#${id})" opacity="${f2(clamp(L.a, 0, 1))}"${mask ? ` mask="url(#${mask})"` : ''}/>`);
  if (P.detailAmount > 0) {
    const did = `n${c.uid++}`, dmask = falloffMask(c, 'detail'), dscale = 100 / P.detailScale;
    const dd = (P.detailDensity - 50) / 100;
    const dcut = `<feComponentTransfer in="m" result="m"><feFuncA type="linear" slope="1.5" intercept="${f2(dd * 0.9 - 0.25)}"/></feComponentTransfer>`;
    c.defs.push(`<filter id="${did}" ${region}>${noisePrimitives(c, 'fractalNoise', clamp(fx * dscale * 2.2, 0.01, 1.5), clamp(freq * dscale * 2.2, 0.01, 1.5), 2, (seed + 131) % 100000 || 1, color, dcut)}</filter>`);
    add(c, `<rect x="${-pad}" y="${-pad}" width="${size}" height="${size}" filter="url(#${did})" opacity="${f2(clamp(L.a * (P.detailAmount / 100) * 1.2, 0, 1))}"${dmask ? ` mask="url(#${dmask})"` : ''}/>`);
  }
}

/* ───────────── detail layer for non-noise textures ───────────── */

function renderDetail(c: Ctx, mode: 'specks' | 'hairs'): void {
  const P = c.P, R = makeRand(c.seed + 4242), amount = P.detailAmount / 100;
  if (amount <= 0) return;
  const n = clamp(Math.round(10 + P.detailDensity * 1.6), 10, 170), scale = P.detailScale / 100;
  open(c, mode === 'specks' ? `<g fill="${c.color}">` : `<g fill="none" stroke="${c.color}" stroke-linecap="round">`);
  for (let i = 0; i < n && room(c); i++) {
    const x = R(i, 0, CH.detailX) * TILE, y = R(i, 0, CH.detailY) * TILE, k = fm(c, x, y, 'detail');
    const opacity = amount * (0.35 + 0.65 * R(i, 0, CH.detailO)) * k;
    if (opacity < 0.03) continue;
    if (mode === 'specks') {
      const r = (0.3 + 0.9 * R(i, 0, CH.detailR)) * (0.4 + scale * 0.9);
      for (const [ox, oy] of copies(c, x - r, y - r, x + r, y + r)) add(c, `<circle cx="${f2(x + ox)}" cy="${f2(y + oy)}" r="${f2(r)}" opacity="${f2(opacity)}"/>`);
    } else {
      const a = R(i, 0, CH.angBase) * Math.PI, len = (2 + 7 * R(i, 0, CH.detailR)) * (0.4 + scale), dx = (Math.cos(a) * len) / 2, dy = (Math.sin(a) * len) / 2;
      for (const [ox, oy] of copies(c, x - len, y - len, x + len, y + len)) add(c, `<path d="M${f2(x + ox - dx)} ${f2(y + oy - dy)}L${f2(x + ox + dx)} ${f2(y + oy + dy)}" stroke-width="0.35" opacity="${f2(opacity)}"/>`);
    }
  }
  open(c, '</g>');
}

/* ───────────── shared path helpers ───────────── */

const quant = (v: number, step: number) => Math.round(v / step) * step;

/** Subdivide a polyline so a smooth warp has enough vertices to bend. */
function densify(pts: Pair[], maxStep: number, closed = false): Pair[] {
  const out: Pair[] = [], n = pts.length, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxStep));
    for (let s = 0; s < steps; s++) out.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  if (!closed && n) out.push(pts[n - 1]);
  return out;
}

function warpPts(c: Ctx, pts: Pair[]): Pair[] {
  const warp = c.warp;
  if (!warp) return pts;
  return pts.map(([x, y]) => { const [dx, dy] = warp(x, y, fm(c, x, y, 'distortion')); return [x + dx, y + dy] as Pair; });
}

const pathOf = (pts: Pair[], closed = false, dx = 0, dy = 0) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f2(x + dx)} ${f2(y + dy)}`).join('') + (closed ? 'Z' : '');
const bboxOf = (pts: Pair[]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
};
const roundedRect = (x: number, y: number, w: number, h: number, r: number) => {
  const k = Math.min(r, w / 2, h / 2);
  if (k <= 0.01) return `M${f2(x)} ${f2(y)}h${f2(w)}v${f2(h)}h${f2(-w)}z`;
  return `M${f2(x + k)} ${f2(y)}H${f2(x + w - k)}A${f2(k)} ${f2(k)} 0 0 1 ${f2(x + w)} ${f2(y + k)}V${f2(y + h - k)}A${f2(k)} ${f2(k)} 0 0 1 ${f2(x + w - k)} ${f2(y + h)}H${f2(x + k)}A${f2(k)} ${f2(k)} 0 0 1 ${f2(x)} ${f2(y + h - k)}V${f2(y + k)}A${f2(k)} ${f2(k)} 0 0 1 ${f2(x + k)} ${f2(y)}z`;
};

/** Paths that share a style are merged into one element (smaller output, and no double-blended overlaps). */
type Buckets = Map<string, string[]>;
const put = (m: Buckets, attrs: string, d: string) => { const list = m.get(attrs); if (list) list.push(d); else m.set(attrs, [d]); };
const flush = (c: Ctx, m: Buckets) => { for (const [attrs, ds] of m) { if (c.len > MAX_LEN) return; add(c, `<path d="${ds.join('')}"${attrs}/>`); } };
const strokeAttrs = (w: number, o: number, extra = '') => ` stroke-width="${f2(quant(w, 0.05))}"${o < 0.995 ? ` opacity="${f2(quant(o, 0.05))}"` : ''}${extra}`;
const fillAttrs = (o: number) => (o < 0.995 ? ` opacity="${f2(quant(o, 0.05))}"` : '');

/** Sample positions on a grid whose step divides the tile exactly, so a polyline has a vertex at 0 and at 64 (no seam). */
function alignedPositions(lo: number, hi: number, maxStep: number): number[] {
  const step = TILE / Math.ceil(TILE / maxStep), out: number[] = [];
  for (let x = Math.floor(lo / step) * step; x <= hi + step; x += step) out.push(x);
  return out;
}

/* ───────────── lines (stripes, hatching, grids) ───────────── */

function normalizeDir(dir: LineSet['dir']): 'h' | 'v' | Pair {
  if (dir === 'h' || dir === 'v') return dir;
  let [a, b] = dir;
  if (a < 0 || (a === 0 && b < 0)) { a = -a; b = -b; }
  if (b === 0) return 'h';
  if (a === 0) return 'v';
  return [a, b];
}

function renderGlitch(L: LinesLayer, c: Ctx): void {
  const P = c.P, R = c.R, S = L.sets[0];
  const rows = clamp(Math.round(TILE / (S.pitch * (P.spacingY / 100))), 2, 20), w = Math.max(0.2, S.w * (P.strokeWidth / 100));
  const buckets: Buckets = new Map();
  for (let i = 0; i < rows; i++) {
    const y = ((i + 0.5) * TILE) / rows, x1 = 6 + R(i, 0, CH.x) * 30, x2 = x1 + 8 + R(i, 0, CH.y) * 22, dy = (R(i, 0, CH.jy) - 0.5) * 9;
    put(buckets, strokeAttrs(w, (S.o ?? 1) * (0.6 + 0.4 * R(i, 0, CH.opBase))), `M-2 ${f2(y)}H${f2(x1)}V${f2(y + dy)}H${f2(x2)}V${f2(y)}H66`);
  }
  open(c, `<g fill="none" stroke="${c.cur}">`);
  flush(c, buckets);
  for (let k = 0; k < 2; k++) add(c, `<path d="M${f2(8 + R(k, 1, CH.x) * 48)} -2V66" stroke="${k ? '#20e8ff' : '#ff2858'}" stroke-width="${f2(w * 0.6)}" opacity="0.55"/>`);
  open(c, '</g>');
}

function renderLines(L: LinesLayer, c: Ctx): void {
  const P = c.P, R = c.R, sx = P.spacingX / 100, sy = P.spacingY / 100;
  if (L.glitch) { renderGlitch(L, c); return; }
  const sets = L.sets.map(s => ({ ...s }));
  if (L.cross && sets.length >= 2 && Math.abs(P.crossingAngle - 90) > 0.5 && Array.isArray(sets[0].dir)) {
    const [a, b] = sets[0].dir;
    sets[1].dir = tileableSlope((Math.atan2(b, a) * 180) / Math.PI + P.crossingAngle);
  }
  open(c, `<g fill="none" stroke="${c.cur}" stroke-linejoin="round">`);
  const rowsAt: number[] = [], colsAt: number[] = [];
  sets.forEach((S, si) => {
    const secondary = si > 0 ? P.secondaryStrength / 100 : 1;
    if (secondary <= 0.001) return;
    const dir = normalizeDir(S.dir), buckets: Buckets = new Map(), colour = S.color ? ` stroke="${S.color}"` : '';
    const style = (nw: number): { w: number; o: number } | null => {
      if (P.coverage < 100 && R(nw, si, CH.cover) * 100 >= P.coverage) return null;
      const w = Math.max(0.15, S.w * (P.strokeWidth / 100) * (1 - vary(S.wv ?? 0, P.sizeVariation / 100) * R(nw, si, CH.width)));
      const o = (S.o ?? 1) * secondary * mix(S.ov, R(nw, si, CH.opBase)) * (1 - (P.opacityVariation / 100) * R(nw, si, CH.opacity));
      return o < 0.02 ? null : { w, o };
    };
    const custom: Pair | undefined = P.dashLength > 0 ? [P.dashLength, P.dashGap > 0 ? P.dashGap : P.dashLength] : S.dash;
    const jit = P.positionJitter / 100;
    let size = 0;

    if (dir === 'h' || dir === 'v') {
      const horizontal = dir === 'h';
      let count = clamp(Math.round(TILE / (S.pitch * (horizontal ? sy : sx))), 1, 64);
      if (S.major) count = Math.max(S.major.every, Math.round(count / S.major.every) * S.major.every);
      const pp = TILE / count, phase = (S.off ?? 0.5) + P.phase / 100;
      let dashAttr = '', period = 0, dashLen = 0;
      if (custom) {
        const total = Math.max(0.5, custom[0] + custom[1]), cycles = Math.max(1, Math.round(TILE / total)), k = TILE / cycles / total;
        period = TILE / cycles; dashLen = custom[0] * k;
        // a dash pattern follows the path length, which distortion changes — so with distortion the dashes are cut explicitly instead
        if (!c.warp) dashAttr = ` stroke-dasharray="${f2(custom[0] * k)} ${f2(custom[1] * k)}"`;
      }
      const wobble = P.angleVariation > 0 ? Math.min(9, Math.tan((P.angleVariation * Math.PI) / 180) * 8) : 0;
      const cellsPerLine = 8, cut = P.lineBreakup / 100, bent = wobble > 0 || !!c.warp;
      const wobbleReach = P.angleVariation > 0 ? Math.min(9, Math.tan((P.angleVariation * Math.PI) / 180) * 8) : 0;
      const reachOut = (c.warp ? WR : 0) + wobbleReach, nx = 1 + Math.ceil(reachOut / pp);
      for (let n = -nx; n <= count + nx - 1; n++) {
        if (c.len + size > MAX_LEN) break;
        const nw = ((n % count) + count) % count, st = style(nw);
        if (!st) continue;
        let w = st.w;
        if (S.major && nw % S.major.every !== 0) w *= S.major.minor;
        const pos = (n + phase) * pp + (jit > 0 ? (R(nw, si, CH.jx) - 0.5) * jit * pp * 0.9 : 0);
        if (pos + w / 2 < -c.pad - reachOut || pos - w / 2 > TILE + c.pad + reachOut) continue;
        const span = S.span, ext = span ? 0 : c.pad + 1 + (c.warp ? WR : 0);
        const start = span ? span[0] : -(period ? Math.ceil(ext / period) * period : ext), end = span ? span[1] : TILE + ext;
        const runs: Pair[] = [];
        if (cut > 0 && !span) {
          const cw = TILE / cellsPerLine;
          let runStart: number | null = null;
          for (let m = Math.floor(start / cw); m < Math.ceil(end / cw); m++) {
            const gone = R(nw * 17 + (((m % cellsPerLine) + cellsPerLine) % cellsPerLine), si, CH.cut) < cut;
            if (!gone && runStart === null) runStart = Math.max(start, m * cw);
            if (gone && runStart !== null) { runs.push([runStart, m * cw]); runStart = null; }
          }
          if (runStart !== null) runs.push([runStart, end]);
        } else runs.push([start, end]);
        const attrs = strokeAttrs(w, st.o, dashAttr + colour), phi = R(nw, si, CH.wobble) * Math.PI * 2;
        const pieces: Pair[] = [];
        if (c.warp && period) { for (const [r0, r1] of runs) for (let m = Math.floor(r0 / period); m * period < r1; m++) { const da = Math.max(r0, m * period), db = Math.min(r1, m * period + dashLen); if (db - da > 0.2) pieces.push([da, db]); } }
        for (const [t0, t1] of c.warp && period ? pieces : runs) {
          if (t1 - t0 < 0.2) continue;
          let d: string;
          if (!bent) d = horizontal ? `M${f2(t0)} ${f2(pos)}H${f2(t1)}` : `M${f2(pos)} ${f2(t0)}V${f2(t1)}`;
          else {
            const pts: Pair[] = [], ts = [t0, ...alignedPositions(t0, t1, 3).filter(t => t > t0 + 0.01 && t < t1 - 0.01), t1];
            for (const t of ts) { const off = wobble * Math.sin((t / TILE) * Math.PI * 2 + phi); pts.push(horizontal ? [t, pos + off] : [pos + off, t]); }
            d = pathOf(warpPts(c, pts));
          }
          put(buckets, attrs, d); size += d.length;
        }
        if (n >= 0 && n < count) (horizontal ? rowsAt : colsAt).push(pos);
      }
    } else {
      const [a, b] = dir, len = Math.hypot(a, b), g = Math.sqrt(sx * sy);
      // a wide butt-capped diagonal stroke needs room beyond the tile, or its end caps would cut into the visible area
      const reach = c.pad + 2 + S.w * (P.strokeWidth / 100) * 1.2 + (c.warp ? WR : 0), lo = -reach, hi = TILE + reach;
      let K = clamp(Math.round(TILE / (S.pitch * g * len)), 1, 64);
      while ((a + Math.abs(b)) * K > 96 && K > 1) K--;
      const qk = TILE / K, offset = (S.off ?? 0.5) + P.phase / 100;
      const corners = [b * lo - a * lo, b * hi - a * lo, b * lo - a * hi, b * hi - a * hi];
      const kMin = Math.ceil(Math.min(...corners) / qk - offset), kMax = Math.floor(Math.max(...corners) / qk - offset);
      let dashAttr = '', period = 0, dashLen = 0;
      if (custom) {
        const total = Math.max(0.5, custom[0] + custom[1]), J = Math.max(1, Math.round((TILE * len) / (a * total)));
        period = (TILE * len) / (a * J); const k = period / total; dashLen = custom[0] * k;
        if (!c.warp) dashAttr = ` stroke-dasharray="${f2(custom[0] * k)} ${f2(custom[1] * k)}"`;
      }
      for (let k = kMin; k <= kMax; k++) {
        if (c.len + size > MAX_LEN) break;
        const kw = ((k % K) + K) % K, st = style(kw);
        if (!st) continue;
        const cc = (k + offset) * qk + (jit > 0 ? (R(kw, si, CH.jx) - 0.5) * jit * qk * 0.9 : 0), y0 = -cc / a;
        let t0 = Math.max((lo * len) / a, -Infinity), t1 = Math.min((hi * len) / a, Infinity);
        if (b > 0) { t0 = Math.max(t0, ((lo - y0) * len) / b); t1 = Math.min(t1, ((hi - y0) * len) / b); }
        else { t0 = Math.max(t0, ((hi - y0) * len) / b); t1 = Math.min(t1, ((lo - y0) * len) / b); }
        if (t1 - t0 < 0.3) continue;
        if (period) t0 = Math.floor(t0 / period) * period;
        const at = (t: number): Pair => [(t * a) / len, y0 + (t * b) / len];
        // with distortion, vertices sit on the tile-aligned x grid so the line is identical in every repeat
        const warped = (ta: number, tb: number) => {
          const xa = (ta * a) / len, xb = (tb * a) / len, pts: Pair[] = [at(ta)];
          for (const x of alignedPositions(xa, xb, 3)) if (x > xa + 0.01 && x < xb - 0.01) pts.push([x, y0 + (x * b) / a]);
          pts.push(at(tb));
          return pathOf(warpPts(c, pts));
        };
        const attrs = strokeAttrs(st.w, st.o, dashAttr + colour);
        if (!c.warp) { const p0 = at(t0), p1 = at(t1), d = `M${f2(p0[0])} ${f2(p0[1])}L${f2(p1[0])} ${f2(p1[1])}`; put(buckets, attrs, d); size += d.length; }
        else if (period) {
          for (let m = Math.floor(t0 / period); m * period < t1; m++) {
            const da = Math.max(t0, m * period), db = Math.min(t1, m * period + dashLen);
            if (db - da > 0.2) { const d = warped(da, db); put(buckets, attrs, d); size += d.length; }
          }
        } else { const d = warped(t0, t1); put(buckets, attrs, d); size += d.length; }
      }
    }
    flush(c, buckets);
  });
  if (L.nodes && rowsAt.length && colsAt.length) {
    open(c, `<g fill="${c.cur}" stroke="none">`);
    const r = Math.max(0.3, L.nodes * (P.strokeWidth / 100));
    for (const y of rowsAt) for (const x of colsAt) if (room(c)) add(c, `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}"/>`);
    open(c, '</g>');
  }
  open(c, '</g>');
}

/* ───────────── waves ───────────── */

function renderWaves(L: WavesLayer, c: Ctx): void {
  const P = c.P, R = c.R, sx = P.spacingX / 100, sy = P.spacingY / 100;
  const rows = clamp(Math.round(TILE / (L.pitch * sy)), 1, 40), pp = TILE / rows;
  const cycles = clamp(Math.round(TILE / (L.lambda * sx)), 1, 16), cycles2 = Math.max(1, Math.round(cycles * (L.l2 ?? 1.9)));
  const tri = L.form === 'tri', jit = P.positionJitter / 100, buckets: Buckets = new Map();
  const reachOut = c.warp ? WR : 0, x0 = -(c.pad + 2 + reachOut), x1 = TILE + c.pad + 2 + reachOut, nx = 1 + (c.warp ? Math.ceil(WR / pp) : 0);
  let size = 0;
  open(c, `<g fill="none" stroke="${c.cur}" stroke-linejoin="round" stroke-linecap="round">`);
  for (let n = -nx; n <= rows + nx - 1; n++) {
    if (c.len + size > MAX_LEN) break;
    const nw = ((n % rows) + rows) % rows;
    if (P.coverage < 100 && R(nw, 0, CH.cover) * 100 >= P.coverage) continue;
    const y0 = (n + 0.5) * pp + (R(nw, 0, CH.jy) - 0.5) * jit * pp * 0.9;
    const amp = L.amp * (P.motifSize / 100) * (1 - (P.sizeVariation / 100) * R(nw, 0, CH.size));
    const phi = ((L.phaseStep ?? 0) * nw + (L.phaseRand ?? 0) * R(nw, 0, CH.phase) + P.phase / 100) * Math.PI * 2;
    const w = Math.max(0.15, L.w * (P.strokeWidth / 100));
    const o = (L.o ?? 1) * mix(L.ov, R(nw, 0, CH.opBase)) * (1 - (P.opacityVariation / 100) * R(nw, 0, CH.opacity)) * fm(c, 32, y0, 'opacity');
    const swing = amp * (1 + (L.h2 ?? 0)) + 0.5;
    if (o < 0.02 || y0 + swing < -c.pad - reachOut || y0 - swing > TILE + c.pad + reachOut) continue;
    const yAt = (x: number) => {
      const t = (x / TILE) * cycles * Math.PI * 2 + phi;
      let v = tri ? (2 / Math.PI) * Math.asin(Math.sin(t)) : Math.sin(t);
      if (L.h2) v += L.h2 * Math.sin((x / TILE) * cycles2 * Math.PI * 2 + phi * 1.7 + 1);
      return y0 + amp * v;
    };
    let pts: Pair[] = [];
    if (tri && !L.h2) {
      const lambda = TILE / cycles, shift = (phi * lambda) / (Math.PI * 2);
      for (let k = Math.floor((x0 + shift) / (lambda / 2)) - 1; k <= Math.ceil((x1 + shift) / (lambda / 2)) + 1; k++) pts.push([(k * lambda) / 2 + (lambda / 4) - shift, y0 + amp * (k % 2 === 0 ? 1 : -1)]);
      pts = pts.map(([x, y]) => [x, y] as Pair);
    } else {
      for (const x of alignedPositions(x0, x1, clamp(TILE / (cycles * 14), 0.8, 4))) pts.push([x, yAt(x)]);
    }
    if (c.warp) pts = warpPts(c, densify(pts, 3));
    const d = pathOf(pts);
    put(buckets, strokeAttrs(w, o), d); size += d.length;
  }
  flush(c, buckets);
  open(c, '</g>');
}

/* ───────────── rings (ripples, contours, rosettes) ───────────── */

function renderRings(L: RingsLayer, c: Ctx): void {
  const P = c.P, R = c.R, sx = P.spacingX / 100, ar = clamp(P.aspectRatio / 100, 0.25, 4), buckets: Buckets = new Map();
  const centers = L.centers ?? [[32, 32] as Pair];
  let size = 0;
  open(c, `<g fill="none" stroke="${c.cur}" stroke-linejoin="round">`);
  centers.forEach(([cx0, cy0], ci) => {
    let lastR = 0;
    for (let j = 0; j < L.n; j++) {
      if (c.len + size > MAX_LEN) return;
      const base = (L.r0 + j * L.dr * sx) * (P.motifSize / 100), rx = base * Math.sqrt(ar), ry = (base * (L.ratio ?? 1)) / Math.sqrt(ar);
      lastR = Math.max(lastR, rx);
      const eps = (L.wobble ?? 0) + (P.positionJitter / 100) * 0.16;
      const k1 = 2 + Math.floor(R(j, ci, CH.wobble) * 3), k2 = k1 + 2, p1 = R(j, ci, CH.phase) * 6.283, p2 = R(j, ci, CH.angBase) * 6.283;
      const N = clamp(Math.round(Math.max(rx, ry) * 2.4), 24, 110);
      let pts: Pair[] = [];
      for (let t = 0; t < N; t++) { const th = (t / N) * Math.PI * 2, rr = 1 + eps * (0.6 * Math.sin(k1 * th + p1) + 0.4 * Math.sin(k2 * th + p2)); pts.push([cx0 + Math.cos(th) * rx * rr, cy0 + Math.sin(th) * ry * rr]); }
      if (c.warp) pts = warpPts(c, densify(pts, 4, true));
      const w = Math.max(0.15, L.w * (P.strokeWidth / 100));
      const o = (L.o ?? 1) * mix(L.ov, R(j, ci, CH.opBase)) * (1 - (P.opacityVariation / 100) * R(j, ci, CH.opacity)) * fm(c, cx0 + rx, cy0, 'opacity');
      if (o < 0.02) continue;
      const [bx0, by0, bx1, by1] = bboxOf(pts);
      for (const [ox, oy] of copies(c, bx0 - w, by0 - w, bx1 + w, by1 + w)) { const d = pathOf(pts, true, ox, oy); put(buckets, strokeAttrs(w, o), d); size += d.length; }
    }
    if (L.spokes) {
      const r0 = (L.r0 + 0.5) * (P.motifSize / 100), r1 = lastR, w = Math.max(0.15, L.w * 0.7 * (P.strokeWidth / 100));
      for (let s = 0; s < L.spokes; s++) {
        const a = (s / L.spokes) * Math.PI * 2;
        let pts: Pair[] = [[cx0 + Math.cos(a) * r0, cy0 + Math.sin(a) * r0], [cx0 + Math.cos(a) * r1, cy0 + Math.sin(a) * r1]];
        if (c.warp) pts = warpPts(c, densify(pts, 4));
        const [bx0, by0, bx1, by1] = bboxOf(pts);
        for (const [ox, oy] of copies(c, bx0 - w, by0 - w, bx1 + w, by1 + w)) put(buckets, strokeAttrs(w, (L.o ?? 1) * 0.8), pathOf(pts, false, ox, oy));
      }
    }
  });
  flush(c, buckets);
  open(c, '</g>');
}

/* ───────────── cells (seamless Voronoi) ───────────── */

interface Site { x: number; y: number; i: number }

function clipHalfPlane(poly: Pair[], s: Site, o: Site): Pair[] {
  const nx = s.x - o.x, ny = s.y - o.y, mx = (s.x + o.x) / 2, my = (s.y + o.y) / 2, out: Pair[] = [];
  const side = (p: Pair) => (p[0] - mx) * nx + (p[1] - my) * ny;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if (sa >= 0 !== sb >= 0) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

/** Voronoi cell of `s` among all sites (sites include the 3×3 neighbouring copies → the diagram tiles exactly). */
function voronoiCell(s: Site, all: Site[]): Pair[] {
  const B = TILE;
  let poly: Pair[] = [[s.x - B, s.y - B], [s.x + B, s.y - B], [s.x + B, s.y + B], [s.x - B, s.y + B]];
  const near = all.filter(o => o !== s).map(o => ({ o, d: (o.x - s.x) ** 2 + (o.y - s.y) ** 2 })).sort((a, b) => a.d - b.d);
  let limit = Infinity;
  for (const { o, d } of near) {
    if (d > limit) break;
    poly = clipHalfPlane(poly, s, o);
    if (poly.length < 3) return [];
    limit = 4 * Math.max(...poly.map(p => (p[0] - s.x) ** 2 + (p[1] - s.y) ** 2));
  }
  return poly;
}

function renderCells(L: CellsLayer, c: Ctx): void {
  const P = c.P, R = c.R, sx = P.spacingX / 100, sy = P.spacingY / 100;
  const dist = effDist(c, L.dist, L.allow ?? ['grid', 'staggered', 'random', 'poisson']), lattice = dist === 'grid' || dist === 'staggered';
  const base = Math.sqrt(L.count), cols = clamp(Math.round(base / sx), 1, 9);
  let rows = clamp(Math.round(base / sy), 1, 9);
  if (dist === 'staggered') rows = Math.max(2, Math.round(rows / 2) * 2);
  const n = clamp(Math.round(L.count / (sx * sy)), 3, 48);
  const pts = distribute(dist, { seed: c.ls, cols, rows, count: n, phase: P.phase / 100, cx: 32, cy: 32, burst: 1, minDist: 0.85 * Math.sqrt((TILE * TILE) / n), flow: c.flow, step: 6 });
  const irr = lattice ? clamp(vary(L.irregular ?? 0.6, P.positionJitter / 100), 0, 1) : 0, px = TILE / cols, py = TILE / rows;
  const sites: Site[] = pts.map(p => ({ x: wrap(p.x + (lattice ? (R(p.i, 0, CH.jx) - 0.5) * irr * px * 0.95 : 0)), y: wrap(p.y + (lattice ? (R(p.i, 0, CH.jy) - 0.5) * irr * py * 0.95 : 0)), i: p.i }));
  const all: Site[] = [];
  for (const ox of [-TILE, 0, TILE]) for (const oy of [-TILE, 0, TILE]) for (const s of sites) all.push(ox || oy ? { x: s.x + ox, y: s.y + oy, i: s.i } : s);
  const w = Math.max(0.15, L.w * (P.strokeWidth / 100)), buckets: Buckets = new Map(), fills: Buckets = new Map();
  let size = 0;
  for (const s of sites) {
    if (c.len + size > MAX_LEN) break;
    let poly = voronoiCell(s, all);
    if (poly.length < 3) continue;
    if (c.warp) poly = warpPts(c, densify(poly, 4, true));
    const o = (L.o ?? 1) * mix(L.ov, R(s.i, 0, CH.opBase)) * (1 - (P.opacityVariation / 100) * R(s.i, 0, CH.opacity)) * fm(c, s.x, s.y, 'opacity');
    const [bx0, by0, bx1, by1] = bboxOf(poly);
    for (const [ox, oy] of copies(c, bx0 - w, by0 - w, bx1 + w, by1 + w)) {
      const d = pathOf(poly, true, ox, oy);
      put(buckets, strokeAttrs(w, o), d); size += d.length;
      if (L.fill) put(fills, fillAttrs(L.fill * (0.4 + 0.6 * R(s.i, 1, CH.opBase)) * o), d);
    }
  }
  if (L.fill) { open(c, `<g fill="${c.cur}" stroke="none">`); flush(c, fills); open(c, '</g>'); }
  open(c, `<g fill="none" stroke="${c.cur}" stroke-linejoin="round">`);
  flush(c, buckets);
  open(c, '</g>');
}

/* ───────────── tilings (checker, hex, cubes, triangles, scales …) ───────────── */

function renderTiling(L: TilingLayer, c: Ctx): void {
  const P = c.P, R = c.R, sx = P.spacingX / 100, sy = P.spacingY / 100, ratio = L.ratio ?? 1;
  const w = Math.max(0.15, L.w * (P.strokeWidth / 100)), even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  let cols = clamp(Math.round(TILE / (L.pitch * sx)), 1, 24), rows = clamp(Math.round(TILE / (L.pitch * ratio * sy)), 1, 24);
  if (L.form === 'scales') { cols = clamp(cols, 1, 12); rows = cols * 2; }
  if (L.form === 'checker') cols = even(cols);
  if (['checker', 'hex', 'cubes', 'tri'].includes(L.form)) rows = even(rows);
  const pw = TILE / cols, ph = TILE / rows, buckets: Buckets = new Map(), cover = (L.cover ?? 1) * (P.coverage / 100);
  const lo = -c.pad, hi = TILE + c.pad, base = L.o ?? 1;
  const phx = (P.phase / 100) * pw, phy = (P.phase / 100) * ph, jit = P.positionJitter / 100;
  let size = 0;
  const wr = c.warp ? WR : 0, mx = (wr ? Math.ceil(WR / pw) + 1 : 1) + 1, my = (wr ? Math.ceil(WR / ph) + 1 : 1) + 1;
  const seen = (pts: Pair[], pad = 0) => { const [x0, y0, x1, y1] = bboxOf(pts); return x1 + pad + wr > lo && x0 - pad - wr < hi && y1 + pad + wr > lo && y0 - pad - wr < hi; };
  const cellOpacity = (iw: number, jw: number, x: number, y: number) => base * mix(L.ov, R(iw, jw, CH.opBase)) * (1 - (P.opacityVariation / 100) * R(iw, jw, CH.opacity)) * fm(c, wrap(x), wrap(y), 'opacity');
  const push = (attrs: string, pts: Pair[], closed: boolean) => { const d = pathOf(c.warp ? warpPts(c, densify(pts, 4, closed)) : pts, closed); put(buckets, attrs, d); size += d.length; };
  const filled = L.form === 'checker';

  for (let j = -my; j <= rows + my - 1; j++) for (let i = -mx; i <= cols + mx - 1; i++) {
    if (c.len + size > MAX_LEN) break;
    const iw = ((i % cols) + cols) % cols, jw = ((j % rows) + rows) % rows, odd = ((j % 2) + 2) % 2 === 1;
    if (cover < 1 && R(iw, jw, CH.cover) >= cover) continue;
    const jx = jit > 0 ? (R(iw, jw, CH.jx) - 0.5) * jit * pw * 0.8 : 0, jy = jit > 0 ? (R(iw, jw, CH.jy) - 0.5) * jit * ph * 0.8 : 0;
    switch (L.form) {
      case 'checker': {
        if ((iw + jw) % 2) break;
        const k = 1 - (P.sizeVariation / 100) * R(iw, jw, CH.size) * 0.8, ww = pw * k, hh = ph * k;
        const cx = (i + 0.5) * pw + phx + jx, cy = (j + 0.5) * ph + phy + jy;
        const r = (P.cornerRadius / 100) * Math.min(ww, hh);
        if (!seen([[cx - ww / 2, cy - hh / 2], [cx + ww / 2, cy + hh / 2]])) break;
        const o = cellOpacity(iw, jw, cx, cy);
        if (c.warp) push(fillAttrs(o), [[cx - ww / 2, cy - hh / 2], [cx + ww / 2, cy - hh / 2], [cx + ww / 2, cy + hh / 2], [cx - ww / 2, cy + hh / 2]], true);
        else { const d = roundedRect(cx - ww / 2, cy - hh / 2, ww, hh, r); put(buckets, fillAttrs(o), d); size += d.length; }
        break;
      }
      case 'hex': case 'cubes': {
        const cx = (i + 0.5 + (odd ? 0.5 : 0)) * pw + phx + jx, cy = (j + 0.5) * ph + phy + jy, rv = ph / 1.5, hx = pw / 2;
        const v: Pair[] = [[0, -rv], [hx, -rv / 2], [hx, rv / 2], [0, rv], [-hx, rv / 2], [-hx, -rv / 2]].map(([x, y]) => [cx + x, cy + y] as Pair);
        if (!seen(v, w)) break;
        const attrs = strokeAttrs(w, cellOpacity(iw, jw, cx, cy));
        push(attrs, v, true);
        if (L.form === 'cubes') { push(attrs, [[cx, cy], v[5]], false); push(attrs, [[cx, cy], v[1]], false); push(attrs, [[cx, cy], v[3]], false); }
        break;
      }
      case 'tri': {
        const x = (i + (odd ? 0.5 : 0) + 0.5) * pw + phx + jx, y = j * ph + phy + jy;
        if (!seen([[x - pw, y], [x + pw, y + ph]], w)) break;
        const attrs = strokeAttrs(w, cellOpacity(iw, jw, x, y));
        push(attrs, [[x, y], [x + pw, y]], false); push(attrs, [[x, y], [x - pw / 2, y + ph]], false); push(attrs, [[x, y], [x + pw / 2, y + ph]], false);
        break;
      }
      case 'diamond': {
        const x = i * pw + phx + jx, y = j * ph + phy + jy;
        if (!seen([[x, y], [x + pw, y + ph]], w)) break;
        const attrs = strokeAttrs(w, cellOpacity(iw, jw, x, y));
        push(attrs, [[x + pw / 2, y], [x + pw, y + ph / 2], [x + pw / 2, y + ph], [x, y + ph / 2]], true);
        if (L.cross) { push(attrs, [[x + pw / 2, y], [x + pw / 2, y + ph]], false); push(attrs, [[x, y + ph / 2], [x + pw, y + ph / 2]], false); }
        break;
      }
      case 'scales': {
        const r = pw / 2, x = (i + (odd ? 0.5 : 0) + 0.5) * pw + phx + jx, y = j * r + phy + jy;
        if (!seen([[x - r, y], [x + r, y + r]], w)) break;
        const d = `M${f2(x - r)} ${f2(y)}A${f2(r)} ${f2(r)} 0 0 0 ${f2(x + r)} ${f2(y)}`;
        if (c.warp) { const pts: Pair[] = []; for (let t = 0; t <= 12; t++) { const a = Math.PI - (t / 12) * Math.PI; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); } push(strokeAttrs(w, cellOpacity(iw, jw, x, y)), pts, false); }
        else { put(buckets, strokeAttrs(w, cellOpacity(iw, jw, x, y)), d); size += d.length; }
        break;
      }
      case 'knit': {
        const x = i * pw + phx + jx, y = j * ph + phy + jy;
        if (!seen([[x, y], [x + pw, y + ph]], w)) break;
        push(strokeAttrs(w, cellOpacity(iw, jw, x, y)), [[x + pw * 0.12, y + ph * 0.1], [x + pw * 0.5, y + ph * 0.9], [x + pw * 0.88, y + ph * 0.1]], false);
        break;
      }
      case 'frames': {
        const x = i * pw + phx + jx, y = j * ph + phy + jy, attrs = strokeAttrs(w, cellOpacity(iw, jw, x, y));
        if (!seen([[x, y], [x + pw, y + ph]], w)) break;
        for (let f = 0; f < (L.cross ? 3 : 1); f++) { const inset = f * 0.17 * Math.min(pw, ph) + w * 0.5; push(attrs, [[x + inset, y + inset], [x + pw - inset, y + inset], [x + pw - inset, y + ph - inset], [x + inset, y + ph - inset]], true); }
        break;
      }
      case 'rays': break;
    }
  }
  if (L.form === 'rays') {
    const attrs = strokeAttrs(w, base);
    for (let k = 0; k < cols; k++) { const x = (k + 0.5) * pw; push(attrs, [[32, 32], [x, 0]], false); push(attrs, [[32, 32], [x, TILE]], false); }
    for (let k = 0; k < rows; k++) { const y = (k + 0.5) * ph; push(attrs, [[32, 32], [0, y]], false); push(attrs, [[32, 32], [TILE, y]], false); }
  }
  open(c, filled ? `<g fill="${c.cur}" stroke="none">` : `<g fill="none" stroke="${c.cur}" stroke-linejoin="round" stroke-linecap="round">`);
  flush(c, buckets);
  open(c, '</g>');
}

/* ───────────── weave (plain, twill, basket) ───────────── */

function renderWeave(L: WeaveLayer, c: Ctx): void {
  const P = c.P, R = c.R, sx = P.spacingX / 100, sy = P.spacingY / 100;
  const interval = P.weaveInterval > 1 ? clamp(Math.round(P.weaveInterval), 1, 4) : L.interval ?? 1, period = interval * 2;
  const snap = (n: number) => clamp(Math.max(period, Math.round(n / period) * period), period, Math.max(period, Math.floor(24 / period) * period));
  const cols = snap(TILE / (L.pitch * sx)), rows = snap(TILE / (L.pitch * sy)), pw = TILE / cols, ph = TILE / rows;
  const tw = clamp(L.w * (P.strokeWidth / 100), 0.3, Math.min(pw, ph) * 0.95), contrast = P.overUnderContrast / 100, shift = L.shift ?? 1;
  const order = ['hUnder', 'vUnder', 'hOver', 'vOver'] as const;
  const buckets: Record<(typeof order)[number], Buckets> = { hUnder: new Map(), vUnder: new Map(), hOver: new Map(), vOver: new Map() };
  const wob = (P.angleVariation / 90) * 0.28, lo = -c.pad, hi = TILE + c.pad;
  let size = 0;
  const wr = c.warp ? WR : 0, mx = wr ? Math.ceil(WR / pw) + 1 : 1, my = wr ? Math.ceil(WR / ph) + 1 : 1;
  for (let j = -my; j <= rows + my - 1; j++) for (let i = -mx; i <= cols + mx - 1; i++) {
    if (c.len + size > MAX_LEN) break;
    const iw = ((i % cols) + cols) % cols, jw = ((j % rows) + rows) % rows;
    const over = L.basket ? (Math.floor(iw / interval) + Math.floor(jw / interval)) % 2 === 0 : (((iw + jw * shift) % period) + period) % period < interval;
    const x = i * pw, y = j * ph;
    if (x + pw < lo - wr || x > hi + wr || y + ph < lo - wr || y > hi + wr) continue;
    for (const horizontal of [true, false]) {
      const top = horizontal ? over : !over, key = `${horizontal ? 'h' : 'v'}${top ? 'Over' : 'Under'}` as (typeof order)[number];
      const stream = horizontal ? 0 : 1;
      if (P.coverage < 100 && R(iw, jw * 2 + stream, CH.cover) * 100 >= P.coverage) continue;
      const th = Math.max(0.2, tw * (1 - (P.sizeVariation / 100) * R(iw, jw * 2 + stream, CH.size)));
      let o = (L.o ?? 1) * mix(L.ov, R(iw, jw * 2 + stream, CH.opBase)) * (1 - (P.opacityVariation / 100) * R(iw, jw * 2 + stream, CH.opacity)) * fm(c, wrap(x + pw / 2), wrap(y + ph / 2), 'opacity');
      if (!top) o *= 1 - contrast * 0.8;
      if (o < 0.02) continue;
      const off = wob > 0 ? (R(iw, jw * 2 + stream, CH.wobble) - 0.5) * 2 * wob * (horizontal ? ph : pw) : 0;
      let d: string;
      if (!c.warp) d = horizontal ? `M${f2(x)} ${f2(y + ph / 2 + off)}h${f2(pw)}` : `M${f2(x + pw / 2 + off)} ${f2(y)}v${f2(ph)}`;
      else {
        const pts: Pair[] = horizontal ? [[x, y + ph / 2 + off], [x + pw / 2, y + ph / 2 + off], [x + pw, y + ph / 2 + off]] : [[x + pw / 2 + off, y], [x + pw / 2 + off, y + ph / 2], [x + pw / 2 + off, y + ph]];
        d = pathOf(warpPts(c, pts));
      }
      put(buckets[key], strokeAttrs(quant(th, 0.1), o), d); size += d.length;
    }
  }
  open(c, `<g fill="none" stroke="${c.cur}" stroke-linecap="butt">`);
  for (const key of order) flush(c, buckets[key]);
  open(c, '</g>');
}

/* ───────────── dispatcher + capability description ───────────── */

export function renderLayers(c: Ctx, layers: Layer[]): void {
  layers.forEach((L, idx) => {
    c.ls = c.seed + idx * 977; c.R = makeRand(c.ls); c.cur = (L as { color?: string }).color ?? c.color;
    switch (L.k) {
      case 'noise': renderNoise(L, c); break;
      case 'scatter': renderScatter(L, c); break;
      case 'strokes': renderStrokes(L, c); break;
      case 'lines': renderLines(L, c); break;
      case 'waves': renderWaves(L, c); break;
      case 'rings': renderRings(L, c); break;
      case 'cells': renderCells(L, c); break;
      case 'tiling': renderTiling(L, c); break;
      case 'weave': renderWeave(L, c); break;
    }
  });
  if (c.P.detailAmount > 0 && !layers.some(l => l.k === 'noise')) renderDetail(c, layers.some(l => l.k === 'lines' || l.k === 'waves' || l.k === 'weave' || l.k === 'strokes') ? 'hairs' : 'specks');
}

export interface LayerInfo {
  kind: TextureKind;
  caps: TextureCapability[];
  /** distributions the preset can use (empty = not distributable) */
  dists: Dist[];
  defaultDist?: Dist;
  defaultShape?: ShapeId;
  falloffTargets: FalloffTarget[];
}

export function describeLayers(layers: Layer[]): LayerInfo {
  const caps = new Set<TextureCapability>(), targets = new Set<FalloffTarget>();
  let dists: Dist[] = [], defaultDist: Dist | undefined, defaultShape: ShapeId | undefined;
  const all = (...list: TextureCapability[]) => list.forEach(x => caps.add(x));
  const tgt = (...list: FalloffTarget[]) => list.forEach(x => targets.add(x));
  for (const L of layers) {
    switch (L.k) {
      case 'noise': all('size', 'aspect', 'threshold', 'octaves', 'detail'); tgt('opacity', 'detail'); break;
      case 'scatter': all('size', 'sx', 'sy', 'aspect', 'shape', 'dist', 'sizevar', 'jitter', 'anglevar', 'opvar', 'cover', 'phase', 'warp', 'detail', 'corner', 'sym'); tgt('opacity', 'size', 'density', 'distortion', 'detail'); if (!dists.length) { dists = L.allow ?? ALL_DISTS; defaultDist = L.dist; defaultShape = L.shape; } break;
      case 'strokes': all('size', 'sx', 'sy', 'dist', 'sizevar', 'jitter', 'anglevar', 'opvar', 'cover', 'stroke', 'phase', 'warp', 'detail'); tgt('opacity', 'size', 'density', 'distortion', 'detail'); if (!dists.length) { dists = L.allow ?? ['random', 'poisson', 'flow', 'grid', 'staggered']; defaultDist = L.dist; } break;
      case 'lines': {
        all('stroke', 'dash', 'sizevar', 'jitter', 'opvar', 'cover', 'phase', 'warp', 'detail');
        tgt('opacity', 'distortion', 'detail');
        const dirs = L.sets.map(s => (L.glitch ? 'h' : normalizeDir(s.dir)));
        if (dirs.some(d => d === 'h' || Array.isArray(d))) caps.add('sy');
        if (dirs.some(d => d === 'v' || Array.isArray(d))) caps.add('sx');
        if (dirs.some(d => d === 'h' || d === 'v')) { caps.add('breakup'); caps.add('anglevar'); }
        if (L.cross) caps.add('cross');
        if (L.sets.length > 1 && !L.glitch) caps.add('secondary');
        if (L.glitch) { caps.delete('dash'); caps.delete('breakup'); caps.delete('anglevar'); caps.delete('phase'); caps.delete('warp'); caps.delete('sx'); }
        break;
      }
      case 'waves': all('size', 'sx', 'sy', 'stroke', 'sizevar', 'jitter', 'opvar', 'cover', 'phase', 'warp', 'detail'); tgt('opacity', 'distortion', 'detail'); break;
      case 'rings': all('size', 'sx', 'aspect', 'stroke', 'jitter', 'opvar', 'warp', 'detail'); tgt('opacity', 'distortion', 'detail'); break;
      case 'cells': all('sx', 'sy', 'dist', 'jitter', 'stroke', 'opvar', 'phase', 'warp', 'detail'); tgt('opacity', 'distortion', 'detail'); if (!dists.length) { dists = L.allow ?? ['grid', 'staggered', 'random', 'poisson']; defaultDist = L.dist; } break;
      case 'tiling':
        all('stroke', 'phase', 'warp', 'detail', 'opvar'); tgt('opacity', 'distortion', 'detail');
        if (L.form !== 'rays') all('sx', 'sy', 'jitter', 'cover'); else all('sx', 'sy');
        if (L.form === 'checker') { all('corner', 'sizevar', 'aspect'); caps.delete('stroke'); }
        break;
      case 'weave': all('sx', 'sy', 'stroke', 'weave', 'sizevar', 'anglevar', 'opvar', 'cover', 'phase', 'warp', 'detail'); tgt('opacity', 'distortion', 'detail'); break;
    }
  }
  if (targets.size) caps.add('falloff');
  return { kind: layers[0]?.k ?? 'noise', caps: [...caps], dists, defaultDist, defaultShape, falloffTargets: [...targets] };
}
