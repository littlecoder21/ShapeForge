import { H as ART_H, W as ART_W } from './constants';
import type { Box, Point, ShapeModel } from './geometry';

/* ═══════════════════════════ Wave maker ═══════════════════════════
 * A wave is a function Y(x) over a frame (width × height). The generator samples it and
 * emits exact Bézier nodes (Hermite → cubic), so smooth waves stay clean at low point counts.
 * Hard-edged waves (square, sawtooth, steps) emit corner nodes + vertical jumps.
 */

export type WaveType = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'arches' | 'steps' | 'noise';
export type ArchShape = 'round' | 'pointed' | 'flat' | 'gaussian';
export type Envelope = 'none' | 'fade-ends' | 'fade-center' | 'rise' | 'fall' | 'decay';

export type WaveParams = {
  type: WaveType;
  /* frame */
  width: number; height: number;
  /* shape */
  offset: number;           // baseline position, % of height from the top
  skew: number;             // −100…100  (duty / asymmetry, meaning depends on type)
  softness: number;         // 0…100     (edge softness for square / sawtooth / steps)
  steps: number;            // 2…12      (steps type)
  seed: number;             // noise type
  /* motion */
  amplitude: number;        // % of height
  frequency: number;        // cycles across the width
  phase: number;            // 0…360°
  points: number; autoPoints: boolean;
  curve: 'smooth' | 'linear';
  /* extras */
  harmonic: number; harmonicRatio: number;
  tilt: number;
  envelope: Envelope; envelopeAmount: number;
  mirror: boolean; clamp: boolean;
  /* options */
  invert: boolean; leftWall: boolean; rightWall: boolean; sideTaper: number;
  arch: boolean; archHeight: number; archWidth: number; archShape: ArchShape;
};

export const DEFAULT_WAVE: WaveParams = {
  type: 'sine', width: 1000, height: 300,
  offset: 45, skew: 0, softness: 0, steps: 4, seed: 7,
  amplitude: 16, frequency: 2, phase: 0, points: 48, autoPoints: true, curve: 'smooth',
  harmonic: 0, harmonicRatio: 3, tilt: 0, envelope: 'none', envelopeAmount: 60, mirror: false, clamp: true,
  invert: false, leftWall: true, rightWall: true, sideTaper: 12,
  arch: false, archHeight: 30, archWidth: 55, archShape: 'round',
};

/** [min, max, step] — used by the UI and by `clampWave`. */
export const WAVE_RANGES = {
  width: [100, 1000, 10], height: [40, 600, 10],
  offset: [0, 100, 1], skew: [-100, 100, 1], softness: [0, 100, 1], steps: [2, 12, 1], seed: [1, 999, 1],
  amplitude: [0, 100, 1], frequency: [0.25, 24, 0.25], phase: [0, 360, 1], points: [3, 400, 1],
  harmonic: [0, 100, 1], harmonicRatio: [2, 8, 1], tilt: [-100, 100, 1], envelopeAmount: [0, 100, 1],
  sideTaper: [0, 45, 1], archHeight: [-100, 100, 1], archWidth: [10, 100, 1],
} as const satisfies Record<string, readonly [number, number, number]>;

export const WAVE_TYPES: { id: WaveType; label: string }[] = [
  { id: 'sine', label: 'Sine' }, { id: 'triangle', label: 'Triangle' }, { id: 'square', label: 'Square' },
  { id: 'sawtooth', label: 'Sawtooth' }, { id: 'arches', label: 'Arches' }, { id: 'steps', label: 'Steps' }, { id: 'noise', label: 'Noise' },
];
export const ENVELOPES: { id: Envelope; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'fade-ends', label: 'Fade ends' }, { id: 'fade-center', label: 'Fade centre' },
  { id: 'rise', label: 'Rise' }, { id: 'fall', label: 'Fall' }, { id: 'decay', label: 'Decay' },
];
export const ARCH_SHAPES: { id: ArchShape; label: string }[] = [
  { id: 'round', label: 'Round' }, { id: 'pointed', label: 'Pointed' }, { id: 'flat', label: 'Flat' }, { id: 'gaussian', label: 'Soft' },
];

export function clampWave(p: WaveParams): WaveParams {
  const out: Record<string, unknown> = { ...p };
  for (const [key, [min, max, step]] of Object.entries(WAVE_RANGES)) {
    const raw = Number(out[key]);
    const v = Number.isFinite(raw) ? raw : (DEFAULT_WAVE as Record<string, unknown>)[key] as number;
    out[key] = Math.min(max, Math.max(min, step >= 1 ? Math.round(v) : Math.round(v / step) * step));
  }
  return out as WaveParams;
}

