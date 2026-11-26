import { FLOW_TYPE_ID, FLOW_TYPES, TURBULENCE_KINDS, type FlowType, type InteractionResponse, type MotionConfig, type TurbulenceKind } from './types';

/* Generates the GPU half of the motion engine and splices it into the template shader.
 *
 * The template (gradient.frag.glsl) is NOT edited. When a project turns the motion engine on, four things are added at
 * named anchors and nowhere else, so a project without motion compiles exactly the shader it always did:
 *     1. uniforms + functions right after the interaction rig's marker;
 *     2. the `centered` line becomes the start of a short loop (1 or 2 passes): before the loop the flow field is composed once
 *        per pixel (sources → composition → turbulence / organic / pointer), inside the loop the sampling position is displaced
 *        by that field × the pass' phase, and the rest of the template runs unchanged on the displaced position;
 *     3. the optional colour-evolution offset just before the palette is sampled;
 *     4. the final write accumulates the passes (premultiplied, weighted by the cross-fade) and ends the loop.
 *
 * Flow model (see motionRuntime.js): velocity V per pixel, displacement D = V · f · T where f cycles 0→1 with the accumulated flow
 * time and T is the flow memory. Two passes half a cycle apart are cross-faded, so the cycle reset is invisible and the shear of
 * the pattern stays bounded however long the animation runs. A pass whose weight is zero is skipped (`continue`), which is also how
 * the runtime degrades to a single pass on slow devices without a recompile.
 *
 * Slider values are uniforms. Flow scenes share one shader variant: when sources exist, all flow types and optional field systems
 * are available, with inactive systems returning immediately. This avoids compiling a new program whenever a scene is selected.
 * The source-count tier (2/4/8), pointer response, and pass count still select the shader structure.
 * GLSL ES 1.00 rules apply: constant loop bounds, explicit float literals, no `%`. */

export const MOTION_ANCHORS = {
  functions: '/*@RIG_FUNCTIONS*/',
  centered: '  vec2 centered = flowDomain((p - 0.5) * vec2(uAspect, 1.0), t);',
  color: '  vec4 color = samplePalette(colorPosition);',
  output: '  gl_FragColor = vec4(color.rgb, alpha);',
} as const;

export interface MotionFeatures {
  /** compiled source capacity */
  tier: 2 | 4 | 8;
  /** all flow types when a source exists, so changing scenes does not recompile */
  types: FlowType[];
  hasPath: boolean;
  /** the field is evaluated (sources, a global flow, organic drift or a flow-type pointer response exist) */
  flow: boolean;
  organic: boolean;
  turbulence: boolean;
  interaction: boolean;
  response: InteractionResponse;
  colorMod: boolean;
}

const tierFor = (count: number): 2 | 4 | 8 => (count <= 2 ? 2 : count <= 4 ? 4 : 8);

export function motionFeatures(motion: MotionConfig): MotionFeatures {
  const types: FlowType[] = motion.sources.length ? [...FLOW_TYPES] : [];
  const hasPath = types.includes('path');
  const response = motion.interaction.response;
  const interaction = motion.interaction.enabled;
  const flow = motion.sources.length > 0 || motion.global.flow > 0 || motion.organic.enabled || (interaction && (response === 'flow' || response === 'direction'));
  return {
    tier: tierFor(motion.sources.length),
    types,
    hasPath,
    flow,
    organic: motion.organic.enabled || motion.sources.length > 0,
    turbulence: motion.turbulence.enabled || motion.sources.length > 0,
    interaction,
    response,
    colorMod: motion.modulators.some(modulator => modulator.target === 'color'),
  };
}

/** True when the config needs GPU code. A config that only drives legacy uniforms (zoom, rotation …) changes no shader text. */
export function isMotionActive(motion: MotionConfig | null | undefined): motion is MotionConfig {
  if (!motion || !motion.enabled) return false;
  const f = motionFeatures(motion);
  return f.flow || f.turbulence || f.organic || f.interaction || f.colorMod;
}

/** A stable key of everything that changes the generated text. Slider values are not part of it. */
export function motionSignature(motion: MotionConfig | null | undefined): string {
  if (!isMotionActive(motion)) return 'off';
  const f = motionFeatures(motion);
  return [
    'm1', f.tier, f.types.join('+') || '-', f.flow ? 'F' : '', f.organic ? 'O' : '', f.turbulence ? 'T' : '',
    f.interaction ? `I:${f.response}` : '', f.colorMod ? 'C' : '',
  ].join('|');
}

/* ───────────── generated pieces ───────────── */

