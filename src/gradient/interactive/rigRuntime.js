/* ShapeForge interaction runtime.
 *
 * Plain JavaScript on purpose: the app imports this file as a module and the exporter embeds the very same
 * source (via ?raw, with the `export` keyword stripped) into exported pages. Pointer physics, drives
 * and uniform packing therefore cannot drift between the editor preview and the exported result.
 *
 * Rules for this file: no imports, no DOM access outside the options passed in, and every top-level
 * declaration is either `export function` / `export const` or lives inside one of those functions. */

export const RIG_MAX_RULES = 8;
export const RIG_TRAIL_POINTS = 12;
export const RIG_MAX_CLICKS = 8;

const TAU = Math.PI * 2;
const clampNumber = (value, low, high) => Math.max(low, Math.min(high, value));
const finiteOr = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Exponential smoothing factor used by the "smooth" pointer response (0 ms = immediate). */
export function pointerSmoothingFactor(deltaSeconds, delayMs) {
  const delay = Math.max(0, delayMs) / 1000;
  return delay === 0 ? 1 : 1 - Math.exp(-Math.max(0, deltaSeconds) / delay);
}

/** Autonomous pointer path used by "Idle motion". Returns normalized x / y (0..1, y up). */
export function idleMotionPoint(path, clock, speed, size) {
  const s = Math.max(0.05, speed);
  const k = clampNumber(size, 0.05, 0.48);
  const t = clock * s;
  if (path === 'circle') return { x: 0.5 + Math.cos(t * 0.9) * k, y: 0.5 + Math.sin(t * 0.9) * k };
  if (path === 'figure8') return { x: 0.5 + Math.sin(t * 0.8) * k, y: 0.5 + Math.sin(t * 1.6) * k * 0.55 };
  if (path === 'scan') return { x: 0.5 + Math.sin(t * 0.55) * k * 1.1, y: 0.5 + Math.sin(t * 5.2) * k * 0.12 + Math.cos(t * 0.21) * k * 0.6 };
  if (path === 'wander') {
    return { x: 0.5 + (Math.sin(t * 0.37) + Math.sin(t * 0.71 + 1.3) * 0.5) * k * 0.66, y: 0.5 + (Math.sin(t * 0.53 + 2.1) + Math.sin(t * 0.97) * 0.5) * k * 0.66 };
  }
  return { x: 0.5 + Math.sin(t * 0.17) * k, y: 0.5 + Math.sin(t * 0.23 + 1.4) * k * 0.86 };
}

