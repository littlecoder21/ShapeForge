/* Procedural gradient runtime.
 *
 * Plain JavaScript with no imports, on purpose: exports embed this file verbatim (the same way they embed rigRuntime.js),
 * so the editor preview and an exported page run exactly the same generation, motion, force and packing code.
 *
 * It turns a ProceduralConfig (see types.ts) into the numbers the fragment shader reads:
 *   generatePoints(config, lut)         deterministic colour centres from a seed
 *   createProceduralState(config, opts) animated state: step(dt, pointerFrame, aspect, motionScale) → buffers
 *   uploadProceduralUniforms(gl, loc, buffers)
 * Every animation is a function of accumulated time or uses a fixed internal step, so it is frame-rate independent.
 * The GPU never receives per-frame CPU noise: it gets 12 points, their colours and a handful of vec4s. */

export const PROC_MAX_POINTS = 12;
export const PROC_MAX_STAGES = 3;
export const PROC_LUT_SIZE = 512;

const TAU = Math.PI * 2;
const FIXED_STEP = 1 / 120;
const MAX_FIXED_STEPS = 8;
const METHOD_INDEX = { idw: 0, gaussian: 1, smooth: 2, radial: 3, smin: 4, soft: 5 };
const SPACE_INDEX = { srgb: 0, linear: 1, oklab: 2 };
const MODE_INDEX = { hybrid: 1, full: 2 };
/** motion types a point can pick when `motion.mixed` is on */
const MOTION_POOL = ['orbit', 'circle', 'figure8', 'sine', 'drift', 'noise', 'wander'];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const fract = v => v - Math.floor(v);
const smooth = v => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const mirror = t => 1 - Math.abs(1 - 2 * fract(t * 0.5));

/* ─────────────── seeded randomness ─────────────── */

/** mulberry32: a small, fast, well-distributed 32-bit generator. The same seed always yields the same sequence. */
export function createRng(seed) {
  let a = (Math.floor(num(seed, 1)) >>> 0) || 1;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return next;
}