const COMMON = `const float MOT_PI = 3.14159265;
vec2 motRot(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
/* sine-free hash (Hoskins): identical results on every GPU, and reproducible on the CPU for parity tests */
vec2 motH2(vec2 p) {
  p = mod(p, 32.0); /* the lattice repeats every 32 cells: keeps the hash precise far from the origin */
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}
float motN(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(motH2(i), f);
  float b = dot(motH2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(motH2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(motH2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.25;
}
float motFbm(vec2 p, float oct, float pers, float lac, float kind) {
  float v = 0.0;
  float a = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= oct) break;
    float n = motN(p);
    if (kind > 0.5 && kind < 1.5) n = sign(n) * sqrt(abs(n));
    else if (kind > 1.5) n = 0.7 - 2.0 * abs(n);
    v += n * a;
    norm += a;
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * lac + vec2(7.1, 3.7);
    a *= pers;
  }
  return v / max(norm, 0.0001);
}
float motFall(float dist, float radius, float kind) {
  if (radius > 999.0) return 1.0;
  float q = max(dist / max(radius, 0.0001), 0.0);
  float edge = 1.0 - smoothstep(0.82, 1.0, q);
  if (kind < 0.5) return 1.0 - smoothstep(0.94, 1.0, q);
  if (kind < 1.5) return max(1.0 - q, 0.0);
  if (kind < 2.5) return 1.0 - smoothstep(0.0, 1.0, q);
  if (kind < 3.5) return exp(-q * q * 3.6) * edge;
  if (kind < 4.5) return max(1.0 / (1.0 + 9.0 * q * q) - 0.1, 0.0) / 0.9 * edge;
  float r = (q - 0.6) * 3.2;
  return exp(-r * r) * edge;
}
/* smooth limit: ~l below m, approaches m above it */
float motSoft(float l, float m) {
  return l / pow(1.0 + pow(l / max(m, 0.0001), 4.0), 0.25);
}
`;

