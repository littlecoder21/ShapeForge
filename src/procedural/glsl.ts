import { assembleFragmentShader, type ShaderBuildOptions } from '../gradient/interactive/rig/glsl';
import { PROC_MAX_FIELDS, PROC_MAX_POINTS, PROC_MAX_STAGES, fieldFeatures, isProceduralActive, proceduralCapacity, type DistortionType, type ProceduralConfig, type StageTarget } from './types';
import { fieldSamplerGlsl } from './fieldGlsl';
import { PREMULT_BLEND_COMPENSATION, cssMeshGlsl } from './meshGlsl';

/* Generates the procedural part of the fragment shader and splices it into the template.
 *
 * The template (gradient.frag.glsl) is NOT edited. When a layer uses the procedural engine, three things are added at
 * named anchor lines and nowhere else, so a layer that does not use it compiles exactly the shader it always did:
 *     1. the uniforms and functions below, right after the interaction rig's functions;
 *     2. `procDistort` just before the surface-gradient block (it moves the sampling position `warped`, and `p`);
 *     3. `procSample` just before the layer-mix block (it recolours the pixel from the animated colour field).
 * Slider values are uniforms, never constants. Only the distortion *types* and the point-capacity tier are compiled in, so a
 * stage costs shader code only when it is present, and the centre loops are as long as the config needs (12 … 128), not
 * always the maximum. GLSL ES 1.00 rules apply (constant loop bounds, no `%`, explicit float literals). */

export { PROCEDURAL_UNIFORM_NAMES } from './types';

/** Lines of the template the hooks attach to. Each must occur exactly once; the injector throws if one is missing. */
export const PROC_ANCHORS = {
  functions: '/*@RIG_FUNCTIONS*/',
  warp: '  vec2 surfaceGradient = vec2(0.0);',
  color: '  if (uLayerMixEnabled > 0.5) {',
} as const;

/** What the generator needs from a config: its distortion stages, and (for the loop size) its points and anchors. */
export type ProceduralShaderInput = Pick<ProceduralConfig, 'enabled' | 'distortion'>
  & Partial<Pick<ProceduralConfig, 'points' | 'anchors' | 'mesh' | 'field' | 'color' | 'influence' | 'fields' | 'material'>>;

const declarations = (capacity: number, f: ReturnType<typeof fieldFeatures>) => `uniform vec4 uProcPoints[${capacity}];
uniform vec4 uProcColors[${capacity}];
uniform vec4 uProcA;
uniform vec4 uProcB;
uniform vec4 uProcC;
uniform vec4 uProcGrade;
uniform vec4 uProcD;
uniform vec4 uProcBase;
uniform vec4 uProcE;
uniform vec4 uProcWarpA[${PROC_MAX_STAGES}];
uniform vec4 uProcWarpB[${PROC_MAX_STAGES}];
uniform vec4 uProcWarpC[${PROC_MAX_STAGES}];
uniform vec4 uProcF;
uniform vec4 uProcG;
uniform vec4 uProcH;
${f.shaped ? `uniform vec4 uProcShape[${capacity}];` : ''}
${f.family === 'rbf' ? `uniform vec4 uProcRbf[${capacity}];\nuniform vec4 uProcRbfP[3];\nuniform vec4 uProcRbfR[2];` : ''}
${f.layers ? `uniform vec4 uProcFieldA[${PROC_MAX_FIELDS}];\nuniform vec4 uProcFieldB[${PROC_MAX_FIELDS}];\nuniform vec4 uProcFieldC[${PROC_MAX_FIELDS}];` : ''}
${f.material ? 'uniform vec4 uProcM0;\nuniform vec4 uProcM1;\nuniform vec4 uProcM2;\nuniform vec4 uProcM3;' : ''}
/* uProcA: mode (1 hybrid, 2 full), point count, field method, hybrid mix
 * uProcB: field radius, strength, falloff, softness
 * uProcC: exponent, overlap, colour space the shader decodes (0 srgb, 1 linear, 2 oklab), octave cap
 * uProcF: OKLCH hue route (0 shorter, 1 longer, 2 increasing, 3 decreasing), chroma preservation, global influence, core intensity
 * uProcG: custom-weighted kernel mix (gaussian, compact, inverse), polygon sides
 * uProcH: RBF scale, RBF kernel parameter, polygon rounding, OKLCH reference hue
 * uProcShape[i]: shape id, rotation (rad), anisotropy, inner fraction · uProcRbf[i]: exact-RBF coefficients
 * uProcFieldA/B/C[k]: extra fields (first centre, count, kernel, blend · radius, strength, falloff, opacity · distort flag)
 * uProcM0…3: material (sampling radius, glow, bloom, threshold · inner glow, edge glow, ambient, light · light dir, elevation, specular · shininess, depth, shadow, scatter)
 * uProcD: hue shift in radians, procedural animation time
 * uProcE: CSS-compatible mesh on (0 = the unified field), layered compositing (0 = background-image), ellipse ratio
 * uProcPoints[i]: x, y, radius, weight · uProcColors[i]: rgb, CSS hint exponent
 * uProcWarpA[i]: enabled, noise scale, intensity, frequency
 * uProcWarpB[i]: octaves, lacunarity, persistence, turbulence
 * uProcWarpC[i]: flow speed, direction (rad), noise kind (0 gradient, 1 value) */`;

