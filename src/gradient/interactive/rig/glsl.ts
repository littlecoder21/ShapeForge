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
        float rgWj = ${weightFn}((p - rgTr.xy) * ${asp}, rgAng, rgCc, rgR, rgQj) * rgTr.z;
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
      float rgWj = ${weightFn}((p - rgCk.xy) * ${asp}, rgAng, rgCc, rgR, rgQj) * rgEnv;
      if (rgWj > rgW) { rgW = rgWj; rgC = rgCk.xy; rgQ = rgQj; rgT = rgAge; }
    }`;
    case 'touch2':
      return `rgC = uTouch2.xy;
    rgW = ${weightFn}((p - rgC) * ${asp}, rgAng, rgCc, rgR, rgQ);`;
    case 'fixed':
      return `rgC = rgDd.zw;
    rgW = ${weightFn}((p - rgC) * ${asp}, rgAng, rgCc, rgR, rgQ);`;
    case 'orbit':
      return `rgC = vec2(0.5 + rgDd.z * cos(uClock * rgDd.w) / max(uAspect, 0.001), 0.5 + rgDd.z * sin(uClock * rgDd.w * 1.31));
    rgW = ${weightFn}((p - rgC) * ${asp}, rgAng, rgCc, rgR, rgQ);`;
    case 'symmetry':
      return `float rgCnt = clamp(floor(rgDd.z + 0.5), 2.0, 8.0);
    vec2 rgRel = (uPointer - 0.5) * ${asp};
    for (int j = 0; j < 8; j++) {
      if (float(j) >= rgCnt) break;
      float rgAn = 6.2831853 * float(j) / rgCnt + uClock * rgDd.w;
      vec2 rgCj = 0.5 + rigRot(rgRel, rgAn) / ${asp};
      float rgQj = 1.0;
      float rgWj = ${weightFn}((p - rgCj) * ${asp}, rgAng, rgCc, rgR, rgQj);
      if (rgWj > rgW) { rgW = rgWj; rgC = rgCj; rgQ = rgQj; }
    }`;
    default:
      return `rgC = uPointer;
    rgW = ${weightFn}((p - rgC) * ${asp}, rgAng, rgCc, rgR, rgQ);`;
  }
}

function rewriteMacros(body: string, rule: RigRule): string {
  return body
    .replace(/RG_FALL\(/g, `rigFall${cap(rule.falloff)}(`)
    .replace(/RG_BLEND\(/g, `rigBlend${cap(rule.blend)}(`);
}

function ruleBlock(index: number, rule: RigRule, stage: 'warp' | 'pre' | 'post'): string {
  const def = RIG_EFFECT_MAP[rule.effect];
  const weightFn = `rigW${cap(rule.shape)}${cap(rule.falloff)}`;
  const guard = def.global ? 'abs(rgAmt) > 0.0005' : 'abs(rgAmt) > 0.0005 && rgW > 0.0005';
  const color = def.usesColor ? `\n      vec3 rgCol = ${colorExpression(rule, index, stage)};` : '';
  const motion = rule.follow ? ' + atan(uVelocity.y, uVelocity.x)' : '';
  return `  {
    vec4 rgB = uRuleB[${index}];
    vec4 rgCc = uRuleC[${index}];
    vec4 rgDd = uRuleD[${index}];
    float rgAmt = rgB.x;
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
  }`;
}

export interface GeneratedRigGlsl { functions: string; signature: string; used: { effects: RigEffectId[]; shapes: RigShapeId[]; falloffs: RigFalloffId[] } }

export function generateRigGlsl(rig: Pick<InteractionRig, 'rules'> | null): GeneratedRigGlsl {
  const rules = rig ? activeRules(rig) : [];
  const shapes = new Set<RigShapeId>();
  const falloffs = new Set<RigFalloffId>();
  const blends = new Set<RigBlend>();
  const combos = new Set<string>();
  const stages: Record<'warp' | 'pre' | 'post', string[]> = { warp: [], pre: [], post: [] };
  rules.forEach((rule, index) => {
    const def = RIG_EFFECT_MAP[rule.effect];
    shapes.add(rule.shape);
    falloffs.add(rule.falloff);
    combos.add(`${rule.shape}:${rule.falloff}`);
    if (def.usesBlend) blends.add(rule.blend);
    stages[def.stage].push(ruleBlock(index, rule, def.stage));
  });
  const parts: string[] = [COMMON_GLSL];
  if (blends.size) parts.push(blendFunctions(blends));
  shapes.forEach(shape => parts.push(`float rigDist${cap(shape)}(vec2 d, float ang, vec4 rc) { ${SHAPE_GLSL[shape]} }`));
  falloffs.forEach(falloff => parts.push(`float rigFall${cap(falloff)}(float q) { return ${FALLOFF_GLSL[falloff]}; }`));
  combos.forEach(combo => {
    const [shape, falloff] = combo.split(':') as [RigShapeId, RigFalloffId];
    parts.push(`float rigW${cap(shape)}${cap(falloff)}(vec2 d, float ang, vec4 rc, float R, out float q) {
  q = rigDist${cap(shape)}(d, ang, rc) / R;
  if (rc.z > 0.001) q = max(q * (1.0 + rc.z * 1.6 * field(d * 5.0 + vec2(uClock * 0.2, -uClock * 0.15))), 0.0);
  return rigFall${cap(falloff)}(q);
}`);
  });
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