const TYPE_GLSL: Record<FlowType, string> = {
  directional: `vec2 motDirectional(vec2 ds, vec4 C, vec4 D, vec2 sd, float tt) {
  float ang = C.x;
  vec2 perp = vec2(-sin(ang), cos(ang));
  ang += D.x * dot(ds, perp) * 0.9;
  if (D.y > 0.001) ang += D.y * motN(ds * 0.8 + sd + vec2(tt * 0.31, -tt * 0.23)) * 1.6;
  float spd = 1.0;
  if (D.z > 0.001) spd += D.z * motN(ds * 1.3 + sd + vec2(5.0 - tt * 0.27, 9.0 + tt * 0.19));
  return vec2(cos(ang), sin(ang)) * max(spd, 0.0);
}`,
  curved: `vec2 motCurved(vec2 ds, vec4 C, vec4 D, vec2 sd, float tt, float ft) {
  float ang = C.x;
  vec2 perp = vec2(-sin(ang), cos(ang));
  float k = D.x * (1.0 + D.z * sin(ft * 0.9 + C.z));
  float around = atan(ds.y, ds.x) + 1.5707963 - ang;
  around = atan(sin(around), cos(around));
  float amt = clamp(abs(k) * 0.5, 0.0, 1.0) * sign(k);
  float a2 = ang + mix(k * dot(ds, perp) * 0.9, around * amt, D.w);
  if (D.y > 0.001) a2 += D.y * motN(ds * 1.1 + sd + vec2(2.0 + tt * 0.3, 2.0 - tt * 0.2)) * 1.5;
  return vec2(cos(a2), sin(a2));
}`,
  vortex: `vec2 motVortex(vec2 ds, vec4 C, vec4 D) {
  float r = length(ds);
  vec2 dh = ds / max(r, 0.0001);
  vec2 tg = vec2(-dh.y, dh.x);
  float core = max(D.x, 0.02);
  float g = 2.0 * core * r / (r * r + core * core);
  return motRot((tg * D.w + dh * D.y) * g, D.z * r * 4.0 + C.z);
}`,
  spiral: `vec2 motSpiral(vec2 ds, vec4 C, vec4 D) {
  float r = length(ds);
  vec2 dh = ds / max(r, 0.0001);
  vec2 tg = vec2(-dh.y, dh.x);
  float prof = smoothstep(D.y * 0.35, D.y * 0.35 + 0.12, r);
  return motRot((tg * D.w * D.x + dh * D.z * (1.0 - D.x) * 1.4) * prof, C.z);
}`,
  radial: `vec2 motRadial(vec2 ds, vec4 C, vec4 D, float ft) {
  float r = length(ds);
  vec2 dh = ds / max(r, 0.0001);
  float pulse = 1.0 + D.y * sin(6.2831853 * D.x * ft + C.z);
  float prof = smoothstep(D.z * 0.3, D.z * 0.3 + 0.15, r);
  return dh * D.w * pulse * prof;
}`,
  wave: `vec2 motWave(vec2 ds, vec4 C, vec4 D, vec2 sd, float tt, float ft) {
  vec2 dir = vec2(cos(C.x), sin(C.x));
  vec2 perp = vec2(-dir.y, dir.x);
  float pat = floor(D.y + 0.5);
  if (D.w > 0.001) ds += D.w * 0.35 * vec2(motN(ds * 1.7 + sd + tt * 0.2), motN(ds * 1.7 + sd + vec2(4.0, 4.0) - tt * 0.2));
  float ph = ft * 0.6 + C.z / 6.2831853;
  float s = dot(ds, dir);
  if (pat < 0.5) s = ds.x;
  else if (pat < 1.5) s = ds.y;
  else if (pat < 2.5) s = (ds.x + ds.y) * 0.70710678;
  else if (pat < 3.5) s = length(ds);
  else if (pat < 4.5) s = atan(ds.y, ds.x) / 6.2831853 * floor(D.x + 0.5);
  float fq = (pat > 3.5 && pat < 4.5) ? 1.0 : D.x;
  float w = sin(6.2831853 * (fq * s - ph));
  if (pat > 5.5) w = 0.5 * (w + sin(6.2831853 * (D.x * dot(ds, perp) * 0.83 - ph * 1.17)));
  if (D.z > 0.001) w += D.z * sin(6.2831853 * (fq * 1.9 * s + ph * 0.7) + 1.7);
  vec2 rh = ds / max(length(ds), 0.0001);
  vec2 v = dir * w;
  if (pat > 2.5 && pat < 3.5) v = rh * w;
  else if (pat > 3.5 && pat < 4.5) v = vec2(-rh.y, rh.x) * w;
  return v;
}`,
  noise: `vec2 motNoiseFlow(vec2 ds, vec4 C, vec4 D, vec2 sd, float tt, float oct) {
  vec2 q = ds;
  if (D.z > 0.001) q += D.z * 0.6 * vec2(motN(q * 1.3 + sd + vec2(tt * 0.21, 0.0)), motN(q * 1.3 + sd + vec2(9.1, -tt * 0.17)));
  vec2 b = q + sd + vec2(tt * 0.37, -tt * 0.29);
  float o = min(floor(D.x + 0.5), oct);
  float nx = motFbm(b, o, D.y, 2.0, D.w);
  float ny = motFbm(b + vec2(17.3, 31.7), o, D.y, 2.0, D.w);
  return motRot(vec2(nx, ny) * 1.5, C.x);
}`,
  curl: `vec2 motCurl(vec2 ds, vec4 C, vec4 D, vec2 sd, float tt, float oct) {
  vec2 q = ds;
  if (D.z > 0.001) q += D.z * 0.5 * vec2(motN(q * 0.9 + sd + vec2(tt * 0.13, 4.0)), motN(q * 0.9 + sd + vec2(11.0, -tt * 0.11)));
  vec2 b = q + sd + vec2(tt * 0.31, tt * 0.17);
  float o = min(floor(D.x + 0.5), oct);
  float pers = mix(0.62, 0.28, D.y);
  float e = 0.05;
  float f0 = motFbm(b, o, pers, 2.0, 0.0);
  float fx = motFbm(b + vec2(e, 0.0), o, pers, 2.0, 0.0);
  float fy = motFbm(b + vec2(0.0, e), o, pers, 2.0, 0.0);
  return motRot(vec2(fy - f0, -(fx - f0)) / e * 0.55, C.x);
}`,
  magnetic: `vec2 motMagnetic(vec2 ds, vec4 C, vec4 D) {
  float r = length(ds);
  vec2 dh = ds / max(r, 0.0001);
  vec2 tg = vec2(-dh.y, dh.x);
  float x = r / max(D.z, 0.02);
  float mag = 1.7 * x / (1.0 + pow(x, D.w + 1.0));
  return motRot((-dh * D.y + tg * D.x) * mag, C.z);
}`,
  path: `void motPathQ(int slot, vec2 q, out vec2 pt, out vec2 tn, out float dist) {
  dist = 100000.0;
  pt = q;
  tn = vec2(1.0, 0.0);
  for (int i = 0; i < 15; i++) {
    vec4 a = slot == 0 ? uMotPath[i] : uMotPath[i + 16];
    vec4 b = slot == 0 ? uMotPath[i + 1] : uMotPath[i + 17];
    vec2 pa = (a.xy - 0.5) * vec2(uAspect, 1.0);
    vec2 pb = (b.xy - 0.5) * vec2(uAspect, 1.0);
    vec2 ab = pb - pa;
    float h = clamp(dot(q - pa, ab) / max(dot(ab, ab), 0.00000001), 0.0, 1.0);
    vec2 c = pa + ab * h;
    float dd = length(q - c);
    if (dd < dist) {
      dist = dd;
      pt = c;
      vec2 tl = mix(a.zw, b.zw, h);
      tn = normalize(vec2(tl.x * uAspect, tl.y) + vec2(0.00001, 0.0));
    }
  }
}
vec2 motPathFlow(vec2 q, vec2 pt, vec2 tn, float dist, vec4 C, vec4 D) {
  vec2 nrm = vec2(-tn.y, tn.x);
  vec2 pull = (pt - q) / max(dist, 0.02) * smoothstep(0.0, 0.25, dist);
  float side = dot(q - pt, nrm) >= 0.0 ? 1.0 : -1.0;
  return motRot(tn * D.z + pull * D.y + nrm * side * D.w, C.z);
}`,
};

