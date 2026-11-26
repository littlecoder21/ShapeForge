/* ShapeForge motion field — the CPU twin of the GPU field in glsl.ts.
 *
 * It reads the very same packed buffers that stepMotion() uploads (state.a … state.t3), so what the editor draws (flow arrows,
 * heat map, falloff rings) and what the tests check is the field the shader evaluates. Noise uses the same sine-free hash, with
 * Math.fround where the GPU would round to 32 bit, so gradient-noise types agree with the GPU to a small tolerance and every other
 * type agrees to rounding.
 *
 * Space: q = (uv − ½) · (aspect, 1), i.e. screen heights, centred, y up. Velocities are screen heights per second.
 * Plain JavaScript with no imports; nothing here allocates per call except `evaluateFlow`'s small scratch (module level). */

const fr = Math.fround;
const fract = value => value - Math.floor(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

const H = [0, 0];
const K1 = fr(0.1031), K2 = fr(0.103), K3 = fr(0.0973), K4 = fr(33.33);
function hash2(px, py) {
  px = ((px % 32) + 32) % 32; py = ((py % 32) + 32) % 32;
  let ax = fract(fr(px * K1)), ay = fract(fr(py * K2)), az = fract(fr(px * K3));
  const d = fr(fr(ax * fr(ay + K4)) + fr(ay * fr(az + K4)) + fr(az * fr(ax + K4)));
  ax = fr(ax + d); ay = fr(ay + d); az = fr(az + d);
  H[0] = fract(fr(fr(ax + ay) * az)) * 2 - 1;
  H[1] = fract(fr(fr(ax + az) * ay)) * 2 - 1;
}
export function gradientNoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  hash2(ix, iy); const a = H[0] * fx + H[1] * fy;
  hash2(ix + 1, iy); const b = H[0] * (fx - 1) + H[1] * fy;
  hash2(ix, iy + 1); const c = H[0] * fx + H[1] * (fy - 1);
  hash2(ix + 1, iy + 1); const d = H[0] * (fx - 1) + H[1] * (fy - 1);
  return mix(mix(a, b, ux), mix(c, d, ux), uy) * 1.25;
}
export function fbm(px, py, oct, pers, lac, kind) {
  let v = 0, a = 0.5, norm = 0;
  for (let i = 0; i < 6; i++) {
    if (i >= oct) break;
    let n = gradientNoise(px, py);
    if (kind > 0.5 && kind < 1.5) n = Math.sign(n) * Math.sqrt(Math.abs(n));
    else if (kind > 1.5) n = 0.7 - 2 * Math.abs(n);
    v += n * a; norm += a;
    const nx = (0.8 * px - 0.6 * py) * lac + 7.1, ny = (0.6 * px + 0.8 * py) * lac + 3.7;
    px = nx; py = ny; a *= pers;
  }
  return v / Math.max(norm, 1e-4);
}
function rot(x, y, angle, out, at = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  out[at] = c * x - s * y; out[at + 1] = s * x + c * y;
}
export function falloff(dist, radius, kind) {
  if (radius > 999) return 1;
  const q = Math.max(dist / Math.max(radius, 1e-4), 0);
  const edge = 1 - smoothstep(0.82, 1, q);
  if (kind < 0.5) return 1 - smoothstep(0.94, 1, q);
  if (kind < 1.5) return Math.max(1 - q, 0);
  if (kind < 2.5) return 1 - smoothstep(0, 1, q);
  if (kind < 3.5) return Math.exp(-q * q * 3.6) * edge;
  if (kind < 4.5) return Math.max(1 / (1 + 9 * q * q) - 0.1, 0) / 0.9 * edge;
  const r = (q - 0.6) * 3.2;
  return Math.exp(-r * r) * edge;
}
export function softLimit(l, m) { return l / Math.pow(1 + Math.pow(l / Math.max(m, 1e-4), 4), 0.25); }

const T = [0, 0];
const U = [0, 0];