const NOISE_GLSL = `float procHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float procNoise(vec2 p, float kind) {
  if (kind > 0.5) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = procHash(i);
    float b = procHash(i + vec2(1.0, 0.0));
    float c = procHash(i + vec2(0.0, 1.0));
    float d = procHash(i + vec2(1.0, 1.0));
    return (mix(mix(a, b, u.x), mix(c, d, u.x), u.y) - 0.5) * 1.6;
  }
  return noise2(p);
}
float procFbm(vec2 p, vec4 b, float kind, float ridged) {
  float oct = min(b.x, uProcC.w);
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= oct) break;
    float n = procNoise(p, kind);
    n = mix(n, 1.0 - 2.0 * abs(n), ridged);
    value += n * amp;
    p = p * b.y + vec2(7.1, 3.7);
    amp *= b.z;
  }
  return value;
}
vec2 procFbm2(vec2 p, vec4 b, float kind, float ridged) {
  return vec2(procFbm(p, b, kind, ridged), procFbm(p + vec2(5.2, 1.3), b, kind, ridged));
}
vec2 procDir(vec4 c) {
  return vec2(cos(c.y), sin(c.y));
}`;

/** Body of each distortion type. a / b / c are that stage's uniform vec4s; `s` is the sampling position, `time` the layer time. */
const STAGE_GLSL: Record<Exclude<DistortionType, 'none'>, string> = {
  fbm: `vec2 drift = procDir(c) * (time * c.x * 0.2);
  return s + procFbm2(s * a.y + drift, b, c.z, b.w * 0.6) * a.z * 0.5;`,
  warp: `vec2 drift = procDir(c) * (time * c.x * 0.2);
  vec2 p = s * a.y + drift;
  vec2 q = procFbm2(p, b, c.z, 0.0);
  vec2 r = procFbm2(p + 2.0 * q + vec2(1.7, 9.2), b, c.z, 0.0);
  return s + r * a.z * 0.5;`,
  multiwarp: `vec2 drift = procDir(c) * (time * c.x * 0.2);
  vec2 p = s * a.y + drift;
  vec2 q = procFbm2(p, b, c.z, 0.0);
  vec2 r = procFbm2(p + 2.0 * q + vec2(1.7, 9.2), b, c.z, 0.0);
  vec2 w = procFbm2(p + 2.0 * r + vec2(8.3, 2.8), b, c.z, 0.0);
  return s + w * a.z * 0.5;`,
  turbulence: `vec2 drift = procDir(c) * (time * c.x * 0.2);
  return s + procFbm2(s * a.y + drift, b, c.z, 0.35 + 0.65 * b.w) * a.z * 0.55;`,
  curl: `vec2 p = s * a.y + procDir(c) * (time * c.x * 0.2);
  float e = 0.03;
  float up = procFbm(p + vec2(0.0, e), b, c.z, 0.0);
  float dn = procFbm(p - vec2(0.0, e), b, c.z, 0.0);
  float rt = procFbm(p + vec2(e, 0.0), b, c.z, 0.0);
  float lf = procFbm(p - vec2(e, 0.0), b, c.z, 0.0);
  return s + vec2(up - dn, -(rt - lf)) / (2.0 * e) * a.z * 0.12;`,
  polar: `float rad = length(s);
  float ang = atan(s.y, s.x);
  ang += a.z * (0.6 + rad * a.w * 0.35) * sin(time * c.x * 0.3 + rad * a.w);
  return vec2(cos(ang), sin(ang)) * rad;`,
  radial: `float rad = length(s);
  float scaled = rad * (1.0 + a.z * 0.35 * sin(rad * a.w * 3.14159265 - time * c.x));
  return s * (scaled / max(rad, 0.0001));`,
  wave: `vec2 d = procDir(c);
  vec2 n = vec2(-d.y, d.x);
  return s + d * sin(dot(s, n) * a.w * 2.0 + time * c.x) * a.z * 0.1
    + n * sin(dot(s, d) * a.w * 1.4 - time * c.x * 0.8) * a.z * 0.05;`,
  flow: `vec2 d = procDir(c);
  vec2 n = vec2(-d.y, d.x);
  vec2 p = s * a.y + d * (time * c.x * 0.3);
  return s + d * procFbm(p, b, c.z, 0.0) * a.z * 0.6 + n * procFbm(p + vec2(3.1, 7.7), b, c.z, 0.0) * a.z * 0.2;`,
  rotate: `return rigRot(s, a.z * 0.8 + time * c.x * 0.15);`,
  scale: `return s * mix(1.0, 1.0 / max(a.y, 0.05), clamp(a.z, 0.0, 1.0));`,
};