/** Integer hash → [0, 1). Used by the closed-form motions so they need no state and are identical in every browser. */
function ihash(n) {
  let x = Math.imul((n | 0) ^ ((n | 0) >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = ihash(i * 374761393 + seed) * 2 - 1;
  const b = ihash((i + 1) * 374761393 + seed) * 2 - 1;
  return a + (b - a) * u;
}

/* ─────────────── colour helpers ─────────────── */

const hexToRgb255 = hex => {
  const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '000000', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toLinear = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

/** Writes an sRGB (0–255) colour into `out` in the space the shader blends in: 0 sRGB, 1 linear light, 2 OKLab. */
function encodeColor(r, g, b, space, out, o) {
  if (space === 0) { out[o] = r / 255; out[o + 1] = g / 255; out[o + 2] = b / 255; return; }
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  if (space === 1) { out[o] = R; out[o + 1] = G; out[o + 2] = B; return; }
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

/** A palette texture-sized lookup (RGBA bytes) from a plain colour list, equally spaced, blended in sRGB. */
export function bakeColorLut(colors, size = PROC_LUT_SIZE) {
  const list = (colors && colors.length ? colors : ['#7c5cff', '#22d3ee']).map(hexToRgb255);
  const lut = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const t = size === 1 ? 0 : i / (size - 1);
    const at = list.length === 1 ? 0 : t * (list.length - 1);
    const k = Math.min(list.length - 2, Math.floor(at));
    const f = list.length === 1 ? 0 : at - k;
    const a = list[Math.max(0, k)], b = list[Math.min(list.length - 1, Math.max(0, k) + 1)];
    for (let c = 0; c < 3; c++) lut[i * 4 + c] = Math.round(a[c] + (b[c] - a[c]) * f);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

function lutAt(lut, t) {
  const size = lut.length >> 2;
  const i = clamp(Math.round(clamp(t, 0, 1) * (size - 1)), 0, size - 1) * 4;
  return [lut[i], lut[i + 1], lut[i + 2]];
}

/* ─────────────── point generation ─────────────── */

export function pointCount(config) {
  const p = config.points || {};
  const lo = clamp(Math.round(num(p.min, 5)), 1, PROC_MAX_POINTS);
  const hi = clamp(Math.round(num(p.max, 8)), lo, PROC_MAX_POINTS);
  return clamp(Math.round(lo + (hi - lo) * clamp(num(p.density, 0.5), 0, 1)), 1, PROC_MAX_POINTS);
}

function placeRandom(n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([rng(), rng()]);
  return out;
}
function placeGrid(n, rng) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    out.push([(c + 0.5 + (rng() - 0.5) * 0.3) / cols, (r + 0.5 + (rng() - 0.5) * 0.3) / rows]);
  }
  return out;
}
function placeCircular(n, rng) {
  const offset = rng() * TAU;
  const outer = n > 6 ? Math.ceil(n * 0.6) : n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const ring = i < outer;
    const count = ring ? outer : n - outer;
    const index = ring ? i : i - outer;
    const angle = offset + (index / Math.max(1, count)) * TAU + (ring ? 0 : Math.PI / Math.max(1, count));
    const radius = ring ? 0.4 : 0.18;
    out.push([0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius]);
  }
  return out;
}
function placeOrganic(n, rng) {
  const offset = rng() * TAU;
  const golden = 2.399963229728653;
  const out = [];
  for (let i = 0; i < n; i++) {
    const radius = 0.46 * Math.sqrt((i + 0.5) / n);
    const angle = offset + i * golden;
    out.push([0.5 + Math.cos(angle) * radius + (rng() - 0.5) * 0.06, 0.5 + Math.sin(angle) * radius + (rng() - 0.5) * 0.06]);
  }
  return out;
}
function placeCluster(n, rng) {
  const groups = clamp(Math.ceil(n / 4), 1, 4);
  const centers = [];
  for (let g = 0; g < groups; g++) centers.push([0.2 + rng() * 0.6, 0.2 + rng() * 0.6]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = centers[i % groups];
    const u = Math.max(1e-6, rng()), v = rng();
    const radius = Math.sqrt(-2 * Math.log(u)) * 0.09;
    out.push([c[0] + Math.cos(v * TAU) * radius, c[1] + Math.sin(v * TAU) * radius]);
  }
  return out;
}
const PLACERS = { random: placeRandom, grid: placeGrid, circular: placeCircular, organic: placeOrganic, cluster: placeCluster };

/** Pushes points apart until no pair is closer than the wanted separation (a few passes; deterministic). */
function relax(points, spacing) {
  const n = points.length;
  const minDistance = clamp(spacing, 0, 1) * 0.9 / Math.sqrt(Math.max(1, n));
  if (minDistance <= 0 || n < 2) return;
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = points[j][0] - points[i][0], dy = points[j][1] - points[i][1];
        let d = Math.hypot(dx, dy);
        if (d >= minDistance) continue;
        if (d < 1e-6) { dx = Math.cos(i * 2.399); dy = Math.sin(i * 2.399); d = 1; }
        const push = (minDistance - Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1])) * 0.5;
        const ux = dx / d, uy = dy / d;
        points[i][0] -= ux * push; points[i][1] -= uy * push;
        points[j][0] += ux * push; points[j][1] += uy * push;
      }
    }
  }
}

/**
 * Deterministic colour centres. Same config + same palette = same points, always.
 * Each record carries every per-point property: position, colour, radius, influence, weight, motion and response.
 * @param {object} config a normalised ProceduralConfig
 * @param {Uint8Array|null} lut the layer's palette LUT (RGBA bytes); used when color.source is 'layer'
 */
