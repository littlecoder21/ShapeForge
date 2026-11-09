import { activeRules, RIG_EFFECT_MAP, type InteractionRig, type RigBlend, type RigEffectId, type RigFalloffId, type RigRule, type RigShapeId } from './model';

/* Generates the interaction part of the fragment shader.
 *
 * The template shader (gradient.frag.glsl) declares the uniforms and calls three hooks:
 *     vec2 rigWarp(vec2 p)                          – moves the sampling position
 *     void rigPre(vec2 uv)                          – writes accumulators (palette offset, colour split, local time)
 *     vec3 rigPost(vec3 col, vec2 uv, float pos)    – recolours / lights the finished colour
 * This file writes those three functions for exactly the rules that are enabled, so an interaction that uses
 * "swirl + glow" compiles (and costs) only swirl and glow. Slider values are uniforms, never constants.
 *
 * Every rule block starts with `abs(amount) > 0.0005`: while the pointer is away (or a drive holds the amount at 0) the
 * block costs one uniform comparison per pixel instead of a shape, a falloff and the effect. That is what keeps stacks of
 * interactive layers cheap when nothing is being touched.
 *
 * Uniforms the template does not declare (the texture-motion arrays and the custom-shape atlas) are declared here, and
 * only when a rule needs them.
 *
 * GLSL ES 1.00 rules apply: explicit float literals, no `%`, constant loop bounds, no reserved words. */

export const RIG_FUNCTIONS_MARKER = '/*@RIG_FUNCTIONS*/';
export const RIG_DEFINES_MARKER = '/*@RIG_DEFINES*/';

const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const FALLOFF_GLSL: Record<RigFalloffId, string> = {
  gauss: 'exp(-q * q * 1.8)',
  smooth: '1.0 - smoothstep(0.0, 1.0, q)',
  linear: 'max(1.0 - q, 0.0)',
  plateau: '1.0 - smoothstep(0.55, 1.0, q)',
  ring: 'exp(-((q - 0.62) * 3.4) * ((q - 0.62) * 3.4))',
  spike: 'max(1.0 / (1.0 + 10.0 * q * q) - 0.06, 0.0)',
  hard: '1.0 - smoothstep(0.94, 1.0, q)',
  bands: '(0.5 + 0.5 * cos(q * 18.0 - uClock * 3.0)) * (1.0 - smoothstep(0.0, 1.0, q))',
  tail: 'exp(-q * 3.0)',
  dome: 'sqrt(max(1.0 - q * q, 0.0))',
  cosine: '(q < 1.0 ? 0.5 + 0.5 * cos(3.14159265 * q) : 0.0)',
  exponential: 'exp(-q * 4.5)',
  power: 'pow(max(1.0 - q, 0.0), 2.8)',
  bell: 'exp(-((q - 0.35) * 3.0) * ((q - 0.35) * 3.0))',
  softstep: '1.0 - smoothstep(0.2, 0.85, q)',
  quadratic: 'pow(max(1.0 - q, 0.0), 2.0)',
  cubic: 'pow(max(1.0 - q, 0.0), 3.0)',
  quintic: 'pow(max(1.0 - q, 0.0), 5.0)',
  sine: 'sin(1.5707963 * clamp(1.0 - q, 0.0, 1.0))',
  logarithmic: 'log(1.0 + 8.0 * max(1.0 - q, 0.0)) / 2.1972246',
};

const SHAPE_GLSL: Record<RigShapeId, string> = {
  circle: 'return length(d);',
  ellipse: 'vec2 e = rigRot(d, -ang); return length(vec2(e.x / max(rc.x, 0.05), e.y));',
  box: 'vec2 e = abs(rigRot(d, -ang)); return max(e.x / max(rc.x, 0.05), e.y);',
  diamond: 'vec2 e = abs(rigRot(d, -ang)); return e.x / max(rc.x, 0.05) + e.y;',
  line: 'vec2 e = rigRot(d, -ang); return abs(e.y);',
  cross: 'vec2 e = abs(rigRot(d, -ang)); return min(e.x, e.y);',
  star: 'vec2 e = rigRot(d, -ang); return length(e) / (0.65 + 0.35 * cos(rc.w * atan(e.y, e.x)));',
  poly: 'vec2 e = rigRot(d, -ang); float an = 6.2831853 / max(rc.w, 3.0); float aa = mod(atan(e.y, e.x) + 3.14159265, an) - an * 0.5; return length(e) * cos(aa) / cos(an * 0.5);',
  capsule: 'vec2 e = rigRot(d, -ang); return length(vec2(max(abs(e.x) - 0.32, 0.0), e.y)) + min(abs(e.x) - 0.32, 0.0) + 0.42;',
  roundBox: 'vec2 e = abs(rigRot(d, -ang)); vec2 q = e - vec2(max(rc.x, 0.2) * 0.42, 0.42); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) + 0.22;',
  triangle: 'vec2 e = rigRot(d, -ang); float an = 2.0943951; float aa = mod(atan(e.y, e.x) + 3.14159265, an) - an * 0.5; return length(e) * cos(aa) / cos(an * 0.5);',
  hexagon: 'vec2 e = rigRot(d, -ang); float an = 1.04719755; float aa = mod(atan(e.y, e.x) + 3.14159265, an) - an * 0.5; return length(e) * cos(aa) / cos(an * 0.5);',
  ringShape: 'return abs(length(d) - 0.48) + 0.18;',
  heart: 'vec2 e = rigRot(d, -ang) * 1.6; float h = length(e) - 0.45 - 0.16 * sin(atan(e.y, e.x) * 2.0); return max(h + 0.4, 0.0);',
  clover: 'float a = atan(d.y, d.x); return length(d) / (0.45 + 0.2 * cos(4.0 * a));',
  custom: 'return length(d);',
};