function evalFunction(types: FlowType[], hasPath: boolean): string {
  const branches = types.map(type => {
    const id = `${FLOW_TYPE_ID[type]}.0`;
    switch (type) {
      case 'directional': return `  if (abs(ty - ${id}) < 0.5) v = motDirectional(ds, C, D, sd, tt);`;
      case 'curved': return `  if (abs(ty - ${id}) < 0.5) v = motCurved(ds, C, D, sd, tt, ft);`;
      case 'vortex': return `  if (abs(ty - ${id}) < 0.5) v = motVortex(ds, C, D);`;
      case 'spiral': return `  if (abs(ty - ${id}) < 0.5) v = motSpiral(ds, C, D);`;
      case 'radial': return `  if (abs(ty - ${id}) < 0.5) v = motRadial(ds, C, D, ft);`;
      case 'wave': return `  if (abs(ty - ${id}) < 0.5) v = motWave(ds, C, D, sd, tt, ft);`;
      case 'noise': return `  if (abs(ty - ${id}) < 0.5) v = motNoiseFlow(ds, C, D, sd, tt, oct);`;
      case 'curl': return `  if (abs(ty - ${id}) < 0.5) v = motCurl(ds, C, D, sd, tt, oct);`;
      case 'magnetic': return `  if (abs(ty - ${id}) < 0.5) v = motMagnetic(ds, C, D);`;
      case 'path': return hasPath ? `  if (abs(ty - ${id}) < 0.5) {
    vec2 pt = q;
    vec2 tn = vec2(1.0, 0.0);
    float pd = 100000.0;
    motPathQ(E.z < 0.5 ? 0 : 1, q, pt, tn, pd);
    dist = pd;
    v = motPathFlow(q, pt, tn, pd, C, D);
  }` : '';
      default: return '';
    }
  }).join('\n');
  return `vec2 motEval(float ty, vec2 q, vec4 A, vec4 B, vec4 C, vec4 D, vec4 E, vec4 F, out float dist) {
  vec2 d = q - (A.zw - 0.5) * vec2(uAspect, 1.0);
  dist = length(d);
  vec2 ds = motRot(d, -C.y) / max(B.w, 0.05) + F.zw;
  vec2 sd = uMotQ.yz + vec2(E.y, E.y * 1.7);
  float tt = F.x * F.y;
  float ft = F.x;
  float oct = uMotQ.x;
  vec2 v = vec2(0.0);
${branches}
  return v;
}`;
}

