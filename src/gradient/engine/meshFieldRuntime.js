/* Mesh-field runtime: a dependency-free JavaScript twin of meshField.ts (+ the colour science and noise it uses).
 *
 * The studio draws the smooth mesh field with the TypeScript renderer. Exports cannot ship TypeScript, so this file carries the
 * same maths for exported pages: `renderPreparedMeshField` here and in meshField.ts produce the same pixels (meshFieldRuntime.test.ts
 * checks every blend method, colour space and edge mode against the TypeScript reference). It is also what the page script runs.
 *
 *   prepareMeshField(input, settings, aspect, time) → prepared field
 *   renderPreparedMeshField(field, width, height)   → straight-alpha RGBA bytes
 *   mountMeshFields(root)                           → paints every <canvas data-sf-mesh-field="{json}"> under root
 */

const TAU = Math.PI * 2;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const mixn = (a, b, t) => a + (b - a) * t;
const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);

function hexToUnit(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : [0, 0, 0];
}

function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToLinear(L, a, b) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
function encodeColor(rgb, space) {
  if (space === 'srgb') return [rgb[0], rgb[1], rgb[2]];
  const lin = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
  if (space === 'linear') return lin;
  const lab = linearToOklab(lin[0], lin[1], lin[2]);
  return space === 'oklab' ? lab : [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])];
}
const inGamut = c => c[0] >= -1e-4 && c[0] <= 1.0001 && c[1] >= -1e-4 && c[1] <= 1.0001 && c[2] >= -1e-4 && c[2] <= 1.0001;
function decodeColor(v, space) {
  if (space === 'srgb') return [clamp01(v[0]), clamp01(v[1]), clamp01(v[2])];
  if (space === 'linear') return [clamp01(linearToSrgb(v[0])), clamp01(linearToSrgb(v[1])), clamp01(linearToSrgb(v[2]))];
  let L = v[0], a, b;
  if (space === 'oklch') { a = v[1] * Math.cos(v[2]); b = v[1] * Math.sin(v[2]); } else { a = v[1]; b = v[2]; }
  L = L < 0 ? 0 : L > 1 ? 1 : L;
  let lin = oklabToLinear(L, a, b);
  if (!inGamut(lin)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 12; i++) {
      const k = (lo + hi) / 2, t = oklabToLinear(L, a * k, b * k);
      if (inGamut(t)) lo = k; else hi = k;
    }
    lin = oklabToLinear(L, a * lo, b * lo);
  }
  return [clamp01(linearToSrgb(lin[0])), clamp01(linearToSrgb(lin[1])), clamp01(linearToSrgb(lin[2]))];
}
const ditherAt = (x, y) => { const v = 52.9829189 * (0.06711056 * x + 0.00583715 * y); return v - Math.floor(v) - 0.5; };