const BLEND_GLSL: Record<RigBlend, string> = {
  mix: 'return mix(base, c, w);',
  add: 'return base + c * w;',
  screen: 'return 1.0 - (1.0 - base) * (1.0 - c * w);',
  multiply: 'return base * mix(vec3(1.0), c, w);',
};

/** Body of each effect. Available names are documented in `ruleBlock`. `RG_FALL(` and `RG_BLEND(` are rewritten per rule. */
export const RIG_EFFECT_GLSL: Record<RigEffectId, string> = {
  attract: 'p -= (p - rgC) * rgA * 0.55;',
  swirl: 'p += rgPerpUv * rgA * (0.12 + rgP1 * rgSpd);',
  twist: 'vec2 rgE = rigRot(rgD, rgA * 2.2 * rgP1); p = rgC + rgE / vec2(uAspect, 1.0);',
  vortex: 'p += (rgPerpUv * rgP1 - rgDirUv * rgP2) * rgA * 0.2;',
  magnet: 'float rgTh = atan(rgD.y, rgD.x) * rgP1; p += (rgDirUv * cos(rgTh) + rgPerpUv * sin(rgTh)) * rgA * 0.12;',
  smear: 'p -= rgVel * rgA * 0.14 * rgP1;',
  bend: 'float rgBa = rgP1 * 0.0174533; p += vec2(cos(rgBa), sin(rgBa)) * rgA * 0.12;',
  shake: `float rgSt = floor(uClock * rgP2);
vec2 rgSh = vec2(fract(sin(rgSt * 12.9898) * 43758.5453), fract(sin(rgSt * 78.233 + 1.7) * 43758.5453));
p += (rgSh - 0.5) * rgA * 0.07 * rgP1;`,
  wave: `float rgPh = rgLen * rgP1 - rgT * rgP2;
float rgWv = mix(sin(rgPh), 1.0 - 2.0 * abs(sin(rgPh * 0.5)), rgP3);
p += rgDirUv * rgWv * rgA * 0.055 * exp(-rgLen * rgP4 / max(rgR, 0.05));`,
  pulse: `float rgPt = rgT * rgP2 * 0.3;
float rgPr = mix(clamp(rgPt, 0.0, 1.0), fract(rgPt), step(0.5, rgP4));
float rgX = (rgLen - rgPr * rgR * rgP3) / (rgR * 0.16 * rgP1);
p += rgDirUv * exp(-rgX * rgX) * (1.0 - rgPr) * rgA * 0.22;`,
  spiral: `float rgSa = atan(rgD.y, rgD.x) * rgP1 + rgLen * rgP2 - rgT * rgP3;
p += (rgPerpUv * sin(rgSa) + rgDirUv * cos(rgSa) * 0.5) * rgA * 0.09;`,
  noise: `vec2 rgNq = rgD * rgP1;
p += vec2(field(rgNq + vec2(0.0, rgT * rgP2 * 0.3)), field(rgNq + vec2(5.2, 1.3) - rgT * rgP2 * 0.25)) * rgA * 0.45 / vec2(uAspect, 1.0);`,
  melt: `float rgMc = p.x * rgP2;
float rgMl = fract(sin(floor(rgMc) * 12.9898) * 43758.5453);
float rgMd = 0.5 + 0.5 * sin(fract(rgMc) * 3.14159265 + rgT * 1.3 + rgMl * 6.2831853);
p.y -= (0.35 + 0.65 * rgMl) * rgMd * rgA * 0.14 * rgP1;
p.x += sin(rgMc * 6.2831853 + uClock) * rgA * 0.006;`,
  lens: 'p = rgC + (p - rgC) * (1.0 - clamp(rgAmt, -1.0, 1.0) * 0.6 * pow(max(rgW, 0.0001), rgP1));',
  bump: `float rgSl = (RG_FALL(rgQ + 0.04) - RG_FALL(rgQ)) / 0.04;
vec2 rgGr = -rgDir * rgSl * rgP1 * rgAmt * 0.45;
vec3 rgN = normalize(vec3(rgGr, 1.0));
float rgLa = rgP3 * 0.0174533;
vec3 rgL = normalize(vec3(cos(rgLa), sin(rgLa), 0.75) + vec3(0.0, 0.0, 1.0));
rgSpec += pow(max(dot(rgN, rgL), 0.0), rgP2) * min(abs(rgAmt), 1.5) * rgW;
rgChroma += length(rgGr) * rgP4 * 0.9;
p += rgGr / vec2(uAspect, 1.0) * 0.12;`,
  mosaic: `vec2 rgCells = vec2(rgP1 * uAspect, rgP1);
vec2 rgMq = (floor(p * rgCells) + 0.5) / rgCells;
p = mix(p, rgMq, smoothstep(0.05, 0.5, rgW) * clamp(abs(rgAmt), 0.0, 1.0));`,
  mirror: `float rgMa = rgP1 * 0.0174533;
vec2 rgMm = rigRot(rgD, -rgMa);
rgMm.x = abs(rgMm.x);
rgMm = rigRot(rgMm, rgMa);
p = mix(p, rgC + rgMm / vec2(uAspect, 1.0), smoothstep(0.05, 0.5, rgW) * clamp(abs(rgAmt), 0.0, 1.0));`,
  kaleido: `float rgKs = max(floor(rgP1 + 0.5), 2.0);
float rgKa = atan(rgD.y, rgD.x) + rgP2 * rgT * 0.25;
float rgKg = 6.2831853 / rgKs;
rgKa = abs(mod(rgKa, rgKg) - rgKg * 0.5);
p = mix(p, rgC + rgLen * vec2(cos(rgKa), sin(rgKa)) / vec2(uAspect, 1.0), smoothstep(0.05, 0.5, rgW) * clamp(abs(rgAmt), 0.0, 1.0));`,
  glitch: `float rgGr = floor(p.y * rgP1);
float rgGt = floor(uClock * rgP2);
float rgGh = fract(sin(rgGr * 12.9898 + rgGt * 78.233) * 43758.5453);
float rgGg = step(0.55, fract(sin(rgGr * 3.7 + rgGt * 1.3 + 4.1) * 43758.5453));
p.x += (rgGh - 0.5) * rgGg * rgA * 0.6 / max(uAspect, 0.001);`,

  palette: 'rgPal += rgA * rgP1 * (1.0 + rgP2 * sin(rgLen * 18.0 - rgT * 2.0));',
  prism: 'rgChroma += rgA * rgP1 * 0.6;',
  timewarp: 'rgTime += rgA * rgP1;',

  hue: 'col = rigHue(col, rgP1 * 0.0174533 * clamp(rgA, -1.5, 1.5));',
  saturate: 'float rgLu = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(vec3(rgLu), col, 1.0 + rgA * rgP1);',
  tone: 'col = (col - 0.5) * (1.0 + rgA * rgP1) + 0.5 + rgA * rgP2 * 0.5;',
  invert: 'col = mix(col, 1.0 - col, smoothstep(0.05, 0.6, rgW) * clamp(abs(rgAmt), 0.0, 1.0));',
  posterize: 'vec3 rgPq = floor(col * rgP1 + 0.5) / rgP1; col = mix(col, rgPq, rgW * clamp(abs(rgAmt), 0.0, 1.0));',
  tint: `col = RG_BLEND(col, rgCol, clamp(rgA, 0.0, 1.0));
rgAlpha = max(rgAlpha, clamp(rgA * 0.6, 0.0, 0.85));`,
  thinfilm: `vec3 rgTf = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + rgQ * rgP1 + rgT * rgP2 * 0.2));
col = mix(col, rgTf, clamp(rgA, 0.0, 1.0));`,
  glow: `col += mix(rgCol, col * 2.0, rgP1) * rgA * 0.6;
rgAlpha = max(rgAlpha, clamp(rgA * 0.7, 0.0, 0.85));`,
  light: `col *= 1.0 + rgA * rgP1;
rgAlpha = max(rgAlpha, clamp(rgA * 0.4, 0.0, 0.85));`,
  spotlight: 'col *= mix(1.0, 0.06 + 0.94 * rgW, clamp(abs(rgAmt), 0.0, 1.0));',
  sparkle: `vec2 rgSg = p * vec2(uAspect, 1.0) * rgP1;
float rgSh = fract(sin(dot(floor(rgSg), vec2(12.9898, 78.233))) * 43758.5453);
vec2 rgSf = fract(rgSg) - 0.5;
float rgStar = max(0.0, 1.0 - length(rgSf) * 4.0) + max(0.0, 1.0 - min(abs(rgSf.x), abs(rgSf.y)) * 14.0) * max(0.0, 1.0 - length(rgSf) * 2.2);
float rgFl = pow(0.5 + 0.5 * sin(uClock * (3.0 + rgSh * 9.0) + rgSh * 40.0), 6.0);
float rgSm = step(1.0 - rgP2, rgSh);
col += rgCol * rgStar * rgSm * rgFl * rgA * 1.6;
rgAlpha = max(rgAlpha, clamp(rgStar * rgSm * rgFl * rgA, 0.0, 0.85));`,
  lightning: `float rgSeed = floor(uClock * rgP2) * 7.3;
float rgLn = field(rgDir * (rgP1 * 0.3) + vec2(rgLen * 5.0 + rgSeed, -rgLen * 3.0 + rgSeed * 0.31));
float rgArc = exp(-abs(rgLn) * (12.0 + 46.0 * (1.0 - rgP3)));
col += rgCol * rgArc * rgA * 1.4;
rgAlpha = max(rgAlpha, clamp(rgArc * rgA, 0.0, 0.85));`,
  rings: `float rgRr = sin(rgLen * rgP1 - rgT * rgP2);
float rgRm = 1.0 - smoothstep(rgP3, rgP3 + 0.25, abs(rgRr));
col = RG_BLEND(col, rgCol, clamp(rgRm * rgA, 0.0, 1.0));
rgAlpha = max(rgAlpha, clamp(rgRm * rgA * 0.8, 0.0, 0.85));`,
  grain: `float rgGn = field(p * rgP1 + vec2(rgT * rgP2, -rgT * rgP2 * 0.73));
float rgGt = (rgGn - 0.5) * 2.0;
col = RG_BLEND(col, rgCol * (0.5 + 0.5 * rgGn), clamp(abs(rgA * rgGt), 0.0, 1.0));`,
  stripes: `vec2 rgSp = rigRot(p * vec2(uAspect, 1.0), rgP3 * 0.0174533);
float rgSt = step(0.5, fract(rgSp.x * rgP1));
col = RG_BLEND(col, rgCol, clamp(rgA * (1.0 - smoothstep(rgP2, rgP2 + 0.08, abs(fract(rgSp.x * rgP1) - 0.5) * 2.0)) * rgSt, 0.0, 1.0));`,
  checker: `vec2 rgCp = rigRot(p * vec2(uAspect, 1.0), rgP2 * 0.0174533) * rgP1;
float rgCk = mod(floor(rgCp.x) + floor(rgCp.y), 2.0);
col = RG_BLEND(col, rgCol, clamp(rgA * rgCk, 0.0, 1.0));`,
  crosshatch: `vec2 rgHp = p * vec2(uAspect, 1.0) * rgP1;
float rgHx = 1.0 - smoothstep(rgP2, rgP2 + 0.08, abs(fract(rgHp.x + rgHp.y) - 0.5));
float rgHy = 1.0 - smoothstep(rgP2, rgP2 + 0.08, abs(fract(rgHp.x - rgHp.y) - 0.5));
col = RG_BLEND(col, rgCol, clamp(rgA * max(rgHx, rgHy), 0.0, 1.0));`,
  // the brush paints nothing itself: its whole look is the texture block (see `textureRuleBlock`)
  texture: '',
  scanlines: 'col *= 1.0 - rgW * clamp(abs(rgAmt), 0.0, 1.0) * rgP2 * (0.5 + 0.5 * sin(p.y * rgP1 * 3.14159265));',
  halftone: `vec2 rgHg = rigRot(p * vec2(uAspect, 1.0), rgP2 * 0.0174533) * rgP1;
float rgHd = length(fract(rgHg) - 0.5);
float rgHl = dot(col, vec3(0.299, 0.587, 0.114));
float rgHr = sqrt(clamp(rgHl, 0.0, 1.0)) * 0.62;
float rgHm = 1.0 - smoothstep(rgHr - 0.1, rgHr + 0.1, rgHd);
col = mix(col, mix(vec3(0.02), col * 1.15, rgHm), rgW * clamp(abs(rgAmt), 0.0, 1.0));`,
};