function hexToRgbArray(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(typeof hex === 'string' ? hex : '');
  const value = match ? parseInt(match[1], 16) : 0xffffff;
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

/** Creates the pointer / touch / click / trail state machine shared by the editor and exported pages. */
export function createPointerEngine(initial) {
  let o = Object.assign({
    touchEnabled: true, ripplesEnabled: true, maximumRipples: 5, delay: 85,
    physics: 'smooth', stiffness: 170, damping: 0.55,
    trailLife: 0.9, pressAttack: 0.06, pressRelease: 0.35, holdTime: 1.2,
  }, initial || {});
  const target = { x: 0.5, y: 0.5, active: 0, down: 0 };
  const current = { x: 0.5, y: 0.5, vx: 0, vy: 0, active: 0, down: 0 };
  const spring = { vx: 0, vy: 0 };
  const second = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: 0, tActive: 0, id: null, angle0: 0 };
  const state = {
    x: 0.5, y: 0.5, vx: 0, vy: 0, active: 0, down: 0,
    press: 0, speed: 0, hold: 0, sinceClick: 1e6, clock: 0, trailLife: 0.9,
    t2x: 0.5, t2y: 0.5, t2active: 0, pinch: 0, twist: 0,
  };
  let primaryId = null;
  let press = 0;
  let speedValue = 0;
  let holdStart = -1;
  let lastClickAt = -1e6;
  let pinch = 0;
  let twist = 0;
  let clicks = [];
  let trail = [];
  let clock = 0;

  const isTouchKind = kind => kind === 'touch' || kind === 'pen';
  const acceptsKind = kind => !(kind === 'touch' && !o.touchEnabled);

  function assignPointer(id, x, y, kind) {
    if (!acceptsKind(kind)) return null;
    if (primaryId === null || primaryId === id || !isTouchKind(kind)) {
      primaryId = id;
      target.x = x; target.y = y; target.active = 1;
      return 'primary';
    }
    if (second.id === null || second.id === id) {
      second.id = id;
      second.tx = x; second.ty = y; second.tActive = 1;
      return 'second';
    }
    return null;
  }

  function secondAngle() {
    return Math.atan2(second.ty - target.y, second.tx - target.x);
  }

  return {
    setOptions(next) { o = Object.assign(o, next || {}); const max = clampNumber(Math.floor(o.maximumRipples), 1, RIG_MAX_CLICKS); if (clicks.length > max) clicks = clicks.slice(-max); },
    move(id, x, y, kind) {
      assignPointer(id, x, y, kind);
    },
    down(id, x, y, kind) {
      const role = assignPointer(id, x, y, kind);
      if (role === 'primary') {
        target.down = 1;
        holdStart = clock;
        lastClickAt = clock;
        if (o.ripplesEnabled) {
          clicks.push({ x, y, t: clock, s: 1 });
          clicks = clicks.slice(-clampNumber(Math.floor(o.maximumRipples), 1, RIG_MAX_CLICKS));
        }
      } else if (role === 'second') {
        second.angle0 = secondAngle();
        second.x = x; second.y = y;
      }
    },
    up(id) {
      if (id === primaryId) { target.down = 0; holdStart = -1; }
      if (id === second.id) { second.tActive = 0; second.id = null; }
    },
    leave(id, kind) {
      if (id === second.id) { second.tActive = 0; second.id = null; return; }
      if (id === primaryId || !isTouchKind(kind)) { target.active = 0; target.down = 0; holdStart = -1; primaryId = null; }
    },
    reset() {
      target.x = 0.5; target.y = 0.5; target.active = 0; target.down = 0;
      current.x = 0.5; current.y = 0.5; current.vx = 0; current.vy = 0; current.active = 0; current.down = 0;
      spring.vx = 0; spring.vy = 0;
      second.active = 0; second.tActive = 0; second.id = null;
      press = 0; speedValue = 0; holdStart = -1; lastClickAt = -1e6; pinch = 0; twist = 0;
      clicks = []; trail = []; primaryId = null;
    },
    hasActivity() {
      return Math.abs(target.x - current.x) > 0.001 || Math.abs(target.y - current.y) > 0.001
        || Math.abs(target.active - current.active) > 0.003 || Math.abs(target.down - current.down) > 0.003
        || Math.abs(current.vx) > 0.003 || Math.abs(current.vy) > 0.003
        || Math.abs(spring.vx) > 0.003 || Math.abs(spring.vy) > 0.003
        || press > 0.003 || clicks.length > 0 || trail.length > 0 || second.active > 0.003 || second.tActive > 0;
    },
    getClicks() { return clicks; },
    getTrail() { return trail; },
    /** Advances the simulation. `nowSeconds` is the renderer clock; the returned object is reused every call. */
    advance(deltaSeconds, nowSeconds) {
      const dt = Math.max(0, deltaSeconds);
      clock = nowSeconds;
      const fade = o.physics === 'spring' ? 1 - Math.exp(-dt / 0.05) : pointerSmoothingFactor(dt, o.delay);
      const priorX = current.x;
      const priorY = current.y;
      if (o.physics === 'spring') {
        const k = clampNumber(finiteOr(o.stiffness, 170), 20, 900);
        const c = 2 * clampNumber(finiteOr(o.damping, 0.55), 0.05, 2) * Math.sqrt(k);
        let left = Math.min(dt, 0.1);
        while (left > 1e-6) {
          const h = Math.min(left, 1 / 120);
          spring.vx += (k * (target.x - current.x) - c * spring.vx) * h;
          spring.vy += (k * (target.y - current.y) - c * spring.vy) * h;
          current.x += spring.vx * h;
          current.y += spring.vy * h;
          left -= h;
        }
        current.x = clampNumber(current.x, -0.25, 1.25);
        current.y = clampNumber(current.y, -0.25, 1.25);
        current.vx = clampNumber(spring.vx, -2, 2);
        current.vy = clampNumber(spring.vy, -2, 2);
      } else {
        current.x += (target.x - current.x) * fade;
        current.y += (target.y - current.y) * fade;
        const blend = 1 - Math.exp(-dt * 8);
        const step = Math.max(dt, 1 / 240);
        current.vx += (clampNumber((current.x - priorX) / step, -2, 2) - current.vx) * blend;
        current.vy += (clampNumber((current.y - priorY) / step, -2, 2) - current.vy) * blend;
      }
      current.active += (target.active - current.active) * fade;
      current.down += (target.down - current.down) * fade;
      if (target.active === 0 && current.active < 0.003) current.active = 0;

      const tau = target.down > current.down || target.down > 0.5 ? Math.max(0.005, o.pressAttack) : Math.max(0.005, o.pressRelease);
      press += (target.down - press) * (1 - Math.exp(-dt / tau));
      if (press < 0.002 && target.down === 0) press = 0;
      const rawSpeed = clampNumber(Math.hypot(current.vx, current.vy) * 1.5, 0, 1);
      speedValue += (rawSpeed - speedValue) * (1 - Math.exp(-dt * 10));
      const hold = holdStart < 0 ? 0 : clampNumber((clock - holdStart) / Math.max(0.05, o.holdTime), 0, 1);

      // trail: a short history of the smoothed pointer, newest first when packed
      const life = Math.max(0.1, o.trailLife);
      if (current.active > 0.02) {
        const last = trail[trail.length - 1];
        if (!last || Math.hypot(current.x - last.x, current.y - last.y) > 0.018) {
          trail.push({ x: current.x, y: current.y, t: clock });
          if (trail.length > RIG_TRAIL_POINTS) trail.shift();
        }
      }
      if (trail.length) trail = trail.filter(point => clock - point.t < life);
      clicks = clicks.filter(click => clock - click.t < 5);

      // second finger: pinch (distance) and twist (relative angle)
      second.active += (second.tActive - second.active) * (1 - Math.exp(-dt / 0.06));
      if (second.tActive) { second.x += (second.tx - second.x) * fade; second.y += (second.ty - second.y) * fade; }
      if (second.active < 0.003 && !second.tActive) second.active = 0;
      if (second.active > 0.01) {
        const distance = Math.hypot(second.x - current.x, second.y - current.y);
        pinch = clampNumber(distance / 0.6, 0, 1);
        let delta = secondAngle() - second.angle0;
        while (delta > Math.PI) delta -= TAU;
        while (delta < -Math.PI) delta += TAU;
        twist = delta;
      } else { pinch = 0; twist = 0; }

      state.x = current.x; state.y = current.y; state.vx = current.vx; state.vy = current.vy;
      state.active = current.active; state.down = current.down;
      state.press = press; state.speed = speedValue; state.hold = hold;
      state.sinceClick = clock - lastClickAt; state.clock = clock; state.trailLife = life;
      state.t2x = second.x; state.t2y = second.y; state.t2active = second.active;
      state.pinch = pinch; state.twist = twist;
      return state;
    },
  };
}

