/* Procedural gradient runtime.
 *
 * Plain JavaScript with no imports, on purpose: exports embed this file verbatim (the same way they embed rigRuntime.js),
 * so the editor preview and an exported page run exactly the same generation, motion, force and packing code.
 *
 * It turns a ProceduralConfig (see types.ts) into the numbers the fragment shader reads:
 *   generatePoints(config, lut)         deterministic colour centres from a seed (or pinned anchors, e.g. a mesh)
 *   createProceduralState(config, opts) animated state: step(dt, pointerFrame, aspect, motionScale) → buffers
 *   uploadProceduralUniforms(gl, loc, buffers)
 * Every animation is a function of accumulated time or uses a fixed internal step, so it is frame-rate independent.
 * The GPU never receives per-frame CPU noise: it gets the centres, their colours and a handful of vec4s.
 *
 * Capacity: generated centres stay at 12. Pinned anchors (a mesh layer's points) may go to 128; the buffers and the shader
 * loop are sized to the smallest tier (12, 24, 48, 96, 128) that holds them. */

export const PROC_MAX_POINTS = 12;
export const PROC_MAX_STAGES = 3;
export const PROC_MAX_MESH_POINTS = 128;
export const PROC_POINT_TIERS = [12, 24, 48, 96, 128];
export const PROC_LUT_SIZE = 512;

const TAU = Math.PI * 2;
const FIXED_STEP = 1 / 120;
const MAX_FIXED_STEPS = 8;
const METHOD_INDEX = {
  idw: 0,
  gaussian: 1,
  smooth: 2,
  radial: 3,
  smin: 4,
  soft: 5,
  "inverse-multiquadric": 6,
  "wendland-c2": 7,
  "smooth-voronoi": 8,
  "power-diagram": 9,
  "natural-neighbor": 10,
  "custom-weighted": 11,
  "rbf-gaussian": 12,
  "rbf-multiquadric": 13,
  "thin-plate": 14,
  harmonic: 15,
};
/** methods whose interpolant is solved on the CPU (exact RBF); the shader only sums the kernels */
const RBF_METHODS = {
  "rbf-gaussian": true,
  "rbf-multiquadric": true,
  "thin-plate": true,
  harmonic: true,
};
const SPACE_INDEX = { srgb: 0, linear: 1, oklab: 2, oklch: 3 };
const LAYER_KERNEL_INDEX = {
  gaussian: 0,
  soft: 1,
  smooth: 2,
  radial: 3,
  idw: 4,
  "wendland-c2": 5,
  "inverse-multiquadric": 6,
};
const BLEND_INDEX = {
  mix: 0,
  add: 1,
  multiply: 2,
  screen: 3,
  overlay: 4,
  "soft-light": 5,
  difference: 6,
  max: 7,
  min: 8,
  weighted: 9,
};
const wrapPi = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
/** Unwrapped hue offset of `h` from the reference hue, for the three hue routes that are not the plain vector mean. */
export function hueDelta(h, ref, direction) {
  const d = wrapPi(h - ref);
  if (direction === 2) return d < 0 ? d + TAU : d;
  if (direction === 3) return d > 0 ? d - TAU : d;
  if (Math.abs(d) < 1e-9) return 0;
  return d > 0 ? d - TAU : d + TAU;
}
const HUE_DIRECTION_INDEX = {
  shorter: 0,
  longer: 1,
  increasing: 2,
  decreasing: 3,
};
const SHAPE_INDEX = {
  circle: 0,
  ellipse: 1,
  "rounded-rect": 2,
  diamond: 3,
  directional: 4,
  polygon: 5,
};
const MODE_INDEX = { hybrid: 1, full: 2 };
/** motion types a point can pick when `motion.mixed` is on */
const MOTION_POOL = [
  "orbit",
  "circle",
  "figure8",
  "sine",
  "drift",
  "noise",
  "wander",
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const fract = (v) => v - Math.floor(v);
const smooth = (v) => {
  const t = clamp(v, 0, 1);
  return t * t * (3 - 2 * t);
};
const mirror = (t) => 1 - Math.abs(1 - 2 * fract(t * 0.5));

/* ─────────────── easing curves (segment-based motion) ─────────────── */

/** Easing curves f(0) = 0, f(1) = 1. `smooth` is the original smoothstep, so existing projects look the same. spring and
 *  elastic overshoot 1 and settle on it. `custom` is a CSS cubic-bezier (see cubicBezierEase). */
const EASE = {
  smooth: (f) => smooth(f),
  linear: (f) => f,
  "ease-in": (f) => f * f,
  "ease-out": (f) => 1 - (1 - f) * (1 - f),
  "ease-in-out": (f) => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2),
  cubic: (f) => (f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2),
  spring: (f) =>
    f >= 1 ? 1 : 1 - Math.exp(-6 * f) * Math.cos(2.5 * Math.PI * f),
  elastic: (f) =>
    f <= 0
      ? 0
      : f >= 1
        ? 1
        : Math.pow(2, -10 * f) * Math.sin(((f * 10 - 0.75) * TAU) / 3) + 1,
};