function stageFunctions(types: DistortionType[]): string {
  const used = [...new Set(types.filter((type): type is Exclude<DistortionType, 'none'> => type !== 'none'))];
  return used.map(type => `vec2 procStage_${type}(vec2 s, float time, vec4 a, vec4 b, vec4 c) {
  ${STAGE_GLSL[type]}
}`).join('\n');
}

type StageInput = { type: DistortionType; target?: StageTarget };
const targetOf = (stage: StageInput): StageTarget => stage.target ?? 'layer';
const stageCall = (index: number, type: string, arg: string) =>
  `procStage_${type}(${arg}, t, uProcWarpA[${index}], uProcWarpB[${index}], uProcWarpC[${index}])`;

/** One function per stage target. `layer` moves the whole shader's sampling position (the original behaviour and the default);
 *  `field` only the position the colour field is sampled at; `points` the colour centres; `color` returns a displacement that
 *  the entry point turns into a hue / exposure offset. A target with no stages is the identity and costs nothing. */
function distortFunctions(stages: StageInput[]): string {
  const list = stages.slice(0, PROC_MAX_STAGES);
  const chain = (name: string, target: StageTarget) => {
    const calls = list.map((stage, index) => stage.type === 'none' || targetOf(stage) !== target ? ''
      : `  if (uProcWarpA[${index}].x > 0.5) s = ${stageCall(index, stage.type, 's')};`).filter(Boolean);
    return `vec2 ${name}(vec2 sIn, float t) {
  vec2 s = sIn;
${calls.join('\n')}
  return s;
}`;
  };
  const colorCalls = list.map((stage, index) => stage.type === 'none' || targetOf(stage) !== 'color' ? ''
    : `  if (uProcWarpA[${index}].x > 0.5) d += ${stageCall(index, stage.type, 'sIn')} - sIn;`).filter(Boolean);
  return [
    chain('procDistort', 'layer'),
    chain('procDistortField', 'field'),
    chain('procDistortPoints', 'points'),
    `vec2 procDistortColor(vec2 sIn, float t) {
  vec2 d = vec2(0.0);
${colorCalls.join('\n')}
  return d;
}`,
    `vec2 procMovePoint(vec2 p) {
  vec2 asp = vec2(uAspect, 1.0);
  return procDistortPoints((p - 0.5) * asp, uProcD.y) / asp + 0.5;
}`,
  ].join('\n');
}

const COLOR_GLSL = `vec3 procToSrgb(vec3 lin) {
  lin = max(lin, vec3(0.0));
  return mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), lin));
}
vec3 procDecode(vec3 c, float space) {
  if (space > 1.5) {
    float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    float s_ = c.x - 0.0894841775 * c.y - 1.291485548 * c.z;
    float l = l_ * l_ * l_;
    float m = m_ * m_ * m_;
    float s = s_ * s_ * s_;
    return procToSrgb(vec3(
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ));
  }
  if (space > 0.5) return procToSrgb(c);
  return c;
}
vec3 procGrade(vec3 c) {
  c = rigHue(c, uProcD.x);
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, uProcGrade.z);
  c *= exp2(uProcGrade.x);
  c = (c - 0.5) * uProcGrade.y + 0.5;
  c *= vec3(1.0 + uProcGrade.w * 0.18, 1.0, 1.0 - uProcGrade.w * 0.18);
  return clamp(c, 0.0, 1.0);
}`;

export interface GeneratedProceduralGlsl {
  functions: string;
  /** distortion types compiled in, in stage order; changing it needs a rebuild */
  signature: string;
  /** the compiled loop size (a tier: 12, 24, 48, 96 or 128) */
  capacity: number;
}