/** Nearest point on a sampled path slot (in q space). Writes [px, py, tx, ty, dist] into `out`. */
function pathQuery(state, slot, qx, qy, aspect, out) {
  let best = 1e5, px = qx, py = qy, tx = 1, ty = 0;
  const base = slot * 16 * 4;
  for (let i = 0; i < 15; i++) {
    const a = base + i * 4, b = a + 4, P = state.path;
    const pax = (P[a] - 0.5) * aspect, pay = P[a + 1] - 0.5, pbx = (P[b] - 0.5) * aspect, pby = P[b + 1] - 0.5;
    const abx = pbx - pax, aby = pby - pay;
    const h = clamp(((qx - pax) * abx + (qy - pay) * aby) / Math.max(abx * abx + aby * aby, 1e-8), 0, 1);
    const cx = pax + abx * h, cy = pay + aby * h;
    const dd = Math.hypot(qx - cx, qy - cy);
    if (dd < best) {
      best = dd; px = cx; py = cy;
      const tlx = mix(P[a + 2], P[b + 2], h) * aspect, tly = mix(P[a + 3], P[b + 3], h);
      const l = Math.hypot(tlx + 1e-5, tly) || 1;
      tx = (tlx + 1e-5) / l; ty = tly / l;
    }
  }
  out[0] = px; out[1] = py; out[2] = tx; out[3] = ty; out[4] = best;
}
const PQ = [0, 0, 0, 0, 0];