/** CSS-style cubic-bezier(x1, y1, x2, y2) evaluated at progress `f` (solves x(t) = f by Newton with a bisection fallback). */
export function cubicBezierEase(x1, y1, x2, y2, f) {
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  let t = f;
  for (let i = 0; i < 6; i++) {
    const err = X(t) - f;
    if (Math.abs(err) < 1e-6) break;
    const d = dX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  if (!(t >= 0 && t <= 1) || Math.abs(X(t) - f) > 1e-4) {
    let lo = 0,
      hi = 1;
    t = f;
    for (let i = 0; i < 24; i++) {
      if (X(t) < f) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return ((ay * t + by) * t + cy) * t;
}

/** The easing a motion uses: `elastic` motion defaults to the elastic curve unless the user picked another one. */
export function easeValue(motion, type, f) {
  const name =
    motion && EASE[motion.easing]
      ? motion.easing
      : motion && motion.easing === "custom"
        ? "custom"
        : "smooth";
  if (name === "custom") {
    const c = (motion && motion.curve) || [0.42, 0, 0.58, 1];
    return cubicBezierEase(
      num(c[0], 0.42),
      num(c[1], 0),
      num(c[2], 0.58),
      num(c[3], 1),
      f,
    );
  }
  if (type === "elastic" && name === "smooth") return EASE.elastic(f);
  return EASE[name](f);
}

/* ─────────────── capacity ─────────────── */

/** The smallest compiled tier that holds `count` centres. */
export function tierFor(count) {
  const wanted = Math.max(1, Math.ceil(num(count, 1)));
  for (const tier of PROC_POINT_TIERS) if (tier >= wanted) return tier;
  return PROC_POINT_TIERS[PROC_POINT_TIERS.length - 1];
}

/** A mesh-sourced config (linked to the layer, or drawn CSS-compatible) draws EXACTLY its anchors: the mesh is the whole picture, so no
 *  generated centres are added to it, and the count follows the mesh when points are added or removed. */
export function pinnedOnly(config) {
  const anchors =
    config && Array.isArray(config.anchors) ? config.anchors.length : 0;
  const mesh = config && config.mesh;
  return (
    anchors > 0 &&
    !!mesh &&
    (mesh.source === "layer" || mesh.render === "css-compatible")
  );
}

/** The extra fields that are drawn (enabled, at most 3, never in the CSS-compatible mesh). */
export function activeFieldLayers(config) {
  if (
    !config ||
    !Array.isArray(config.fields) ||
    (config.mesh && config.mesh.render === "css-compatible")
  )
    return [];
  return config.fields.slice(0, 3).filter((layer) => layer && layer.enabled);
}

const layerPointCount = (layer) => clamp(Math.round(num(layer.count, 2)), 1, 4);
const extraPointCount = (config) =>
  activeFieldLayers(config).reduce(
    (sum, layer) => sum + layerPointCount(layer),
    0,
  );

/** How many centres a config needs: generated ones (min…max by density) or its pinned anchors, whichever is more, plus the extra fields' centres. */
export function proceduralNeed(config) {
  if (!config) return 1;
  const anchors = Array.isArray(config.anchors) ? config.anchors.length : 0;
  if (pinnedOnly(config)) return anchors + extraPointCount(config);
  const p = config.points;
  const generated = p
    ? clamp(
        Math.round(
          num(p.min, 5) +
            (num(p.max, 8) - num(p.min, 5)) * clamp(num(p.density, 0.5), 0, 1),
        ),
        1,
        PROC_MAX_POINTS,
      )
    : 1;
  return Math.max(generated, anchors) + extraPointCount(config);
}

export const proceduralCapacity = (config) => tierFor(proceduralNeed(config));

/* ─────────────── seeded randomness ─────────────── */

/** mulberry32: a small, fast, well-distributed 32-bit generator. The same seed always yields the same sequence. */
export function createRng(seed) {
  let a = Math.floor(num(seed, 1)) >>> 0 || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
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

const hexToRgb255 = (hex) => {
  const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "000000", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toLinear = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** Writes an sRGB (0–255) colour into `out` in the space the shader blends in: 0 sRGB, 1 linear light, 2 OKLab,
 *  3 OKLCH as (lightness, chroma, hue in radians). */
function encodeColor(r, g, b, space, out, o) {
  if (space === 0) {
    out[o] = r / 255;
    out[o + 1] = g / 255;
    out[o + 2] = b / 255;
    return;
  }
  const R = toLinear(r),
    G = toLinear(g),
    B = toLinear(b);
  if (space === 1) {
    out[o] = R;
    out[o + 1] = G;
    out[o + 2] = B;
    return;
  }
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const labL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const labA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const labB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  out[o] = labL;
  if (space === 3) {
    out[o + 1] = Math.hypot(labA, labB);
    out[o + 2] = Math.atan2(labB, labA);
    return;
  }
  out[o + 1] = labA;
  out[o + 2] = labB;
}

/** A palette texture-sized lookup (RGBA bytes) from a plain colour list, equally spaced, blended in sRGB. */
export function bakeColorLut(colors, size = PROC_LUT_SIZE) {
  const list = (colors && colors.length ? colors : ["#7c5cff", "#22d3ee"]).map(
    hexToRgb255,
  );
  const lut = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const t = size === 1 ? 0 : i / (size - 1);
    const at = list.length === 1 ? 0 : t * (list.length - 1);
    const k = Math.min(list.length - 2, Math.floor(at));
    const f = list.length === 1 ? 0 : at - k;
    const a = list[Math.max(0, k)],
      b = list[Math.min(list.length - 1, Math.max(0, k) + 1)];
    for (let c = 0; c < 3; c++)
      lut[i * 4 + c] = Math.round(a[c] + (b[c] - a[c]) * f);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

function lutAt(lut, t) {
  const size = lut.length >> 2;
  const i = clamp(Math.round(clamp(t, 0, 1) * (size - 1)), 0, size - 1) * 4;
  return [lut[i], lut[i + 1], lut[i + 2]];
}

/** The exponent of the CSS colour hint a mesh point writes (mesh.ts: mid = 25 + core / 2 %, printed with one decimal;
 *  no hint, i.e. a linear fade, within 0.5 % of the centre): alpha(t) = a0 · (1 − t^k), k = ln 0.5 / ln(mid). */
export function cssHintExponent(core) {
  const mid = Math.round((25 + clamp(num(core, 40), 0, 100) * 0.5) * 10) / 10;
  if (Math.abs(mid - 50) <= 0.5) return 1;
  return Math.log(0.5) / Math.log(mid / 100);
}

/* ─────────────── point generation ─────────────── */

export function pointCount(config) {
  const p = config.points || {};
  const lo = clamp(Math.round(num(p.min, 5)), 1, PROC_MAX_POINTS);
  const hi = clamp(Math.round(num(p.max, 8)), lo, PROC_MAX_POINTS);
  return clamp(
    Math.round(lo + (hi - lo) * clamp(num(p.density, 0.5), 0, 1)),
    1,
    PROC_MAX_POINTS,
  );
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
    const c = i % cols,
      r = Math.floor(i / cols);
    out.push([
      (c + 0.5 + (rng() - 0.5) * 0.3) / cols,
      (r + 0.5 + (rng() - 0.5) * 0.3) / rows,
    ]);
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
    const angle =
      offset +
      (index / Math.max(1, count)) * TAU +
      (ring ? 0 : Math.PI / Math.max(1, count));
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
    out.push([
      0.5 + Math.cos(angle) * radius + (rng() - 0.5) * 0.06,
      0.5 + Math.sin(angle) * radius + (rng() - 0.5) * 0.06,
    ]);
  }
  return out;
}
function placeCluster(n, rng) {
  const groups = clamp(Math.ceil(n / 4), 1, 4);
  const centers = [];
  for (let g = 0; g < groups; g++)
    centers.push([0.2 + rng() * 0.6, 0.2 + rng() * 0.6]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = centers[i % groups];
    const u = Math.max(1e-6, rng()),
      v = rng();
    const radius = Math.sqrt(-2 * Math.log(u)) * 0.09;
    out.push([
      c[0] + Math.cos(v * TAU) * radius,
      c[1] + Math.sin(v * TAU) * radius,
    ]);
  }
  return out;
}
const PLACERS = {
  random: placeRandom,
  grid: placeGrid,
  circular: placeCircular,
  organic: placeOrganic,
  cluster: placeCluster,
};

/** Pushes points apart until no pair is closer than the wanted separation (a few passes; deterministic). */
function relax(points, spacing) {
  const n = points.length;
  const minDistance = (clamp(spacing, 0, 1) * 0.9) / Math.sqrt(Math.max(1, n));
  if (minDistance <= 0 || n < 2) return;
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = points[j][0] - points[i][0],
          dy = points[j][1] - points[i][1];
        let d = Math.hypot(dx, dy);
        if (d >= minDistance) continue;
        if (d < 1e-6) {
          dx = Math.cos(i * 2.399);
          dy = Math.sin(i * 2.399);
          d = 1;
        }
        const push =
          (minDistance -
            Math.hypot(
              points[j][0] - points[i][0],
              points[j][1] - points[i][1],
            )) *
          0.5;
        const ux = dx / d,
          uy = dy / d;
        points[i][0] -= ux * push;
        points[i][1] -= uy * push;
        points[j][0] += ux * push;
        points[j][1] += uy * push;
      }
    }
  }
}

/**
 * Deterministic colour centres. Same config + same palette = same points, always.
 * Each record carries every per-point property: position, colour, radius, influence, weight, motion and response.
 * Anchors that come from a mesh (they carry `size`) are EXACT: no per-point variation of radius / weight / influence.
 * @param {object} config a normalised ProceduralConfig
 * @param {Uint8Array|null} lut the layer's palette LUT (RGBA bytes); used when color.source is 'layer'
 */
export function generatePoints(config, lut) {
  const pc = config.points;
  const cc = config.color;
  const mc = config.motion;
  const anchors = Array.isArray(config.anchors)
    ? config.anchors.slice(0, PROC_MAX_MESH_POINTS)
    : [];
  const count = Math.min(
    PROC_MAX_MESH_POINTS,
    pinnedOnly(config)
      ? anchors.length
      : Math.max(pointCount(config), anchors.length),
  );
  const rng = createRng(config.seed);

  const placed = (PLACERS[pc.distribution] || placeOrganic)(count, rng);
  relax(placed, num(pc.spacing, 0.35));
  const spread = num(pc.spread, 0.9);

  const order = Array.from({ length: count }, (_, i) => i);
  if (cc.shuffle) {
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const swap = order[i];
      order[i] = order[j];
      order[j] = swap;
    }
  }
  const paletteLut =
    cc.source === "layer" && lut && lut.length >= 8
      ? lut
      : bakeColorLut(cc.colors);

  const variance = clamp(num(pc.variance, 0.35), 0, 1);
  const randomness = clamp(num(mc.randomness, 0.4), 0, 1);
  const globalPhase = (num(mc.phase, 0) / 360) * TAU;
  const groups = Math.round(clamp(num(mc.groups, 0), 0, 6));
  const sync = clamp(num(mc.sync, 0), 0, 1);
  const delaySec = clamp(num(mc.delay, 0), 0, 10);
  // animation groups draw their own random numbers from separate generators, so the main sequence (and every old project) is untouched
  const groupTable = [];
  for (let g = 0; g < groups; g++) {
    const grng = createRng(num(config.seed, 1) * 31 + 1009 * (g + 1));
    groupTable.push({
      pick: MOTION_POOL[Math.floor(grng() * MOTION_POOL.length)],
      speed: 1 + (grng() * 2 - 1) * randomness * 0.6,
      phase: grng() * TAU * (0.25 + 0.75 * randomness),
      amp: 1 + (grng() * 2 - 1) * randomness * 0.5,
      freq: 1 + (grng() * 2 - 1) * randomness * 0.3,
      seed: Math.floor(grng() * 1e9),
    });
  }
  /** group membership, synchronisation and start delay, applied on top of a point's own random motion */
  const share = (motionRec, index, total) => {
    let order = total > 1 ? index / (total - 1) : 0;
    if (groups > 0) {
      const g = index % groups;
      const gm = groupTable[g];
      if (mc.mixed) motionRec.type = gm.pick;
      motionRec.speed = num(mc.speed, 0.6) * gm.speed;
      motionRec.phase = gm.phase + globalPhase;
      motionRec.amplitude = num(mc.amplitude, 0.1) * gm.amp;
      motionRec.frequency = num(mc.frequency, 1) * gm.freq;
      motionRec.seed = gm.seed;
      order = groups > 1 ? g / (groups - 1) : 0;
    }
    if (sync > 0) {
      const toward = (value, target) => target + (value - target) * (1 - sync);
      motionRec.speed = toward(motionRec.speed, num(mc.speed, 0.6));
      motionRec.phase = toward(motionRec.phase, globalPhase);
      motionRec.amplitude = toward(motionRec.amplitude, num(mc.amplitude, 0.1));
      motionRec.frequency = toward(motionRec.frequency, num(mc.frequency, 1));
    }
    motionRec.delay = delaySec * order;
  };
  const points = [];
  for (let i = 0; i < count; i++) {
    const anchor = anchors[i];
    const exact = !!anchor && anchor.size !== undefined;
    const rv = exact ? 1 : 1 + (rng() * 2 - 1) * variance * 0.6;
    const wv = exact ? 1 : 1 + (rng() * 2 - 1) * variance * 0.5;
    const iv = exact ? 1 : 1 + (rng() * 2 - 1) * variance * 0.4;
    if (exact) {
      rng();
      rng();
      rng();
    }
    const tJitter =
      (rng() * 2 - 1) * clamp(num(cc.variance, 0.15), 0, 1) * 0.25;
    const poolPick = MOTION_POOL[Math.floor(rng() * MOTION_POOL.length)];
    const speedJitter = 1 + (rng() * 2 - 1) * randomness * 0.6;
    const phase = rng() * TAU * (0.25 + 0.75 * randomness);
    const ampJitter = 1 + (rng() * 2 - 1) * randomness * 0.5;
    const freqJitter = 1 + (rng() * 2 - 1) * randomness * 0.3;
    const responseJitter = 1 + (rng() * 2 - 1) * 0.3 * randomness;
    const seed = Math.floor(rng() * 1e9);

    const t = clamp(
      (count === 1 ? 0.5 : order[i] / (count - 1)) + tJitter,
      0,
      1,
    );
    const color = anchor ? hexToRgb255(anchor.color) : lutAt(paletteLut, t);
    const inf = config.influence || {};
    const point = {
      shape:
        anchor && anchor.shape !== undefined
          ? anchor.shape
          : inf.shape || "circle",
      /** degrees; the shader gets radians */
      rotation:
        anchor && anchor.rotation !== undefined
          ? anchor.rotation
          : num(inf.rotation, 0),
      anisotropy:
        anchor && anchor.anisotropy !== undefined
          ? anchor.anisotropy
          : num(inf.anisotropy, 1),
      inner:
        anchor && anchor.inner !== undefined ? anchor.inner : num(inf.inner, 0),
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
    };
    share(point.motion, i, count);
    if (exact) {
      // a mesh point keeps its own alpha / core / size; the field's `points.influence` and `points.weight` do not rescale it
      point.size = anchor.size;
      point.alpha =
        anchor.alpha !== undefined ? anchor.alpha : clamp(anchor.weight, 0, 1);
      if (anchor.core !== undefined) point.core = anchor.core;
      point.influence = 1;
      point.weight = anchor.weight;
    }
    points.push(point);
  }
  // extra fields: their centres follow the primary ones, tagged with the field they belong to (1…3)
  activeFieldLayers(config).forEach((layer, index) => {
    const n = layerPointCount(layer);
    const lrng = createRng(num(config.seed, 1) + 7919 * (index + 1));
    const lplaced = (PLACERS[layer.distribution] || placeOrganic)(n, lrng);
    relax(lplaced, 0.3);
    const lspread = num(layer.spread, 0.8);
    const colors =
      Array.isArray(layer.colors) && layer.colors.length
        ? layer.colors
        : ["#ffffff"];
    for (let i = 0; i < n; i++) {
      const phase = lrng() * TAU * (0.25 + 0.75 * randomness);
      const speedJitter = 1 + (lrng() * 2 - 1) * randomness * 0.6;
      const ampJitter = 1 + (lrng() * 2 - 1) * randomness * 0.5;
      const rv = 1 + (lrng() * 2 - 1) * variance * 0.4;
      const layerPoint = {
        field: index + 1,
        shape: "circle",
        rotation: 0,
        anisotropy: 1,
        inner: 0,
        x: 0.5 + (lplaced[i][0] - 0.5) * lspread,
        y: 0.5 + (lplaced[i][1] - 0.5) * lspread,
        color: hexToRgb255(colors[i % colors.length]),
        t: -2,
        radius: num(layer.pointRadius, 0.22) * rv,
        influence: 1,
        weight: 1,
        motion: {
          type: mc.mixed
            ? MOTION_POOL[Math.floor(lrng() * MOTION_POOL.length)]
            : mc.type,
          speed: num(mc.speed, 0.6) * speedJitter,
          phase: phase + globalPhase,
          amplitude: num(mc.amplitude, 0.1) * ampJitter,
          frequency: num(mc.frequency, 1),
          seed: Math.floor(lrng() * 1e9),
        },
        response: 1,
      };
      share(layerPoint.motion, i, n);
      points.push(layerPoint);
    }
  });
  return points;
}

/* ─────────────── motion ─────────────── */

/**
 * Closed-form position of a point at motion time `time` (seconds, already scaled by speed / direction).
 * Static, orbit, circle, figure-8, sine, drift, noise and wander are pure functions of time, so they are exactly
 * frame-rate independent. `flow` and `follow` need state and live in createProceduralState().
 */
function rawMotion(point, time, motion) {
  const m = point.motion;
  const hx = point.x,
    hy = point.y;
  const dir = motion.direction < 0 ? -1 : 1;
  const w = TAU * 0.12 * m.speed * m.frequency;
  const theta = w * time * dir + m.phase;
  const smoothness = clamp(num(motion.smoothness, 0.6), 0, 1);
  const amp = m.amplitude;
  let x = hx,
    y = hy;
  switch (m.type) {
    case "orbit": {
      const a = theta * 0.5 - m.phase * 0.5;
      const c = Math.cos(a),
        s = Math.sin(a);
      const dx = hx - 0.5,
        dy = hy - 0.5;
      const breathe = 1 + amp * 2 * Math.sin(theta);
      x = 0.5 + (c * dx - s * dy) * breathe;
      y = 0.5 + (s * dx + c * dy) * breathe;
      break;
    }
    case "circle":
      x = hx + amp * Math.cos(theta);
      y = hy + amp * Math.sin(theta);
      break;
    case "figure8":
      x = hx + amp * 1.3 * Math.sin(theta);
      y = hy + amp * 0.65 * Math.sin(2 * theta);
      break;
    case "sine": {
      const a = (m.seed % 6283) / 1000;
      const ax = Math.cos(a),
        ay = Math.sin(a);
      const along = amp * 1.4 * Math.sin(theta * 0.6);
      const across = amp * 0.4 * Math.sin(theta * 1.7 + m.phase);
      x = hx + ax * along - ay * across;
      y = hy + ay * along + ax * across;
      break;
    }
    case "drift": {
      const h2 = 0.5 * (1 - smoothness);
      x =
        hx +
        (amp *
          (Math.sin(theta * 0.7) +
            h2 * Math.sin(theta * 1.9 + m.phase * 2.3))) /
          (1 + h2);
      y =
        hy +
        (amp *
          (Math.cos(theta * 0.8 + m.phase) +
            h2 * Math.cos(theta * 2.1 + m.phase * 1.7))) /
          (1 + h2);
      break;
    }
    case "noise": {
      const rate = w * (1.4 - smoothness) * 0.8 * dir;
      x = hx + amp * 1.6 * noise1(time * rate, m.seed);
      y = hy + amp * 1.6 * noise1(time * rate + 37.1, m.seed + 101);
      break;
    }
    case "wander":
    case "elastic":
    case "spring": {
      // travel between random targets: wander and elastic follow an easing curve, spring a damped-spring step response
      const rate =
        (0.15 + 0.5 * (1 - smoothness)) * m.speed * m.frequency * dir;
      const at = time * rate;
      const k = Math.floor(at);
      const f = at - k;
      const e =
        m.type === "spring"
          ? springStep(f, num(motion.damping, 0.5))
          : easeValue(motion, m.type, f);
      const rx = (index) => ihash(m.seed + index * 7919) * 2 - 1;
      const ry = (index) => ihash(m.seed + 13 + index * 104729) * 2 - 1;
      x = hx + amp * 1.6 * (rx(k) + (rx(k + 1) - rx(k)) * e);
      y = hy + amp * 1.6 * (ry(k) + (ry(k + 1) - ry(k)) * e);
      break;
    }
    case "float": {
      // organic floating: three slow, incommensurate sines per axis, a gentle buoyant bob, a faint high harmonic when not smooth
      const s0 = (m.seed % 6283) / 1000;
      const h3 = 0.25 * (1 - smoothness);
      x =
        hx +
        amp *
          (0.7 * Math.sin(theta * 0.31 + s0) +
            0.25 * Math.sin(theta * 0.73 + s0 * 2.1 + 1.3) +
            h3 * Math.sin(theta * 1.37 + s0 * 0.6));
      y =
        hy +
        amp *
          (0.55 * Math.sin(theta * 0.43 + s0 * 1.7 + 0.8) +
            0.3 * Math.sin(theta * 0.97 + s0 * 0.4) +
            0.35 * Math.sin(theta * 0.5 + s0) +
            h3 * Math.sin(theta * 1.61 + s0 * 2.9));
      break;
    }
    case "magnetic": {
      // a virtual magnet wanders on a Lissajous path shared by every point; points near it are drawn toward it
      const ms = num(motion.speed, m.speed) * num(motion.frequency, 1);
      const wm = TAU * 0.07 * ms * time * dir;
      const mx = 0.5 + 0.32 * Math.sin(wm) + 0.1 * Math.sin(wm * 2.3 + 1);
      const my =
        0.5 + 0.28 * Math.sin(wm * 1.31 + 0.7) + 0.08 * Math.sin(wm * 3.1);
      const dx = mx - hx,
        dy = my - hy;
      const k = clamp(amp * 5 * Math.exp(-(dx * dx + dy * dy) * 8), 0, 0.85);
      x = hx + dx * k + amp * 0.15 * Math.sin(theta * 1.3);
      y = hy + dy * k + amp * 0.15 * Math.cos(theta * 1.1);
      break;
    }
    default:
      break;
  }
  return [x, y];
}

/** Closed-form step response of a damped spring over one travel segment (f = 0…1). `damping` 0 = bouncy … 1 = no overshoot.
 *  The natural frequency is chosen so the oscillation has died out by the end of the segment, then a short blend lands exactly on 1. */
export function springStep(f, damping) {
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  const zeta = clamp(0.18 + 0.8 * clamp(num(damping, 0.5), 0, 1), 0.18, 0.98);
  const omega = Math.max(10, 4.8 / zeta);
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const e =
    1 -
    Math.exp(-zeta * omega * f) *
      (Math.cos(wd * f) + ((zeta * omega) / wd) * Math.sin(wd * f));
  return e + (1 - e) * smooth((f - 0.92) / 0.08);
}

/**
 * Position of a point at motion time `time` (seconds). With `motion.loop` > 0 the motion repeats every `loop` seconds: the last
 * 20 % of the loop cross-fades into the start, so the seam is invisible for every motion type that is a pure function of time.
 * `point.motion.delay` holds the point back and eases it in; `motion.influence` scales the whole excursion.
 */
export function motionPosition(point, time, motion) {
  const hx = point.x,
    hy = point.y;
  const loop = num(motion.loop, 0);
  let pos;
  if (loop > 0.05) {
    const t = ((time % loop) + loop) % loop;
    const span = loop * 0.2;
    pos = rawMotion(point, t, motion);
    if (t > loop - span) {
      const a = smooth((t - (loop - span)) / span);
      const wrap = rawMotion(point, t - loop, motion);
      pos = [pos[0] + (wrap[0] - pos[0]) * a, pos[1] + (wrap[1] - pos[1]) * a];
    }
  } else {
    pos = rawMotion(point, time, motion);
  }
  let influence = clamp(num(motion.influence, 1), 0, 1);
  const delay = num(point.motion.delay, 0);
  if (delay > 0) influence *= smooth((time - delay) / 1.5);
  return [hx + (pos[0] - hx) * influence, hy + (pos[1] - hy) * influence];
}

/* ─────────────── interaction forces ─────────────── */

const FALLOFF = {
  soft: (q) => 1 - smooth(q),
  linear: (q) => 1 - q,
  sharp: (q) => Math.pow(1 - smooth(q), 2.4),
  gaussian: (q) => Math.exp(-4.5 * q * q),
};

/**
 * Displacement (in aspect-corrected canvas-height units) a pointer source applies to a point.
 * (dx, dy) = point − pointer, w = falloff × strength, (vx, vy) = pointer velocity.
 */
export function forceDisplacement(type, dx, dy, dist, w, vx, vy, clock) {
  const ux = dx / dist,
    uy = dy / dist;
  switch (type) {
    case "attract":
      return [-ux * w * 0.25, -uy * w * 0.25];
    case "repel":
      return [ux * w * 0.25, uy * w * 0.25];
    case "swirl":
      return [-uy * w * 0.25, ux * w * 0.25];
    case "vortex":
      return [
        (-uy * 0.8 - ux * 0.35) * w * 0.25,
        (ux * 0.8 - uy * 0.35) * w * 0.25,
      ];
    case "push":
      return [vx * w * 0.6, vy * w * 0.6];
    case "pull":
      return [-vx * w * 0.6, -vy * w * 0.6];
    case "ripple": {
      const r = Math.sin(dist * 18 - clock * 4) * w * 0.12;
      return [ux * r, uy * r];
    }
    case "wave": {
      const r = Math.sin(dist * 14 - clock * 3) * w * 0.12;
      return [-uy * r, ux * r];
    }
    case "fluid":
      return [vx * w * 0.8 - uy * w * 0.06, vy * w * 0.8 + ux * w * 0.06];
    case "magnetic": {
      // pulls hardest close to the pointer, with a slight sideways turn like field lines bending around a pole
      const pull = w * 0.2 * (1 + 4 * Math.exp(-dist * dist * 60));
      return [-ux * pull - uy * w * 0.05, -uy * pull + ux * w * 0.05];
    }
    case "drag":
      return [vx * w * 0.5 - ux * w * 0.1, vy * w * 0.5 - uy * w * 0.1];
    case "disturb": {
      const r = w * 0.12;
      return [
        Math.sin(dy * 41 + clock * 3.1 + dx * 13) * r,
        Math.cos(dx * 37 - clock * 2.7 + dy * 11) * r,
      ];
    }
    default:
      return [0, 0];
  }
}

/* ─────────────── exact RBF interpolation (CPU) ─────────────── */

/** Kernel shape parameter for an RBF method, from the field's falloff (0 soft … 1 sharp). The shader receives the same number. */
export function rbfKernelParameter(method, falloff) {
  const f = clamp(num(falloff, 0.45), 0, 1);
  if (method === "rbf-gaussian") return 0.5 + 2 * f;
  if (method === "rbf-multiquadric") return 0.5 + 2.5 * f;
  if (method === "harmonic") return 0.6 - 0.52 * f;
  return 0;
}

/** φ(x) with x = distance / scale. Mirrors the GLSL in glsl.ts exactly. */
export function rbfKernel(method, x, k) {
  switch (method) {
    case "rbf-gaussian":
      return Math.exp(-(k * x) * (k * x));
    case "rbf-multiquadric":
      return Math.sqrt(1 + k * k * x * x);
    case "thin-plate":
      return x > 0.0001 ? x * x * Math.log(x) : 0;
    case "harmonic":
      return 0.5 * Math.log(x * x + k * k);
    default:
      return 0;
  }
}

/** Polynomial terms appended to the system: 1 = a constant (conditionally positive definite kernels need it), 3 = constant + affine. */
const rbfPolyTerms = (method) => (method === "thin-plate" ? 3 : 1);

/** Smoothing: 0 interpolates every colour exactly, 1 is a heavily regularised (very smooth) fit. */
export function rbfRegularization(softness) {
  const s = clamp(num(softness, 0.5), 0, 1);
  return 2e-4 + s * s * 0.25;
}

/**
 * Solves  [Φ + λI  P; Pᵀ 0] [c; d] = [Y; 0]  for the three colour channels at once (Gaussian elimination, partial pivoting).
 * A global solve is the one thing that must not run per pixel, so it runs here, once per animation frame, for ≤ 128 centres
 * (about 0.7 M multiply-adds at the maximum). The shader then evaluates  Σ cⱼ φ(‖x − xⱼ‖ / scale) + P(x)  per fragment.
 * Returns false (and zeroes the output) when the system is degenerate, in which case the field is a flat colour.
 * @param {number[]} px point x in aspect-corrected units
 * @param {number[]} py point y
 * @param {Float32Array|number[]} colors rgb triplets at stride 4 (the encoded colours)
 * @param {{ method: string, scale: number, k: number, lambda: number }} options
 * @param {Float32Array} coef out: n × vec4 (c_r, c_g, c_b, 0)
 * @param {Float32Array} poly out: 3 × vec4 (constant, x term, y term; unused terms are 0)
 */
export function solveRbf(px, py, colors, options, coef, poly) {
  const n = px.length;
  coef.fill(0);
  poly.fill(0);
  if (n === 0) return true;
  const m = rbfPolyTerms(options.method);
  const size = n + m;
  const A = new Float64Array(size * size);
  const Y = new Float64Array(size * 3);
  const scale = Math.max(1e-4, options.scale);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const r = Math.hypot(px[i] - px[j], py[i] - py[j]) / scale;
      A[i * size + j] = rbfKernel(options.method, r, options.k);
    }
    A[i * size + i] += options.lambda;
    A[i * size + n] = 1;
    A[n * size + i] = 1;
    if (m === 3) {
      A[i * size + n + 1] = px[i];
      A[(n + 1) * size + i] = px[i];
      A[i * size + n + 2] = py[i];
      A[(n + 2) * size + i] = py[i];
    }
    Y[i * 3] = colors[i * 4];
    Y[i * 3 + 1] = colors[i * 4 + 1];
    Y[i * 3 + 2] = colors[i * 4 + 2];
  }
  // a tiny diagonal on the polynomial block keeps the elimination finite when every point is collinear
  for (let t = 0; t < m; t++) A[(n + t) * size + n + t] -= 1e-9;
  for (let col = 0; col < size; col++) {
    let best = col;
    let bestValue = Math.abs(A[col * size + col]);
    for (let row = col + 1; row < size; row++) {
      const v = Math.abs(A[row * size + col]);
      if (v > bestValue) {
        bestValue = v;
        best = row;
      }
    }
    if (bestValue < 1e-14) {
      coef.fill(0);
      poly.fill(0);
      return false;
    }
    if (best !== col) {
      for (let k = 0; k < size; k++) {
        const t = A[col * size + k];
        A[col * size + k] = A[best * size + k];
        A[best * size + k] = t;
      }
      for (let c = 0; c < 3; c++) {
        const t = Y[col * 3 + c];
        Y[col * 3 + c] = Y[best * 3 + c];
        Y[best * 3 + c] = t;
      }
    }
    const pivot = A[col * size + col];
    for (let row = col + 1; row < size; row++) {
      const factor = A[row * size + col] / pivot;
      if (factor === 0) continue;
      for (let k = col; k < size; k++)
        A[row * size + k] -= factor * A[col * size + k];
      for (let c = 0; c < 3; c++) Y[row * 3 + c] -= factor * Y[col * 3 + c];
    }
  }
  const X = new Float64Array(size * 3);
  for (let c = 0; c < 3; c++) {
    for (let row = size - 1; row >= 0; row--) {
      let sum = Y[row * 3 + c];
      for (let k = row + 1; k < size; k++)
        sum -= A[row * size + k] * X[k * 3 + c];
      X[row * 3 + c] = sum / A[row * size + row];
    }
  }
  for (let i = 0; i < size * 3; i++) {
    if (!Number.isFinite(X[i])) {
      coef.fill(0);
      poly.fill(0);
      return false;
    }
  }
  for (let i = 0; i < n; i++) {
    coef[i * 4] = X[i * 3];
    coef[i * 4 + 1] = X[i * 3 + 1];
    coef[i * 4 + 2] = X[i * 3 + 2];
  }
  for (let t = 0; t < m; t++) {
    poly[t * 4] = X[(n + t) * 3];
    poly[t * 4 + 1] = X[(n + t) * 3 + 1];
    poly[t * 4 + 2] = X[(n + t) * 3 + 2];
  }
  return true;
}