/* ───────────────────── base waveforms (period 1, range −1…1) ───────────────────── */

type Vert = { u: number; l: number; r: number };   // u in [0,1), left/right limits (jumps allowed)

function evalCyclic(u: number, verts: Vert[], side: number): number {
  const t = u - Math.floor(u), n = verts.length;
  for (let k = 0; k < n; k++) if (Math.abs(t - verts[k].u) < 1e-9) return side < 0 ? verts[k].l : side > 0 ? verts[k].r : (verts[k].l + verts[k].r) / 2;
  let k = -1;
  for (let i = 0; i < n; i++) if (verts[i].u <= t) k = i;
  let a: Vert, b: Vert, ua: number, ub: number;
  if (k === -1) { a = verts[n - 1]; ua = a.u - 1; b = verts[0]; ub = b.u; }
  else { a = verts[k]; ua = a.u; b = verts[(k + 1) % n]; ub = k === n - 1 ? b.u + 1 : b.u; }
  return a.r + (b.l - a.r) * ((t - ua) / (ub - ua));
}

function template(p: WaveParams): { verts: Vert[]; breaks: number[] } | null {
  const s = p.skew / 100, soft = p.softness / 100;
  if (p.type === 'triangle') {
    const a = 0.25 + s * 0.2, b = 0.75 + s * 0.2;
    return { verts: [{ u: 0, l: 0, r: 0 }, { u: a, l: 1, r: 1 }, { u: b, l: -1, r: -1 }], breaks: [a, b] };
  }
  if (p.type === 'square') {
    const d = 0.5 + s * 0.4, e = soft * Math.min(d, 1 - d) * 0.98;
    if (e < 1e-6) return { verts: [{ u: 0, l: -1, r: 1 }, { u: d, l: 1, r: -1 }], breaks: [0, d] };
    const v = [e / 2, d - e / 2, d + e / 2, 1 - e / 2];
    return { verts: [{ u: v[0], l: 1, r: 1 }, { u: v[1], l: 1, r: 1 }, { u: v[2], l: -1, r: -1 }, { u: v[3], l: -1, r: -1 }], breaks: v };
  }
  if (p.type === 'sawtooth') {
    const j = 0.5 + s * 0.45, e = soft * 0.3;
    if (e < 1e-6) return { verts: [{ u: j, l: 1, r: -1 }], breaks: [j] };
    return { verts: [{ u: j - e / 2, l: 1, r: 1 }, { u: j + e / 2, l: -1, r: -1 }], breaks: [j - e / 2, j + e / 2] };
  }
  if (p.type === 'steps') {
    const n = Math.max(2, Math.round(p.steps)), e = soft * 0.9 / n, lv = (i: number) => -1 + 2 * ((i + n) % n) / (n - 1);
    if (e < 1e-6) {
      const verts = Array.from({ length: n }, (_, i) => ({ u: i / n, l: lv(i - 1), r: lv(i) }));
      return { verts, breaks: verts.map(v => v.u) };
    }
    const verts: Vert[] = [];
    for (let i = 0; i < n; i++) { verts.push({ u: i / n + e / 2, l: lv(i), r: lv(i) }, { u: (i + 1) / n - e / 2, l: lv(i), r: lv(i) }); }
    return { verts, breaks: verts.map(v => v.u) };
  }
  return null;
}