/** One source's velocity direction (before strength / falloff) at q. Writes into `out` [vx, vy, distanceForFalloff]. */
export function evaluateSource(state, index, qx, qy, aspect, out) {
  const o = index * 4;
  const A = state.a, B = state.b, C = state.c, D = state.d, E = state.e, F = state.f;
  const type = Math.round(A[o]);
  const dx = qx - (A[o + 2] - 0.5) * aspect, dy = qy - (A[o + 3] - 0.5);
  let dist = Math.hypot(dx, dy);
  rot(dx, dy, -C[o + 1], T);
  const sc = Math.max(B[o + 3], 0.05);
  const dsx = T[0] / sc + F[o + 2], dsy = T[1] / sc + F[o + 3];
  const sdx = state.q[1] + E[o + 1], sdy = state.q[2] + E[o + 1] * 1.7;
  const tt = F[o] * F[o + 1], ft = F[o];
  const oct = state.q[0];
  const angle = C[o], phase = C[o + 2];
  const p1 = D[o], p2 = D[o + 1], p3 = D[o + 2], p4 = D[o + 3];
  let vx = 0, vy = 0;
  const r = Math.hypot(dsx, dsy);
  const hx = dsx / Math.max(r, 1e-4), hy = dsy / Math.max(r, 1e-4);
  switch (type) {
    case 0: { // directional
      let ang = angle;
      ang += p1 * (dsx * -Math.sin(angle) + dsy * Math.cos(angle)) * 0.9;
      if (p2 > 0.001) ang += p2 * gradientNoise(dsx * 0.8 + sdx + tt * 0.31, dsy * 0.8 + sdy - tt * 0.23) * 1.6;
      let spd = 1;
      if (p3 > 0.001) spd += p3 * gradientNoise(dsx * 1.3 + sdx + 5 - tt * 0.27, dsy * 1.3 + sdy + 9 + tt * 0.19);
      spd = Math.max(spd, 0);
      vx = Math.cos(ang) * spd; vy = Math.sin(ang) * spd;
      break;
    }
    case 1: { // curved
      const k = p1 * (1 + p3 * Math.sin(ft * 0.9 + phase));
      let around = Math.atan2(dsy, dsx) + 1.5707963 - angle;
      around = Math.atan2(Math.sin(around), Math.cos(around));
      const amt = clamp(Math.abs(k) * 0.5, 0, 1) * Math.sign(k);
      const lat = dsx * -Math.sin(angle) + dsy * Math.cos(angle);
      let a2 = angle + mix(k * lat * 0.9, around * amt, p4);
      if (p2 > 0.001) a2 += p2 * gradientNoise(dsx * 1.1 + sdx + 2 + tt * 0.3, dsy * 1.1 + sdy + 2 - tt * 0.2) * 1.5;
      vx = Math.cos(a2); vy = Math.sin(a2);
      break;
    }
    case 2: { // vortex
      const core = Math.max(p1, 0.02);
      const g = 2 * core * r / (r * r + core * core);
      rot((-hy * p4 + hx * p2) * g, (hx * p4 + hy * p2) * g, p3 * r * 4 + phase, T);
      vx = T[0]; vy = T[1];
      break;
    }
    case 3: { // spiral
      const prof = smoothstep(p2 * 0.35, p2 * 0.35 + 0.12, r);
      const tg = p4 * p1, rd = p3 * (1 - p1) * 1.4;
      rot((-hy * tg + hx * rd) * prof, (hx * tg + hy * rd) * prof, phase, T);
      vx = T[0]; vy = T[1];
      break;
    }
    case 4: { // radial
      const pulse = 1 + p2 * Math.sin(6.2831853 * p1 * ft + phase);
      const prof = smoothstep(p3 * 0.3, p3 * 0.3 + 0.15, r);
      vx = hx * p4 * pulse * prof; vy = hy * p4 * pulse * prof;
      break;
    }
    case 5: { // wave
      const dirx = Math.cos(angle), diry = Math.sin(angle);
      const pat = Math.floor(p2 + 0.5);
      let wx = dsx, wy = dsy;
      if (p4 > 0.001) { wx += p4 * 0.35 * gradientNoise(wx * 1.7 + sdx + tt * 0.2, wy * 1.7 + sdy + tt * 0.2); wy += p4 * 0.35 * gradientNoise(dsx * 1.7 + sdx + 4 - tt * 0.2, dsy * 1.7 + sdy + 4 - tt * 0.2); }
      const ph = ft * 0.6 + phase / 6.2831853;
      let s = wx * dirx + wy * diry;
      const wr = Math.hypot(wx, wy);
      if (pat < 0.5) s = wx; else if (pat < 1.5) s = wy; else if (pat < 2.5) s = (wx + wy) * 0.70710678;
      else if (pat < 3.5) s = wr; else if (pat < 4.5) s = Math.atan2(wy, wx) / 6.2831853 * Math.floor(p1 + 0.5);
      const fq = pat > 3.5 && pat < 4.5 ? 1 : p1;
      let w = Math.sin(6.2831853 * (fq * s - ph));
      if (pat > 5.5) w = 0.5 * (w + Math.sin(6.2831853 * (p1 * (wx * -diry + wy * dirx) * 0.83 - ph * 1.17)));
      if (p3 > 0.001) w += p3 * Math.sin(6.2831853 * (fq * 1.9 * s + ph * 0.7) + 1.7);
      const rhx = wx / Math.max(wr, 1e-4), rhy = wy / Math.max(wr, 1e-4);
      vx = dirx * w; vy = diry * w;
      if (pat > 2.5 && pat < 3.5) { vx = rhx * w; vy = rhy * w; } else if (pat > 3.5 && pat < 4.5) { vx = -rhy * w; vy = rhx * w; }
      break;
    }
    case 6: { // noise
      let qx2 = dsx, qy2 = dsy;
      if (p3 > 0.001) { qx2 += p3 * 0.6 * gradientNoise(dsx * 1.3 + sdx + tt * 0.21, dsy * 1.3 + sdy); qy2 += p3 * 0.6 * gradientNoise(dsx * 1.3 + sdx + 9.1, dsy * 1.3 + sdy - tt * 0.17); }
      const bx = qx2 + sdx + tt * 0.37, by = qy2 + sdy - tt * 0.29;
      const oc = Math.min(Math.floor(p1 + 0.5), oct);
      rot(fbm(bx, by, oc, p2, 2, p4) * 1.5, fbm(bx + 17.3, by + 31.7, oc, p2, 2, p4) * 1.5, angle, T);
      vx = T[0]; vy = T[1];
      break;
    }
    case 7: { // curl
      let qx2 = dsx, qy2 = dsy;
      if (p3 > 0.001) { qx2 += p3 * 0.5 * gradientNoise(dsx * 0.9 + sdx + tt * 0.13, dsy * 0.9 + sdy + 4); qy2 += p3 * 0.5 * gradientNoise(dsx * 0.9 + sdx + 11, dsy * 0.9 + sdy - tt * 0.11); }
      const bx = qx2 + sdx + tt * 0.31, by = qy2 + sdy + tt * 0.17;
      const oc = Math.min(Math.floor(p1 + 0.5), oct);
      const pers = mix(0.62, 0.28, p2), e = 0.05;
      const f0 = fbm(bx, by, oc, pers, 2, 0), fx = fbm(bx + e, by, oc, pers, 2, 0), fy = fbm(bx, by + e, oc, pers, 2, 0);
      rot((fy - f0) / e * 0.55, -(fx - f0) / e * 0.55, angle, T);
      vx = T[0]; vy = T[1];
      break;
    }
    case 8: { // magnetic
      const x = r / Math.max(p3, 0.02);
      const mag = 1.7 * x / (1 + Math.pow(x, p4 + 1));
      rot((-hx * p2 + -hy * p1) * mag, (-hy * p2 + hx * p1) * mag, phase, T);
      vx = T[0]; vy = T[1];
      break;
    }
    case 9: { // path
      pathQuery(state, E[o + 2] < 0.5 ? 0 : 1, qx, qy, aspect, PQ);
      const [px, py, tx, ty, pd] = PQ;
      dist = pd;
      const nx = -ty, ny = tx;
      const k = smoothstep(0, 0.25, pd) / Math.max(pd, 0.02);
      const side = (qx - px) * nx + (qy - py) * ny >= 0 ? 1 : -1;
      rot(tx * p3 + (px - qx) * k * p2 + nx * side * p4, ty * p3 + (py - qy) * k * p2 + ny * side * p4, phase, T);
      vx = T[0]; vy = T[1];
      break;
    }
    default: break;
  }
  out[0] = vx; out[1] = vy; out[2] = dist;
  return out;
}