/** Evaluates the solved interpolant at (x, y) in the same units the solver used. Used by tests and by tooling, never per frame. */
export function evaluateRbf(method, px, py, coef, poly, scale, k, x, y) {
  let r = poly[0],
    g = poly[1],
    b = poly[2];
  r += poly[4] * x + poly[8] * y;
  g += poly[5] * x + poly[9] * y;
  b += poly[6] * x + poly[10] * y;
  for (let i = 0; i < px.length; i++) {
    const phi = rbfKernel(
      method,
      Math.hypot(x - px[i], y - py[i]) / Math.max(1e-4, scale),
      k,
    );
    r += coef[i * 4] * phi;
    g += coef[i * 4 + 1] * phi;
    b += coef[i * 4 + 2] * phi;
  }
  return [r, g, b];
}

/* ─────────────── animated state ─────────────── */

function createBuffers(capacity) {
  return {
    points: new Float32Array(capacity * 4),
    colors: new Float32Array(capacity * 4),
    a: new Float32Array(4),
    b: new Float32Array(4),
    c: new Float32Array(4),
    grade: new Float32Array(4),
    d: new Float32Array(4),
    base: new Float32Array(4),
    e: new Float32Array(4),
    warpA: new Float32Array(PROC_MAX_STAGES * 4),
    warpB: new Float32Array(PROC_MAX_STAGES * 4),
    warpC: new Float32Array(PROC_MAX_STAGES * 4),
    /** f: hue direction, chroma preservation, global influence, core intensity */
    f: new Float32Array(4),
    /** g: custom-weighted kernel mix (gaussian, compact, inverse) */
    g: new Float32Array(4),
    /** h: RBF scale (aspect-corrected height units), RBF kernel parameter */
    h: new Float32Array(4),
    /** capacity × vec4: shape id, rotation (rad), anisotropy, inner radius fraction */
    shape: new Float32Array(capacity * 4),
    /** capacity × vec4: RBF coefficients per colour channel (re-solved whenever points or colours move) */
    rbf: new Float32Array(capacity * 4),
    /** 3 × vec4: RBF polynomial terms (constant, x, y) */
    rbfP: new Float32Array(12),
    /** 2 × vec4: the per-channel range an exact RBF fit may reach (the palette's range plus a margin), min then max */
    rbfR: new Float32Array(8),
    /** extra fields, 3 × vec4 each: A = first centre, centre count, kernel, blend · B = radius, strength, falloff, opacity · C = distort flag */
    fieldA: new Float32Array(12),
    fieldB: new Float32Array(12),
    fieldC: new Float32Array(12),
    /** material stage, 4 × vec4 */
    m0: new Float32Array(4),
    m1: new Float32Array(4),
    m2: new Float32Array(4),
    m3: new Float32Array(4),
    count: 0,
    capacity,
  };
}