function hash(seed: number, k: number) {
  let h = (Math.imul(k | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noiseValue(u: number, seed: number) {
  const k = Math.floor(u), t = u - k, s = t * t * (3 - 2 * t);
  const a = hash(seed, k) * 2 - 1, b = hash(seed, k + 1) * 2 - 1;
  return a + (b - a) * s;
}

function archTerm(shape: ArchShape, xn: number, widthFrac: number) {
  const t = (xn - 0.5) / (widthFrac / 2), at = Math.abs(t);
  if (at >= 1) return 0;
  if (shape === 'round') return 0.5 * (1 + Math.cos(Math.PI * t));
  if (shape === 'pointed') return 1 - at;
  if (shape === 'flat') return Math.min(1, (1 - at) / 0.3);
  return Math.exp(-((t * 2.4) ** 2));
}
function envelopeAt(kind: Envelope, a: number, x: number) {
  switch (kind) {
    case 'fade-ends': return (1 - a) + a * Math.sin(Math.PI * x);
    case 'fade-center': return (1 - a) + a * (1 - Math.sin(Math.PI * x));
    case 'rise': return (1 - a) + a * x;
    case 'fall': return (1 - a) + a * (1 - x);
    case 'decay': return (1 - a) + a * Math.exp(-4 * x);
    default: return 1;
  }
}

/** Y(xn, side) in frame units (0 = top). `side` selects the left/right limit at jumps. */
export function makeWaveFn(p: WaveParams) {
  const tpl = template(p), u0 = p.phase / 360, H = p.height;
  const amp = p.amplitude / 100, env = p.envelopeAmount / 100, hm = p.harmonic / 100;
  const base = (u: number, side: number) => {
    if (p.type === 'sine') return Math.sin(2 * Math.PI * (u + (p.skew / 100) * 0.16 * Math.sin(2 * Math.PI * u) / (2 * Math.PI)));
    if (p.type === 'arches') return 2 * Math.abs(Math.sin(Math.PI * (u + 1 / 6))) - 1;
    if (p.type === 'noise') return noiseValue(u, p.seed);
    return tpl ? evalCyclic(u, tpl.verts, side) : 0;
  };
  const fn = (xn: number, side: number) => {
    let x = xn, s = side;
    if (p.mirror && xn > 0.5) { x = 1 - xn; s = -side; }
    const u = x * p.frequency + u0;
    let v = base(u, s);
    if (hm > 0) v += hm * 0.8 * Math.sin(2 * Math.PI * p.harmonicRatio * u);
    let y = H * (p.offset / 100) - H * amp * envelopeAt(p.envelope, env, x) * v + H * (p.tilt / 100) * (xn - 0.5) * 0.5;
    if (p.arch) y -= H * (p.archHeight / 100) * archTerm(p.archShape, xn, p.archWidth / 100);
    return p.clamp ? Math.min(H, Math.max(0, y)) : y;
  };
  /** x positions (0…1) where the curve has a corner or a jump. */
  const breaks = () => {
    const out: number[] = [];
    const limit = p.mirror ? 0.5 : 1;
    const add = (x: number) => { if (x > 1e-7 && x < limit - 1e-7) out.push(x); };
    if (tpl || p.type === 'arches') {
      const local = p.type === 'arches' ? [5 / 6] : tpl!.breaks;
      const m0 = Math.floor(u0) - 1, m1 = Math.ceil(u0 + p.frequency) + 1;
      for (let m = m0; m <= m1; m++) for (const b of local) add((m + b - u0) / p.frequency);
    }
    if (p.arch) {
      const w = p.archWidth / 200;
      if (p.archShape === 'pointed') { add(0.5); add(0.5 - w); add(0.5 + w); }
      if (p.archShape === 'flat') { add(0.5 - w); add(0.5 + w); add(0.5 - 0.7 * w); add(0.5 + 0.7 * w); }
    }
    if (p.mirror) { for (const x of [...out]) if (1 - x > 0.5 + 1e-7) out.push(1 - x); out.push(0.5); }
    return out;
  };
  return { y: fn, breaks };
}

export function autoPointCount(p: WaveParams) {
  const per = p.curve === 'smooth' ? 7 : 20;
  return Math.round(Math.min(400, Math.max(8, p.frequency * per + (p.arch ? 14 : 4))));
}

/* ───────────────────────── generator ───────────────────────── */

export function buildWave(input: WaveParams) {
  const p = clampWave(input);
  const { y: Y, breaks } = makeWaveFn(p);
  const w = p.width, h = p.height, smooth = p.curve === 'smooth';
  const n = p.autoPoints ? autoPointCount(p) : p.points;

  // sample positions: uniform grid + corner/jump positions
  const marks: { x: number; brk: boolean }[] = [];
  const brk = breaks();
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    if (i > 0 && i < n && brk.some(b => Math.abs(b - x) < 0.3 / n)) continue;   // avoid crowding nodes next to a corner
    marks.push({ x, brk: false });
  }
  for (const b of brk) marks.push({ x: b, brk: true });
  marks.sort((a, b) => a.x - b.x);
  const xs: { x: number; brk: boolean }[] = [];
  for (const m of marks) {
    const last = xs[xs.length - 1];
    if (last && Math.abs(last.x - m.x) < 1e-6) { last.brk = last.brk || m.brk; continue; }
    xs.push({ ...m });
  }
  if (xs.length > 1800) xs.splice(0, xs.length, ...xs.filter((_, i) => i % Math.ceil(xs.length / 1800) === 0 || xs[i].brk));

  type Entry = { x: number; y: number; jumpAfter: boolean; jumpBefore: boolean; xn: number };
  const entries: Entry[] = [];
  xs.forEach((m, i) => {
    const xn = m.x, first = i === 0, last = i === xs.length - 1;
    const yl = first ? Y(xn, 1) : Y(xn, -1), yr = last ? Y(xn, -1) : Y(xn, 1);
    if (Math.abs(yl - yr) > 1e-4) {
      entries.push({ x: xn * w, y: yl, xn, jumpAfter: true, jumpBefore: false });
      entries.push({ x: xn * w, y: yr, xn, jumpAfter: false, jumpBefore: true });
    } else entries.push({ x: xn * w, y: (yl + yr) / 2, xn, jumpAfter: false, jumpBefore: false });
  });

  const nodes: Point[] = entries.map(e => ({ x: e.x, y: e.y, mode: 'corner' as const }));
  if (smooth) {
    const eps = 1e-5;
    entries.forEach((e, i) => {
      const prev = entries[i - 1], next = entries[i + 1];
      if (prev && !e.jumpBefore) {
        const dx = e.x - prev.x;
        if (dx > 1e-9) {
          const dL = (Y(e.xn, -1) - Y(e.xn - eps, 0)) / (eps * w);
          nodes[i].in = { x: e.x - dx / 3, y: e.y - dL * dx / 3 };
        }
      }
      if (next && !e.jumpAfter) {
        const dx = next.x - e.x;
        if (dx > 1e-9) {
          const dR = (Y(e.xn + eps, 0) - Y(e.xn, 1)) / (eps * w);
          nodes[i].out = { x: e.x + dx / 3, y: e.y + dR * dx / 3 };
        }
      }
    });
    // prune handles of straight segments so they export as plain `L`
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i], b = nodes[i + 1];
      if (!a.out || !b.in) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const off = (c: Point) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / len;
      if (off(a.out) < 0.02 && off(b.in) < 0.02) { delete a.out; delete b.in; }
    }
    for (const nd of nodes) {
      if (nd.in && nd.out) {
        const c = Math.abs((nd.x - nd.in.x) * (nd.out.y - nd.y) - (nd.y - nd.in.y) * (nd.out.x - nd.x));
        const m = (Math.hypot(nd.x - nd.in.x, nd.y - nd.in.y) * Math.hypot(nd.out.x - nd.x, nd.out.y - nd.y)) || 1;
        nd.mode = c / m < 0.01 ? 'smooth' : 'free';
      } else nd.mode = nd.in || nd.out ? 'free' : 'corner';
    }
  }

  // drop redundant nodes on straight runs (flat plateaus of square/steps, ramps of triangle/sawtooth)
  const kept: Point[] = nodes.filter((nd, i) => {
    if (i === 0 || i === nodes.length - 1 || nd.in || nd.out) return true;
    const a = nodes[i - 1], b = nodes[i + 1];
    if (a.out || b.in || Math.abs(a.x - b.x) < 1e-9) return true;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return Math.abs((b.x - a.x) * (nd.y - a.y) - (b.y - a.y) * (nd.x - a.x)) / len > 0.01 || nd.x === a.x || nd.x === b.x;
  });
  nodes.splice(0, nodes.length, ...kept);

  // walls: close the wave against the bottom (or top when inverted)
  const taper = p.sideTaper / 100, edge = p.invert ? 0 : h;
  const rx = p.rightWall ? w : w * (1 - taper), lx = p.leftWall ? 0 : w * taper;
  nodes.push({ x: rx, y: edge, mode: 'corner' }, { x: lx, y: edge, mode: 'corner' });

  const box: Box = { x: (ART_W - w) / 2, y: (ART_H - h) / 2, w, h };
  const points = nodes.map(nd => ({
    ...nd, x: nd.x + box.x, y: nd.y + box.y,
    ...(nd.in ? { in: { x: nd.in.x + box.x, y: nd.in.y + box.y } } : {}),
    ...(nd.out ? { out: { x: nd.out.x + box.x, y: nd.out.y + box.y } } : {}),
  }));
  return { points, kind: (smooth ? 'path' : 'polygon') as 'path' | 'polygon', box, params: p, pointCount: points.length - 2 };
}