const SRC = [0, 0, 0];
const STASH = new Float64Array(8 * 4);
/** The composed flow velocity at q (screen heights per second), including the global flow, composition mode, blends and the
 *  velocity limit. `extra` is a velocity that joins before the limit (the pointer's flow response). Writes [vx, vy]. */
export function evaluateFlow(state, qx, qy, aspect, out, extraX = 0, extraY = 0) {
  const count = state.count;
  const mode = state.g2[2];
  let sumX = 0, sumY = 0, sumM = 0, cnt = 0, bestMag = 0, bestX = 0, bestY = 0, domM = -1, domX = 0, domY = 0;
  let softN = 0, softX = 0, softY = 0, remain = 1, prioX = 0, prioY = 0, others = false;
  let stashCount = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const wgt = state.a[o + 1];
    if (wgt <= 0) continue;
    evaluateSource(state, i, qx, qy, aspect, SRC);
    const fall = falloff(SRC[2], state.b[o + 1], state.b[o + 2]) * state.c[o + 3];
    const ux = SRC[0] * state.b[o] * fall, uy = SRC[1] * state.b[o] * fall;
    const m = fall * wgt;
    const blend = state.e[o];
    if (blend < 0.5) {
      const uwx = ux * wgt, uwy = uy * wgt;
      sumX += uwx; sumY += uwy; sumM += m;
      if (fall > 0.002) cnt += 1;
      const mag = Math.hypot(uwx, uwy);
      if (mag > bestMag) { bestMag = mag; bestX = uwx; bestY = uwy; }
      if (m > domM) { domM = m; domX = uwx; domY = uwy; }
      const sw = Math.pow(Math.max(m, 1e-4), state.g2[0]);
      softN += sw; softX += uwx * sw; softY += uwy * sw;
      prioX += uwx * remain; prioY += uwy * remain;
      remain *= 1 - clamp(m, 0, 1);
    } else {
      STASH[stashCount++] = ux * wgt;
      STASH[stashCount++] = uy * wgt;
      STASH[stashCount++] = m;
      STASH[stashCount++] = blend;
      others = true;
    }
  }
  let sx = prioX, sy = prioY;
  if (mode < 0.5) { sx = sumX; sy = sumY; }
  else if (mode < 1.5) { const d = Math.max(1, sumM); sx = sumX / d; sy = sumY / d; }
  else if (mode < 2.5) { const d = Math.max(1, cnt); sx = sumX / d; sy = sumY / d; }
  else if (mode < 3.5) { sx = sumX; sy = sumY; const l = Math.hypot(sx, sy); if (l > bestMag) { const k = bestMag / Math.max(l, 1e-6); sx *= k; sy *= k; } }
  else if (mode < 4.5) { sx = bestX; sy = bestY; }
  else if (mode < 5.5) { sx = domX; sy = domY; }
  else if (mode < 6.5) { const d = Math.max(softN, 1e-9); sx = softX / d; sy = softY / d; }
  if (others) {
    for (let k = 0; k < stashCount; k += 4) {
      const ux = STASH[k], uy = STASH[k + 1], m = STASH[k + 2], blend = STASH[k + 3];
      if (blend < 1.5) { const f = 1 - clamp(Math.hypot(sx, sy) / Math.max(state.g0[3], 1e-4), 0, 1); sx += ux * f; sy += uy * f; }
      else if (blend < 2.5) { sx -= ux; sy -= uy; }
      else if (blend < 3.5) { const t = clamp(m, 0, 1); sx = mix(sx, ux, t); sy = mix(sy, uy, t); }
      else if (Math.hypot(ux, uy) > Math.hypot(sx, sy)) { sx = ux; sy = uy; }
    }
  }
  let vx = (sx * state.g1[2] + state.g1[0]) * state.g0[0] + extraX, vy = (sy * state.g1[2] + state.g1[1]) * state.g0[0] + extraY;
  const l = Math.hypot(vx, vy);
  if (!(l < 1e5)) { out[0] = 0; out[1] = 0; return out; }
  const cap = state.g0[3] * (state.g2[1] > 0.5 ? 1 : 4);
  const k = l > 1e-6 ? softLimit(l, cap) / l : 1;
  out[0] = vx * k; out[1] = vy * k;
  return out;
}