/** Saturation scale about the luma, then a hue rotation about the grey axis (the SVG hueRotate matrix). rgb in 0–255. */
function gradeRgb(rgb, sat, hueDeg) {
  const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const r = l + (rgb[0] - l) * sat,
    g = l + (rgb[1] - l) * sat,
    b = l + (rgb[2] - l) * sat;
  const a = (hueDeg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const out = [
    r * (0.213 + c * 0.787 - s * 0.213) +
      g * (0.715 - c * 0.715 - s * 0.715) +
      b * (0.072 - c * 0.072 + s * 0.928),
    r * (0.213 - c * 0.213 + s * 0.143) +
      g * (0.715 + c * 0.285 + s * 0.14) +
      b * (0.072 - c * 0.072 - s * 0.283),
    r * (0.213 - c * 0.213 - s * 0.787) +
      g * (0.715 - c * 0.715 + s * 0.715) +
      b * (0.072 + c * 0.928 + s * 0.072),
  ];
  return [clamp(out[0], 0, 255), clamp(out[1], 0, 255), clamp(out[2], 0, 255)];
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
  let paletteTime = 0;
  let clock = 0;
  let acc = 0;
  let settling = false;
  let maxIw = 0;
  let dyn = [];
  let lastAspect = 1.5;
  const buffers = createBuffers(proceduralCapacity(initial));

  const meshOf = () => config.mesh || {};
  const isCss = () => meshOf().render === "css-compatible";

  const resetDynamic = () => {
    dyn = points.map((point) => ({
      ix: 0,
      iy: 0,
      fx: point.x,
      fy: point.y,
      px: point.x,
      py: point.y,
      iw: 0,
    }));
  };

  /** the buffers follow the config's tier; the renderer rebuilds the shader when the tier (its signature) changes */
  const fitCapacity = () => {
    const wanted = proceduralCapacity(config);
    if (wanted === buffers.capacity) return;
    buffers.capacity = wanted;
    buffers.points = new Float32Array(wanted * 4);
    buffers.colors = new Float32Array(wanted * 4);
    buffers.shape = new Float32Array(wanted * 4);
    buffers.rbf = new Float32Array(wanted * 4);
  };

  const primaryCountOf = () =>
    points.reduce((n, p) => n + (p.field ? 0 : 1), 0);
  const isRbf = () => !isCss() && !!RBF_METHODS[config.field.method];
  /** The space the colours are encoded in. An exact-RBF fit interpolates numbers, not angles, so OKLCH falls back to OKLab there. */
  const encodingSpace = () => {
    if (isCss()) return 0;
    const space = SPACE_INDEX[config.color.interpolation] || 0;
    return space === 3 && isRbf() ? 2 : space;
  };

  const packStatic = () => {
    const css = isCss();
    const space = encodingSpace();
    const on = config.enabled && points.length > 0;
    buffers.a[0] = on ? MODE_INDEX[config.mode] || 2 : 0;
    const primaryN = primaryCountOf();
    buffers.a[1] = on ? primaryN : 0;
    buffers.a[2] = METHOD_INDEX[config.field.method] || 0;
    buffers.a[3] = clamp(num(config.mix, 1), 0, 1);
    buffers.b[0] = config.field.radius;
    buffers.b[1] = config.field.strength;
    buffers.b[2] = config.field.falloff;
    buffers.b[3] = config.field.softness;
    buffers.c[0] = config.field.exponent;
    buffers.c[1] = config.field.overlap;
    buffers.c[2] = space === 3 ? 2 : space;
    buffers.c[3] = octaveCap;
    buffers.grade[0] = config.color.exposure;
    buffers.grade[1] = config.color.contrast;
    buffers.grade[2] = config.color.saturation;
    buffers.grade[3] = config.color.temperature;
    buffers.d[0] = (config.color.hue * Math.PI) / 180;
    const cc = config.color;
    const fc = config.field;
    const ic = config.influence || {};
    buffers.f[0] = HUE_DIRECTION_INDEX[cc.hueDirection] || 0;
    buffers.f[1] = clamp(num(cc.chromaPreserve, 0), 0, 1);
    buffers.f[2] = clamp(num(fc.global, 0), 0, 1);
    buffers.f[3] = clamp(num(ic.core, 0), 0, 2);
    const custom = fc.custom || {};
    buffers.g[0] = clamp(num(custom.gaussian, 0.6), 0, 1);
    buffers.g[1] = clamp(num(custom.compact, 0.3), 0, 1);
    buffers.g[2] = clamp(num(custom.inverse, 0.1), 0, 1);
    buffers.g[3] = clamp(Math.round(num(ic.sides, 6)), 3, 8);
    buffers.h[1] = rbfKernelParameter(fc.method, fc.falloff);
    buffers.h[2] = clamp(num(ic.rounding, 0.2), 0, 1);
    buffers.e[0] = on && css ? 1 : 0;
    buffers.e[1] = meshOf().composite === "layered" ? 1 : 0;
    buffers.e[2] = 1;
    buffers.e[3] = 0;
    for (let i = 0; i < PROC_MAX_STAGES; i++) {
      const stage = config.distortion[i];
      const o = i * 4;
      if (!stage || stage.type === "none") {
        buffers.warpA.fill(0, o, o + 4);
        buffers.warpB.fill(0, o, o + 4);
        buffers.warpC.fill(0, o, o + 4);
        continue;
      }
      buffers.warpA[o] = stage.enabled ? 1 : 0;
      buffers.warpA[o + 1] = stage.scale;
      buffers.warpA[o + 2] = stage.intensity;
      buffers.warpA[o + 3] = stage.frequency;
      buffers.warpB[o] = stage.octaves;
      buffers.warpB[o + 1] = stage.lacunarity;
      buffers.warpB[o + 2] = stage.persistence;
      buffers.warpB[o + 3] = stage.turbulence;
      buffers.warpC[o] = stage.speed;
      buffers.warpC[o + 1] = (stage.direction * Math.PI) / 180;
      buffers.warpC[o + 2] = stage.noise === "value" ? 1 : 0;
      buffers.warpC[o + 3] = 0;
    }
    buffers.count = on ? points.length : 0;
    buffers.fieldA.fill(0);
    buffers.fieldB.fill(0);
    buffers.fieldC.fill(0);
    let layerStart = primaryN;
    activeFieldLayers(config).forEach((layer, k) => {
      const n = layerPointCount(layer);
      buffers.fieldA[k * 4] = layerStart;
      buffers.fieldA[k * 4 + 1] = on && !css ? n : 0;
      buffers.fieldA[k * 4 + 2] = LAYER_KERNEL_INDEX[layer.kernel] || 0;
      buffers.fieldA[k * 4 + 3] = BLEND_INDEX[layer.blend] || 0;
      buffers.fieldB[k * 4] = clamp(num(layer.radius, 0.7), 0.2, 3);
      buffers.fieldB[k * 4 + 1] = clamp(num(layer.strength, 1), 0.1, 3);
      buffers.fieldB[k * 4 + 2] = clamp(num(layer.falloff, 0.5), 0, 1);
      buffers.fieldB[k * 4 + 3] = clamp(num(layer.opacity, 0.8), 0, 1);
      buffers.fieldC[k * 4] = layer.distort ? 1 : 0;
      layerStart += n;
    });
    const mc = config.material || {};
    const mr = 0.004 + clamp(num(mc.radius, 0.4), 0, 1) * 0.056;
    const ang = (num(mc.lightAngle, 135) * Math.PI) / 180;
    buffers.m0[0] = mr;
    buffers.m0[1] = num(mc.glow, 0);
    buffers.m0[2] = num(mc.bloom, 0);
    buffers.m0[3] = num(mc.bloomThreshold, 0.6);
    buffers.m1[0] = num(mc.innerGlow, 0);
    buffers.m1[1] = num(mc.edgeGlow, 0);
    buffers.m1[2] = num(mc.ambient, 0.55);
    buffers.m1[3] = num(mc.light, 0);
    buffers.m2[0] = Math.cos(ang);
    buffers.m2[1] = Math.sin(ang);
    buffers.m2[2] = clamp(num(mc.lightElevation, 0.6), 0, 1);
    buffers.m2[3] = num(mc.specular, 0);
    buffers.m3[0] = num(mc.shininess, 28);
    buffers.m3[1] = num(mc.depth, 1);
    buffers.m3[2] = num(mc.shadow, 0);
    buffers.m3[3] = num(mc.scatter, 0);
    buffers.shape.fill(0);
    for (let i = 0; i < points.length && i * 4 < buffers.shape.length; i++) {
      const p = points[i];
      buffers.shape[i * 4] = SHAPE_INDEX[p.shape] || 0;
      buffers.shape[i * 4 + 1] = (num(p.rotation, 0) * Math.PI) / 180;
      buffers.shape[i * 4 + 2] = clamp(num(p.anisotropy, 1), 0.05, 20);
      buffers.shape[i * 4 + 3] = clamp(num(p.inner, 0), 0, 0.95);
    }
  };

  const rebuild = () => {
    const before = points;
    fitCapacity();
    points = config.enabled ? generatePoints(config, lut) : [];
    const sameHomes =
      before.length === points.length &&
      before.every(
        (p, i) =>
          Math.abs(p.x - points[i].x) < 1e-9 &&
          Math.abs(p.y - points[i].y) < 1e-9,
      );
    if (!sameHomes || dyn.length !== points.length) resetDynamic();
    packStatic();
    pack(0, lastAspect);
  };

  const positions = [];
  const encoded = new Float32Array(PROC_MAX_POINTS * 3);

  /** Writes points + colours into the uniform buffers. `cycle` is the palette offset in palette-lengths. */
  function pack(cycle, aspect) {
    const css = isCss();
    const mesh = meshOf();
    const space = encodingSpace();
    const paletteLut =
      config.color.source === "layer" && lut && lut.length >= 8 ? lut : null;
    const customLut = paletteLut
      ? null
      : state.customLut ||
        (state.customLut = bakeColorLut(config.color.colors));
    const sourceLut = paletteLut || customLut;
    const ia = (config.interaction && config.interaction.affect) || {};
    const affect = {
      radius: clamp(num(ia.radius, 0), 0, 1),
      strength: clamp(num(ia.strength, 0), 0, 1),
      saturation: clamp(num(ia.saturation, 0), 0, 1),
      hue: clamp(num(ia.hue, 0), 0, 1),
    };
    buffers.points.fill(0);
    buffers.colors.fill(0);
    const baseHex = mesh.base ? mesh.base : config.field.base;
    if (css) {
      // CSS-compatible: records go bottom → top (the LAST mesh point is the bottom of the stack), colours stay sRGB, the
      // 4th colour component carries the hint exponent, and the point record carries (x, y, radius in height units, alpha)
      const n = points.length;
      const layered = mesh.composite === "layered";
      const opacity = clamp(num(mesh.opacity, 1), 0, 1);
      for (let j = 0; j < n; j++) {
        const i = n - 1 - j;
        const p = points[i];
        const at = positions[i] || [p.x, p.y];
        let rgb = p.color;
        const palettePosition =
          p.t >= 0
            ? p.t
            : cycle !== 0 && p.size !== undefined
              ? points.length === 1
                ? 0.5
                : i / (points.length - 1)
              : -1;
        if (palettePosition >= 0 && cycle !== 0)
          rgb = lutAt(sourceLut, mirror(palettePosition + cycle));
        encodeColor(rgb[0], rgb[1], rgb[2], 0, buffers.colors, j * 4);
        const core = p.core !== undefined ? p.core : num(mesh.core, 40);
        buffers.colors[j * 4 + 3] = layered ? 0 : cssHintExponent(core);
        const radius =
          p.size !== undefined
            ? (p.size / 100) * Math.max(0.1, aspect)
            : p.radius * p.influence;
        const alpha = p.alpha !== undefined ? p.alpha : clamp(p.weight, 0, 1);
        buffers.points[j * 4] = at[0];
        buffers.points[j * 4 + 1] = at[1];
        buffers.points[j * 4 + 2] = Math.max(0.0001, radius);
        buffers.points[j * 4 + 3] = clamp(alpha * opacity, 0, 1);
      }
      if (baseHex) {
        const rgb = hexToRgb255(baseHex);
        buffers.base[0] = rgb[0] / 255;
        buffers.base[1] = rgb[1] / 255;
        buffers.base[2] = rgb[2] / 255;
        buffers.base[3] = clamp(num(mesh.opacity, 1), 0, 1);
      } else {
        buffers.base[0] = 0;
        buffers.base[1] = 0;
        buffers.base[2] = 0;
        buffers.base[3] = 0;
      }
      return;
    }
    let mean0 = 0,
      mean1 = 0,
      mean2 = 0;
    const primaryN = primaryCountOf();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const at = positions[i] || [p.x, p.y];
      let rgb = p.color;
      const palettePosition =
        p.t >= 0
          ? p.t
          : cycle !== 0 && p.size !== undefined
            ? primaryN === 1
              ? 0.5
              : i / (primaryN - 1)
            : -1;
      if (palettePosition >= 0 && cycle !== 0)
        rgb = lutAt(sourceLut, mirror(palettePosition + cycle));
      const reaction = dyn[i] ? clamp(dyn[i].iw, 0, 1.5) : 0;
      if (reaction > 1e-4 && (affect.saturation > 0 || affect.hue > 0))
        rgb = gradeRgb(
          rgb,
          1 + affect.saturation * reaction * 1.2,
          affect.hue * reaction * 50,
        );
      // an extra field's colours are never OKLCH-encoded (they blend as plain OKLab), and the 4th component carries the
      // chroma the OKLab chroma-preservation pass averages
      const encSpace = p.field && space === 3 ? 2 : space;
      encodeColor(rgb[0], rgb[1], rgb[2], encSpace, buffers.colors, i * 4);
      if (encSpace === 2)
        buffers.colors[i * 4 + 3] = Math.hypot(
          buffers.colors[i * 4 + 1],
          buffers.colors[i * 4 + 2],
        );
      buffers.points[i * 4] = at[0];
      buffers.points[i * 4 + 1] = at[1];
      // mesh anchors size the field exactly like the CSS mesh does: size % of the canvas width, in canvas-height units
      const radius =
        p.size !== undefined
          ? (p.size / 100) * Math.max(0.1, aspect)
          : p.radius * p.influence;
      buffers.points[i * 4 + 2] = Math.max(
        0.01,
        radius * (1 + affect.radius * 1.2 * reaction),
      );
      buffers.points[i * 4 + 3] =
        p.weight * (1 + affect.strength * 1.5 * reaction);
      if (p.field) continue;
      if (space === 3) {
        // (L, C, h): average in OKLab so the base colour is a real colour, not a mean of angles
        mean0 += buffers.colors[i * 4];
        mean1 +=
          buffers.colors[i * 4 + 1] * Math.cos(buffers.colors[i * 4 + 2]);
        mean2 +=
          buffers.colors[i * 4 + 1] * Math.sin(buffers.colors[i * 4 + 2]);
      } else {
        mean0 += buffers.colors[i * 4];
        mean1 += buffers.colors[i * 4 + 1];
        mean2 += buffers.colors[i * 4 + 2];
      }
    }
    if (space === 3) {
      // OKLCH: re-pack each primary colour as the shader accumulates it (see glsl.ts procLchResolve)
      const direction = HUE_DIRECTION_INDEX[config.color.hueDirection] || 0;
      const reference = primaryN > 0 ? buffers.colors[2] : 0;
      buffers.h[3] = reference;
      for (let i = 0; i < primaryN; i++) {
        const chroma = buffers.colors[i * 4 + 1];
        const hue = buffers.colors[i * 4 + 2];
        if (direction === 0) {
          // shorter arc = a chroma-weighted vector mean of the hue; a near-grey colour has no real hue and barely votes
          const vote = clamp(chroma / 0.04, 0, 1);
          buffers.colors[i * 4 + 2] = vote * Math.cos(hue);
          buffers.colors[i * 4 + 3] = vote * Math.sin(hue);
        } else {
          buffers.colors[i * 4 + 2] =
            chroma < 0.01 ? 0 : hueDelta(hue, reference, direction);
          buffers.colors[i * 4 + 3] = 0;
        }
      }
    }
    const n = Math.max(1, primaryN);
    if (baseHex) {
      const rgb = hexToRgb255(baseHex);
      encodeColor(rgb[0], rgb[1], rgb[2], space === 3 ? 2 : space, encoded, 0);
      buffers.base[0] = encoded[0];
      buffers.base[1] = encoded[1];
      buffers.base[2] = encoded[2];
    } else {
      buffers.base[0] = mean0 / n;
      buffers.base[1] = mean1 / n;
      buffers.base[2] = mean2 / n;
    }
    buffers.base[3] = 1;
    if (isRbf() && primaryN > 0) solveCurrentRbf(aspect, primaryN);
    else buffers.rbf.fill(0);
  }

  /** Re-solves the exact-RBF coefficients from the animated positions and the current (possibly palette-cycled) colours. */
  function solveCurrentRbf(aspect, count) {
    const n = count;
    const asp = Math.max(0.1, aspect || 1);
    const px = new Array(n);
    const py = new Array(n);
    let meanRadius = 0;
    for (let i = 0; i < n; i++) {
      px[i] = buffers.points[i * 4] * asp;
      py[i] = buffers.points[i * 4 + 1];
      meanRadius += buffers.points[i * 4 + 2];
    }
    meanRadius = meanRadius / Math.max(1, n);
    const scale = Math.max(
      0.02,
      meanRadius * Math.max(0.2, num(config.field.radius, 1)),
    );
    buffers.h[0] = scale;
    // an exact fit rings and runs away outside the points (a multiquadric grows linearly, a thin plate worse): keep the result
    // inside the palette's own range plus a 12 % margin, which still passes exactly through every colour
    for (let c = 0; c < 3; c++) {
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const v = buffers.colors[i * 4 + c];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const margin = Math.max(0.02, (hi - lo) * 0.12);
      buffers.rbfR[c] = lo - margin;
      buffers.rbfR[4 + c] = hi + margin;
    }
    solveRbf(
      px,
      py,
      buffers.colors,
      {
        method: config.field.method,
        scale,
        k: buffers.h[1],
        lambda: rbfRegularization(config.field.softness),
      },
      buffers.rbf,
      buffers.rbfP,
    );
  }

  const state = {
    buffers,
    customLut: null,
    getConfig: () => config,
    getPoints: () => points,
    /** the loop size the shader needs for this config (a tier) */
    getCapacity: () => buffers.capacity,
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
      if (config.color.source === "layer") rebuild();
    },
    /** performance hook: the most octaves any distortion stage may use (lowered when the frame rate drops) */
    setQuality(quality) {
      const cap = clamp(Math.round(num(quality && quality.octaveCap, 6)), 1, 6);
      if (cap !== octaveCap) {
        octaveCap = cap;
        buffers.c[3] = cap;
      }
    },
    /** true while the points are still moving on their own (so the renderer must keep drawing frames) */
    isAnimated() {
      if (!config.enabled) return false;
      const m = config.motion;
      const moves =
        m.influence > 0 && m.speed > 0 && (m.mixed || m.type !== "static");
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
      if (!config.enabled || !points.length) {
        buffers.a[0] = 0;
        buffers.e[0] = 0;
        settling = false;
        return buffers;
      }
      buffers.a[0] = MODE_INDEX[config.mode] || 2;
      buffers.e[0] = isCss() ? 1 : 0;
      const dtMotion = Math.max(0, dt) * Math.max(0, motionScale);
      const aff = (config.interaction && config.interaction.affect) || {};
      time +=
        dtMotion *
        (1 + clamp(num(aff.speed, 0), 0, 1) * 2 * maxIw) *
        (config.motion.speed > 0 ? 1 : 0);
      paletteTime += dtMotion;
      buffers.d[1] = time;
      clock += Math.max(0, dt);
      const m = config.motion;
      const ic = config.interaction;
      const falloff = FALLOFF[ic.falloff] || FALLOFF.soft;
      const pointer = frame || {
        x: 0.5,
        y: 0.5,
        vx: 0,
        vy: 0,
        active: 0,
        down: 0,
        t2x: 0.5,
        t2y: 0.5,
        t2active: 0,
      };
      const asp = Math.max(0.1, aspect || 1);
      lastAspect = asp;
      const forcesOn = ic.force !== "none" && ic.strength > 0;
      const sources = [
        {
          x: pointer.x,
          y: pointer.y,
          a: num(pointer.active, 0),
          vx: clamp(num(pointer.vx, 0), -1.5, 1.5),
          vy: clamp(num(pointer.vy, 0), -1.5, 1.5),
          down: num(pointer.down, 0),
        },
        {
          x: num(pointer.t2x, 0.5),
          y: num(pointer.t2y, 0.5),
          a: num(pointer.t2active, 0),
          vx: 0,
          vy: 0,
          down: 0,
        },
      ];
      // fixed internal step for the stateful motions: identical result at 30, 60 or 144 fps
      acc += dtMotion;
      let steps = 0;
      const stepCount = Math.min(MAX_FIXED_STEPS, Math.floor(acc / FIXED_STEP));
      acc -= stepCount * FIXED_STEP;
      if (acc > FIXED_STEP * MAX_FIXED_STEPS) acc = 0;
      settling = false;
      const posK = clamp(num(aff.position, 1), 0, 1);
      const dirRot = (num(ic.direction, 0) * Math.PI) / 180;
      const dirCos = Math.cos(dirRot),
        dirSin = Math.sin(dirRot);
      const pressure = clamp(num(ic.pressure, 0.6), 0, 2);
      const velocityGain = clamp(num(ic.velocity, 0), 0, 2);
      const persistence = clamp(num(ic.persistence, 0), 0, 1);
      let frameMaxIw = 0;

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const d = dyn[i];
        let pos;
        if (p.motion.type === "flow") {
          const k = 3 * p.motion.frequency;
          const gain =
            p.motion.speed *
            p.motion.amplitude *
            3.2 *
            (m.direction < 0 ? -1 : 1);
          for (steps = 0; steps < stepCount; steps++) {
            const vx =
              Math.sin(k * d.fy + time * 0.3 + p.motion.phase) +
              0.5 * Math.sin(k * 1.7 * d.fx - time * 0.21);
            const vy =
              Math.cos(k * d.fx - time * 0.25 + p.motion.phase * 1.3) +
              0.5 * Math.cos(k * 1.3 * d.fy + time * 0.17);
            d.fx += vx * gain * FIXED_STEP;
            d.fy += vy * gain * FIXED_STEP;
            const home = 1 - Math.exp(-0.6 * FIXED_STEP);
            d.fx += (p.x - d.fx) * home;
            d.fy += (p.y - d.fy) * home;
          }
          const inf = clamp(num(m.influence, 1), 0, 1);
          pos = [p.x + (d.fx - p.x) * inf, p.y + (d.fy - p.y) * inf];
        } else if (p.motion.type === "follow") {
          const lead = sources[0];
          const tracking = lead.a > 0.02;
          const ring = p.motion.amplitude * 2 + 0.04;
          const tx = tracking ? lead.x + Math.cos(p.motion.phase) * ring : p.x;
          const ty = tracking ? lead.y + Math.sin(p.motion.phase) * ring : p.y;
          const tau = 0.06 + clamp(num(m.smoothness, 0.6), 0, 1) * 0.9;
          const speedUp = Math.max(0.15, p.motion.speed);
          const blend = 1 - Math.exp((-dtMotion * speedUp) / tau);
          d.px += (tx - d.px) * blend;
          d.py += (ty - d.py) * blend;
          const inf = clamp(num(m.influence, 1), 0, 1);
          pos = [p.x + (d.px - p.x) * inf, p.y + (d.py - p.y) * inf];
          if (Math.abs(d.px - tx) + Math.abs(d.py - ty) > 5e-4 && dtMotion > 0)
            settling = true;
        } else {
          pos = motionPosition(p, time, m);
        }

        let tx = 0,
          ty = 0,
          wsum = 0;
        if (forcesOn) {
          for (let s = 0; s < sources.length; s++) {
            const src = sources[s];
            if (src.a < 0.003) continue;
            const dx = (pos[0] - src.x) * asp,
              dy = pos[1] - src.y;
            const dist = Math.hypot(dx, dy) + 1e-4;
            const q = dist / ic.radius;
            if (q >= 1) continue;
            const w =
              falloff(q) *
              src.a *
              ic.strength *
              (1 + pressure * src.down) *
              (1 + velocityGain * Math.min(1, Math.hypot(src.vx, src.vy)));
            wsum += w;
            let f = forceDisplacement(
              ic.force,
              dx,
              dy,
              dist,
              w,
              src.vx,
              src.vy,
              clock,
            );
            if (dirRot !== 0)
              f = [
                f[0] * dirCos - f[1] * dirSin,
                f[0] * dirSin + f[1] * dirCos,
              ];
            tx += (f[0] / asp) * posK;
            ty += f[1] * posK;
          }
        }
        // the reaction is a smoothed offset on top of the motion: the saved positions are never changed, and `persistence`
        // slows only the release (the pointer pulling harder is still followed at the normal speed)
        const hold = wsum < d.iw - 1e-5 ? 1 - 0.92 * persistence : 1;
        const relax =
          1 - Math.exp(-Math.max(0, dt) * ic.response * p.response * hold);
        d.ix += (tx - d.ix) * relax;
        d.iy += (ty - d.iy) * relax;
        d.iw += (wsum - d.iw) * relax;
        if (d.iw > frameMaxIw) frameMaxIw = d.iw;
        if (
          Math.abs(d.ix) + Math.abs(d.iy) > 4e-4 ||
          Math.abs(tx) + Math.abs(ty) > 4e-4 ||
          Math.abs(d.iw) > 4e-4
        )
          settling = true;
        positions[i] = [
          clamp(pos[0] + d.ix, -0.4, 1.4),
          clamp(pos[1] + d.iy, -0.4, 1.4),
        ];
      }
      maxIw = Math.min(1.5, frameMaxIw);
      pack(
        config.color.cycleSpeed !== 0
          ? paletteTime * config.color.cycleSpeed * 0.05
          : 0,
        asp,
      );
      return buffers;
    },
  };
  rebuild();
  return state;
}