const COMMON_GLSL = `vec2 rigRot(vec2 v, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
vec3 rigHue(vec3 c, float h) {
  vec3 k = vec3(0.57735026, 0.57735026, 0.57735026);
  float ch = cos(h);
  return c * ch + cross(k, c) * sin(h) + k * dot(k, c) * (1.0 - ch);
}
vec3 rigCssHue(vec3 c, float h) {
  float ch = cos(h);
  float sh = sin(h);
  return vec3(
    (0.213 + 0.787 * ch - 0.213 * sh) * c.r + (0.715 - 0.715 * ch - 0.715 * sh) * c.g + (0.072 - 0.072 * ch + 0.928 * sh) * c.b,
    (0.213 - 0.213 * ch + 0.143 * sh) * c.r + (0.715 + 0.285 * ch + 0.140 * sh) * c.g + (0.072 - 0.072 * ch - 0.283 * sh) * c.b,
    (0.213 - 0.213 * ch - 0.787 * sh) * c.r + (0.715 - 0.715 * ch + 0.715 * sh) * c.g + (0.072 + 0.928 * ch + 0.072 * sh) * c.b
  );
}
float rigHash(vec2 c) {
  return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
}
vec4 rigAtlas(vec2 tc, vec2 origin) {
  return texture2D(uRuleTextureAtlas, (origin + vec2(0.5) + fract(tc) * 63.0) / vec2(256.0, 128.0));
}`;