const COMPOSE = (tier: number) => `/* composition: stage 1 reduces the "add" sources by the global mode, stage 2 folds the other blends in priority order */
vec2 motFlow(vec2 q, vec2 extra) {
  float mode = uMotG2.z;
  vec2 sumU = vec2(0.0);
  float sumM = 0.0;
  float cnt = 0.0;
  float bestMag = 0.0;
  vec2 bestU = vec2(0.0);
  float domM = -1.0;
  vec2 domU = vec2(0.0);
  float softN = 0.0;
  vec2 softU = vec2(0.0);
  float remain = 1.0;
  vec2 prioU = vec2(0.0);
  float others = 0.0;
  vec4 stash[${tier}];
  for (int i = 0; i < ${tier}; i++) stash[i] = vec4(0.0);
  for (int i = 0; i < ${tier}; i++) {
    if (float(i) >= uMotCount) break;
    vec4 A = uMotA[i];
    vec4 B = uMotB[i];
    vec4 C = uMotC[i];
    vec4 D = uMotD[i];
    vec4 E = uMotE[i];
    vec4 F = uMotF[i];
    float wgt = A.y;
    if (wgt <= 0.0) continue;
    float dist = 0.0;
    vec2 v = motEval(A.x, q, A, B, C, D, E, F, dist);
    float fall = motFall(dist, B.y, B.z) * C.w;
    vec2 u = v * B.x * fall;
    float m = fall * wgt;
    if (E.x < 0.5) {
      vec2 uw = u * wgt;
      sumU += uw;
      sumM += m;
      if (fall > 0.002) cnt += 1.0;
      float mag = length(uw);
      if (mag > bestMag) { bestMag = mag; bestU = uw; }
      if (m > domM) { domM = m; domU = uw; }
      float sw = pow(max(m, 0.0001), uMotG2.x);
      softN += sw;
      softU += uw * sw;
      prioU += uw * remain;
      remain *= 1.0 - clamp(m, 0.0, 1.0);
    } else {
      stash[i] = vec4(u * wgt, m, E.x);
      others = 1.0;
    }
  }
  vec2 S = prioU;
  if (mode < 0.5) S = sumU;
  else if (mode < 1.5) S = sumU / max(1.0, sumM);
  else if (mode < 2.5) S = sumU / max(1.0, cnt);
  else if (mode < 3.5) {
    S = sumU;
    float l = length(S);
    if (l > bestMag) S *= bestMag / max(l, 0.000001);
  }
  else if (mode < 4.5) S = bestU;
  else if (mode < 5.5) S = domU;
  else if (mode < 6.5) S = softU / max(softN, 0.000000001);
  if (others > 0.5) {
    for (int i = 0; i < ${tier}; i++) {
      if (float(i) >= uMotCount) break;
      vec4 s = stash[i];
      if (s.w < 0.5) continue;
      if (s.w < 1.5) S += s.xy * (1.0 - clamp(length(S) / max(uMotG0.w, 0.0001), 0.0, 1.0));
      else if (s.w < 2.5) S -= s.xy;
      else if (s.w < 3.5) S = mix(S, s.xy, clamp(s.z, 0.0, 1.0));
      else if (length(s.xy) > length(S)) S = s.xy;
    }
  }
  vec2 V = (S * uMotG1.z + uMotG1.xy) * uMotG0.x + extra;
  float l = length(V);
  if (!(l < 100000.0)) return vec2(0.0);
  float cap = uMotG0.w * (uMotG2.y > 0.5 ? 1.0 : 4.0);
  return l > 0.000001 ? V * (motSoft(l, cap) / l) : V;
}
`;

const ORGANIC = `vec2 motOrganic(vec2 q) {
  float amp = uMotO0.x;
  if (amp <= 0.00001) return vec2(0.0);
  float tt = uMotO1.x;
  vec2 sd = uMotQ.yz + uMotO1.zw;
  vec2 b = motRot(q * uMotO0.y + sd, uMotO1.y) + vec2(tt * 0.31, -tt * 0.23);
  vec2 d = vec2(motFbm(b, uMotO2.x, uMotO0.w, 2.0, 0.0), motFbm(b + vec2(23.1, 7.7), uMotO2.x, uMotO0.w, 2.0, 0.0));
  if (uMotO0.z > 0.001) d += uMotO0.z * 0.5 * vec2(motN(b * 0.45 + vec2(3.3, -tt * 0.07)), motN(b * 0.45 - vec2(1.7, tt * 0.05)));
  return d * amp;
}
`;