export function buildWaveShape(params: WaveParams, fill: string): ShapeModel {
  const r = buildWave(params);
  return { name: 'Wave', kind: r.kind, points: r.points, closed: true, fill, stroke: '#9bf0d0', strokeWidth: 2, box: r.box, frame: 'box', wave: r.params };
}

/** Normalised (0…1, top = 0) wave line for tiny previews. */
export function waveLine(params: WaveParams, count = 40): number[] {
  const p = clampWave(params), { y } = makeWaveFn(p);
  const ys = Array.from({ length: count + 1 }, (_, i) => y(i / count, 0));
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  return ys.map(v => (v - lo) / span);
}

/* ───────────────────────── auto wave maker ───────────────────────── */

export type AutoStyle = { id: string; label: string; make: (rnd: () => number) => Partial<WaveParams> };

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const j = (rnd: () => number, v: number, spread: number) => v * (1 + (rnd() - 0.5) * 2 * spread);

export const AUTO_STYLES: AutoStyle[] = [
  { id: 'calm', label: 'Calm sea', make: r => ({ type: 'sine', frequency: j(r, 2.5, .15), amplitude: j(r, 9, .2), offset: 50, harmonic: 12 }) },
  { id: 'swell', label: 'Ocean swell', make: r => ({ type: 'sine', frequency: j(r, 1.5, .2), amplitude: j(r, 20, .15), offset: 50, harmonic: 28, harmonicRatio: 3, skew: Math.round((r() - .5) * 50) }) },
  { id: 'choppy', label: 'Choppy', make: r => ({ type: 'sine', frequency: j(r, 7, .15), amplitude: j(r, 11, .2), harmonic: 45, harmonicRatio: 3 }) },
  { id: 'ripple', label: 'Ripple', make: r => ({ type: 'sine', frequency: j(r, 5, .2), amplitude: j(r, 22, .15), envelope: 'decay', envelopeAmount: 85 }) },
  { id: 'dunes', label: 'Dunes', make: r => ({ type: 'sine', frequency: j(r, 2, .2), amplitude: j(r, 15, .2), skew: 55 + Math.round(r() * 30), tilt: Math.round((r() - .5) * 50) }) },
  { id: 'zigzag', label: 'Zigzag', make: r => ({ type: 'triangle', frequency: j(r, 6, .2), amplitude: j(r, 14, .2), curve: 'linear', skew: Math.round((r() - .5) * 40) }) },
  { id: 'castle', label: 'Castle', make: r => ({ type: 'square', frequency: j(r, 5, .2), amplitude: j(r, 10, .2), curve: 'linear', skew: Math.round((r() - .5) * 30), softness: 0 }) },
  { id: 'saw', label: 'Sawtooth', make: r => ({ type: 'sawtooth', frequency: j(r, 6, .2), amplitude: j(r, 13, .2), curve: 'linear', skew: Math.round((r() - .5) * 30) }) },
  { id: 'hills', label: 'Hills', make: r => ({ type: 'arches', frequency: j(r, 3, .2), amplitude: j(r, 15, .15), offset: 55 }) },
  { id: 'stairs', label: 'Stairs', make: r => ({ type: 'steps', frequency: j(r, 2, .2), amplitude: j(r, 20, .15), steps: 4 + Math.round(r() * 2), curve: 'linear', softness: 0 }) },
  { id: 'tide', label: 'Tide', make: r => ({ type: 'sine', frequency: j(r, 1, .2), amplitude: j(r, 11, .2), arch: true, archHeight: 22 + Math.round(r() * 14), archWidth: 55 + Math.round(r() * 20), archShape: 'round' }) },
  { id: 'organic', label: 'Organic', make: r => ({ type: 'noise', frequency: j(r, 3.5, .25), amplitude: j(r, 17, .2), seed: 1 + Math.floor(r() * 998) }) },
];

