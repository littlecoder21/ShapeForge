/* ShapeForge motion runtime.
 *
 * Plain JavaScript on purpose (like rigRuntime.js): the editor imports it as a module and the exporter embeds the very
 * same source (via ?raw, with the `export` keyword stripped) in exported pages. Time, physics, modulation, organic drift,
 * pointer state, paths and uniform packing therefore cannot drift between the preview and the exported result.
 *
 * Rules for this file: no imports, no DOM access, and every top-level declaration is either `export function` /
 * `export const` or a plain `const` / `function` helper. The per-frame path allocates nothing: every buffer is created once
 * in createMotionState().
 *
 * What runs where
 *   CPU (here):  clocks, the flow-time integrator and its physics, modulators, organic drift, pointer smoothing and echoes,
 *                path sampling, source-follows-path, sorting sources by priority, packing everything into uniform buffers.
 *   GPU (glsl.ts): the spatial field itself — evaluating each source at each pixel, composing them, turbulence, organic
 *                spatial noise and the pointer's immediate effect. motionField.js is the CPU twin used by the editor overlay and tests.
 *
 * Flow model: every source yields a velocity vector at each point (units: screen heights per second at strength 1 = MOTION_VEL).
 * The composed velocity V displaces the sampling position by V · f · T, where T is the "flow memory" (cycle) and f ∈ [0,1) cycles
 * with the accumulated flow time. Two phases half a cycle apart are cross-faded in the shader so the cycle reset is invisible and
 * the displacement (and therefore the shear of the pattern) stays bounded no matter how long the animation runs. */

export const MOTION_MAX_SOURCES = 8;
export const MOTION_MAX_PATHS = 2;
export const MOTION_PATH_SAMPLES = 16;
export const MOTION_PTR_SLOTS = 6;
/** Screen heights per second that a strength of 1 stands for. */
export const MOTION_VEL = 0.12;
const TURBULENCE_KIND_ID = { simple: 0, fractal: 1, warped: 2, multiscale: 3, directional: 4, aligned: 5, animated: 6 };
const TURB_UNIT = 0.18;
const ORGANIC_UNIT = 0.07;
const INTERACTION_UNIT = 0.2;
const DENSE_MAX = 128;
const SUBSTEP = 1 / 120;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const MOTION_UNIFORM_NAMES = [
  'uMotA[0]', 'uMotB[0]', 'uMotC[0]', 'uMotD[0]', 'uMotE[0]', 'uMotF[0]', 'uMotCount',
  'uMotG0', 'uMotG1', 'uMotG2', 'uMotPhase', 'uMotPal', 'uMotQ',
  'uMotO0', 'uMotO1', 'uMotO2', 'uMotT0', 'uMotT1', 'uMotT2', 'uMotT3', 'uMotTKind', 'uMotI0', 'uMotI1',
  'uMotPtrP[0]', 'uMotPtrQ[0]', 'uMotPath[0]', 'uMotPathI[0]',
];

const clampNumber = (value, low, high) => Math.max(low, Math.min(high, value));
const finiteOr = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const fract = value => value - Math.floor(value);
const smooth01 = value => { const x = clampNumber(value, 0, 1); return x * x * (3 - 2 * x); };

/* ───────────── deterministic random (integer hash: identical in every browser, unlike fract(sin())) ───────────── */