function blendFunctions(blends: Set<RigBlend>): string {
  return [...blends].map(blend => `vec3 rigBlend${cap(blend)}(vec3 base, vec3 c, float w) { ${BLEND_GLSL[blend]} }`).join('\n');
}

function colorExpression(rule: RigRule, index: number, stage: 'warp' | 'pre' | 'post'): string {
  if (rule.colorMode === 'custom') return `uRuleE[${index}].rgb`;
  if (rule.colorMode === 'spectrum') return '0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + rgQ * 0.7 + uClock * 0.12))';
  if (rule.colorMode === 'scene' && stage === 'post') return 'samplePalette(wrapT(pos + 0.14 + rgQ * 0.25)).rgb';
  return 'sampleInteractionPalette(fract(rgQ * 0.8 + uClock * uInteractionColorSpeed))';
}

function sourceCode(rule: RigRule, weightFn: string): string {
  const asp = 'vec2(uAspect, 1.0)';
  switch (rule.source) {
    case 'trail':
      return `for (int j = 0; j < 12; j++) {
      vec4 rgTr = uTrail[j];
      if (rgTr.z > 0.0) {
        float rgQj = 1.0;
        float rgWj = ${weightFn}((p - rgTr.xy) * ${asp}, rgAng, rgCc, rgR, rgF.xy, rgG, rgQj) * rgTr.z;
        if (rgWj > rgW) { rgW = rgWj; rgC = rgTr.xy; rgQ = rgQj; rgT = rgTr.w; }
      }
    }`;
    case 'clicks':
      return `for (int j = 0; j < 8; j++) {
      if (float(j) >= uRippleCount) break;
      vec4 rgCk = uRipples[j];
      float rgAge = max(uClock - rgCk.z, 0.0);
      float rgEnv = exp(-rgAge / max(rgDd.z, 0.05)) * rgCk.w;
      float rgQj = 1.0;
      float rgWj = ${weightFn}((p - rgCk.xy) * ${asp}, rgAng, rgCc, rgR, rgF.xy, rgG, rgQj) * rgEnv;
      if (rgWj > rgW) { rgW = rgWj; rgC = rgCk.xy; rgQ = rgQj; rgT = rgAge; }
    }`;
    case 'touch2':
      return `rgC = uTouch2.xy;
    rgW = ${weightFn}((p - rgC) * ${asp}, rgAng, rgCc, rgR, rgF.xy, rgG, rgQ);`;
    case 'fixed':
      return `rgC = rgDd.zw;
    rgW = ${weightFn}((p - rgC) * ${asp}, rgAng, rgCc, rgR, rgF.xy, rgG, rgQ);`;
    case 'orbit':
      return `rgC = vec2(0.5 + rgDd.z * cos(uClock * rgDd.w) / max(uAspect, 0.001), 0.5 + rgDd.z * sin(uClock * rgDd.w * 1.31));
    rgW = ${weightFn}((p - rgC) * ${asp}, rgAng, rgCc, rgR, rgF.xy, rgG, rgQ);`;
    case 'symmetry':
      return `float rgCnt = clamp(floor(rgDd.z + 0.5), 2.0, 8.0);
    vec2 rgRel = (uPointer - 0.5) * ${asp};
    for (int j = 0; j < 8; j++) {
      if (float(j) >= rgCnt) break;
      float rgAn = 6.2831853 * float(j) / rgCnt + uClock * rgDd.w;
      vec2 rgCj = 0.5 + rigRot(rgRel, rgAn) / ${asp};
      float rgQj = 1.0;
      float rgWj = ${weightFn}((p - rgCj) * ${asp}, rgAng, rgCc, rgR, rgF.xy, rgG, rgQj);
      if (rgWj > rgW) { rgW = rgWj; rgC = rgCj; rgQ = rgQj; }
    }`;
    default:
      return `rgC = uPointer;
    rgW = ${weightFn}((p - rgC) * ${asp}, rgAng, rgCc, rgR, rgF.xy, rgG, rgQ);`;
  }
}