/** intensity / complexity are 0…100. Everything is derived deterministically from (style, seed). */
export function autoWaveParams(styleId: string, intensity: number, complexity: number, seed: number, current: WaveParams): WaveParams {
  const style = AUTO_STYLES.find(s => s.id === styleId) ?? AUTO_STYLES[0];
  const rnd = mulberry32(seed * 9973 + 17);
  const spec = style.make(rnd);
  const i = intensity / 100, c = complexity / 100;
  const merged: WaveParams = {
    ...DEFAULT_WAVE,
    // keep the user's frame and option choices
    width: current.width, height: current.height, invert: current.invert, leftWall: current.leftWall, rightWall: current.rightWall, sideTaper: current.sideTaper,
    clamp: current.clamp, mirror: current.mirror,
    ...spec,
    phase: Math.round(rnd() * 360), autoPoints: true,
  };
  merged.amplitude = (spec.amplitude ?? DEFAULT_WAVE.amplitude) * (0.35 + 1.3 * i);
  merged.frequency = (spec.frequency ?? DEFAULT_WAVE.frequency) * (0.5 + 1.0 * i);
  if (merged.curve === 'smooth') merged.harmonic = Math.max(spec.harmonic ?? 0, Math.round(c * 55));
  return clampWave(merged);
}