export function generatePoints(config, lut) {
  const pc = config.points;
  const cc = config.color;
  const mc = config.motion;
  const anchors = Array.isArray(config.anchors) ? config.anchors.slice(0, PROC_MAX_POINTS) : [];
  const count = Math.min(PROC_MAX_POINTS, Math.max(pointCount(config), anchors.length));
  const rng = createRng(config.seed);

  const placed = (PLACERS[pc.distribution] || placeOrganic)(count, rng);
  relax(placed, num(pc.spacing, 0.35));
  const spread = num(pc.spread, 0.9);

  const order = Array.from({ length: count }, (_, i) => i);
  if (cc.shuffle) {
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const swap = order[i]; order[i] = order[j]; order[j] = swap;
    }
  }
  const paletteLut = cc.source === 'layer' && lut && lut.length >= 8 ? lut : bakeColorLut(cc.colors);

  const variance = clamp(num(pc.variance, 0.35), 0, 1);
  const randomness = clamp(num(mc.randomness, 0.4), 0, 1);
  const globalPhase = (num(mc.phase, 0) / 360) * TAU;
  const points = [];
  for (let i = 0; i < count; i++) {
    const anchor = anchors[i];
    const rv = 1 + (rng() * 2 - 1) * variance * 0.6;
    const wv = 1 + (rng() * 2 - 1) * variance * 0.5;
    const iv = 1 + (rng() * 2 - 1) * variance * 0.4;
    const tJitter = (rng() * 2 - 1) * clamp(num(cc.variance, 0.15), 0, 1) * 0.25;
    const poolPick = MOTION_POOL[Math.floor(rng() * MOTION_POOL.length)];
    const speedJitter = 1 + (rng() * 2 - 1) * randomness * 0.6;
    const phase = rng() * TAU * (0.25 + 0.75 * randomness);
    const ampJitter = 1 + (rng() * 2 - 1) * randomness * 0.5;
    const freqJitter = 1 + (rng() * 2 - 1) * randomness * 0.3;
    const responseJitter = 1 + (rng() * 2 - 1) * 0.3 * randomness;
    const seed = Math.floor(rng() * 1e9);

    const t = clamp((count === 1 ? 0.5 : order[i] / (count - 1)) + tJitter, 0, 1);
    const color = anchor ? hexToRgb255(anchor.color) : lutAt(paletteLut, t);
    points.push({
      x: anchor ? anchor.x : 0.5 + (placed[i][0] - 0.5) * spread,
      y: anchor ? anchor.y : 0.5 + (placed[i][1] - 0.5) * spread,
      color,
      /** position along the palette (−1 = a fixed anchor colour that palette cycling must not touch) */
      t: anchor ? -1 : t,
      radius: anchor ? anchor.radius : num(pc.radius, 0.42) * rv,
      influence: num(pc.influence, 1) * iv,
      weight: (anchor ? anchor.weight : 1) * num(pc.weight, 1) * wv,
      motion: {
        type: mc.mixed ? poolPick : mc.type,
        speed: num(mc.speed, 0.6) * speedJitter,
        phase: phase + globalPhase,
        amplitude: num(mc.amplitude, 0.1) * ampJitter,
        frequency: num(mc.frequency, 1) * freqJitter,
        seed,
      },
      response: responseJitter,
    });
  }
  return points;
}

/* ─────────────── motion ─────────────── */

/**
 * Closed-form position of a point at motion time `time` (seconds, already scaled by speed / direction).
 * Static, orbit, circle, figure-8, sine, drift, noise and wander are pure functions of time, so they are exactly
 * frame-rate independent. `flow` and `follow` need state and live in createProceduralState().
 */