function ihash(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
export function randomAt(seed, index) {
  return ihash((Math.imul(seed | 0, 374761393) + Math.imul(index | 0, 668265263)) | 0);
}
/** Smooth 1-D value noise in [-1, 1]. */
export function smoothNoise1(seed, x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return (randomAt(seed, i) * (1 - u) + randomAt(seed, i + 1) * u) * 2 - 1;
}

/* ───────────── modulation ───────────── */

function envelopeShape(u) {
  // attack 0..0.1, decay to 0.55 by 0.3, sustain to 0.7, release to 0 by 1
  if (u < 0.1) return u / 0.1;
  if (u < 0.3) return 1 - (u - 0.1) / 0.2 * 0.45;
  if (u < 0.7) return 0.55;
  return 0.55 * (1 - (u - 0.7) / 0.3);
}
function bump(u, center, width) { const d = (u - center) / width; return Math.exp(-d * d); }

function rawShape(shape, x, mod) {
  switch (shape) {
    case 'sine': return Math.sin(TAU * x);
    case 'cosine': return Math.cos(TAU * x);
    case 'triangle': return 4 * Math.abs(fract(x - 0.25) - 0.5) - 1;
    case 'sawtooth': return 2 * fract(x) - 1;
    case 'pulse': return fract(x) < 0.5 ? 1 : -1;
    case 'smooth-pulse': return Math.tanh(Math.sin(TAU * x) * 3) / Math.tanh(3);
    case 'noise': return clampNumber(smoothNoise1(mod.seed, x * 2) * 0.65 + smoothNoise1(mod.seed + 17, x * 4.3) * 0.35, -1, 1);
    case 'random-smooth': return smoothNoise1(mod.seed, x);
    case 'random-stepped': return randomAt(mod.seed, Math.floor(x)) * 2 - 1;
    case 'envelope': return envelopeShape(fract(x)) * 2 - 1;
    case 'curve': {
      const curve = mod.curve && mod.curve.length ? mod.curve : [0, 1];
      const n = curve.length;
      const position = fract(x) * n;
      const index = Math.floor(position);
      const a = curve[index % n];
      const b = curve[(index + 1) % n];
      return (a + (b - a) * smooth01(position - index)) * 2 - 1;
    }
    case 'circular': { const u = fract(x) * 2 - 1; return Math.sqrt(Math.max(0, 1 - u * u)) * 2 - 1; }
    case 'ping-pong': return smooth01(Math.abs(fract(x) * 2 - 1)) * 2 - 1;
    case 'beat': { const u = fract(x); return clampNumber(bump(u, 0.08, 0.045) + 0.7 * bump(u, 0.27, 0.06), 0, 1) * 2 - 1; }
    default: return 0;
  }
}
/** One modulator's output in [-1, 1] at time t (seconds of modulation time). `smoothness` rounds hard edges. */
export function modulatorShape(mod, t) {
  const x = t * mod.speed * mod.frequency + mod.phase / 360;
  const base = rawShape(mod.shape, x, mod);
  const s = clampNumber(mod.smoothness, 0, 1);
  if (s <= 0.001 || mod.shape === 'sine' || mod.shape === 'cosine' || mod.shape === 'noise' || mod.shape === 'random-smooth') return base;
  const d = s * 0.12;
  return base * (1 - s * 0.5) + (rawShape(mod.shape, x - d, mod) + rawShape(mod.shape, x + d, mod)) * 0.25 * s;
}
export function modulatorValue(mod, t) {
  return clampNumber(mod.offset + mod.amplitude * modulatorShape(mod, t), mod.min, mod.max);
}

/** Folds every enabled modulator into `state.mods` (target id -> accumulated factor, 1 = unchanged). */
function evaluateModulators(state, modulators, t) {
  const map = state.mods;
  map.clear();
  for (let i = 0; i < modulators.length; i++) {
    const mod = modulators[i];
    if (!mod.enabled) continue;
    const v = modulatorValue(mod, t);
    const current = map.has(mod.target) ? map.get(mod.target) : 1;
    let next;
    switch (mod.blend) {
      case 'multiply': next = current * (1 + v); break;
      case 'replace': next = 1 + v; break;
      case 'clamp': next = clampNumber(current, 1 + mod.min, 1 + mod.max); break;
      case 'min': next = Math.min(current, 1 + v); break;
      case 'max': next = Math.max(current, 1 + v); break;
      case 'smooth': next = current + (1 + v - current) * clampNumber(0.35 + mod.smoothness * 0.5, 0, 1); break;
      default: next = current + v;
    }
    map.set(mod.target, finiteOr(next, 1));
  }
}
const modMul = (state, id) => (state.mods.has(id) ? Math.max(0, state.mods.get(id)) : 1);
const modAdd = (state, id) => (state.mods.has(id) ? state.mods.get(id) - 1 : 0);

/* ───────────── physics ───────────── */

const PHYS_BASE = {
  linear: { kind: 'direct' },
  smooth: { kind: 'exp', rate: 3.2 },
  'ease-in': { kind: 'tween', ease: 'in', dur: 1.1 },
  'ease-out': { kind: 'tween', ease: 'out', dur: 1.1 },
  'ease-in-out': { kind: 'tween', ease: 'inout', dur: 1.5 },
  spring: { kind: 'spring', w: 5.5, z: 0.42 },
  elastic: { kind: 'spring', w: 7.5, z: 0.16 },
  inertial: { kind: 'spring', w: 2.0, z: 0.9 },
  damped: { kind: 'spring', w: 4.5, z: 1.0 },
  momentum: { kind: 'spring', w: 1.4, z: 0.3 },
  viscous: { kind: 'spring', w: 1.0, z: 2.4 },
  fluid: { kind: 'spring', w: 2.6, z: 0.95 },
  heavy: { kind: 'spring', w: 0.9, z: 1.1 },
  light: { kind: 'spring', w: 9, z: 0.85 },
  custom: { kind: 'spring', w: 4, z: 0.7 },
};
function easeCurve(kind, u) {
  if (kind === 'in') return u * u * u;
  if (kind === 'out') return 1 - (1 - u) * (1 - u) * (1 - u);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}
export function createDynamics(value = 0) { return { x: value, v: 0, from: value, to: value, t: 1, init: false }; }

/** Natural frequency and damping ratio of a physics model after the user's mass / stiffness / damping / elasticity knobs. */
export function springParameters(phys, coasting) {
  const base = PHYS_BASE[phys.model] || PHYS_BASE.fluid;
  const w0 = base.w || 4;
  const z0 = base.z || 0.8;
  const w = w0 * Math.sqrt(phys.stiffness / phys.mass) / (1 + phys.inertia * 2.5);
  let z = z0 * phys.damping * (1 + phys.friction * 0.5 + phys.resistance * 0.5) / (1 + phys.elasticity * 2);
  if (coasting) z /= 1 + phys.persistence * 0.8;
  return { w: Math.max(0.05, w), z: Math.max(0.02, z) };
}

/** Advances a scalar toward `target`. Frame-rate independent: sub-steps of at most 1/120 s with implicit damping. */
export function stepDynamics(d, target, dt, phys, wrapAngle) {
  if (!(dt > 0)) return d.x;
  if (!d.init) { d.x = target; d.from = target; d.to = target; d.init = true; d.v = 0; return d.x; }
  if (wrapAngle) target = d.x + Math.atan2(Math.sin(target - d.x), Math.cos(target - d.x));
  const base = PHYS_BASE[phys.model] || PHYS_BASE.fluid;
  if (base.kind === 'direct') { d.x = target; d.v = 0; return d.x; }
  if (base.kind === 'exp') {
    d.x += (target - d.x) * (1 - Math.exp(-dt * base.rate * Math.sqrt(phys.stiffness / phys.mass)));
    d.v = 0;
    return d.x;
  }
  if (base.kind === 'tween') {
    if (Math.abs(target - d.to) > 1e-6) { d.from = d.x; d.to = target; d.t = 0; }
    d.t += dt;
    const dur = base.dur * phys.mass / Math.max(0.2, Math.sqrt(phys.stiffness));
    d.x = d.from + (d.to - d.from) * easeCurve(base.ease, clampNumber(d.t / dur, 0, 1));
    d.v = 0;
    return d.x;
  }
  const { w, z } = springParameters(phys, Math.abs(target) < 1e-4);
  const c = 2 * z * w;
  const k = w * w;
  const steps = Math.min(16, Math.max(1, Math.ceil(dt / SUBSTEP)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    d.v = (d.v + h * k * (target - d.x)) / (1 + h * c + h * phys.drag * 0.15 * Math.abs(d.v));
    d.x += h * d.v;
  }
  if (!Number.isFinite(d.x) || !Number.isFinite(d.v)) { d.x = target; d.v = 0; }
  return d.x;
}
/** A simple critically-damped follower used for pointers and direction. `omega` is the response speed (rad/s). */
function stepFollow(d, target, dt, omega) {
  if (!(dt > 0)) return d.x;
  if (!d.init) { d.x = target; d.v = 0; d.init = true; return d.x; }
  const steps = Math.min(12, Math.max(1, Math.ceil(dt / SUBSTEP)));
  const h = dt / steps;
  const c = 2 * omega;
  const k = omega * omega;
  for (let i = 0; i < steps; i++) {
    d.v = (d.v + h * k * (target - d.x)) / (1 + h * c);
    d.x += h * d.v;
  }
  return d.x;
}

/* ───────────── paths ───────────── */

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function bezier(p0, c0, c1, p1, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * c0 + 3 * u * t * t * c1 + t * t * t * p1;
}

/** Samples a path's curve into `slot.dense` (x, y pairs), applying wobble, offset, reversal and smoothing. */
function sampleDense(path, slot, time) {
  const pts = path.points;
  const n = pts.length;
  const xs = slot.cx, ys = slot.cy;
  for (let i = 0; i < n; i++) {
    let x = pts[i].x + path.offsetX, y = pts[i].y + path.offsetY;
    if (path.evolve > 0) {
      x += smoothNoise1(31 + i * 7, time * path.evolveSpeed + i) * path.evolve;
      y += smoothNoise1(57 + i * 11, time * path.evolveSpeed + i * 1.7) * path.evolve;
    }
    xs[i] = x; ys[i] = y;
  }
  const dense = slot.dense;
  let count = 0;
  const push = (x, y) => { if (count < DENSE_MAX) { dense[count * 2] = x; dense[count * 2 + 1] = y; count++; } };
  const segments = path.closed ? n : n - 1;
  const per = Math.max(2, Math.min(14, Math.floor((DENSE_MAX - 2) / Math.max(1, segments))));
  const wrap = i => (path.closed ? (i + n) % n : clampNumber(i, 0, n - 1));
  for (let s = 0; s < segments; s++) {
    const a = s, b = wrap(s + 1);
    for (let k = 0; k < per; k++) {
      const t = k / per;
      if (path.kind === 'polyline') push(xs[a] + (xs[b] - xs[a]) * t, ys[a] + (ys[b] - ys[a]) * t);
      else if (path.kind === 'bezier') {
        push(bezier(xs[a], xs[a] + pts[a].ox, xs[b] + pts[b].ix, xs[b], t), bezier(ys[a], ys[a] + pts[a].oy, ys[b] + pts[b].iy, ys[b], t));
      } else {
        const p0 = wrap(s - 1), p3 = wrap(s + 2);
        push(catmull(xs[p0], xs[a], xs[b], xs[p3], t), catmull(ys[p0], ys[a], ys[b], ys[p3], t));
      }
    }
  }
  push(path.closed ? xs[0] : xs[n - 1], path.closed ? ys[0] : ys[n - 1]);
  if (path.reversed) {
    for (let i = 0, j = count - 1; i < j; i++, j--) {
      const tx = dense[i * 2], ty = dense[i * 2 + 1];
      dense[i * 2] = dense[j * 2]; dense[i * 2 + 1] = dense[j * 2 + 1]; dense[j * 2] = tx; dense[j * 2 + 1] = ty;
    }
  }
  const passes = Math.round(clampNumber(path.smoothing, 0, 1) * 6);
  for (let pass = 0; pass < passes; pass++) {
    let px = dense[0], py = dense[1];
    for (let i = 1; i < count - 1; i++) {
      const cx = dense[i * 2], cy = dense[i * 2 + 1];
      dense[i * 2] = (px + 2 * cx + dense[(i + 1) * 2]) / 4;
      dense[i * 2 + 1] = (py + 2 * cy + dense[(i + 1) * 2 + 1]) / 4;
      px = cx; py = cy;
    }
  }
  slot.denseCount = count;
  const cum = slot.cum;
  cum[0] = 0;
  for (let i = 1; i < count; i++) cum[i] = cum[i - 1] + Math.hypot(dense[i * 2] - dense[(i - 1) * 2], dense[i * 2 + 1] - dense[(i - 1) * 2 + 1]);
  slot.length = cum[count - 1];
}

/** Position and unit tangent at arc fraction s (0..1) of a sampled path. Writes into `out` = [x, y, tx, ty]. */
export function pathPointAt(slot, s, out) {
  const count = slot.denseCount;
  if (count < 2 || !(slot.length > 1e-6)) { out[0] = 0.5; out[1] = 0.5; out[2] = 1; out[3] = 0; return out; }
  const target = clampNumber(s, 0, 1) * slot.length;
  let lo = 0, hi = count - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (slot.cum[mid] <= target) lo = mid; else hi = mid; }
  const span = Math.max(1e-9, slot.cum[hi] - slot.cum[lo]);
  const f = (target - slot.cum[lo]) / span;
  const ax = slot.dense[lo * 2], ay = slot.dense[lo * 2 + 1], bx = slot.dense[hi * 2], by = slot.dense[hi * 2 + 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  out[0] = ax + dx * f; out[1] = ay + dy * f; out[2] = dx / len; out[3] = dy / len;
  return out;
}

/** Resamples the dense curve at equal arc length into the GPU buffer: MOTION_PATH_SAMPLES vec4 (x, y, tangent x, tangent y). */
function packPath(slot, base, gpu, info, index, closed) {
  const n = MOTION_PATH_SAMPLES;
  const point = slot.tmp;
  for (let i = 0; i < n; i++) {
    pathPointAt(slot, i / (n - 1), point);
    const o = (base + i) * 4;
    gpu[o] = point[0]; gpu[o + 1] = point[1]; gpu[o + 2] = point[2]; gpu[o + 3] = point[3];
  }
  info[index * 4] = closed ? 1 : 0;
  info[index * 4 + 1] = n;
  info[index * 4 + 2] = slot.length;
  info[index * 4 + 3] = 1;
}

/* ───────────── state ───────────── */

function createPathSlot() {
  return { dense: new Float32Array(DENSE_MAX * 2), denseCount: 0, cum: new Float32Array(DENSE_MAX), length: 0, cx: new Float32Array(16), cy: new Float32Array(16), tmp: new Float32Array(4), used: false };
}
function createPointer() { return { x: createDynamics(0.5), y: createDynamics(0.5), vx: 0, vy: 0, px: 0.5, py: 0.5, e: 0, gain: 1, press: 1, was: false, ax: 0, ay: 0 }; }

export function createMotionState() {
  const state = {
    seedKey: '',
    time: 0, timeAcc: 0, tau: 0, tauFollow: 0, modTime: 0, organicT: 0, turbT: 0, clock: 0, tKind: 0,
    rate: createDynamics(1), dir: createDynamics(0),
    tauSrc: new Float32Array(MOTION_MAX_SOURCES),
    order: new Int8Array(MOTION_MAX_SOURCES),
    mods: new Map(),
    flowActive: false, animating: false, count: 0,
    drift: new Float32Array(2),
    // uniform buffers
    a: new Float32Array(MOTION_MAX_SOURCES * 4), b: new Float32Array(MOTION_MAX_SOURCES * 4), c: new Float32Array(MOTION_MAX_SOURCES * 4),
    d: new Float32Array(MOTION_MAX_SOURCES * 4), e: new Float32Array(MOTION_MAX_SOURCES * 4), f: new Float32Array(MOTION_MAX_SOURCES * 4),
    g0: new Float32Array(4), g1: new Float32Array(4), g2: new Float32Array(4), phase: new Float32Array(4), pal: new Float32Array(4), q: new Float32Array(4),
    o0: new Float32Array(4), o1: new Float32Array(4), o2: new Float32Array(4),
    t0: new Float32Array(4), t1: new Float32Array(4), t2: new Float32Array(4), t3: new Float32Array(4),
    i0: new Float32Array(4), i1: new Float32Array(4),
    ptrP: new Float32Array(MOTION_PTR_SLOTS * 4), ptrQ: new Float32Array(MOTION_PTR_SLOTS * 4),
    path: new Float32Array(MOTION_MAX_PATHS * MOTION_PATH_SAMPLES * 4), pathI: new Float32Array(MOTION_MAX_PATHS * 4),
    pathSlots: [createPathSlot(), createPathSlot()],
    ptr: createPointer(), touch2: createPointer(),
    echo: [0, 1, 2, 3].map(() => ({ x: 0.5, y: 0.5, e: 0 })), echoTimer: 0,
    follow: new Float32Array(4),
    /** values for the legacy shader uniforms the modulators can drive */
    legacy: { distortion: 1, rotation: 0, zoom: 1, breath: 1, timeOffset: 0, color: 0 },
    /** pointer state as the editor overlay wants to read it (uv, y up) */
    stats: { sources: 0, paths: 0, modulators: 0, phases: 1, flowSpeed: 0 },
  };
  return state;
}

/** Forgets accumulated time and pointer state (a new seed or a "reset motion" action). */
export function resetMotionState(state) {
  state.time = 0; state.timeAcc = 0; state.tau = 0; state.tauFollow = 0; state.modTime = 0; state.organicT = 0; state.turbT = 0;
  state.rate = createDynamics(1); state.dir = createDynamics(0);
  state.tauSrc.fill(0);
  state.ptr = createPointer(); state.touch2 = createPointer();
  for (const echo of state.echo) { echo.e = 0; }
}

function mapTime(acc, time) {
  let t = acc + time.offset;
  const duration = Math.max(0.5, time.duration);
  if (time.loop === 'loop') t = ((t % duration) + duration) % duration;
  else if (time.loop === 'pingpong') { const m = ((t % (2 * duration)) + 2 * duration) % (2 * duration); t = m <= duration ? m : 2 * duration - m; }
  return t;
}

/** How many noise octaves a quality level allows. */
export function effectiveMotionQuality(quality, coarsePointer, interactionEnabled) {
  return quality === 'auto' && coarsePointer && interactionEnabled ? 'performance' : quality;
}
export function qualityOctaves(quality, projectQuality) {
  const level = quality === 'auto' ? ({ low: 'performance', medium: 'balanced', high: 'high', ultra: 'ultra' }[projectQuality] || 'balanced') : quality;
  return { performance: 2, balanced: 3, high: 5, ultra: 6 }[level] || 3;
}
export function qualityDualPhase(quality, projectQuality) {
  const level = quality === 'auto' ? ({ low: 'performance', medium: 'balanced', high: 'high', ultra: 'ultra' }[projectQuality] || 'balanced') : quality;
  return level !== 'performance';
}

/* ───────────── pointer / interaction ───────────── */

const FALLOFF_IDS = { hard: 0, linear: 1, smooth: 2, gauss: 3, inverse: 4, ring: 5 };
const TYPE_IDS = { directional: 0, curved: 1, vortex: 2, spiral: 3, radial: 4, wave: 5, noise: 6, curl: 7, magnetic: 8, path: 9 };
const BLEND_IDS = { add: 0, screen: 1, difference: 2, override: 3, max: 4 };
const COMP_IDS = { additive: 0, weighted: 1, average: 2, normalized: 3, maximum: 4, dominant: 5, soft: 6, priority: 7 };
/** A stable small number per source id (so a source keeps its own noise pattern when the list is reordered). */
function idSeed(id) { let h = 7; for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0; return ((h >>> 0) % 997) * 0.137; }
function falloffId(name) { return FALLOFF_IDS[name] || 0; }

function stepPointer(p, rawX, rawY, active, I, impulse, dt, aspect, frame) {
  const w = 38 - 34 * clampNumber(I.inertia * 0.8 + I.smoothing * 0.5 + I.lag * 0.5, 0, 1) * 0.97;
  if (active && !p.was) { p.x = createDynamics(rawX); p.y = createDynamics(rawY); p.x.init = true; p.y.init = true; p.px = rawX; p.py = rawY; p.vx = 0; p.vy = 0; }
  p.was = active;
  if (active) { stepFollow(p.x, rawX, dt, w); stepFollow(p.y, rawY, dt, w); }
  let speed = 0;
  if (dt > 0) {
    const vx = (p.x.x - p.px) / dt, vy = (p.y.x - p.py) / dt;
    const k = 1 - Math.exp(-dt / 0.07);
    const nvx = p.vx + (vx - p.vx) * k, nvy = p.vy + (vy - p.vy) * k;
    const ax = (nvx - p.vx) / dt, ay = (nvy - p.vy) / dt;
    p.ax += ((ax - p.ax)) * k; p.ay += ((ay - p.ay)) * k;
    p.vx = nvx; p.vy = nvy;
  }
  p.px = p.x.x; p.py = p.y.x;
  speed = Math.hypot(p.vx * aspect, p.vy);
  const accel = Math.hypot(p.ax * aspect, p.ay);
  const speedNorm = 1 - Math.exp(-speed * 1.4);
  const accelNorm = 1 - Math.exp(-accel * 0.12);
  const target = active ? 1 + I.accelerationSensitivity * accelNorm * 0.6 : 0;
  if (target > p.e) p.e += (target - p.e) * (1 - Math.exp(-dt / 0.07));
  else p.e = target + (p.e - target) * Math.exp(-dt / (I.persistence + 0.03));
  if (p.e < 1e-4) p.e = 0;
  const s = clampNumber(I.velocitySensitivity, 0, 2);
  p.gain = (1 - Math.min(1, s)) + Math.min(1, s) * Math.min(1.6, speedNorm * 3) + Math.max(0, s - 1) * speedNorm;
  p.press = 1;
  if (frame) {
    p.press = 1 + 0.3 * (frame.down || 0);
    if (I.clickImpulse) p.press += (impulse || 0) * Math.exp(-Math.max(0, frame.sinceClick === undefined ? 1e6 : frame.sinceClick) * 5);
  }
}

function stepInteraction(state, cfg, frame, dt, aspect, running) {
  const I = cfg.interaction;
  const phys = cfg.physics;
  const on = I.enabled && frame;
  const activeA = !!on && frame.active > 0.003;
  stepPointer(state.ptr, on ? frame.x : 0.5, on ? frame.y : 0.5, activeA, I, phys.impulse, dt, aspect, frame);
  const activeB = !!on && frame.t2active > 0.003;
  stepPointer(state.touch2, on ? frame.t2x : 0.5, on ? frame.t2y : 0.5, activeB, I, phys.impulse, dt, aspect, null);
  // trail echoes: previous positions of the primary pointer that fade out by "persistence"
  state.echoTimer += dt;
  const echoes = state.echo;
  const trailOn = I.trail || I.response === 'trail' || I.response === 'wake';
  const fade = Math.exp(-dt / Math.max(0.05, I.persistence * 0.8 + 0.05));
  for (let i = 0; i < echoes.length; i++) echoes[i].e *= fade;
  if (trailOn && state.ptr.e > 0.02 && state.echoTimer > 0.09) {
    state.echoTimer = 0;
    for (let i = echoes.length - 1; i > 0; i--) { echoes[i].x = echoes[i - 1].x; echoes[i].y = echoes[i - 1].y; echoes[i].e = echoes[i - 1].e; }
    echoes[0].x = state.ptr.x.x; echoes[0].y = state.ptr.y.x; echoes[0].e = state.ptr.e;
  }
  const P = state.ptrP, Q = state.ptrQ;
  for (let i = 0; i < 2; i++) {
    const p = i === 0 ? state.ptr : state.touch2;
    P[i * 4] = p.x.x; P[i * 4 + 1] = p.y.x; P[i * 4 + 2] = p.vx; P[i * 4 + 3] = p.vy;
    Q[i * 4] = I.enabled ? p.e : 0; Q[i * 4 + 1] = p.gain; Q[i * 4 + 2] = p.press; Q[i * 4 + 3] = 0;
  }
  for (let i = 0; i < echoes.length; i++) {
    const o = (2 + i) * 4;
    P[o] = echoes[i].x; P[o + 1] = echoes[i].y; P[o + 2] = state.ptr.vx; P[o + 3] = state.ptr.vy;
    Q[o] = I.enabled && trailOn ? echoes[i].e : 0; Q[o + 1] = 1; Q[o + 2] = 1; Q[o + 3] = 0;
  }
  return state.ptr.e > 0.002 || state.touch2.e > 0.002 || echoes[0].e > 0.002;
}

/* ───────────── per-frame step ───────────── */

const clamp01 = v => clampNumber(v, 0, 1);

/** Advances every motion system by `dt` seconds and fills the uniform buffers.
 *  opts: { aspect, shaderDt (legacy animation clock increment), animate, timeScale (frame-scheduler catch-up factor), projectQuality, octaveCap, dual (false = single-phase), clock } */
export function stepMotion(state, cfg, frame, dt, opts) {
  const aspect = opts.aspect || 1;
  const running = opts.animate !== false && dt > 0;
  const seedKey = `${cfg.global.seed}|${cfg.organic.seed}`;
  if (state.seedKey !== seedKey) { state.seedKey = seedKey; resetMotionState(state); }
  const global = cfg.global, comp = cfg.composition, phys = cfg.physics, time = cfg.time;
  state.clock = opts.clock !== undefined ? opts.clock : state.clock + dt;

  // clocks
  const dtEng = running ? dt * time.scale * (opts.timeScale || 1) : 0;
  state.modTime += time.freeze ? 0 : dtEng;
  evaluateModulators(state, cfg.modulators, state.modTime);
  if (opts.animate !== false && !time.freeze) state.timeAcc += (opts.shaderDt || 0) * time.scale * (time.reverse ? -1 : 1);
  state.time = mapTime(state.timeAcc, time);

  // flow-time rate through the physics model
  const speedFactor = global.speed * modMul(state, 'flow.speed') * (time.reverse ? -1 : 1);
  const rateTarget = !time.freeze && opts.animate !== false ? speedFactor : 0;
  const rate = stepDynamics(state.rate, rateTarget, dtEng > 0 ? dtEng : 0, phys, false);
  const clampedRate = clampNumber(rate, -phys.maxSpeed, phys.maxSpeed);
  let appliedRate = clampedRate;
  if (phys.minSpeed > 0 && Math.abs(rateTarget) > 1e-3 && Math.abs(appliedRate) < phys.minSpeed) appliedRate = Math.sign(rateTarget || 1) * phys.minSpeed;
  const dTau = appliedRate * dtEng;
  state.tau += dTau;
  state.tauFollow += dTau;
  state.organicT += dTau * cfg.organic.speed * (0.3 + cfg.organic.evolution);
  state.turbT += dTau * cfg.turbulence.speed;

  // global direction (never snaps: it follows through a damped follower)
  const dirTarget = (global.direction + modAdd(state, 'flow.direction') * 180) * DEG;
  const dirOmega = 9 - 8 * clampNumber(phys.directionInertia, 0, 1);
  if (!state.dir.init) { state.dir.x = dirTarget; state.dir.v = 0; state.dir.init = true; }
  else if (dt > 0) {
    const wrapped = state.dir.x + Math.atan2(Math.sin(dirTarget - state.dir.x), Math.cos(dirTarget - state.dir.x));
    stepFollow(state.dir, wrapped, dt, dirOmega);
  }

  // organic drift: a slow wandering vector (sines at seeded phases mixed with smooth noise)
  const org = cfg.organic;
  let driftX = 0, driftY = 0;
  if (org.enabled) {
    const t = state.organicT, s = org.seed;
    const sineX = Math.sin(t * 0.37 + randomAt(s, 1) * TAU) * 0.6 + Math.sin(t * 0.91 + randomAt(s, 2) * TAU) * 0.4;
    const sineY = Math.sin(t * 0.43 + randomAt(s, 3) * TAU) * 0.6 + Math.sin(t * 1.07 + randomAt(s, 4) * TAU) * 0.4;
    const noiseX = smoothNoise1(s + 5, t * 0.35), noiseY = smoothNoise1(s + 9, t * 0.35);
    driftX = sineX * (1 - org.randomness) + noiseX * org.randomness;
    driftY = sineY * (1 - org.randomness) + noiseY * org.randomness;
    const wander = org.variation * smoothNoise1(s + 13, t * 0.22) * Math.PI;
    const cw = Math.cos(wander), sw = Math.sin(wander);
    const rx = driftX * cw - driftY * sw, ry = driftX * sw + driftY * cw;
    driftX = rx; driftY = ry;
  }
  state.drift[0] = driftX; state.drift[1] = driftY;

  // paths
  const pathSlots = state.pathSlots;
  for (let i = 0; i < MOTION_MAX_PATHS; i++) {
    const path = cfg.paths[i];
    const slot = pathSlots[i];
    slot.used = !!path && path.points.length >= 2;
    if (!slot.used) { state.pathI[i * 4 + 3] = 0; continue; }
    sampleDense(path, slot, state.modTime);
    packPath(slot, i * MOTION_PATH_SAMPLES, state.path, state.pathI, i, path.closed);
  }

  // flow sources: priority order (high first), ties by id, so the list order never changes the result
  const sources = cfg.sources;
  const order = state.order;
  let count = 0;
  for (let i = 0; i < sources.length && i < MOTION_MAX_SOURCES; i++) if (sources[i].enabled) order[count++] = i;
  for (let i = 1; i < count; i++) {
    const key = order[i];
    let j = i - 1;
    while (j >= 0 && (sources[order[j]].priority < sources[key].priority || (sources[order[j]].priority === sources[key].priority && sources[order[j]].id > sources[key].id))) { order[j + 1] = order[j]; j--; }
    order[j + 1] = key;
  }
  const flowMul = modMul(state, 'flow.strength');
  const unlockCap = comp.unlockLimits ? 6 : 2;
  let strongest = 0;
  for (let n = 0; n < count; n++) {
    const src = sources[order[n]];
    const o = n * 4;
    const id = src.id;
    let x = src.x, y = src.y, angle = src.angle;
    if (src.follow && src.follow.enabled) {
      let pathIndex = -1;
      for (let k = 0; k < cfg.paths.length && k < MOTION_MAX_PATHS; k++) if (cfg.paths[k].id === src.follow.pathId) { pathIndex = k; break; }
      const slot = pathIndex >= 0 ? pathSlots[pathIndex] : null;
      if (slot && slot.used) {
        const tf = state.tauFollow;
        let s = src.follow.offset + src.follow.speed * tf + 0.5 * src.follow.acceleration * tf * Math.abs(tf);
        s = src.follow.mode === 'pingpong' ? Math.abs(fract(s * 0.5) * 2 - 1) : fract(s);
        pathPointAt(slot, s, state.follow);
        x = state.follow[0]; y = state.follow[1];
        if (src.follow.orient === 'tangent') angle = Math.atan2(state.follow[3], state.follow[2]) / DEG;
        else if (src.follow.orient === 'normal') angle = Math.atan2(state.follow[3], state.follow[2]) / DEG + 90;
      }
    }
    const listIndex = order[n];
    state.tauSrc[listIndex] += dTau * src.timeScale;
    const typeMul = src.type === 'vortex' || src.type === 'spiral' ? modMul(state, 'flow.vortex') : src.type === 'radial' ? modMul(state, 'flow.radial') : 1;
    const strength = clampNumber(src.strength * src.speed * (src.reverse ? -1 : 1) * flowMul * typeMul * modMul(state, `src:${id}:strength`) * MOTION_VEL, -MOTION_VEL * unlockCap * 2, MOTION_VEL * unlockCap * 2);
    const radius = src.global ? 1e4 : Math.max(0.01, src.radius * modMul(state, 'flow.radius') * modMul(state, `src:${id}:radius`));
    const scale = Math.max(0.05, src.scale * modMul(state, 'flow.scale') * modMul(state, `src:${id}:scale`));
    const angleRad = (angle + modAdd(state, 'flow.direction') * 180 + modAdd(state, `src:${id}:angle`) * 180) * DEG;
    const rotationRad = (src.rotation + modAdd(state, `src:${id}:rotation`) * 180) * DEG;
    const phaseRad = (src.phase + modAdd(state, `src:${id}:phase`) * 180) * DEG;
    const curveMul = src.type === 'directional' || src.type === 'curved' ? modMul(state, 'flow.curvature') : 1;
    let pathSlot = 0;
    let weight = src.weight;
    if (src.type === 'path') {
      pathSlot = Math.round(clampNumber(src.params[0], 0, MOTION_MAX_PATHS - 1));
      if (!pathSlots[pathSlot].used) weight = 0;
    }
    state.a[o] = TYPE_IDS[src.type] || 0;
    state.a[o + 1] = weight; state.a[o + 2] = x; state.a[o + 3] = y;
    state.b[o] = strength; state.b[o + 1] = radius; state.b[o + 2] = falloffId(src.falloff); state.b[o + 3] = scale;
    state.c[o] = angleRad; state.c[o + 1] = rotationRad; state.c[o + 2] = phaseRad; state.c[o + 3] = src.influence;
    state.d[o] = src.params[0] * curveMul; state.d[o + 1] = src.params[1]; state.d[o + 2] = src.params[2]; state.d[o + 3] = src.params[3];
    state.e[o] = BLEND_IDS[src.blend] || 0; state.e[o + 1] = idSeed(id); state.e[o + 2] = pathSlot; state.e[o + 3] = n;
    state.f[o] = state.tauSrc[listIndex]; state.f[o + 1] = src.evolution; state.f[o + 2] = src.offsetX; state.f[o + 3] = src.offsetY;
    if (weight > 0) strongest = Math.max(strongest, Math.abs(strength) * weight * src.influence);
  }
  state.count = count;

  // global flow vector (+ organic drift)
  const balance = clampNumber(comp.balance, 0, 1);
  const globalGain = 1 - Math.max(0, balance - 0.5) * 2;
  const localGain = Math.min(1, balance * 2);
  const intensity = global.intensity * comp.strength * modMul(state, 'intensity');
  const globalFlow = global.flow * flowMul * MOTION_VEL;
  const gx = Math.cos(state.dir.x) * globalFlow + driftX * org.drift * org.intensity * global.organic * modMul(state, 'organic.intensity') * MOTION_VEL * 1.4;
  const gy = Math.sin(state.dir.x) * globalFlow + driftY * org.drift * org.intensity * global.organic * modMul(state, 'organic.intensity') * MOTION_VEL * 1.4;
  const maxVel = comp.maxVelocity * MOTION_VEL * 2;
  state.g0[0] = intensity; state.g0[1] = 0; state.g0[2] = comp.cycle; state.g0[3] = maxVel;
  state.g1[0] = gx * globalGain; state.g1[1] = gy * globalGain; state.g1[2] = localGain; state.g1[3] = strongest;
  state.g2[0] = 2 + (1 - clampNumber(comp.smoothing, 0, 1)) * 12; state.g2[1] = comp.normalize ? 1 : 0; state.g2[2] = COMP_IDS[comp.mode] || 0; state.g2[3] = 0;
  state.pal[0] = modAdd(state, 'color') * 0.5;
  state.q[0] = Math.max(1, Math.min(6, opts.octaveCap || 4)); state.q[1] = randomAt(global.seed, 31) * 64; state.q[2] = randomAt(global.seed, 32) * 64; state.q[3] = 0;

  // flow phases (dual-phase cross-fade, or a single smooth ping-pong when the device cannot afford two passes)
  const flowPossible = count > 0 || Math.abs(gx) + Math.abs(gy) > 1e-6 || (cfg.interaction.enabled && (cfg.interaction.response === 'flow' || cfg.interaction.response === 'direction'));
  state.flowActive = flowPossible;
  const T = Math.max(1, comp.cycle);
  const cyc = state.tau / T;
  if (!flowPossible) { state.phase[0] = 0; state.phase[1] = 0; state.phase[2] = 1; state.phase[3] = 0; }
  else if (opts.dual !== false) {
    const fa = fract(cyc);
    const fb = fract(cyc + 0.5);
    state.phase[0] = fa; state.phase[1] = fb;
    state.phase[2] = 1 - Math.abs(2 * fa - 1); state.phase[3] = 1 - Math.abs(2 * fb - 1);
  } else {
    state.phase[0] = 0.5 - 0.5 * Math.cos(Math.PI * cyc); state.phase[1] = 0; state.phase[2] = 1; state.phase[3] = 0;
  }
  state.stats.phases = state.phase[3] > 0.002 ? 2 : 1;

  // organic (spatial part)
  state.o0[0] = org.enabled ? org.intensity * org.spatial * global.organic * modMul(state, 'organic.intensity') * ORGANIC_UNIT : 0;
  state.o0[1] = org.scale; state.o0[2] = org.variation; state.o0[3] = org.persistence;
  state.o1[0] = state.organicT; state.o1[1] = org.phase * DEG; state.o1[2] = randomAt(org.seed, 21) * 90; state.o1[3] = randomAt(org.seed, 22) * 90;
  state.o2[0] = Math.min(opts.octaveCap || 4, 1 + Math.round((1 - org.smoothness) * 2)); state.o2[1] = org.smoothness; state.o2[2] = 0; state.o2[3] = 0;

  // turbulence
  const tur = cfg.turbulence;
  state.tKind = TURBULENCE_KIND_ID[tur.kind] || 0;
  state.t0[0] = tur.enabled ? tur.strength * global.turbulence * modMul(state, 'turbulence.strength') * TURB_UNIT : 0;
  state.t0[1] = tur.scale; state.t0[2] = Math.min(tur.detail, opts.octaveCap || 4); state.t0[3] = tur.persistence;
  state.t1[0] = tur.lacunarity; state.t1[1] = tur.warp * modMul(state, 'turbulence.warp'); state.t1[2] = tur.warpScale; state.t1[3] = tur.rotation * DEG;
  state.t2[0] = state.turbT; state.t2[1] = tur.warpDirection * DEG; state.t2[2] = tur.influence; state.t2[3] = tur.angle * DEG;
  state.t3[0] = tur.localX; state.t3[1] = tur.localY; state.t3[2] = tur.localRadius; state.t3[3] = tur.evolution;

  // interaction
  const interacting = stepInteraction(state, cfg, frame, dt, aspect, running);
  const I = cfg.interaction;
  state.i0[0] = I.radius; state.i0[1] = I.strength * global.interaction * modMul(state, 'interaction.strength') * INTERACTION_UNIT;
  state.i0[2] = falloffId(I.falloff); state.i0[3] = I.maxDisplacement;
  state.i1[0] = I.frequency; state.i1[1] = I.directionResponse; state.i1[2] = state.clock * I.speed; state.i1[3] = I.drag;

  // legacy uniforms the modulators may drive
  const L = state.legacy;
  L.distortion = modMul(state, 'distortion'); L.zoom = modMul(state, 'zoom'); L.breath = modMul(state, 'breathing');
  L.rotation = modAdd(state, 'rotation') * 0.3; L.timeOffset = modAdd(state, 'layerOffset') * 20; L.color = modAdd(state, 'color') * 0.5;

  let usedPaths = 0, activeMods = 0;
  for (let i = 0; i < MOTION_MAX_PATHS; i++) if (pathSlots[i].used) usedPaths++;
  for (let i = 0; i < cfg.modulators.length; i++) if (cfg.modulators[i].enabled) activeMods++;
  state.stats.sources = count; state.stats.paths = usedPaths; state.stats.modulators = activeMods;
  state.stats.flowSpeed = appliedRate;
  const advancing = running && !time.freeze && Math.abs(rateTarget) > 0 && (flowPossible || tur.enabled || org.enabled || activeMods > 0);
  state.animating = advancing || interacting || Math.abs(state.rate.v) > 1e-3 || (running && Math.abs(state.rate.x) > 1e-3 && !time.freeze && (flowPossible || tur.enabled || org.enabled));
  return state;
}

/** True while the engine still needs frames (time is advancing, the pointer is fading, a spring is settling). */
export function isMotionAnimating(state) { return !!state.animating; }

/** Uploads every motion buffer. Locations that the compiled program does not declare are null and are skipped by WebGL. */
export function uploadMotionUniforms(gl, loc, state) {
  gl.uniform4fv(loc['uMotA[0]'] ?? null, state.a);
  gl.uniform4fv(loc['uMotB[0]'] ?? null, state.b);
  gl.uniform4fv(loc['uMotC[0]'] ?? null, state.c);
  gl.uniform4fv(loc['uMotD[0]'] ?? null, state.d);
  gl.uniform4fv(loc['uMotE[0]'] ?? null, state.e);
  gl.uniform4fv(loc['uMotF[0]'] ?? null, state.f);
  gl.uniform1f(loc.uMotCount ?? null, state.count);
  gl.uniform4fv(loc.uMotG0 ?? null, state.g0);
  gl.uniform4fv(loc.uMotG1 ?? null, state.g1);
  gl.uniform4fv(loc.uMotG2 ?? null, state.g2);
  gl.uniform4fv(loc.uMotPhase ?? null, state.phase);
  gl.uniform4fv(loc.uMotPal ?? null, state.pal);
  gl.uniform4fv(loc.uMotQ ?? null, state.q);
  gl.uniform4fv(loc.uMotO0 ?? null, state.o0);
  gl.uniform4fv(loc.uMotO1 ?? null, state.o1);
  gl.uniform4fv(loc.uMotO2 ?? null, state.o2);
  gl.uniform4fv(loc.uMotT0 ?? null, state.t0);
  gl.uniform4fv(loc.uMotT1 ?? null, state.t1);
  gl.uniform4fv(loc.uMotT2 ?? null, state.t2);
  gl.uniform4fv(loc.uMotT3 ?? null, state.t3);
  gl.uniform1f(loc.uMotTKind ?? null, state.tKind);
  gl.uniform4fv(loc.uMotI0 ?? null, state.i0);
  gl.uniform4fv(loc.uMotI1 ?? null, state.i1);
  gl.uniform4fv(loc['uMotPtrP[0]'] ?? null, state.ptrP);
  gl.uniform4fv(loc['uMotPtrQ[0]'] ?? null, state.ptrQ);
  gl.uniform4fv(loc['uMotPath[0]'] ?? null, state.path);
  gl.uniform4fv(loc['uMotPathI[0]'] ?? null, state.pathI);
}