function rewriteMacros(body: string, rule: RigRule): string {
  return body
    .replace(/RG_FALL\(/g, `rigFall${cap(rule.falloff)}(`)
    .replace(/RG_BLEND\(/g, `rigBlend${cap(rule.blend)}(`);
}

/** A custom outline is a texture lookup, so it costs the same for 3 points or 32 and never changes the shader source. */
function customShapeFunction(index: number): string {
  return `float rigDistCustom${index}(vec2 d, float ang, vec4 rc, float R) {
  vec2 p = rigRot(d, -ang) / max(R, 0.005);
  p.x /= max(rc.x, 0.05);
  vec2 pc = clamp(p, -0.5, 0.5);
  vec2 suv = vec2((${index}.0 * 64.0 + 0.5 + (pc.x + 0.5) * 63.0) / 512.0, (0.5 + (0.5 - pc.y) * 63.0) / 64.0);
  float sd = (texture2D(uRuleShapeAtlas, suv).r - 0.5) * 2.0 + length(p - pc);
  return max(1.0 + 2.0 * sd, 0.0);
}`;
}

/** The fade direction (g.w = mode + 4 · invert) is read at run time: turning the fade around does not recompile. */
function weightFunction(index: number, rule: RigRule): string {
  const shape = rule.shape;
  const shapeQ = shape === 'custom'
    ? `rigDistCustom${index}(d, ang, rc, R)`
    : `rigDist${cap(shape)}(d, ang, rc) / R`;
  const falloff = `rigFall${cap(rule.falloff)}(q)`;
  return `float rigWRule${index}(vec2 d, float ang, vec4 rc, float R, vec2 fade, vec4 extra, out float q) {
  float shapeQ = ${shapeQ};
  q = shapeQ;
  float fm = extra.w - 4.0 * floor(extra.w * 0.25);
  if (fm > 0.5) {
    vec2 fd = rigRot(d, -ang) / max(R, 0.005);
    fd.x /= max(rc.x, 0.05);
    if (fm < 1.5) q = max(shapeQ, clamp(0.5 + fd.x * 0.5, 0.0, 1.0));
    else if (fm < 2.5) q = max(shapeQ, clamp(0.5 + fd.y * 0.5, 0.0, 1.0));
    else q = max(shapeQ, clamp(0.5 + dot(fd, vec2(cos(ang), sin(ang))) * 0.5, 0.0, 1.0));
  }
  q = clamp((q - extra.x) / max(fade.y - extra.x, 0.05), 0.0, 1.0);
  q = pow(q, max(fade.x, 0.1));
  q = mix(q, q * q * (3.0 - 2.0 * q), extra.y);
  float weight = ${falloff};
  if (extra.w >= 4.0) weight = 1.0 - weight;
  return clamp(weight * extra.z, 0.0, 1.0);
}`;
}

function ruleBlock(index: number, rule: RigRule, stage: 'warp' | 'pre' | 'post'): string {
  const def = RIG_EFFECT_MAP[rule.effect];
  const weightFn = `rigWRule${index}`;
  const guard = def.global ? 'abs(rgAmt) > 0.0005' : 'abs(rgAmt) > 0.0005 && rgW > 0.0005';
  const color = def.usesColor ? `\n      vec3 rgCol = ${colorExpression(rule, index, stage)};` : '';
  const motion = rule.follow ? ' + atan(uVelocity.y, uVelocity.x)' : '';
  return `  {
    vec4 rgB = uRuleB[${index}];
    float rgAmt = rgB.x;
    if (abs(rgAmt) > 0.0005) {
    vec4 rgCc = uRuleC[${index}];
    vec4 rgDd = uRuleD[${index}];
    vec4 rgF = uRuleF[${index}];
    vec4 rgG = uRuleG[${index}];
    float rgR = max(rgB.y, 0.005);
    float rgP1 = rgB.z;
    float rgP2 = rgB.w;
    float rgP3 = rgDd.x;
    float rgP4 = rgDd.y;
    float rgAng = rgCc.y${motion};
    vec2 rgC = uPointer;
    float rgW = 0.0;
    float rgQ = 1.0;
    float rgT = uClock;
    ${sourceCode(rule, weightFn)}
    if (${guard}) {
      vec2 rgD = (p - rgC) * vec2(uAspect, 1.0);
      float rgLen = length(rgD);
      vec2 rgDir = rgD / max(rgLen, 0.0001);
      vec2 rgDirUv = rgDir / vec2(uAspect, 1.0);
      vec2 rgPerpUv = vec2(-rgDir.y, rgDir.x) / vec2(uAspect, 1.0);
      float rgA = rgAmt * rgW;${color}
      ${rewriteMacros(RIG_EFFECT_GLSL[rule.effect], rule).split('\n').join('\n      ')}
    }
    }
  }`;
}

/** The CSS texture of a rule, with motion and shading (see textureFx.ts). Anchored to the pointer or to the canvas. */
function textureRuleBlock(index: number, rule: RigRule): string {
  const weightFn = `rigWRule${index}`;
  const source = sourceCode(rule, weightFn);
  const origin = `vec2(${index % 4}.0, ${Math.floor(index / 4)}.0) * 64.0`;
  return `  {
    vec4 rgB = uRuleB[${index}];
    vec4 rgH = uRuleH[${index}];
    if (rgH.w > 0.5 && abs(rgB.x) > 0.0005) {
      vec4 rgCc = uRuleC[${index}];
      vec4 rgDd = uRuleD[${index}];
      vec4 rgE = uRuleE[${index}];
      vec4 rgF = uRuleF[${index}];
      vec4 rgG = uRuleG[${index}];
      vec4 rgI = uRuleI[${index}];
      vec4 rgJ = uRuleJ[${index}];
      vec4 rgK = uRuleK[${index}];
      float rgR = max(rgB.y, 0.005);
      float rgAng = rgCc.y${rule.follow ? ' + atan(uVelocity.y, uVelocity.x)' : ''};
      vec2 rgC = uPointer;
      float rgW = 0.0;
      float rgQ = 1.0;
      float rgT = uClock;
      ${source}
      rgW *= uInputActive;
      if (rgW > 0.0005) {
        vec2 rgBase = rgJ.w > 0.5 ? uvIn - vec2(0.5) : uvIn - rgC;
        vec2 texCoord0 = rigRot(rgBase * vec2(uAspect, 1.0) / max(rgH.x, 0.001), rgJ.z * uClock);
        vec2 rgFlow = rgJ.xy * uClock;
        vec2 texCoord = texCoord0 + rgH.yz - rgFlow;
        texCoord.x += rgK.z * sin(texCoord.y * 1.3 + uClock * rgK.w);
        vec2 rgCell = floor(texCoord);
        float rgKeep = step(rgF.z, rigHash(rgCell));
        float rgTw = 1.0 - rgK.x * (0.5 + 0.5 * sin(uClock * rgK.y + rigHash(floor(texCoord * 6.0) + rgCell) * 6.2831853));
        vec4 rgTex = rigAtlas(texCoord, ${origin});
        float rgTa = rgTex.a * rgKeep;
        vec3 rgTcol = min(rgTex.rgb / max(rgTex.a, 0.05), vec3(1.0));
        if (rgE.w > 0.001) {
          vec2 texCoord2 = texCoord0 * 0.62 + vec2(3.7, 1.9) + rgH.yz - rgFlow * 0.55;
          float rgBack = rigAtlas(texCoord2, ${origin}).a * rgE.w * 0.75 * step(rgF.z * 0.6, rigHash(floor(texCoord2) + vec2(7.0, 3.0)));
          rgTa = max(rgTa, rgBack);
        }
        if (rgI.w > 0.001) rgTcol = mix(rgTcol, ${colorExpression(rule, index, 'post')}, rgI.w);
        rgTcol *= rgF.w;
        float rgTf = clamp(rgTa * rgTw * rgW * min(abs(rgB.x), 1.0), 0.0, 1.0);
        col = rigBlend${cap(rule.blend)}(col, rgTcol, rgTf);
        rgAlpha = max(rgAlpha, clamp(rgTf * 0.85, 0.0, 0.85));
      }
    }
  }`;
}

function cssFxRuleBlock(index: number, rule: RigRule): string {
  const fx = rule.cssFx;
  if (!fx?.enabled) return '';
  const operation: Record<typeof fx.type, string> = {
    brightness: 'rgFxCol *= max(rgI.x, 0.0) / 100.0;',
    contrast: 'rgFxCol = (rgFxCol - 0.5) * (rgI.x / 100.0) + 0.5;',
    saturate: 'rgFxCol = mix(vec3(dot(rgFxCol, vec3(0.213, 0.715, 0.072))), rgFxCol, max(rgI.x, 0.0) / 100.0);',
    hue: 'rgFxCol = rigCssHue(rgFxCol, rgI.y * 0.0174533);',
    grayscale: 'rgFxCol = mix(rgFxCol, vec3(dot(rgFxCol, vec3(0.213, 0.715, 0.072))), clamp(rgI.x / 100.0, 0.0, 1.0));',
    'color-drift': 'rgFxCol = rigCssHue(rgFxCol, rgI.y * 0.0174533); rgFxCol = mix(vec3(dot(rgFxCol, vec3(0.213, 0.715, 0.072))), rgFxCol, max(rgI.z, 0.0) / 100.0);',
  };
  const weightFn = `rigWRule${index}`;
  const source = sourceCode(rule, weightFn);
  return `  {
    vec4 rgB = uRuleB[${index}];
    if (abs(rgB.x) > 0.0005) {
      vec4 rgCc = uRuleC[${index}];
      vec4 rgDd = uRuleD[${index}];
      vec4 rgF = uRuleF[${index}];
      vec4 rgG = uRuleG[${index}];
      vec4 rgI = uRuleI[${index}];
      float rgR = max(rgB.y, 0.005);
      float rgAng = rgCc.y${rule.follow ? ' + atan(uVelocity.y, uVelocity.x)' : ''};
      vec2 rgC = uPointer;
      float rgW = 0.0;
      float rgQ = 1.0;
      float rgT = uClock;
      ${source}
      if (rgW > 0.0005) {
        vec3 rgFxCol = col;
        ${operation[fx.type]}
        col = mix(col, rgFxCol, rgW * min(abs(rgB.x), 1.0));
      }
    }
  }`;
}

export interface GeneratedRigGlsl { functions: string; signature: string; used: { effects: RigEffectId[]; shapes: RigShapeId[]; falloffs: RigFalloffId[] } }

export function generateRigGlsl(rig: Pick<InteractionRig, 'rules'> | null): GeneratedRigGlsl {
  const rules = rig ? activeRules(rig) : [];
  const shapes = new Set<RigShapeId>();
  const falloffs = new Set<RigFalloffId>();
  const blends = new Set<RigBlend>();
  const stages: Record<'warp' | 'pre' | 'post', string[]> = { warp: [], pre: [], post: [] };
  const customShapes: string[] = [];
  const weights: string[] = [];
  rules.forEach((rule, index) => {
    const def = RIG_EFFECT_MAP[rule.effect];
    shapes.add(rule.shape);
    falloffs.add(rule.falloff);
    if (def.usesBlend) blends.add(rule.blend);
    if (rule.texture.enabled) blends.add(rule.blend);
    if (rule.shape === 'custom') customShapes.push(customShapeFunction(index));
    weights.push(weightFunction(index, rule));
    if (RIG_EFFECT_GLSL[rule.effect]) stages[def.stage].push(ruleBlock(index, rule, def.stage));
    if (rule.texture.enabled) stages.post.push(textureRuleBlock(index, rule));
    if (rule.cssFx?.enabled) stages.post.push(cssFxRuleBlock(index, rule));
  });
  const parts: string[] = [];
  // uniforms that only exist when a rule needs them (the template never declares them)
  const declarations: string[] = [];
  if (rules.some(rule => rule.texture.enabled)) declarations.push('uniform vec4 uRuleJ[8];', 'uniform vec4 uRuleK[8];');
  if (rules.some(rule => rule.shape === 'custom')) declarations.push('uniform sampler2D uRuleShapeAtlas;');
  if (declarations.length) parts.push(declarations.join('\n'));
  parts.push(COMMON_GLSL);
  if (blends.size) parts.push(blendFunctions(blends));
  shapes.forEach(shape => parts.push(`float rigDist${cap(shape)}(vec2 d, float ang, vec4 rc) { ${SHAPE_GLSL[shape]} }`));
  falloffs.forEach(falloff => parts.push(`float rigFall${cap(falloff)}(float q) { return ${FALLOFF_GLSL[falloff]}; }`));
  parts.push(...customShapes, ...weights);
  const header = 'float rgSpd = clamp(length(uVelocity) * 1.5, 0.0, 1.0);\n  vec2 rgVel = uVelocity;';
  parts.push(`vec2 rigWarp(vec2 pIn) {
  vec2 p = pIn;
  ${header}
${stages.warp.join('\n')}
  return p;
}
void rigPre(vec2 uvIn) {
  vec2 p = uvIn;
  ${header}
${stages.pre.join('\n')}
}
vec3 rigPost(vec3 colIn, vec2 uvIn, float pos) {
  vec3 col = colIn;
  vec2 p = uvIn;
  ${header}
${stages.post.join('\n')}
  return col;
}`);
  return {
    functions: parts.join('\n'),
    signature: rules.map(rule => rule.effect).join(','),
    used: {
      effects: [...new Set(rules.map(rule => rule.effect))],
      shapes: [...shapes],
      falloffs: [...falloffs],
    },
  };
}

export interface ShaderBuildOptions { octaves?: number; warpDepth?: number }

/** Builds the final fragment source from the template and a rig. Octaves / warp depth become compile-time constants. */
export function assembleFragmentShader(template: string, rig: Pick<InteractionRig, 'rules'> | null, options: ShaderBuildOptions = {}): string {
  const octaves = Math.max(1, Math.min(6, Math.round(options.octaves ?? 5)));
  const warpDepth = options.warpDepth === 1 ? 1 : 2;
  const defines = `#define RG_OCTAVES ${octaves}\n#define RG_WARP_DEPTH ${warpDepth}`;
  const functions = generateRigGlsl(rig).functions;
  return template.replace(RIG_DEFINES_MARKER, defines).replace(RIG_FUNCTIONS_MARKER, functions);
}