const TURB_KIND: Record<TurbulenceKind, string> = {
  simple: `vec2 b = p * sc + sd + vec2(tt * 0.5, -tt * 0.35);
  vec2 d = vec2(motN(b), motN(b + vec2(5.2, 1.3)));`,
  fractal: `vec2 b = p * sc + sd + vec2(tt * 0.5, -tt * 0.35);
  vec2 d = vec2(motFbm(b, oc, pers, lac, 0.0), motFbm(b + vec2(5.2, 1.3), oc, pers, lac, 0.0));`,
  warped: `vec2 b = p * sc + sd + vec2(tt * 0.5, -tt * 0.35);
  vec2 w = vec2(motFbm(b + vec2(1.7, 9.2), oc, pers, lac, 0.0), motFbm(b + vec2(8.3, 2.8), oc, pers, lac, 0.0));
  vec2 d = vec2(motFbm(b + 2.0 * w, oc, pers, lac, 0.0), motFbm(b + 2.0 * w + vec2(5.2, 1.3), oc, pers, lac, 0.0));`,
  multiscale: `vec2 b = p * sc + sd + vec2(tt * 0.5, -tt * 0.35);
  vec2 d = vec2(motFbm(b, oc, pers, lac, 0.0), motFbm(b + vec2(5.2, 1.3), oc, pers, lac, 0.0));
  vec2 b2 = b * 3.1 + vec2(11.0, -4.0);
  d = (d + 0.5 * vec2(motFbm(b2, oc, pers, lac, 0.0), motFbm(b2 + vec2(5.2, 1.3), oc, pers, lac, 0.0))) / 1.5;`,
  directional: `vec2 nrm = vec2(-dir.y, dir.x);
  vec2 b = vec2(dot(p, dir) * sc * 0.3, dot(p, nrm) * sc) + sd + vec2(tt * 0.5, -tt * 0.35);
  vec2 d = dir * motFbm(b, oc, pers, lac, 0.0) * 1.2 + nrm * motFbm(b + vec2(7.0, 3.0), oc, pers, lac, 0.0) * 0.4;`,
  aligned: `vec2 b = p * sc + sd + vec2(tt * 0.5, -tt * 0.35);
  vec2 d = dir * motFbm(b, oc, pers, lac, 0.0) * 1.4;`,
  animated: `vec2 b = p * sc + sd - dir * tt * 1.7;
  vec2 d = vec2(motFbm(b, oc, pers, lac, 0.0), motFbm(b + vec2(5.2, 1.3), oc, pers, lac, 0.0));`,
};

const turbulenceFunction = () => `vec2 motTurb(vec2 q) {
  float amp = uMotT0.x;
  if (amp <= 0.00001) return vec2(0.0);
  float tt = uMotT2.x;
  vec2 sd = uMotQ.yz + vec2(41.0, 13.0);
  float mask = 1.0;
  if (uMotT3.z > 0.001) mask = 1.0 - smoothstep(0.0, 1.0, length(q - (uMotT3.xy - 0.5) * vec2(uAspect, 1.0)) / uMotT3.z);
  vec2 p = motRot(q, uMotT1.w + uMotT3.w * tt * 0.23);
  if (uMotT1.y > 0.001) p += motRot(vec2(motN(p * uMotT1.z + sd + vec2(tt * 0.4, 0.0)), motN(p * uMotT1.z + sd + vec2(8.3, -tt * 0.4))), uMotT2.y) * uMotT1.y * 0.6;
  float sc = uMotT0.y;
  float oc = uMotT0.z;
  float pers = uMotT0.w;
  float lac = uMotT1.x;
  vec2 dir = vec2(cos(uMotT2.w), sin(uMotT2.w));
  vec2 result = vec2(0.0);
  ${TURBULENCE_KINDS.map((type, index) => {
    const body = TURB_KIND[type].replace(/\bd\b/g, 'result').replace('vec2 result =', 'result =');
    const branch = index === 0 ? 'if' : 'else if';
    return `  ${branch} (uMotTKind < ${(index + 0.5).toFixed(1)}) {\n    ${body}\n  }`;
  }).join('\n')}
  return result * amp * uMotT2.z * mask;
}
`;

/** The body of one pointer response, in terms of: a (amount), dh (unit away from the pointer), pr (perpendicular), vd (unit motion
 *  direction × direction response), vel, spd, spN (0..1 speed), delta, dist, radius, i (slot). `dd` is an immediate displacement of the content,
 *  `dv` a velocity that joins the flow field. */