export function motionPosition(point, time, motion) {
  const m = point.motion;
  const hx = point.x, hy = point.y;
  const dir = motion.direction < 0 ? -1 : 1;
  const w = TAU * 0.12 * m.speed * m.frequency;
  const theta = w * time * dir + m.phase;
  const smoothness = clamp(num(motion.smoothness, 0.6), 0, 1);
  const amp = m.amplitude;
  let x = hx, y = hy;
  switch (m.type) {
    case 'orbit': {
      const a = theta * 0.5 - m.phase * 0.5;
      const c = Math.cos(a), s = Math.sin(a);
      const dx = hx - 0.5, dy = hy - 0.5;
      const breathe = 1 + amp * 2 * Math.sin(theta);
      x = 0.5 + (c * dx - s * dy) * breathe; y = 0.5 + (s * dx + c * dy) * breathe;
      break;
    }
    case 'circle': x = hx + amp * Math.cos(theta); y = hy + amp * Math.sin(theta); break;
    case 'figure8': x = hx + amp * 1.3 * Math.sin(theta); y = hy + amp * 0.65 * Math.sin(2 * theta); break;
    case 'sine': {
      const a = (m.seed % 6283) / 1000;
      const ax = Math.cos(a), ay = Math.sin(a);
      const along = amp * 1.4 * Math.sin(theta * 0.6);
      const across = amp * 0.4 * Math.sin(theta * 1.7 + m.phase);
      x = hx + ax * along - ay * across; y = hy + ay * along + ax * across;
      break;
    }
    case 'drift': {
      const h2 = 0.5 * (1 - smoothness);
      x = hx + amp * (Math.sin(theta * 0.7) + h2 * Math.sin(theta * 1.9 + m.phase * 2.3)) / (1 + h2);
      y = hy + amp * (Math.cos(theta * 0.8 + m.phase) + h2 * Math.cos(theta * 2.1 + m.phase * 1.7)) / (1 + h2);
      break;
    }
    case 'noise': {
      const rate = w * (1.4 - smoothness) * 0.8 * dir;
      x = hx + amp * 1.6 * noise1(time * rate, m.seed);
      y = hy + amp * 1.6 * noise1(time * rate + 37.1, m.seed + 101);
      break;
    }
    case 'wander': {
      const rate = (0.15 + 0.5 * (1 - smoothness)) * m.speed * m.frequency * dir;
      const at = time * rate;
      const k = Math.floor(at);
      const f = smooth(at - k);
      const rx = (index) => ihash(m.seed + index * 7919) * 2 - 1;
      const ry = (index) => ihash(m.seed + 13 + index * 104729) * 2 - 1;
      x = hx + amp * 1.6 * (rx(k) + (rx(k + 1) - rx(k)) * f);
      y = hy + amp * 1.6 * (ry(k) + (ry(k + 1) - ry(k)) * f);
      break;
    }
    default: break;
  }
  const influence = clamp(num(motion.influence, 1), 0, 1);
  return [hx + (x - hx) * influence, hy + (y - hy) * influence];
}

/* ─────────────── interaction forces ─────────────── */

const FALLOFF = {
  soft: q => 1 - smooth(q),
  linear: q => 1 - q,
  sharp: q => Math.pow(1 - smooth(q), 2.4),
  gaussian: q => Math.exp(-4.5 * q * q),
};

/**
 * Displacement (in aspect-corrected canvas-height units) a pointer source applies to a point.
 * (dx, dy) = point − pointer, w = falloff × strength, (vx, vy) = pointer velocity.
 */
export function forceDisplacement(type, dx, dy, dist, w, vx, vy, clock) {
  const ux = dx / dist, uy = dy / dist;
  switch (type) {
    case 'attract': return [-ux * w * 0.25, -uy * w * 0.25];
    case 'repel': return [ux * w * 0.25, uy * w * 0.25];
    case 'swirl': return [-uy * w * 0.25, ux * w * 0.25];
    case 'vortex': return [(-uy * 0.8 - ux * 0.35) * w * 0.25, (ux * 0.8 - uy * 0.35) * w * 0.25];
    case 'push': return [vx * w * 0.6, vy * w * 0.6];
    case 'pull': return [-vx * w * 0.6, -vy * w * 0.6];
    case 'ripple': { const r = Math.sin(dist * 18 - clock * 4) * w * 0.12; return [ux * r, uy * r]; }
    case 'wave': { const r = Math.sin(dist * 14 - clock * 3) * w * 0.12; return [-uy * r, ux * r]; }
    case 'fluid': return [vx * w * 0.8 - uy * w * 0.06, vy * w * 0.8 + ux * w * 0.06];
    default: return [0, 0];
  }
}

/* ─────────────── animated state ─────────────── */

function createBuffers() {
  return {
    points: new Float32Array(PROC_MAX_POINTS * 4),
    colors: new Float32Array(PROC_MAX_POINTS * 4),
    a: new Float32Array(4), b: new Float32Array(4), c: new Float32Array(4),
    grade: new Float32Array(4), d: new Float32Array(4), base: new Float32Array(4),
    warpA: new Float32Array(PROC_MAX_STAGES * 4), warpB: new Float32Array(PROC_MAX_STAGES * 4), warpC: new Float32Array(PROC_MAX_STAGES * 4),
    count: 0,
  };
}

/**
 * @param {object} initial a normalised ProceduralConfig
 * @param {{ lut?: Uint8Array|null, octaveCap?: number }} [options]
 */