/** Allocates the typed arrays that `evaluateRig` writes and the renderer uploads. */
export function createRigBuffers() {
  return {
    b: new Float32Array(RIG_MAX_RULES * 4),
    c: new Float32Array(RIG_MAX_RULES * 4),
    d: new Float32Array(RIG_MAX_RULES * 4),
    e: new Float32Array(RIG_MAX_RULES * 4),
    f: new Float32Array(RIG_MAX_RULES * 4),
    g: new Float32Array(RIG_MAX_RULES * 4),
    h: new Float32Array(RIG_MAX_RULES * 4),
    i: new Float32Array(RIG_MAX_RULES * 4),
    trail: new Float32Array(RIG_TRAIL_POINTS * 4),
    count: 0,
  };
}

function curveValue(curve, value) {
  const v = clampNumber(value, 0, 1);
  if (curve === 'ease') return v * v * (3 - 2 * v);
  if (curve === 'invert') return 1 - v;
  if (curve === 'step') return v > 0.5 ? 1 : 0;
  if (curve === 'sqrt') return Math.sqrt(v);
  return v;
}

function driveValue(drive, f, extra) {
  const rate = Math.max(0.01, finiteOr(drive.rate, 0.5));
  const t = f.clock * rate;
  switch (drive.source) {
    case 'always': return 1;
    case 'hover': return f.active;
    case 'press': return f.press;
    case 'hold': return f.hold;
    case 'click': return Math.exp(-Math.max(0, f.sinceClick) / Math.max(0.05, rate));
    case 'speed': return f.speed;
    case 'still': return (1 - f.speed) * f.active;
    case 'pointerX': return clampNumber(f.x, 0, 1);
    case 'pointerY': return clampNumber(f.y, 0, 1);
    case 'lfoSine': return 0.5 + 0.5 * Math.sin(t * TAU);
    case 'lfoTri': return Math.abs(2 * (t - Math.floor(t + 0.5)));
    case 'lfoSaw': return t - Math.floor(t);
    case 'lfoSquare': return t - Math.floor(t) < 0.5 ? 1 : 0;
    case 'lfoNoise': return valueNoise1(t * 2 + extra * 7.31);
    case 'pinch': return f.pinch;
    case 'twist': return clampNumber(0.5 + f.twist / TAU, 0, 1);
    default: return 1;
  }
}