const RESPONSE_GLSL: Record<InteractionResponse, string> = {
  attract: 'dd -= dh * a * 1.5;',
  repel: 'dd += dh * a * 1.5;',
  vortex: 'dd += pr * a * 1.6;',
  orbit: 'dd += motRot(delta, a * 6.0) - delta;',
  flow: 'dv += clamp(vel, vec2(-1.5), vec2(1.5)) * a * 0.7 * uMotI1.y;',
  direction: 'dv += vd * a;',
  turbulence: 'dd += vec2(motN(delta * uMotI1.x * 3.0 + vec2(uMotI1.z, 0.0)), motN(delta * uMotI1.x * 3.0 + vec2(9.0, -uMotI1.z))) * a * 1.6;',
  distortion: 'float w = 6.2831853 * (dist * uMotI1.x - uMotI1.z * 0.6); dd += (dh * sin(w) + pr * cos(w) * 0.6) * a * 1.4;',
  warp: 'dd -= delta * a * 5.0;',
  displacement: 'dd += vd * a * 1.4;',
  ripple: 'float w = 6.2831853 * (dist * uMotI1.x - uMotI1.z * 0.8); dd += dh * sin(w) * a * 1.2 * exp(-dist / (radius * 1.5));',
  push: 'dd += dh * a * (0.3 + 1.6 * spN) * 1.5;',
  pull: 'dd -= dh * a * (0.3 + 1.6 * spN) * 1.5;',
  stir: 'dd += (pr * (0.35 + spN) + vd * 0.5) * a * 1.4;',
  magnetic: 'vec2 ax = spd > 0.02 ? vel / spd : vec2(1.0, 0.0); float cs = dot(dh, ax); float sn = ax.x * dh.y - ax.y * dh.x; dd += (dh * 2.0 * cs + pr * sn) * a;',
  follow: 'dd += vel * a * 0.6;',
  trail: 'dd += (pr * 0.6 + vd * 0.4) * a * 1.3;',
  wake: 'vec2 ax = spd > 0.02 ? vel / spd : vec2(0.0); float behind = smoothstep(0.0, 0.8, -dot(dh, ax)); vec2 sdv = vec2(-ax.y, ax.x); dd += sdv * clamp(dot(delta, sdv) / (radius * 0.15), -1.0, 1.0) * behind * a * 1.6 * min(1.0, spd * 4.0);',
};

const interactionFunction = (response: InteractionResponse) => `void motInteract(vec2 q, out vec2 dv, out vec2 dd) {
  dv = vec2(0.0);
  dd = vec2(0.0);
  float radius = max(uMotI0.x, 0.01);
  for (int i = 0; i < 6; i++) {
    ${response === 'trail' ? 'if (i < 2) continue;' : ''}
    vec4 P = uMotPtrP[i];
    vec4 Qv = uMotPtrQ[i];
    if (Qv.x <= 0.002) continue;
    vec2 delta = q - (P.xy - 0.5) * vec2(uAspect, 1.0);
    float dist = length(delta);
    vec2 vel = vec2(P.z * uAspect, P.w);
    float spd = length(vel);
    float spN = 1.0 - exp(-spd * 1.4);
    float a = motFall(dist, radius, uMotI0.z) * Qv.x * Qv.y * Qv.z * uMotI0.y / (1.0 + uMotI1.w * spN * 0.6);
    vec2 dh = delta / max(dist, 0.0001);
    vec2 pr = vec2(-dh.y, dh.x);
    vec2 vd = vel / max(spd, 0.001) * min(1.0, spd * 4.0) * uMotI1.y;
    ${RESPONSE_GLSL[response]}
  }
  float dl = length(dd);
  if (!(dl < 100000.0)) dd = vec2(0.0);
  else if (dl > 0.000001) dd *= motSoft(dl, max(uMotI0.w, 0.01)) / dl;
}
`;

function declarations(f: MotionFeatures): string {
  const n = f.tier;
  const lines = [
    `#define MOT_SRC ${n}`,
    `#define MOT_PH ${f.flow ? 2 : 1}`,
    `uniform vec4 uMotA[${n}];`, `uniform vec4 uMotB[${n}];`, `uniform vec4 uMotC[${n}];`, `uniform vec4 uMotD[${n}];`, `uniform vec4 uMotE[${n}];`, `uniform vec4 uMotF[${n}];`,
    'uniform float uMotCount;',
    'uniform vec4 uMotG0;', 'uniform vec4 uMotG1;', 'uniform vec4 uMotG2;', 'uniform vec4 uMotPhase;', 'uniform vec4 uMotPal;', 'uniform vec4 uMotQ;',
  ];
  if (f.organic) lines.push('uniform vec4 uMotO0;', 'uniform vec4 uMotO1;', 'uniform vec4 uMotO2;');
  if (f.turbulence) lines.push('uniform vec4 uMotT0;', 'uniform vec4 uMotT1;', 'uniform vec4 uMotT2;', 'uniform vec4 uMotT3;', 'uniform float uMotTKind;');
  if (f.interaction) lines.push('uniform vec4 uMotI0;', 'uniform vec4 uMotI1;', 'uniform vec4 uMotPtrP[6];', 'uniform vec4 uMotPtrQ[6];');
  if (f.hasPath) lines.push('uniform vec4 uMotPath[32];');
  return lines.join('\n');
}