export function generateProceduralGlsl(config: Pick<ProceduralConfig, 'distortion'> & Partial<Pick<ProceduralConfig, 'points' | 'anchors' | 'mesh' | 'field' | 'color' | 'influence' | 'fields' | 'material'>>, capacity = proceduralCapacity(config)): GeneratedProceduralGlsl {
  const stages = config.distortion.slice(0, PROC_MAX_STAGES);
  const types = stages.map(stage => stage.type);
  const size = Math.max(PROC_MAX_POINTS, capacity);
  const features = fieldFeatures(config);
  const used = (target: StageTarget) => stages.some(stage => stage.type !== 'none' && targetOf(stage) === target);
  return {
    functions: [
      declarations(size, features), NOISE_GLSL, COLOR_GLSL, stageFunctions(types), distortFunctions(stages),
      fieldSamplerGlsl({ capacity: size, features, fieldStages: used('field'), pointStages: used('points'), colorStages: used('color') }),
      cssMeshGlsl(size),
    ].filter(Boolean).join('\n'),
    signature: types.join(','),
    capacity: size,
  };
}

const WARP_HOOK = `  if (uProcA.x > 0.5) {
    vec2 procShift = procDistort(warped, uProcD.y) - warped;
    warped += procShift;
    p += procShift / vec2(uAspect, 1.0);
  }
`;

/* CSS-compatible mesh: sampled at `p` (the pointer / ripple / procedural-distortion position), not at `warped`, so the style's own
 * ambient noise, zoom and rotation cannot bend a mesh that is meant to match the CSS. Full mode REPLACES colour and alpha with the
 * mesh (straight alpha, the renderer writes it without blending); hybrid mode lays it over the existing colour. */
const COLOR_HOOK = `  if (uProcA.x > 0.5) {
    if (uProcE.x > 0.5) {
      vec4 procMesh = procSampleCss(p);
      procMesh.rgb = procGrade(procMesh.rgb);
      if (uProcA.x > 1.5) {
${PREMULT_BLEND_COMPENSATION
  ? `        float procRoot = sqrt(max(procMesh.a, 0.0));
        color = vec4(min(procMesh.rgb / max(procRoot, 0.0001), vec3(1.0)), procRoot);`
  : '        color = procMesh;'}
        alpha = 1.0;
      } else {
        float procCover = procMesh.a * uProcA.w;
        color.rgb = mix(color.rgb, procMesh.rgb, procCover);
        color.a = mix(color.a, 1.0, procCover);
        alpha = mix(alpha, 1.0, procCover);
      }
    } else {
      vec4 procField = procSample(warped / vec2(uAspect, 1.0) + 0.5);
      float procCover = procField.a * (uProcA.x > 1.5 ? 1.0 : uProcA.w);
      color.rgb = mix(color.rgb, procField.rgb, procCover);
      color.a = mix(color.a, 1.0, procCover);
      alpha = mix(alpha, 1.0, procCover);
    }
  }
`;

function insertOnce(source: string, anchor: string, text: string, where: 'before' | 'after', name: string): string {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`Procedural shader hook "${name}" needs exactly one occurrence of: ${anchor.trim()}`);
  }
  return where === 'before'
    ? `${source.slice(0, first)}${text}${source.slice(first)}`
    : `${source.slice(0, first + anchor.length)}\n${text}${source.slice(first + anchor.length)}`;
}

/** Returns the template with the procedural hooks added (when the config is active) — otherwise the template unchanged. */
export function injectProceduralGlsl(template: string, config: ProceduralShaderInput | null | undefined): string {
  if (!config || !isProceduralActive(config)) return template;
  const { functions } = generateProceduralGlsl(config);
  let out = insertOnce(template, PROC_ANCHORS.functions, functions, 'after', 'functions');
  out = insertOnce(out, PROC_ANCHORS.warp, WARP_HOOK, 'before', 'warp');
  out = insertOnce(out, PROC_ANCHORS.color, COLOR_HOOK, 'before', 'color');
  return out;
}

/** The existing interaction-rig assembly, plus the procedural engine when `procedural` is active. */
export function assembleProceduralShader(
  template: string,
  rig: Parameters<typeof assembleFragmentShader>[1],
  options: ShaderBuildOptions,
  procedural: ProceduralShaderInput | null | undefined,
): string {
  return assembleFragmentShader(injectProceduralGlsl(template, procedural), rig, options);
}