function applyDrive(value, mode, depth, v) {
  const d = clampNumber(depth, 0, 2);
  if (mode === 'boost') return value * (1 + d * v);
  if (mode === 'swing') return value * (1 + d * (2 * v - 1));
  return value * (1 - Math.min(d, 1) + Math.min(d, 1) * v);
}

function sourceActivity(source, f) {
  if (source === 'pointer' || source === 'symmetry') return f.active;
  if (source === 'touch2') return f.t2active;
  return 1;
}

/** Evaluates drives and packs the enabled rules into uniform arrays (same order the shader was generated in). */
export function evaluateRig(rig, frame, buffers, options) {
  const opts = Object.assign({ radiusScale: 0.28, reaction: 1, enabled: true }, options || {});
  const out = buffers;
  let count = 0;
  const rules = rig && rig.rules ? rig.rules : [];
  for (let r = 0; r < rules.length && count < RIG_MAX_RULES; r++) {
    const rule = rules[r];
    if (!rule || !rule.enabled) continue;
    const values = [
      finiteOr(rule.amount, 1) * finiteOr(rig.gain, 1) * opts.reaction,
      Math.max(0.005, finiteOr(rule.radius, 1) * opts.radiusScale),
      finiteOr(rule.p && rule.p[0], 0), finiteOr(rule.p && rule.p[1], 0),
      finiteOr(rule.p && rule.p[2], 0), finiteOr(rule.p && rule.p[3], 0),
    ];
    const drives = rule.drives || [];
    for (let k = 0; k < drives.length; k++) {
      const drive = drives[k];
      const slot = drive.target === 'amount' ? 0 : drive.target === 'radius' ? 1 : drive.target === 'p1' ? 2 : drive.target === 'p2' ? 3 : drive.target === 'p3' ? 4 : drive.target === 'p4' ? 5 : -1;
      if (slot < 0) continue;
      const v = curveValue(drive.curve, driveValue(drive, frame, r * 3 + k));
      values[slot] = applyDrive(values[slot], drive.mode, finiteOr(drive.depth, 1), v);
    }
    const activity = opts.enabled ? sourceActivity(rule.source, frame) : 0;
    const base = count * 4;
    out.b[base] = values[0] * activity;
    out.b[base + 1] = Math.max(0.005, values[1]);
    out.b[base + 2] = values[2];
    out.b[base + 3] = values[3];
    out.d[base] = values[4];
    out.d[base + 1] = values[5];
    out.d[base + 2] = finiteOr(rule.sp1, 0);
    out.d[base + 3] = finiteOr(rule.sp2, 0);
    out.c[base] = Math.max(0.05, finiteOr(rule.aspect, 1));
    out.c[base + 1] = finiteOr(rule.rotation, 0) * Math.PI / 180;
    out.c[base + 2] = clampNumber(finiteOr(rule.edge, 0), 0, 1);
    out.c[base + 3] = finiteOr(rule.shapeN, 5);
    const rgb = hexToRgbArray(rule.color);
    out.e[base] = rgb[0]; out.e[base + 1] = rgb[1]; out.e[base + 2] = rgb[2]; out.e[base + 3] = 1;
    out.f[base] = clampNumber(finiteOr(rule.fadePower, 1), 0.25, 4);
    out.f[base + 1] = clampNumber(finiteOr(rule.fadeWidth, 1), 0.25, 2);
    out.f[base + 2] = 0; out.f[base + 3] = 0;
    out.g[base] = clampNumber(finiteOr(rule.fadeStart, 0), 0, 0.95);
    out.g[base + 1] = clampNumber(finiteOr(rule.fadeSoftness, 0), 0, 1);
    out.g[base + 2] = clampNumber(finiteOr(rule.fadeOpacity, 1), 0, 1);
    const fadeMode = rule.fadeMode === 'horizontal' ? 1 : rule.fadeMode === 'vertical' ? 2 : rule.fadeMode === 'angle' ? 3 : 0;
    out.g[base + 3] = fadeMode + (rule.fadeInvert ? 4 : 0);
    const texture = rule.texture || {};
    const textureScale = Math.max(1, finiteOr(texture.scale, 36));
    out.h[base] = textureScale;
    out.h[base + 1] = finiteOr(texture.offsetX, 0) / textureScale;
    out.h[base + 2] = finiteOr(texture.offsetY, 0) / textureScale;
    out.h[base + 3] = texture.enabled === true ? 1 : 0;
    const cssFx = rule.cssFx && rule.cssFx.enabled ? rule.cssFx.params || {} : {};
    out.i[base] = finiteOr(cssFx.amount, finiteOr(cssFx.angle, 0));
    out.i[base + 1] = finiteOr(cssFx.angle, 0);
    out.i[base + 2] = finiteOr(cssFx.amount, 0);
    count++;
  }
  for (let i = count * 4; i < RIG_MAX_RULES * 4; i++) { out.b[i] = 0; out.c[i] = 0; out.d[i] = 0; out.e[i] = 0; out.f[i] = 0; out.g[i] = 0; out.h[i] = 0; out.i[i] = 0; }
  out.count = count;
  return out;
}

/** Packs the pointer trail (newest first) as x, y, weight, age for the shader. */
export function packTrail(engine, frame, buffers, enabled) {
  const out = buffers.trail;
  out.fill(0);
  if (!enabled) return 0;
  const trail = engine.getTrail();
  const life = Math.max(0.1, frame.trailLife || 0.9);
  let index = 0;
  if (frame.active > 0.02) {
    out[0] = frame.x; out[1] = frame.y; out[2] = Math.min(1, frame.active); out[3] = 0;
    index = 1;
  }
  for (let i = trail.length - 1; i >= 0 && index < RIG_TRAIL_POINTS; i--) {
    const point = trail[i];
    const age = Math.max(0, frame.clock - point.t);
    const weight = Math.pow(Math.max(0, 1 - age / life), 1.6);
    if (weight <= 0.001) continue;
    const at = index * 4;
    out[at] = point.x; out[at + 1] = point.y; out[at + 2] = weight; out[at + 3] = age;
    index++;
  }
  return index;
}