/** Independent turbulence displacement (screen heights). `kind` is the TURBULENCE_KIND name. */
export function evaluateTurbulence(state, kind, qx, qy, aspect, out) {
  const amp = state.t0[0];
  if (amp <= 1e-5) { out[0] = 0; out[1] = 0; return out; }
  const tt = state.t2[0];
  const sdx = state.q[1] + 41, sdy = state.q[2] + 13;
  let mask = 1;
  if (state.t3[2] > 0.001) mask = 1 - smoothstep(0, 1, Math.hypot(qx - (state.t3[0] - 0.5) * aspect, qy - (state.t3[1] - 0.5)) / state.t3[2]);
  rot(qx, qy, state.t1[3] + state.t3[3] * tt * 0.23, T);
  let px = T[0], py = T[1];
  if (state.t1[1] > 0.001) {
    const wx = gradientNoise(px * state.t1[2] + sdx + tt * 0.4, py * state.t1[2] + sdy), wy = gradientNoise(px * state.t1[2] + sdx + 8.3, py * state.t1[2] + sdy - tt * 0.4);
    rot(wx, wy, state.t2[1], U);
    px += U[0] * state.t1[1] * 0.6; py += U[1] * state.t1[1] * 0.6;
  }
  const sc = state.t0[1], oc = state.t0[2], pers = state.t0[3], lac = state.t1[0];
  const dirx = Math.cos(state.t2[3]), diry = Math.sin(state.t2[3]);
  const f = (x, y) => fbm(x, y, oc, pers, lac, 0);
  let dx, dy;
  const bx = px * sc + sdx + tt * 0.5, by = py * sc + sdy - tt * 0.35;
  switch (kind) {
    case 'simple': dx = gradientNoise(bx, by); dy = gradientNoise(bx + 5.2, by + 1.3); break;
    case 'warped': {
      const wx = f(bx + 1.7, by + 9.2), wy = f(bx + 8.3, by + 2.8);
      dx = f(bx + 2 * wx, by + 2 * wy); dy = f(bx + 2 * wx + 5.2, by + 2 * wy + 1.3); break;
    }
    case 'multiscale': {
      const b2x = bx * 3.1 + 11, b2y = by * 3.1 - 4;
      dx = (f(bx, by) + 0.5 * f(b2x, b2y)) / 1.5; dy = (f(bx + 5.2, by + 1.3) + 0.5 * f(b2x + 5.2, b2y + 1.3)) / 1.5; break;
    }
    case 'directional': {
      const nx = -diry, ny = dirx;
      const cx = (px * dirx + py * diry) * sc * 0.3 + sdx + tt * 0.5, cy = (px * nx + py * ny) * sc + sdy - tt * 0.35;
      const a = f(cx, cy) * 1.2, b = f(cx + 7, cy + 3) * 0.4;
      dx = dirx * a + nx * b; dy = diry * a + ny * b; break;
    }
    case 'aligned': { const a = f(bx, by) * 1.4; dx = dirx * a; dy = diry * a; break; }
    case 'animated': {
      const cx = px * sc + sdx - dirx * tt * 1.7, cy = py * sc + sdy - diry * tt * 1.7;
      dx = f(cx, cy); dy = f(cx + 5.2, cy + 1.3); break;
    }
    default: dx = f(bx, by); dy = f(bx + 5.2, by + 1.3); break;
  }
  const k = amp * state.t2[2] * mask;
  out[0] = dx * k; out[1] = dy * k;
  return out;
}

