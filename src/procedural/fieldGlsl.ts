import { PROC_MAX_FIELDS, type FieldFeatures, type FieldMethod } from './types';

/* The colour-field sampler of the procedural engine, generated per config.
 *
 * Only what a config uses is compiled in:
 *   - the ONE interpolation method that is selected (a kernel, a cell rule or an exact RBF),
 *   - shaped influence (per-point reach shapes) only when some point is not round,
 *   - the OKLCH hue path / chroma preservation only when that colour space is selected,
 *   - extra fields and the material stage only when present.
 * A config that uses none of them compiles the same loop it always did (the default Gaussian field, round points, OKLab).
 *
 * Distances: every method measures a point's reach as `dn` = distance / (point radius × field radius), so 1 is the edge of the
 * reach whatever the shape. Weights are then built from dn. GLSL ES 1.00 rules: constant loop bounds, no `%`, float literals. */

export interface FieldGlslOptions {
  capacity: number;
  features: FieldFeatures;
  /** a distortion stage targets the field's sampling position / the colour centres / the finished colour */
  fieldStages: boolean;
  pointStages: boolean;
  colorStages: boolean;
}

const kernelOf = (method: FieldMethod): string => {
  switch (method) {
    case 'idw': return '1.0 / (pow(dn, expo) + 0.05)';
    case 'gaussian': return 'exp(-dn * dn * mix(1.5, 9.0, falloff))';
    case 'smooth': return 'pow(1.0 - smoothstep(0.0, 1.0, dn), mix(0.6, 3.0, falloff))';
    case 'radial': return 'pow(max(1.0 - dn, 0.0), expo)';
    case 'soft': return 'exp(-dn * dn * mix(0.8, 6.0, falloff))';
    case 'inverse-multiquadric': return 'inversesqrt(1.0 + (dn * mix(1.0, 4.0, falloff)) * (dn * mix(1.0, 4.0, falloff)))';
    case 'wendland-c2': return 'procWendland(dn)';
    case 'custom-weighted': return 'procCustomKernel(dn, falloff)';
    default: return 'exp(-dn * dn * mix(1.5, 9.0, falloff))';
  }
};

/** Methods that cover the whole canvas by themselves (their weights never reach 0), as before. */
const FULL_COVER: readonly FieldMethod[] = ['idw', 'soft', 'inverse-multiquadric'];

export const SHAPE_GLSL = `vec2 procRotNeg(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x + s * v.y, -s * v.x + c * v.y);
}
/* Reach of one point. d is the offset in units of the point's own reach; the result is 1 on the edge of the shape.
 *   1 ellipse (anisotropy) · 2 rounded rectangle (a true signed distance) · 3 diamond (L1 norm, area-matched to the circle)
 *   4 directional (reach grows on the + side of the rotation, shrinks behind) · 5 regular polygon (n-gon gauge, circumradius 1) */
float procReach(vec2 d, vec4 sh) {
  float kind = sh.x;
  if (kind < 0.5) return length(d);
  vec2 q = procRotNeg(d, sh.y);
  float a = sqrt(max(sh.z, 0.05));
  q = vec2(q.x / a, q.y * a);
  if (kind < 1.5) return length(q);
  if (kind < 2.5) {
    vec2 w = abs(q) - vec2(0.6);
    return max(1.0 + length(max(w, 0.0)) + min(max(w.x, w.y), 0.0) - 0.4, 0.0);
  }
  if (kind < 3.5) return (abs(q.x) + abs(q.y)) * 0.798;
  float l = length(q);
  if (kind < 4.5) {
    float k = 0.5 + 0.5 * (l > 0.00001 ? q.x / l : 0.0);
    return l / mix(0.55, 1.9, k);
  }
  float seg = 6.28318530718 / max(uProcG.w, 3.0);
  float sector = mod(atan(q.y, q.x) + seg * 0.5, seg) - seg * 0.5;
  float rho = cos(seg * 0.5) / cos(seg * 0.5 - abs(sector));
  rho = mix(rho, 0.5 * (1.0 + cos(seg * 0.5)), uProcH.z);
  return l / max(rho, 0.05);
}
/* reach with the flat inner core removed: dn is 0 inside the inner fraction, then rises to 1 at the edge */
float procReachN(vec2 d, vec4 sh) {
  float dn = procReach(d, sh);
  return max(0.0, (dn - sh.w) / max(1.0 - sh.w, 0.05));
}`;