export function createProceduralState(initial, options = {}) {
  let config = initial;
  let lut = options.lut || null;
  let octaveCap = options.octaveCap || 6;
  let points = [];
  let time = 0;
  let clock = 0;
  let acc = 0;
  let settling = false;
  let dyn = [];
  const buffers = createBuffers();

  const resetDynamic = () => {
    dyn = points.map(point => ({ ix: 0, iy: 0, fx: point.x, fy: point.y, px: point.x, py: point.y }));
  };

  const packStatic = () => {
    const space = SPACE_INDEX[config.color.interpolation] || 0;
    const on = config.enabled && points.length > 0;
    buffers.a[0] = on ? (MODE_INDEX[config.mode] || 2) : 0;
    buffers.a[1] = on ? points.length : 0;
    buffers.a[2] = METHOD_INDEX[config.field.method] || 0;
    buffers.a[3] = clamp(num(config.mix, 1), 0, 1);
    buffers.b[0] = config.field.radius;
    buffers.b[1] = config.field.strength;
    buffers.b[2] = config.field.falloff;
    buffers.b[3] = config.field.softness;
    buffers.c[0] = config.field.exponent;
    buffers.c[1] = config.field.overlap;
    buffers.c[2] = space;
    buffers.c[3] = octaveCap;
    buffers.grade[0] = config.color.exposure;
    buffers.grade[1] = config.color.contrast;
    buffers.grade[2] = config.color.saturation;
    buffers.grade[3] = config.color.temperature;
    buffers.d[0] = (config.color.hue * Math.PI) / 180;
    for (let i = 0; i < PROC_MAX_STAGES; i++) {
      const stage = config.distortion[i];
      const o = i * 4;
      if (!stage || stage.type === 'none') { buffers.warpA.fill(0, o, o + 4); buffers.warpB.fill(0, o, o + 4); buffers.warpC.fill(0, o, o + 4); continue; }
      buffers.warpA[o] = stage.enabled ? 1 : 0; buffers.warpA[o + 1] = stage.scale; buffers.warpA[o + 2] = stage.intensity; buffers.warpA[o + 3] = stage.frequency;
      buffers.warpB[o] = stage.octaves; buffers.warpB[o + 1] = stage.lacunarity; buffers.warpB[o + 2] = stage.persistence; buffers.warpB[o + 3] = stage.turbulence;
      buffers.warpC[o] = stage.speed; buffers.warpC[o + 1] = (stage.direction * Math.PI) / 180; buffers.warpC[o + 2] = stage.noise === 'value' ? 1 : 0; buffers.warpC[o + 3] = 0;
    }
    buffers.count = on ? points.length : 0;
  };

  const rebuild = () => {
    const before = points;
    points = config.enabled ? generatePoints(config, lut) : [];
    const sameHomes = before.length === points.length && before.every((p, i) => Math.abs(p.x - points[i].x) < 1e-9 && Math.abs(p.y - points[i].y) < 1e-9);
    if (!sameHomes || dyn.length !== points.length) resetDynamic();
    packStatic();
    pack(0);
  };

  const positions = [];
  const encoded = new Float32Array(PROC_MAX_POINTS * 3);

  /** Writes points + colours into the uniform buffers. `cycle` is the palette offset in palette-lengths. */
  function pack(cycle) {
    const space = SPACE_INDEX[config.color.interpolation] || 0;
    const paletteLut = config.color.source === 'layer' && lut && lut.length >= 8 ? lut : null;
    const customLut = paletteLut ? null : (state.customLut || (state.customLut = bakeColorLut(config.color.colors)));
    const sourceLut = paletteLut || customLut;
    buffers.points.fill(0);
    buffers.colors.fill(0);
    let mean0 = 0, mean1 = 0, mean2 = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const at = positions[i] || [p.x, p.y];
      let rgb = p.color;
      if (p.t >= 0 && cycle !== 0) rgb = lutAt(sourceLut, mirror(p.t + cycle));
      encodeColor(rgb[0], rgb[1], rgb[2], space, buffers.colors, i * 4);
      buffers.points[i * 4] = at[0];
      buffers.points[i * 4 + 1] = at[1];
      buffers.points[i * 4 + 2] = Math.max(0.01, p.radius * p.influence);
      buffers.points[i * 4 + 3] = p.weight;
      mean0 += buffers.colors[i * 4]; mean1 += buffers.colors[i * 4 + 1]; mean2 += buffers.colors[i * 4 + 2];
    }
    const n = Math.max(1, points.length);
    const base = config.field.base;
    if (base) {
      const rgb = hexToRgb255(base);
      encodeColor(rgb[0], rgb[1], rgb[2], space, encoded, 0);
      buffers.base[0] = encoded[0]; buffers.base[1] = encoded[1]; buffers.base[2] = encoded[2];
    } else {
      buffers.base[0] = mean0 / n; buffers.base[1] = mean1 / n; buffers.base[2] = mean2 / n;
    }
    buffers.base[3] = 1;
  }

  const state = {
    buffers,
    customLut: null,
    getConfig: () => config,
    getPoints: () => points,
    /** current animated positions in uv units, one [x, y] per point */
    getPositions: () => positions.slice(0, points.length),
    setConfig(next) {
      if (next === config) return;
      config = next;
      state.customLut = null;
      rebuild();
    },
    setPaletteLut(next) {
      if (next === lut) return;
      lut = next || null;
      if (config.color.source === 'layer') rebuild();
    },
    /** performance hook: the most octaves any distortion stage may use (lowered when the frame rate drops) */
    setQuality(quality) {
      const cap = clamp(Math.round(num(quality && quality.octaveCap, 6)), 1, 6);
      if (cap !== octaveCap) { octaveCap = cap; buffers.c[3] = cap; }
    },
    /** true while the points are still moving on their own (so the renderer must keep drawing frames) */
    isAnimated() {
      if (!config.enabled) return false;
      const m = config.motion;
      const moves = m.influence > 0 && m.speed > 0 && (m.mixed || m.type !== 'static');
      return moves || config.color.cycleSpeed !== 0;
    },
    /** true while points are easing back after the pointer left */
    isSettling: () => settling,
    /**
     * Advances the simulation.
     * @param {number} dt real seconds since the last frame (clamped by the caller)
     * @param {object} frame pointer state: x, y, vx, vy, active, down, t2x, t2y, t2active
     * @param {number} aspect canvas width / height
     * @param {number} motionScale 0 freezes autonomous motion (animation off / paused); 1 plays at normal speed
     */
    step(dt, frame, aspect, motionScale) {
      if (!config.enabled || !points.length) { buffers.a[0] = 0; settling = false; return buffers; }
      buffers.a[0] = MODE_INDEX[config.mode] || 2;
      const dtMotion = Math.max(0, dt) * Math.max(0, motionScale);
      time += dtMotion * (config.motion.speed > 0 ? 1 : 0);
      buffers.d[1] = time;
      clock += Math.max(0, dt);
      const m = config.motion;
      const ic = config.interaction;
      const falloff = FALLOFF[ic.falloff] || FALLOFF.soft;
      const pointer = frame || { x: 0.5, y: 0.5, vx: 0, vy: 0, active: 0, down: 0, t2x: 0.5, t2y: 0.5, t2active: 0 };
      const asp = Math.max(0.1, aspect || 1);
      const forcesOn = ic.force !== 'none' && ic.strength > 0;
      const sources = [
        { x: pointer.x, y: pointer.y, a: num(pointer.active, 0), vx: clamp(num(pointer.vx, 0), -1.5, 1.5), vy: clamp(num(pointer.vy, 0), -1.5, 1.5), down: num(pointer.down, 0) },
        { x: num(pointer.t2x, 0.5), y: num(pointer.t2y, 0.5), a: num(pointer.t2active, 0), vx: 0, vy: 0, down: 0 },
      ];
      // fixed internal step for the stateful motions: identical result at 30, 60 or 144 fps
      acc += dtMotion;
      let steps = 0;
      const stepCount = Math.min(MAX_FIXED_STEPS, Math.floor(acc / FIXED_STEP));
      acc -= stepCount * FIXED_STEP;
      if (acc > FIXED_STEP * MAX_FIXED_STEPS) acc = 0;
      settling = false;

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const d = dyn[i];
        let pos;
        if (p.motion.type === 'flow') {
          const k = 3 * p.motion.frequency;
          const gain = p.motion.speed * p.motion.amplitude * 3.2 * (m.direction < 0 ? -1 : 1);
          for (steps = 0; steps < stepCount; steps++) {
            const vx = Math.sin(k * d.fy + time * 0.3 + p.motion.phase) + 0.5 * Math.sin(k * 1.7 * d.fx - time * 0.21);
            const vy = Math.cos(k * d.fx - time * 0.25 + p.motion.phase * 1.3) + 0.5 * Math.cos(k * 1.3 * d.fy + time * 0.17);
            d.fx += vx * gain * FIXED_STEP;
            d.fy += vy * gain * FIXED_STEP;
            const home = 1 - Math.exp(-0.6 * FIXED_STEP);
            d.fx += (p.x - d.fx) * home;
            d.fy += (p.y - d.fy) * home;
          }
          const inf = clamp(num(m.influence, 1), 0, 1);
          pos = [p.x + (d.fx - p.x) * inf, p.y + (d.fy - p.y) * inf];
        } else if (p.motion.type === 'follow') {
          const lead = sources[0];
          const tracking = lead.a > 0.02;
          const ring = p.motion.amplitude * 2 + 0.04;
          const tx = tracking ? lead.x + Math.cos(p.motion.phase) * ring : p.x;
          const ty = tracking ? lead.y + Math.sin(p.motion.phase) * ring : p.y;
          const tau = 0.06 + clamp(num(m.smoothness, 0.6), 0, 1) * 0.9;
          const speedUp = Math.max(0.15, p.motion.speed);
          const blend = 1 - Math.exp(-dtMotion * speedUp / tau);
          d.px += (tx - d.px) * blend;
          d.py += (ty - d.py) * blend;
          const inf = clamp(num(m.influence, 1), 0, 1);
          pos = [p.x + (d.px - p.x) * inf, p.y + (d.py - p.y) * inf];
          if (Math.abs(d.px - tx) + Math.abs(d.py - ty) > 5e-4 && dtMotion > 0) settling = true;
        } else {
          pos = motionPosition(p, time, m);
        }

        let tx = 0, ty = 0;
        if (forcesOn) {
          for (let s = 0; s < sources.length; s++) {
            const src = sources[s];
            if (src.a < 0.003) continue;
            const dx = (pos[0] - src.x) * asp, dy = pos[1] - src.y;
            const dist = Math.hypot(dx, dy) + 1e-4;
            const q = dist / ic.radius;
            if (q >= 1) continue;
            const w = falloff(q) * src.a * ic.strength * (1 + 0.6 * src.down);
            const f = forceDisplacement(ic.force, dx, dy, dist, w, src.vx, src.vy, clock);
            tx += f[0] / asp; ty += f[1];
          }
        }
        const relax = 1 - Math.exp(-Math.max(0, dt) * ic.response * p.response);
        d.ix += (tx - d.ix) * relax;
        d.iy += (ty - d.iy) * relax;
        if (Math.abs(d.ix) + Math.abs(d.iy) > 4e-4 || Math.abs(tx) + Math.abs(ty) > 4e-4) settling = true;
        positions[i] = [clamp(pos[0] + d.ix, -0.4, 1.4), clamp(pos[1] + d.iy, -0.4, 1.4)];
      }
      pack(config.color.cycleSpeed !== 0 ? time * config.color.cycleSpeed * 0.05 : 0);
      return buffers;
    },
  };
  rebuild();
  return state;
}

/** Sends the packed buffers to the GPU. `loc` maps uniform names (arrays as `name[0]`) to locations. */
export function uploadProceduralUniforms(gl, loc, buffers) {
  const at = name => loc[name] || null;
  gl.uniform4fv(at('uProcPoints[0]'), buffers.points);
  gl.uniform4fv(at('uProcColors[0]'), buffers.colors);
  gl.uniform4fv(at('uProcA'), buffers.a);
  gl.uniform4fv(at('uProcB'), buffers.b);
  gl.uniform4fv(at('uProcC'), buffers.c);
  gl.uniform4fv(at('uProcGrade'), buffers.grade);
  gl.uniform4fv(at('uProcD'), buffers.d);
  gl.uniform4fv(at('uProcBase'), buffers.base);
  gl.uniform4fv(at('uProcWarpA[0]'), buffers.warpA);
  gl.uniform4fv(at('uProcWarpB[0]'), buffers.warpB);
  gl.uniform4fv(at('uProcWarpC[0]'), buffers.warpC);
}