/* ───────── deterministic noise (integer hash, identical to fieldNoise.ts) ───────── */
function hashInt(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul((seed | 0) + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
const hash2 = (ix, iy, seed) => hashInt(ix, iy, seed) / 4294967296;
const fadeCurve = t => t * t * t * (t * (t * 6 - 15) + 10);
const GX = new Float64Array(256), GY = new Float64Array(256);
for (let i = 0; i < 256; i++) { const a = (i / 256) * TAU; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }
function gnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const g = (cx, cy, dx, dy) => { const k = hashInt(cx, cy, seed) >>> 24; return GX[k] * dx + GY[k] * dy; };
  const u = fadeCurve(fx), v = fadeCurve(fy);
  const n00 = g(ix, iy, fx, fy), n10 = g(ix + 1, iy, fx - 1, fy), n01 = g(ix, iy + 1, fx, fy - 1), n11 = g(ix + 1, iy + 1, fx - 1, fy - 1);
  const top = n00 + (n10 - n00) * u, bottom = n01 + (n11 - n01) * u;
  return (top + (bottom - top) * v) * 1.41421356;
}
function fbm(x, y, seed, octaves) {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += gnoise(fx, fy, seed + i * 31) * amp;
    norm += amp; amp *= 0.5;
    const rx = fx * 0.8 - fy * 0.6, ry = fx * 0.6 + fy * 0.8;
    fx = rx * 2 + 17.3; fy = ry * 2 + 9.1;
  }
  return sum / norm;
}
function rng(seed) {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───────── the field ───────── */
const DEFAULTS = { method: 'gaussian', space: 'oklab', spread: 1, sharpness: 0.42, edge: 'extend', warp: 0, warpScale: 2, flow: 0.25, grain: 0, saturation: 1, contrast: 1 };

function prepareMeshField(input, raw, aspect, time) {
  const settings = Object.assign({}, DEFAULTS, raw || {});
  const pts = input.points.slice(0, 128), n = pts.length, H = 1 / Math.max(0.05, aspect);
  const f64 = () => new Float64Array(n);
  const p = {
    n, settings, aspect, H, time: time || 0, seed: input.seed == null ? 7 : input.seed,
    base: input.base ? hexToUnit(input.base) : null,
    cx: f64(), cy: f64(), cs: f64(), sn: f64(), ix: f64(), iy: f64(), lnS: f64(), plateau: f64(), alpha: f64(), e0: f64(), e1: f64(), e2: f64(), conf: f64(), lw: f64(),
    warpAmt: settings.warp * 0.13, phase: [],
  };
  const r = rng((input.seed == null ? 7 : input.seed) * 977 + 5);
  p.phase = Array.from({ length: 6 }, () => r());
  const meshCore = input.core == null ? 40 : input.core;
  pts.forEach((pt, i) => {
    const t = pt.transform || {};
    p.cx[i] = (pt.x + (t.x || 0)) / 100;
    p.cy[i] = ((pt.y + (t.y || 0)) / 100) * H;
    const radius = Math.max(0.01, (pt.size * (t.scale == null ? 1 : t.scale)) / 100) * settings.spread;
    const stretch = Math.sqrt(Math.min(4, Math.max(0.25, pt.aspect == null ? 1 : pt.aspect)));
    const angle = ((pt.angle || 0) * Math.PI) / 180;
    p.cs[i] = Math.cos(angle); p.sn[i] = Math.sin(angle);
    p.ix[i] = 1 / (radius * stretch); p.iy[i] = stretch / radius;
    p.lnS[i] = Math.log(Math.max(1e-4, pt.strength == null ? 1 : pt.strength));
    p.plateau[i] = (Math.min(100, Math.max(0, pt.core == null ? meshCore : pt.core)) / 100) * 0.3;
    p.alpha[i] = clamp01(pt.alpha);
    const e = encodeColor(hexToUnit(pt.color), settings.space);
    p.e0[i] = e[0]; p.e1[i] = e[1]; p.e2[i] = e[2];
    p.conf[i] = settings.space === 'oklch' ? e[1] / (e[1] + 0.03) : 1;
  });
  return p;
}

function logit(f, i, q2) {
  const sharp = f.settings.sharpness;
  switch (f.settings.method) {
    case 'idw': return f.lnS[i] - 0.5 * mixn(1.6, 4.2, sharp) * Math.log(q2 + 0.03);
    case 'imq': { const e = mixn(2.5, 9, sharp); return f.lnS[i] - Math.log(1 + e * e * q2); }
    case 'wendland': {
      const q = Math.sqrt(q2) / mixn(2, 0.9, sharp);
      const w = q < 1 ? Math.pow(1 - q, 4) * (4 * q + 1) : 0;
      return f.lnS[i] + Math.log(w + 2e-4 / (1 + q2));
    }
    case 'cells': return f.lnS[i] - q2 / (1.0 * Math.pow(0.03, sharp));
    default: {
      const e = Math.max(0, Math.sqrt(q2) - f.plateau[i]);
      return f.lnS[i] - mixn(2.5, 16, sharp) * e * e;
    }
  }
}

function grade(rgb, saturation, contrast) {
  const lab = linearToOklab(srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2]));
  const L = Math.min(1, Math.max(0, 0.5 + (lab[0] - 0.5) * contrast));
  let lin = oklabToLinear(L, lab[1] * saturation, lab[2] * saturation);
  if (lin.some(c => c < -1e-4 || c > 1.0001)) lin = oklabToLinear(L, lab[1] * saturation * 0.7, lab[2] * saturation * 0.7);
  return [clamp01(linearToSrgb(lin[0])), clamp01(linearToSrgb(lin[1])), clamp01(linearToSrgb(lin[2]))];
}