const WENDLAND_GLSL = `float procWendland(float dn) {
  float support = max(1.0 - dn, 0.0);
  return support * support * support * support * (4.0 * dn + 1.0);
}`;
const CUSTOM_KERNEL_GLSL = `float procCustomKernel(float dn, float falloff) {
  float scaled = dn * mix(1.0, 4.0, falloff);
  float total = max(uProcG.x + uProcG.y + uProcG.z, 0.0001);
  return (uProcG.x * exp(-dn * dn * mix(1.5, 9.0, falloff)) + uProcG.y * procWendland(dn) + uProcG.z * inversesqrt(1.0 + scaled * scaled)) / total;
}`;
/* kernels of the extra fields, picked by a uniform (so changing one never recompiles) */
const LAYER_GLSL = `float procKernelRt(float k, float dn, float falloff, float expo) {
  if (k < 0.5) return exp(-dn * dn * mix(1.5, 9.0, falloff));
  if (k < 1.5) return exp(-dn * dn * mix(0.8, 6.0, falloff));
  if (k < 2.5) return pow(1.0 - smoothstep(0.0, 1.0, dn), mix(0.6, 3.0, falloff));
  if (k < 3.5) return pow(max(1.0 - dn, 0.0), expo);
  if (k < 4.5) return 1.0 / (pow(dn, expo) + 0.05);
  if (k < 5.5) return procWendland(dn);
  float sc = dn * mix(1.0, 4.0, falloff);
  return inversesqrt(1.0 + sc * sc);
}
vec3 procLayerBlend(float op, vec3 b, vec3 t, float cov, float mass) {
  if (op < 0.5) return mix(b, t, cov);
  if (op < 1.5) return b + t * cov;
  if (op < 2.5) return mix(b, b * t, cov);
  if (op < 3.5) return mix(b, 1.0 - (1.0 - b) * (1.0 - t), cov);
  if (op < 4.5) return mix(b, mix(2.0 * b * t, 1.0 - 2.0 * (1.0 - b) * (1.0 - t), step(vec3(0.5), b)), cov);
  if (op < 5.5) return mix(b, (1.0 - 2.0 * t) * b * b + 2.0 * t * b, cov);
  if (op < 6.5) return mix(b, abs(b - t), cov);
  if (op < 7.5) return mix(b, max(b, t), cov);
  if (op < 8.5) return mix(b, min(b, t), cov);
  float wt = cov * mass;
  return mix(b, t, wt / (1.0 + wt));
}`;

/** OKLCH: the shader accumulates (L, C, a, b) per colour, where a/b are either the chroma-weighted hue vector (shorter arc) or the
 *  unwrapped hue offset from the first colour (the other three routes). Resolving gives an OKLab colour. */
const LCH_RESOLVE_GLSL = `vec3 procLchResolve(vec4 acc, float wsum) {
  float inv = 1.0 / max(wsum, 0.00001);
  float L = acc.x * inv;
  float C = acc.y * inv;
  float hue = uProcH.w;
  if (uProcF.x < 0.5) {
    if (length(acc.zw) > 0.00001 * max(wsum, 1.0)) hue = atan(acc.w, acc.z);
  } else {
    hue = uProcH.w + acc.z * inv;
  }
  return vec3(L, C * cos(hue), C * sin(hue));
}`;