/** Organic spatial warp displacement (screen heights). */
export function evaluateOrganic(state, qx, qy, out) {
  const amp = state.o0[0];
  if (amp <= 1e-5) { out[0] = 0; out[1] = 0; return out; }
  const tt = state.o1[0];
  const sdx = state.q[1] + state.o1[2], sdy = state.q[2] + state.o1[3];
  rot(qx * state.o0[1] + sdx, qy * state.o0[1] + sdy, state.o1[1], T);
  const bx = T[0] + tt * 0.31, by = T[1] - tt * 0.23;
  let dx = fbm(bx, by, state.o2[0], state.o0[3], 2, 0), dy = fbm(bx + 23.1, by + 7.7, state.o2[0], state.o0[3], 2, 0);
  if (state.o0[2] > 0.001) { dx += state.o0[2] * 0.5 * gradientNoise(bx * 0.45 + 3.3, by * 0.45 - tt * 0.07); dy += state.o0[2] * 0.5 * gradientNoise(bx * 0.45 - 1.7, by * 0.45 - tt * 0.05); }
  out[0] = dx * amp; out[1] = dy * amp;
  return out;
}

/** What one pass of the shader displaces the sampling position by, for a given pass phase (0..1). Writes [dx, dy] in screen heights. */
export function displacementAt(state, kind, qx, qy, aspect, phase, out) {
  const v = [0, 0], t = [0, 0], g = [0, 0];
  evaluateFlow(state, qx, qy, aspect, v);
  if (state.t0[0] > 1e-5) evaluateTurbulence(state, kind, qx, qy, aspect, t);
  evaluateOrganic(state, qx, qy, g);
  let dx = v[0] * phase * state.g0[2] + t[0] + g[0], dy = v[1] * phase * state.g0[2] + t[1] + g[1];
  const l = Math.hypot(dx, dy);
  if (!(l < 1e5)) { dx = 0; dy = 0; } else if (l > 1e-5) { const k = softLimit(l, 1.3) / l; dx *= k; dy *= k; }
  out[0] = dx; out[1] = dy;
  return out;
}