function sampleMeshField(f, u, v, out) {
  const s = f.settings, n = f.n;
  if (!n) { out[0] = out[1] = out[2] = 0; out[3] = 0; return; }
  let X = u, Y = v * f.H;
  if (f.warpAmt > 0) {
    const t = f.time * s.flow * 0.15, A = f.warpAmt;
    if (s.edge === 'wrap') {
      const m = Math.max(1, Math.round(s.warpScale / 1.5)), p = f.phase, ph = t * TAU;
      X += A * (Math.sin(TAU * (m * u + 2 * v + p[0]) + ph) + 0.5 * Math.sin(TAU * (2 * m * u - v + p[1]) - ph * 1.3));
      Y += A * (Math.sin(TAU * (2 * u + m * v + p[2]) - ph) + 0.5 * Math.sin(TAU * (-u + 3 * m * v + p[3]) + ph * 0.8));
    } else {
      const k = s.warpScale, qx = fbm(X * k + t, Y * k, f.seed, 2), qy = fbm(X * k + 5.2, Y * k + 1.3 - t, f.seed + 7, 2);
      X += fbm(X * k + 3 * qx + 1.7, Y * k + 3 * qy + 9.2, f.seed + 13, 2) * A * 2.2;
      Y += fbm(X * k + 3 * qx + 8.3, Y * k + 3 * qy + 2.8, f.seed + 19, 2) * A * 2.2;
    }
  }
  const wrap = s.edge === 'wrap', lw = f.lw;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    let dx = X - f.cx[i], dy = Y - f.cy[i];
    if (wrap) { dx -= Math.round(dx); dy -= Math.round(dy / f.H) * f.H; }
    const rx = (dx * f.cs[i] + dy * f.sn[i]) * f.ix[i], ry = (dy * f.cs[i] - dx * f.sn[i]) * f.iy[i];
    const l = logit(f, i, rx * rx + ry * ry);
    lw[i] = l;
    if (l > max) max = l;
  }
  let sum = 0, a0 = 0, a1 = 0, a2 = 0, alpha = 0, raw = 0;
  const lch = s.space === 'oklch', fade = s.edge === 'fade';
  for (let i = 0; i < n; i++) {
    const w = Math.exp(lw[i] - max);
    sum += w; alpha += w * f.alpha[i];
    if (fade) raw += Math.exp(lw[i]) * f.alpha[i];
    if (lch) { const c = f.conf[i]; a0 += w * f.e0[i]; a1 += w * f.e1[i]; a2 += w * c * Math.cos(f.e2[i]); lw[i] = w * c * Math.sin(f.e2[i]); }
    else { a0 += w * f.e0[i]; a1 += w * f.e1[i]; a2 += w * f.e2[i]; }
  }
  const inv = 1 / Math.max(sum, 1e-30);
  let rgb;
  if (lch) {
    let hy = 0;
    for (let i = 0; i < n; i++) hy += lw[i];
    rgb = decodeColor([a0 * inv, a1 * inv, Math.atan2(hy * inv, a2 * inv)], 'oklch');
  } else rgb = decodeColor([a0 * inv, a1 * inv, a2 * inv], s.space);
  if (s.saturation !== 1 || s.contrast !== 1) rgb = grade(rgb, s.saturation, s.contrast);
  let a = clamp01(alpha * inv);
  if (fade) a *= 1 - Math.exp(-3 * raw);
  if (f.base) {
    out[0] = rgb[0] * a + f.base[0] * (1 - a); out[1] = rgb[1] * a + f.base[1] * (1 - a); out[2] = rgb[2] * a + f.base[2] * (1 - a); out[3] = 1;
  } else { out[0] = rgb[0]; out[1] = rgb[1]; out[2] = rgb[2]; out[3] = a; }
}

function renderPreparedMeshField(f, width, height, options) {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const data = new Uint8ClampedArray(w * h * 4), px = new Float32Array(4);
  const finish = !options || options.finish !== false, grain = finish ? f.settings.grain : 0, seed = f.seed | 0;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      sampleMeshField(f, (x + 0.5) / w, v, px);
      const g = finish ? ditherAt(x, y) / 255 + (grain > 0 ? (hash2(x, y, seed) - 0.5) * grain * 0.1 : 0) : 0, o = (y * w + x) * 4;
      data[o] = (px[0] + g) * 255 + 0.5; data[o + 1] = (px[1] + g) * 255 + 0.5; data[o + 2] = (px[2] + g) * 255 + 0.5; data[o + 3] = px[3] * 255 + 0.5;
    }
  }
  return data;
}

/* ───────── page script: paints exported canvases ───────── */
const PREVIEW_EDGE = 192;

function mountMeshFields(root) {
  const scope = root && root.querySelectorAll ? root : document;
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  scope.querySelectorAll('canvas[data-sf-mesh-field]').forEach(canvas => {
    if (canvas.getAttribute('data-sf-ready')) return;
    let config;
    try { config = JSON.parse(canvas.getAttribute('data-sf-mesh-field') || ''); } catch (error) { return; }
    const context = canvas.getContext('2d');
    if (!config || !config.input || !context) return;
    const aspect = config.aspect || 1;
    const width = Math.max(1, Math.round(config.width || (aspect >= 1 ? PREVIEW_EDGE : PREVIEW_EDGE * aspect)));
    const height = Math.max(1, Math.round(config.height || (aspect >= 1 ? PREVIEW_EDGE / aspect : PREVIEW_EDGE)));
    canvas.width = width; canvas.height = height;
    const field = prepareMeshField(config.input, config.settings, aspect, 0);
    const animate = field.settings.warp > 0 && field.settings.flow > 0 && !reduceMotion;
    const paint = () => {
      const image = context.createImageData(width, height);
      image.data.set(renderPreparedMeshField(field, width, height));
      context.putImageData(image, 0, 0);
    };
    paint();
    canvas.setAttribute('data-sf-ready', '1');
    if (canvas.parentElement) canvas.parentElement.style.backgroundImage = 'none';
    if (!animate) return;
    let frame = 0, last = 0, visible = true;
    const started = performance.now();
    const tick = now => {
      frame = 0;
      if (!visible || document.hidden) return;
      if (now - last >= 1000 / 12) { last = now; field.time = (now - started) / 1000; paint(); }
      frame = requestAnimationFrame(tick);
    };
    const wake = () => { if (!frame && visible && !document.hidden) frame = requestAnimationFrame(tick); };
    if (typeof IntersectionObserver === 'function') new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); wake(); }).observe(canvas);
    document.addEventListener('visibilitychange', wake);
    wake();
  });
}

export { prepareMeshField, sampleMeshField, renderPreparedMeshField, mountMeshFields };