/** Sends the packed buffers to the GPU. `loc` maps uniform names (arrays as `name[0]`) to locations. */
export function uploadProceduralUniforms(gl, loc, buffers) {
  const at = (name) => loc[name] || null;
  gl.uniform4fv(at("uProcPoints[0]"), buffers.points);
  gl.uniform4fv(at("uProcColors[0]"), buffers.colors);
  gl.uniform4fv(at("uProcA"), buffers.a);
  gl.uniform4fv(at("uProcB"), buffers.b);
  gl.uniform4fv(at("uProcC"), buffers.c);
  gl.uniform4fv(at("uProcGrade"), buffers.grade);
  gl.uniform4fv(at("uProcD"), buffers.d);
  gl.uniform4fv(at("uProcBase"), buffers.base);
  gl.uniform4fv(at("uProcE"), buffers.e);
  gl.uniform4fv(at("uProcWarpA[0]"), buffers.warpA);
  gl.uniform4fv(at("uProcWarpB[0]"), buffers.warpB);
  gl.uniform4fv(at("uProcWarpC[0]"), buffers.warpC);
  gl.uniform4fv(at("uProcF"), buffers.f);
  gl.uniform4fv(at("uProcG"), buffers.g);
  gl.uniform4fv(at("uProcH"), buffers.h);
  gl.uniform4fv(at("uProcShape[0]"), buffers.shape);
  gl.uniform4fv(at("uProcRbf[0]"), buffers.rbf);
  gl.uniform4fv(at("uProcRbfP[0]"), buffers.rbfP);
  gl.uniform4fv(at("uProcRbfR[0]"), buffers.rbfR);
  gl.uniform4fv(at("uProcFieldA[0]"), buffers.fieldA);
  gl.uniform4fv(at("uProcFieldB[0]"), buffers.fieldB);
  gl.uniform4fv(at("uProcFieldC[0]"), buffers.fieldC);
  gl.uniform4fv(at("uProcM0"), buffers.m0);
  gl.uniform4fv(at("uProcM1"), buffers.m1);
  gl.uniform4fv(at("uProcM2"), buffers.m2);
  gl.uniform4fv(at("uProcM3"), buffers.m3);
}