export interface GeneratedMotionGlsl { functions: string; loopOpen: string; colorHook: string; outputHook: string }

export function generateMotionGlsl(motion: MotionConfig): GeneratedMotionGlsl {
  const f = motionFeatures(motion);
  const parts: string[] = [`/* ── ShapeForge motion engine (generated) ── */`, declarations(f), COMMON];
  if (f.flow) {
    for (const type of f.types) parts.push(TYPE_GLSL[type]);
    parts.push(evalFunction(f.types, f.hasPath), COMPOSE(f.tier));
  }
  if (f.organic) parts.push(ORGANIC);
  if (f.turbulence) parts.push(turbulenceFunction());
  if (f.interaction) parts.push(interactionFunction(f.response));
  const pre = [
    '  /* ShapeForge motion engine: compose the flow field once, then run the rest of the shader on the displaced position (1 or 2 phases) */',
    '  vec2 motQ = (p - 0.5) * vec2(uAspect, 1.0);',
    '  vec2 motDx = vec2(0.0);',
    '  vec2 motVi = vec2(0.0);',
    f.interaction ? '  vec2 motDi = vec2(0.0);\n  motInteract(motQ, motVi, motDi);\n  motDx += motDi;' : '',
    f.turbulence ? '  motDx += motTurb(motQ);' : '',
    f.organic ? '  motDx += motOrganic(motQ);' : '',
    f.flow ? '  vec2 motV = motFlow(motQ, motVi);' : '  vec2 motV = vec2(0.0);',
    '  vec2 motBaseP = p;',
    '  vec4 motAcc = vec4(0.0);',
    '  float motWSum = 0.0;',
    '  float motSpec0 = rgSpec;',
    '  float motAlpha0 = rgAlpha;',
    '  float motChroma0 = rgChroma;',
    '  float motPal0 = rgPal;',
    '  float motTime0 = rgTime;',
    '  for (int motPh = 0; motPh < MOT_PH; motPh++) {',
    '    float motF = motPh == 0 ? uMotPhase.x : uMotPhase.y;',
    '    float motW = motPh == 0 ? uMotPhase.z : uMotPhase.w;',
    '    if (motW < 0.002) continue;',
    '    rgSpec = motSpec0; rgAlpha = motAlpha0; rgChroma = motChroma0; rgPal = motPal0; rgTime = motTime0;',
    '    vec2 motDisp = motV * (motF * uMotG0.z) + motDx;',
    '    float motDl = length(motDisp);',
    '    if (!(motDl < 100000.0)) motDisp = vec2(0.0);',
    '    else if (motDl > 0.00001) motDisp *= motSoft(motDl, 1.3) / motDl;',
    '    vec2 p = motBaseP - motDisp / vec2(uAspect, 1.0);',
    MOTION_ANCHORS.centered,
  ].filter(Boolean).join('\n');
  const colorHook = f.colorMod
    ? `  colorPosition = wrapT(colorPosition + uMotPal.x);\n${MOTION_ANCHORS.color}`
    : MOTION_ANCHORS.color;
  const outputHook = [
    '  motAcc += vec4(color.rgb * alpha, alpha) * motW;',
    '  motWSum += motW;',
    '  }',
    '  motAcc /= max(motWSum, 0.0001);',
    '  gl_FragColor = motAcc.a > 0.0001 ? vec4(motAcc.rgb / motAcc.a, motAcc.a) : vec4(0.0);',
  ].join('\n');
  return { functions: parts.join('\n'), loopOpen: pre, colorHook, outputHook };
}

function replaceOnce(source: string, anchor: string, text: string, name: string): string {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`Motion shader hook "${name}" needs exactly one occurrence of: ${anchor.trim()}`);
  }
  return `${source.slice(0, first)}${text}${source.slice(first + anchor.length)}`;
}

/** The template with the motion hooks added (when the config needs them) — otherwise the template unchanged. */
export function injectMotionGlsl(template: string, motion: MotionConfig | null | undefined): string {
  if (!isMotionActive(motion)) return template;
  const g = generateMotionGlsl(motion);
  let out = replaceOnce(template, MOTION_ANCHORS.functions, `${MOTION_ANCHORS.functions}\n${g.functions}`, 'functions');
  out = replaceOnce(out, MOTION_ANCHORS.centered, g.loopOpen, 'centered');
  out = replaceOnce(out, MOTION_ANCHORS.color, g.colorHook, 'color');
  out = replaceOnce(out, MOTION_ANCHORS.output, g.outputHook, 'output');
  return out;
}