const CHROMA_RESOLVE_GLSL = `vec3 procChromaResolve(vec4 acc, float wsum) {
  float inv = 1.0 / max(wsum, 0.00001);
  vec3 lab = acc.rgb * inv;
  float have = length(lab.yz);
  float want = acc.w * inv;
  lab.yz *= mix(1.0, clamp(want / max(have, 0.0001), 0.0, 3.0), uProcF.y);
  return lab;
}`;

export function fieldSamplerGlsl(options: FieldGlslOptions): string {
  const { capacity, features, pointStages, fieldStages, colorStages } = options;
  const { family, method, shaped, lch, chroma, layers, material } = features;
  const wide = lch || chroma;
  const accType = wide ? 'vec4' : 'vec3';
  const accInit = wide ? 'vec4(0.0)' : 'vec3(0.0)';
  const colorAdd = (w: string) => (wide ? `accum += uProcColors[i] * ${w};` : `accum += uProcColors[i].rgb * ${w};`);
  const resolve = lch ? 'procLchResolve(accum, wsum)' : chroma ? 'procChromaResolve(accum, wsum)' : 'accum / wsum';
  const pos = pointStages ? 'procMovePoint(uProcPoints[i].xy)' : 'uProcPoints[i].xy';
  const dnOf = (radius: string) => (shaped
    ? `procReachN((uv - pp) * asp / max(pt.z * ${radius}, 0.005), uProcShape[i])`
    : `length((uv - pp) * asp) / max(pt.z * ${radius}, 0.005)`);
  const core = shaped ? 'w *= 1.0 + uProcF.w * (1.0 - smoothstep(0.0, 0.5, dn));' : '';
  const globalTail = 'w += uProcF.z * 0.35 * pt.w / (1.0 + dn * dn);';

  // each block is compiled in only when something uses it: the shader of a plain Gaussian field carries none of them
  const parts: string[] = [];
  if (method === 'wendland-c2' || method === 'custom-weighted' || layers > 0) parts.push(WENDLAND_GLSL);
  if (method === 'custom-weighted') parts.push(CUSTOM_KERNEL_GLSL);
  if (layers > 0) parts.push(LAYER_GLSL);
  if (shaped) parts.push(SHAPE_GLSL);
  if (lch) parts.push(LCH_RESOLVE_GLSL);
  if (chroma) parts.push(CHROMA_RESOLVE_GLSL);

  /* ───── primary field ───── */
  let primary: string;
  if (method === 'smin') {
    const distOf = shaped
      ? 'procReach((uv - pp) * asp / max(pt.z, 0.005), uProcShape[i]) * pt.z'
      : 'length((uv - pp) * asp)';
    primary = `vec4 procPrimarySmin(vec2 uv, float count, float radius, float softness) {
  vec2 asp = vec2(uAspect, 1.0);
  float k = 0.02 + softness * 0.35;
  float dmin = 100.0;
  float dsoft = 100.0;
  for (int i = 0; i < ${capacity}; i++) {
    if (float(i) >= count) break;
    vec4 pt = uProcPoints[i];
    vec2 pp = ${pos};
    float dist = ${distOf};
    dmin = min(dmin, dist);
    float h = clamp(0.5 + 0.5 * (dsoft - dist) / k, 0.0, 1.0);
    dsoft = mix(dsoft, dist, h) - k * h * (1.0 - h);
  }
  float tau = 0.015 + softness * 0.25;
  ${accType} accum = ${accInit};
  float wsum = 0.0;
  for (int i = 0; i < ${capacity}; i++) {
    if (float(i) >= count) break;
    vec4 pt = uProcPoints[i];
    vec2 pp = ${pos};
    float dist = ${distOf};
    float w = exp(-(dist - dmin) / tau) * pt.w;
    ${colorAdd('w')}
    wsum += w;
  }
  vec3 enc = wsum > 0.00001 ? ${resolve} : uProcBase.rgb;
  return vec4(enc, 1.0 - smoothstep(0.0, radius * 0.55, dsoft));
}
vec4 procPrimary(vec2 uv) {
  vec4 s = procPrimarySmin(uv, uProcA.y, max(uProcB.x, 0.02), uProcB.w);
  return vec4(s.rgb, mix(s.a, 1.0, uProcF.z));
}`;
  } else if (family === 'rbf') {
    const phi: Record<string, string> = {
      'rbf-gaussian': 'exp(-(k * x) * (k * x))',
      'rbf-multiquadric': 'sqrt(1.0 + k * k * x * x)',
      'thin-plate': '(x > 0.0001 ? x * x * log(x) : 0.0)',
      harmonic: '0.5 * log(x * x + k * k)',
    };
    primary = `/* exact interpolation: the coefficients were solved on the CPU, the shader only sums the kernels */
vec4 procPrimary(vec2 uv) {
  vec2 asp = vec2(uAspect, 1.0);
  float count = uProcA.y;
  float scale = max(uProcH.x, 0.005);
  float k = uProcH.y;
  vec3 sum = uProcRbfP[0].rgb + uProcRbfP[1].rgb * (uv.x * uAspect) + uProcRbfP[2].rgb * uv.y;
  for (int i = 0; i < ${capacity}; i++) {
    if (float(i) >= count) break;
    float x = length((uv - uProcPoints[i].xy) * asp) / scale;
    sum += uProcRbf[i].rgb * ${phi[method] ?? phi['rbf-gaussian']};
  }
  return vec4(clamp(sum, uProcRbfR[0].rgb, uProcRbfR[1].rgb), 1.0);
}`;
  } else if (family === 'cells') {
    const metric: Record<string, string> = {
      'smooth-voronoi': 'dn / max(pt.w, 0.05)',
      'power-diagram': 'R * R * (dn * dn - 1.0)',
      'natural-neighbor': 'sqrt(dn * dn + eps * eps)',
    };
    const weight: Record<string, string> = {
      'smooth-voronoi': 'exp(-(m - m1) / (0.02 + uProcB.w * uProcB.w * 0.6))',
      'power-diagram': 'exp(-(m - m1) / (0.0004 + uProcB.w * uProcB.w * 0.06))',
      'natural-neighbor': 'pow(max(1.0 / max(m, 0.002) - 1.0 / (mix(3.0, 1.6, falloff) * max(m2, 0.002)), 0.0), expo) * pt.w',
    };
    primary = `/* cell rules need the smallest distance(s) first: pass 1 finds them, pass 2 weights every colour against them */
vec4 procPrimary(vec2 uv) {
  float count = uProcA.y;
  float radius = max(uProcB.x, 0.02);
  float falloff = uProcB.z;
  float expo = uProcC.x;
  float eps = uProcB.w * 0.25;
  vec2 asp = vec2(uAspect, 1.0);
  float m1 = 1000.0;
  float m2 = 1000.0;
  for (int i = 0; i < ${capacity}; i++) {
    if (float(i) >= count) break;
    vec4 pt = uProcPoints[i];
    vec2 pp = ${pos};
    float R = max(pt.z * radius, 0.005);
    float dn = ${dnOf('radius')};
    float m = ${metric[method]};
    if (m < m1) { m2 = m1; m1 = m; }
    else if (m < m2) { m2 = m; }
  }
  ${accType} accum = ${accInit};
  float wsum = 0.0;
  for (int i = 0; i < ${capacity}; i++) {
    if (float(i) >= count) break;
    vec4 pt = uProcPoints[i];
    vec2 pp = ${pos};
    float R = max(pt.z * radius, 0.005);
    float dn = ${dnOf('radius')};
    float m = ${metric[method]};
    float w = ${weight[method]};
    ${core}
    ${globalTail}
    ${colorAdd('w')}
    wsum += w;
  }
  vec3 enc = wsum > 0.00001 ? ${resolve} : uProcBase.rgb;
  return vec4(enc, 1.0);
}`;
  } else {
    const fullCover = FULL_COVER.includes(method);
    primary = `vec4 procPrimary(vec2 uv) {
  float count = uProcA.y;
  float radius = max(uProcB.x, 0.02);
  float strength = uProcB.y;
  float falloff = uProcB.z;
  float expo = uProcC.x;
  float overlapPow = 1.0 + (1.0 - uProcC.y) * 7.0;
  vec2 asp = vec2(uAspect, 1.0);
  ${accType} accum = ${accInit};
  float wsum = 0.0;
  float uncovered = 1.0;
  for (int i = 0; i < ${capacity}; i++) {
    if (float(i) >= count) break;
    vec4 pt = uProcPoints[i];
    vec2 pp = ${pos};
    float dn = ${dnOf('radius')};
    float w = ${kernelOf(method)};
    w = pow(max(w, 0.0), overlapPow) * pt.w * strength;
    ${core}
    ${globalTail}
    ${colorAdd('w')}
    wsum += w;
    uncovered *= 1.0 - clamp(w, 0.0, 1.0);
  }
  vec3 enc = wsum > 0.00001 ? ${resolve} : uProcBase.rgb;
  float cover = ${fullCover ? '1.0' : '1.0 - uncovered'};
  return vec4(enc, mix(cover, 1.0, uProcF.z));
}`;
  }
  parts.push(primary);

  /* ───── primary → decoded colour (full mode fills with the base colour where nothing reaches) ───── */
  parts.push(`vec4 procPrimaryRgb(vec2 uv) {
  vec4 s = procPrimary(uv);
  if (uProcA.x > 1.5) return vec4(procDecode(mix(uProcBase.rgb, s.rgb, s.a), uProcC.z), 1.0);
  return vec4(procDecode(s.rgb, uProcC.z), s.a);
}`);

  /* ───── extra fields ───── */
  const layerBlocks: string[] = [];
  for (let k = 0; k < Math.min(layers, PROC_MAX_FIELDS); k++) {
    layerBlocks.push(`  if (uProcFieldA[${k}].y > 0.5) {
    vec4 fa = uProcFieldA[${k}];
    vec4 fb = uProcFieldB[${k}];
    bool follow = uProcFieldC[${k}].x > 0.5;
    vec2 luv = follow ? fuv : uv;
    vec3 acc = vec3(0.0);
    float ws = 0.0;
    float unc = 1.0;
    for (int i = 0; i < ${capacity}; i++) {
      if (float(i) < fa.x) continue;
      if (float(i) >= fa.x + fa.y) break;
      vec4 pt = uProcPoints[i];
      ${pointStages ? 'vec2 pp = follow ? procMovePoint(pt.xy) : pt.xy;' : 'vec2 pp = pt.xy;'}
      float dn = length((luv - pp) * asp) / max(pt.z * fb.x, 0.005);
      float w = procKernelRt(fa.z, dn, fb.z, 2.0) * pt.w * fb.y;
      acc += uProcColors[i].rgb * w;
      ws += w;
      unc *= 1.0 - clamp(w, 0.0, 1.0);
    }
    float lcov = ((fa.z > 3.5 && fa.z < 4.5) || fa.z > 5.5 ? 1.0 : 1.0 - unc) * fb.w;
    vec3 top = procDecode(ws > 0.00001 ? acc / ws : vec3(0.0), uProcC.z);
    vec3 res = procLayerBlend(fa.w, rgb, top, lcov, fb.y);
    rgb = mix(top, res, cover);
    cover = 1.0 - (1.0 - cover) * (1.0 - lcov);
  }`);
  }
  parts.push(`/* the primary field with the extra fields composited over it, in sRGB, before grading. fuv = the field's own sampling position
 * (field-target distortion applied), uv = the undistorted canvas position */
vec4 procCompose(vec2 fuv, vec2 uv) {
  vec2 asp = vec2(uAspect, 1.0);
  vec4 prim = procPrimaryRgb(fuv);
  vec3 rgb = prim.rgb;
  float cover = prim.a;
${layerBlocks.join('\n')}
  return vec4(rgb, cover);
}`);

  /* ───── material ───── */
  if (material) {
    parts.push(`float procLuma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}
/* Lightness is read as a height map: four taps give the slope (normal, edges), the average (glow, bloom, scatter), and one more
 * tap toward the light gives the shadow. Nothing here adds colour that is not in the field except light itself. */
vec3 procMaterial(vec2 fuv, vec2 uv, vec3 col) {
  float r = uProcM0.x;
  vec2 ox = vec2(r / uAspect, 0.0);
  vec2 oy = vec2(0.0, r);
  vec3 cxp = procCompose(fuv + ox, uv + ox).rgb;
  vec3 cxn = procCompose(fuv - ox, uv - ox).rgb;
  vec3 cyp = procCompose(fuv + oy, uv + oy).rgb;
  vec3 cyn = procCompose(fuv - oy, uv - oy).rgb;
  vec3 blur = (cxp + cxn + cyp + cyn) * 0.25;
  vec2 grad = vec2(procLuma(cxp) - procLuma(cxn), procLuma(cyp) - procLuma(cyn)) / (2.0 * r);
  float edge = clamp(length(grad) * 0.6, 0.0, 1.0);
  col = mix(col, blur, uProcM3.w);
  col = 1.0 - (1.0 - col) * (1.0 - blur * uProcM0.y * 0.5);
  col = 1.0 - (1.0 - col) * (1.0 - max(blur - vec3(uProcM0.w), 0.0) * uProcM0.z);
  col = mix(col, 1.0 - (1.0 - col) * (1.0 - col), clamp(uProcM1.x * (1.0 - edge) * 0.5, 0.0, 1.0));
  col = mix(col, 1.0 - (1.0 - col) * (1.0 - col * 1.5), clamp(edge * uProcM1.y, 0.0, 1.0));
  if (uProcM1.w > 0.0 || uProcM2.w > 0.0 || uProcM3.z > 0.0) {
    float el = mix(0.15, 1.45, uProcM2.z);
    vec3 L = vec3(uProcM2.x * cos(el), uProcM2.y * cos(el), sin(el));
    vec3 n = normalize(vec3(-grad * uProcM3.y * 0.5, 1.0));
    float flatLit = uProcM1.z + uProcM1.w * sin(el);
    float lit = uProcM1.z + uProcM1.w * max(dot(n, L), 0.0);
    col *= lit / max(flatLit, 0.001);
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = max(pow(max(dot(n, H), 0.0), uProcM3.x) - pow(max(H.z, 0.0), uProcM3.x), 0.0);
    col += vec3(spec * uProcM2.w * 0.6);
    if (uProcM3.z > 0.0) {
      vec2 toward = L.xy / max(length(L.xy), 0.0001) * 3.0 * r;
      float ahead = procLuma(procCompose(fuv + toward / vec2(uAspect, 1.0), uv + toward / vec2(uAspect, 1.0)).rgb);
      col *= 1.0 - clamp((ahead - procLuma(col)) * uProcM3.y * 2.0, 0.0, 1.0) * uProcM3.z * 0.6;
    }
  }
  return col;
}`);
  }

  /* ───── entry point ───── */
  parts.push(`/* rgb = the field's colour in sRGB; a = how much of the pixel it covers (always 1 in full mode) */
vec4 procSample(vec2 uv) {
  vec2 asp = vec2(uAspect, 1.0);
  float t = uProcD.y;
  vec2 s0 = (uv - 0.5) * asp;
  vec2 fuv = ${fieldStages ? 'procDistortField(s0, t) / asp + 0.5' : 'uv'};
  vec4 comp = procCompose(fuv, uv);
  vec3 rgb = comp.rgb;
${material ? '  rgb = procMaterial(fuv, uv, rgb);' : ''}
${colorStages ? '  vec2 cd = procDistortColor(s0, t);\n  rgb = rigHue(rgb, cd.x * 2.5) * exp2(cd.y * 1.5);' : ''}
  return vec4(procGrade(rgb), comp.a);
}`);
  return parts.join('\n');
}
