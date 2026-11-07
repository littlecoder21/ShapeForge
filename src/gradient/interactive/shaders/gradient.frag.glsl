precision highp float;

varying vec2 vUv;

/*@RIG_DEFINES*/

uniform vec2 uResolution;
uniform vec2 uPointer;
uniform vec2 uVelocity;
uniform float uPointerActive;
uniform float uPointerDown;
uniform float uTime;
uniform float uClock;
uniform float uAspect;
uniform float uStyle;
uniform vec4 uStyleP;
uniform float uGradientKind;
uniform float uGradientAngle;
uniform vec2 uGradientOrigin;
uniform vec2 uGradientRadius;
uniform float uShaderMix;
uniform vec3 uInteractionColor;
uniform vec3 uInteractionColors[5];
uniform float uInteractionColorCount;
uniform float uInteractionColorMix;
uniform float uInteractionColorSpeed;
uniform float uInteractionFalloff;
uniform float uInteractionDistortion;
uniform float uInteractionDisplacement;
uniform float uInteractionDisplacementMode;
uniform float uInteractionVelocityReaction;
uniform float uInteractionGlitch;
uniform float uStopCount;
uniform float uSpeed;
uniform float uIntensity;
uniform float uDistortion;
uniform float uDistortionScale;
uniform float uTurbulence;
uniform float uTimeOffset;
uniform float uFlowAngle;
uniform float uFlowDrift;
uniform float uBreath;
uniform float uBreathRate;
uniform float uRotation;
uniform float uZoom;
uniform float uInteractionRadius;
uniform float uInteractionStrength;
uniform float uGlow;
uniform float uRippleStrength;
uniform float uRippleSpeed;
uniform float uRippleCount;
uniform float uMeshCount;
uniform float uMeshDrift;
uniform float uMeshSpread;
uniform float uMeshBlend;
uniform float uWrapMode;
uniform float uToneMap;
uniform float uVignette;
uniform float uSheen;
uniform float uGrain;
uniform float uLutEnabled;
uniform float uProjectOutput;
uniform float uLayerMixEnabled;
uniform float uLayerMixMode;
uniform float uLayerMixStrength;
uniform float uLayerMixSpeed;
uniform sampler2D uPaletteLut;
uniform sampler2D uLayerMixLut;
uniform vec4 uPalette[8];
uniform float uPaletteAlpha[8];
uniform vec4 uRipples[8];
uniform vec4 uMeshPoints[8];
uniform vec4 uMeshColors[8];
uniform vec4 uMeshBase;
uniform vec4 uRuleB[8];
uniform vec4 uRuleC[8];
uniform vec4 uRuleD[8];
uniform vec4 uRuleE[8];
uniform vec4 uRuleF[8];
uniform vec4 uTrail[12];
uniform vec3 uTouch2;

vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(dot(hash22(i), f), dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y
  );
}

const float FIELD_GAIN = 1.0;
float field(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotateScale = mat2(0.8, 0.6, -0.6, 0.8) * 2.03;
  for (int octave = 0; octave < RG_OCTAVES; octave++) {
    value += noise2(p) * amplitude;
    p = rotateScale * p + vec2(7.1);
    amplitude *= 0.5;
  }
  return value * FIELD_GAIN;
}

vec2 warpFlow(vec2 p, float t) {
  vec2 q = vec2(
    field(p * 1.2 + vec2(0.0, t * 0.05)),
    field(p * 1.2 + vec2(5.2, 1.3) - t * 0.04)
  );
#if RG_WARP_DEPTH > 1
  return vec2(
    field(p * 1.5 + 3.0 * q + vec2(1.7, 9.2) + t * 0.13),
    field(p * 1.5 + 3.0 * q + vec2(8.3, 2.8) - t * 0.11)
  );
#else
  return q;
#endif
}

float wrapT(float t) {
  if (uWrapMode > 1.5) return fract(t);
  return 1.0 - abs(1.0 - 2.0 * fract(t * 0.5));
}

vec3 finish(vec3 c, vec2 uv, vec2 frag) {
  c = mix(c, 1.0 - exp(-c * 1.4), uToneMap);
  vec2 d = uv - 0.5;
  c *= 1.0 - uVignette * dot(d, d) * 1.4;
  float h = fract(sin(dot(frag, vec2(12.9898, 78.233)) + uClock) * 43758.5453);
  c += (h - 0.5) * (1.0 / 255.0 + uGrain * 0.06);
  return max(c, vec3(0.0));
}

vec4 samplePalette(float t) {
  t = clamp(t, 0.0, 1.0);
  if (uLutEnabled > 0.5) return texture2D(uPaletteLut, vec2(t, 0.5));
  if (uStopCount < 1.5) return vec4(uPalette[0].rgb, uPaletteAlpha[0]);
  vec4 previous = uPalette[0];
  float previousAlpha = uPaletteAlpha[0];
  for (int i = 1; i < 8; i++) {
    if (float(i) >= uStopCount) break;
    vec4 current = uPalette[i];
    if (t <= current.a) {
      float f = clamp((t - previous.a) / max(0.0001, current.a - previous.a), 0.0, 1.0);
      return vec4(mix(previous.rgb, current.rgb, f), mix(previousAlpha, uPaletteAlpha[i], f));
    }
    previous = current;
    previousAlpha = uPaletteAlpha[i];
  }
  return vec4(previous.rgb, previousAlpha);
}

vec3 blendLayerColors(vec3 base, vec3 other, float mode) {
  if (mode < 0.5) return other;
  if (mode < 1.5) return base * other;
  if (mode < 2.5) return 1.0 - (1.0 - base) * (1.0 - other);
  if (mode < 3.5) return mix(2.0 * base * other, 1.0 - 2.0 * (1.0 - base) * (1.0 - other), step(vec3(0.5), base));
  return min(base + other, 1.0);
}

vec3 sampleInteractionPalette(float t) {
  float count = max(1.0, uInteractionColorCount);
  if (count < 1.5) return uInteractionColors[0];
  float position = clamp(t, 0.0, 1.0) * (count - 1.0);
  vec3 previous = uInteractionColors[0];
  for (int i = 1; i < 5; i++) {
    if (float(i) >= count) break;
    if (position <= float(i)) return mix(previous, uInteractionColors[i], clamp(position - float(i - 1), 0.0, 1.0));
    previous = uInteractionColors[i];
  }
  return previous;
}

vec4 sampleMesh(vec2 p) {
  vec3 weightedColor = uMeshBase.rgb * uMeshBase.a;
  float totalWeight = uMeshBase.a;
  float uncovered = 1.0 - uMeshBase.a;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uMeshCount) break;
    vec4 point = uMeshPoints[i];
    float fi = float(i);
    vec2 drift = vec2(sin(uTime * 0.45 + fi) * 0.025, cos(uTime * 0.38 + fi * 1.7) * 0.02) * uDistortion;
    vec2 orbit = vec2(
      sin(uTime * 0.16 * (0.7 + fract(fi * 0.618)) + fi * 2.4) * 0.62 / max(uAspect, 0.001),
      cos(uTime * 0.14 * (0.6 + fract(fi * 0.417)) + fi * 1.9) * 0.38
    ) * uMeshDrift;
    vec2 delta = (p - point.xy - drift - orbit) * vec2(uAspect, 1.0);
    float radius = max(0.01, point.z * uAspect * (1.0 + 0.08 * sin(uTime + float(i)) * uDistortion));
    float sharpness = mix(4.5, 1.0, clamp(uMeshSpread, 0.0, 1.0));
    float weight = exp(-sharpness * dot(delta, delta) / (radius * radius)) * point.w;
    weightedColor += uMeshColors[i].rgb * weight;
    totalWeight += weight;
    uncovered *= 1.0 - clamp(weight, 0.0, 1.0);
  }
  if (totalWeight < 0.0001) return vec4(0.0);
  return vec4(weightedColor / totalWeight, clamp(1.0 - uncovered, uMeshBase.a, 1.0));
}

/* accumulators written by the generated interaction rules */
float rgPal = 0.0;
float rgChroma = 0.0;
float rgAlpha = 0.0;
float rgTime = 0.0;
float rgSpec = 0.0;

/*@RIG_FUNCTIONS*/

/* motion: static rotation + slow spin, drift along the rotated axis, zoom */
vec2 flowDomain(vec2 v, float t) {
  float a = uFlowAngle + uRotation * t;
  float s = sin(a);
  float c = cos(a);
  v = vec2(c * v.x - s * v.y, s * v.x + c * v.y);
  v.x += uFlowDrift * t * 0.12;
  return v / max(uZoom, 0.05);
}

void main() {
  vec2 p = vUv;
  float t = uTime + uTimeOffset;
  vec2 pointerDelta = (p - uPointer) * vec2(uAspect, 1.0);
  float pointerDistance = length(pointerDelta);
  float pointerRatio = clamp(pointerDistance / max(0.001, uInteractionRadius), 0.0, 1.0);
  float pointerFalloff = 1.0 - smoothstep(0.0, 1.0, pointerRatio);
  if (uInteractionFalloff > 0.5 && uInteractionFalloff < 1.5) pointerFalloff = 1.0 - pointerRatio;
  else if (uInteractionFalloff > 1.5 && uInteractionFalloff < 2.5) pointerFalloff = pow(pointerFalloff, 2.4);
  else if (uInteractionFalloff > 2.5) pointerFalloff = exp(-4.5 * pointerRatio * pointerRatio);
  float influence = pointerFalloff * uPointerActive * uInteractionStrength;
  vec2 direction = normalize(pointerDelta + vec2(0.0001));
  vec2 directionUv = direction / vec2(uAspect, 1.0);
  vec2 perpendicularUv = vec2(-direction.y, direction.x) / vec2(uAspect, 1.0);
  float pointerSpeed = length(uVelocity);
  float velocityResponse = clamp(pointerSpeed * 1.5, 0.0, 1.0) * uInteractionVelocityReaction;
  float velocityGain = 1.0 + velocityResponse * 1.8;
  float glitchAmount = uInteractionGlitch * pointerFalloff * uPointerActive * uInteractionStrength
    * (0.35 + velocityResponse * 0.65);
  float glitchRow = floor(p.y * (18.0 + uResolution.y * 0.08));
  float glitchTick = floor(uClock * 20.0);
  float glitchRandom = fract(sin(glitchRow * 12.9898 + glitchTick * 78.233) * 43758.5453);
  float glitchGate = step(0.76, glitchRandom);

  /* interaction rig: warp the sampling position, then write palette / time accumulators */
  p = rigWarp(p);
  rigPre(vUv);
  t += rgTime;

  float displacement = clamp(influence * uInteractionDisplacement * velocityGain * 0.18, 0.0, 0.42);
  float displacementDirection = uInteractionDisplacementMode < 0.5 ? -1.0 : 1.0;
  p += directionUv * displacement * displacementDirection;
  float interactionWarp = pointerFalloff * uPointerActive * uInteractionDistortion * velocityGain;
  float interactionWave = sin(pointerDistance * 22.0 - uClock * (2.0 + uSpeed * 4.0));
  p += directionUv * interactionWave * interactionWarp * 0.14;
  p += perpendicularUv * cos(pointerDistance * 14.0 + uClock * 1.7) * interactionWarp * 0.09;
  p.x += (glitchRandom - 0.5) * glitchAmount * glitchGate * 0.075 / max(uAspect, 0.001);

  float rippleGlow = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uRippleCount) break;
    vec4 ripple = uRipples[i];
    float age = max(0.0, uClock - ripple.z);
    vec2 dr = (p - ripple.xy) * vec2(uAspect, 1.0);
    float radius = length(dr) + 0.0001;
    float front = age * uRippleSpeed;
    float wave = exp(-pow((radius - front) * 8.0, 2.0)) * exp(-age * 1.25) * ripple.w;
    p += dr / radius / vec2(uAspect, 1.0) * wave * sin((radius - front) * 26.0) * 0.05 * uRippleStrength;
    rippleGlow += wave;
  }
  rippleGlow *= uRippleStrength;

  vec2 centered = flowDomain((p - 0.5) * vec2(uAspect, 1.0), t);
  vec2 r = warpFlow(centered, t);
  float n = field(centered * uDistortionScale + (2.0 * uTurbulence) * r + vec2(t * 0.13, -t * 0.09));
  vec2 warped = centered;
  float turbulence = field(warped * uDistortionScale * 2.1 + (2.0 * uTurbulence) * r + vec2(t * 0.17, t * 0.11));
  float breathMul = 1.0 + uBreath * sin(uClock * uBreathRate * 6.2831853);
  warped += vec2(turbulence, n) * uDistortion * breathMul * (0.25 + uTurbulence);
  vec2 surfaceGradient = vec2(0.0);
  if (uSheen > 0.0 || uStyle > 2.5 && uStyle < 3.5) {
    float surface = field(warped);
    surfaceGradient = vec2(field(warped + vec2(0.012, 0.0)), field(warped + vec2(0.0, 0.012))) - vec2(surface);
  }
  float colorPosition;
  float alpha = 1.0;
  float bands = 1.0;
  float rimLight = 0.0;
  vec4 sp = uStyleP;
  vec2 gradientOrigin = uGradientOrigin;
  if (uGradientKind < 0.5 || uGradientKind > 2.5 && uGradientKind < 4.5) gradientOrigin = vec2(0.5);
  vec2 gradientDelta = (p - gradientOrigin) * vec2(uAspect, 1.0);
  vec2 gradientDirection = vec2(sin(uGradientAngle), cos(uGradientAngle));
  float lineSpan = max(0.001, abs(gradientDirection.x) * uAspect + abs(gradientDirection.y));
  float basePosition = clamp(0.5 + dot(gradientDelta, gradientDirection) / lineSpan, 0.0, 1.0);
  float radialPosition = clamp(length((p - uGradientOrigin) / max(uGradientRadius, vec2(0.001))), 0.0, 1.0);
  vec2 cssGradientDelta = (p - gradientOrigin) * vec2(uAspect, 1.0);
  float cssPosition = clamp(0.5 + dot(cssGradientDelta, gradientDirection) / lineSpan, 0.0, 1.0);
  float cssRadialPosition = clamp(length((p - uGradientOrigin) / max(uGradientRadius, vec2(0.001))), 0.0, 1.0);
  float conicPosition = fract((1.5707963 - atan(gradientDelta.y, gradientDelta.x) - uGradientAngle) / 6.2831853);
  float cssConicPosition = fract((1.5707963 - atan(cssGradientDelta.y, cssGradientDelta.x) - uGradientAngle) / 6.2831853);
  if (dot(gradientDelta, gradientDelta) < 0.0000001) conicPosition = 0.0;
  if (dot(cssGradientDelta, cssGradientDelta) < 0.0000001) cssConicPosition = 0.0;
  if (uGradientKind > 0.5 && uGradientKind < 1.5) basePosition = radialPosition;
  else if (uGradientKind > 1.5 && uGradientKind < 2.5) basePosition = conicPosition;
  else if (uGradientKind > 3.5 && uGradientKind < 4.5) basePosition = radialPosition;
  // Curve geometry intentionally retains the linear gradient position.
  else if (uGradientKind > 4.5) basePosition = clamp(0.5 + field(warped * 1.4), 0.0, 1.0);
  if (uGradientKind > 0.5 && uGradientKind < 1.5) cssPosition = cssRadialPosition;
  else if (uGradientKind > 1.5 && uGradientKind < 2.5) cssPosition = cssConicPosition;

  if (uStyle < 0.5) {
    colorPosition = wrapT(basePosition + 0.13 * sin(warped.x * 4.1 + warped.y * 2.3 + n * 3.0 + t * 0.34));
  } else if (uStyle < 1.5) {
    float wave = sin(warped.x * 3.2 + n * 4.0 + t * 0.28) * 0.16;
    float curtain = field(vec2(warped.x * 0.7, warped.y * 2.2) + vec2(0.0, t * 0.04));
    float ridge = warped.y + wave + curtain * 0.08;
    bands = smoothstep(0.42, 0.5, ridge) * (1.0 - smoothstep(0.64, 0.8, ridge));
    bands += smoothstep(0.02, 0.13, ridge) * (1.0 - smoothstep(0.22, 0.35, ridge)) * 0.62;
    colorPosition = wrapT(basePosition * 0.55 + p.x * 0.28 + n * 0.4 + t * 0.025);
    alpha = clamp(bands, 0.0, 1.0);
  } else if (uStyle < 2.5) {
    colorPosition = wrapT(basePosition + 0.22 * sin((warped.x + warped.y * 0.73 + n * 0.8) * 4.8 + t * 0.24));
  } else if (uStyle < 3.5) {
    colorPosition = wrapT(conicPosition * 0.48 + basePosition * 0.3 + n * 0.25 + t * 0.018 + atan(surfaceGradient.y, surfaceGradient.x) * 0.025);
  } else if (uStyle < 4.5) {
    float plasma = sin((warped.x + r.x) * 5.2 + t * 0.3) + cos((warped.y + r.y) * 5.4 - t * 0.24) + sin((warped.x + warped.y + r.x) * 3.8 + t * 0.19);
    colorPosition = wrapT(basePosition * 0.42 + plasma * 0.12 + n * 0.2 + 0.5);
  } else if (uStyle < 5.5) {
    float silk = sin(warped.y * 7.0 + sin(warped.x * 2.1 + t * 0.16) * 1.7 + n * 2.0);
    colorPosition = wrapT(basePosition * 0.62 + silk * 0.13 + 0.3);
  } else if (uStyle < 6.5) {
    float farLayer = field(warped * 1.1 + vec2(t * 0.025, -t * 0.018));
    float nebula = field(warped * 2.4 + vec2(t * 0.06, -t * 0.04));
    float dust = 1.0 - abs(2.0 * field(warped * 4.0 + r * 2.0));
    nebula += farLayer * 0.38 + dust * 0.08;
    colorPosition = wrapT(basePosition * 0.45 + nebula * 1.15 + 0.5);
    alpha *= smoothstep(-0.2, 0.42, nebula + 0.28);
  } else if (uStyle < 7.5) {
    float ribbon = sin(warped.y * 5.0 + sin(warped.x * 2.0 + t * 0.2) * 1.4 + n * 2.0);
    float secondRibbon = sin(warped.y * 3.3 - warped.x * 1.3 - t * 0.17);
    colorPosition = wrapT(basePosition * 0.45 + ribbon * 0.12 + 0.32);
    float edge = 1.0 / max(1.0, uResolution.y);
    bands = smoothstep(0.18 - edge, 0.5 + edge, max(ribbon, secondRibbon));
    alpha *= 0.58 + bands * 0.42;
  } else if (uStyle < 8.5) {
    float metaballField = 10.0;
    for (int i = 0; i < 4; i++) {
      vec2 center = vec2(0.27, 0.32);
      if (i == 1) center = vec2(0.72, 0.35);
      else if (i == 2) center = vec2(0.43, 0.73);
      else if (i == 3) center = vec2(0.82, 0.78);
      if (uMeshCount > 0.5 && float(i) < uMeshCount) center = uMeshPoints[i].xy;
      center += vec2(sin(t * 0.12 + float(i)) * 0.08, cos(t * 0.1 + float(i) * 1.7) * 0.07) * uDistortion;
      vec2 blobDelta = (p - center) * vec2(uAspect, 1.0);
      float distanceToBlob = length(blobDelta) - 0.19;
      float blend = clamp(0.5 + 0.5 * (distanceToBlob - metaballField) / 0.12, 0.0, 1.0);
      metaballField = mix(distanceToBlob, metaballField, blend) - 0.12 * blend * (1.0 - blend);
    }
    float blobs = 1.0 - smoothstep(-0.02, 0.04, metaballField);
    rimLight = exp(-abs(metaballField) * 24.0);
    colorPosition = wrapT(basePosition * 0.32 + blobs * 0.12 + n * 0.15);
  } else if (uStyle < 9.5) {
    float contours = sin((basePosition * 7.0 + n * 2.8) * 6.2831853);
    colorPosition = wrapT(basePosition + 0.12 * n + 0.5);
    float lineWidth = 0.14 + 1.0 / max(1.0, uResolution.y) * 2.0;
    bands = 1.0 - smoothstep(lineWidth, lineWidth + 0.2, abs(contours));
    alpha *= 0.45 + bands * 0.55;
  } else if (uStyle < 10.5) {
    float smokeDrift = field(vec2(warped.x * 2.1 + t * 0.08, warped.y * 1.1 - t * 0.18));
    vec2 smokeUv = warped * (1.3 + uDistortionScale * 0.24);
    smokeUv.x += (smokeDrift - 0.5) * (0.32 + uDistortion * 0.55);
    smokeUv.y -= t * (0.06 + uSpeed * 0.12);
    float smokeCloud = field(smokeUv * 2.1 + vec2(t * 0.035, -t * 0.11));
    float smokeDetail = field(smokeUv * 4.2 + vec2(-t * 0.06, -t * 0.17));
    float smokeShape = exp(-pow(abs(warped.x) / (0.17 + max(warped.y, 0.0) * 0.19), 1.55))
      * smoothstep(-0.5, 0.08, warped.y) * (1.0 - smoothstep(0.7, 1.2, warped.y));
    float smokeDensity = smoothstep(0.2, 0.76, smokeCloud * 0.72 + smokeDetail * (0.18 + uTurbulence * 0.2) + 0.1);
    bands = smokeShape * smokeDensity;
    colorPosition = wrapT(basePosition * 0.22 + smokeCloud * 0.48 + smokeDetail * 0.22 + 0.08);
    alpha *= bands * (0.42 + uIntensity * 0.58);
  } else if (uStyle < 11.5) {
    float fireDrift = field(vec2(warped.x * 2.5 + t * 0.13, warped.y * 1.8 - t * 0.34));
    vec2 fireUv = warped * (2.0 + uDistortionScale * 0.3);
    fireUv.x += (fireDrift - 0.5) * (0.2 + uDistortion * 0.65);
    fireUv.y -= t * (0.12 + uSpeed * 0.22);
    float flameNoise = field(fireUv * 2.8 + vec2(t * 0.08, -t * 0.2));
    float flameDetail = field(fireUv * 5.2 + vec2(-t * 0.11, -t * 0.29));
    float flameWidth = 0.24 + max(warped.y, 0.0) * 0.18;
    float flameEnvelope = exp(-pow(abs(warped.x) / flameWidth, 1.7))
      * smoothstep(-0.58, -0.24, warped.y) * (1.0 - smoothstep(0.62, 1.08, warped.y));
    float flame = smoothstep(0.18, 0.82, flameNoise * 0.72 + flameDetail * (0.18 + uTurbulence * 0.2) + 0.08);
    bands = flameEnvelope * flame;
    colorPosition = clamp(0.02 + (1.0 - warped.y) * 0.68 + flameNoise * 0.18 + flameDetail * 0.12, 0.0, 1.0);
    alpha *= bands * (0.5 + uIntensity * 0.5);
    rimLight = smoothstep(0.54, 0.9, flame) * flameEnvelope * 0.45;
  } else if (uStyle < 12.5) {
    /* marble: sp = vein scale, sharpness, turbulence, contrast */
    float mbScale = max(sp.x, 0.5);
    float mbWarp = field(warped * 1.3 + r * 1.5) * sp.z * 3.0;
    float mbVein = abs(sin((warped.x * mbScale * 0.7 + warped.y * mbScale * 0.45 + mbWarp + n * sp.z) * 3.14159265));
    float mbLine = pow(max(1.0 - mbVein, 0.0), mix(2.0, 14.0, sp.y)) * (0.4 + sp.w);
    colorPosition = wrapT(basePosition * 0.4 + 0.3 + field(warped * 0.9 + vec2(t * 0.01, 0.0)) * 0.35 + mbLine * 0.6);
    rimLight = mbLine * 0.5;
  } else if (uStyle < 13.5) {
    /* waves: sp = wave count, amplitude, choppiness, foam */
    float wvBase = warped.y * max(sp.x, 1.0) * 1.2;
    float wvA = sin(wvBase + sin(warped.x * 2.2 + t * 0.35) * sp.y * 2.4 + n * 1.5 + t * 0.55);
    float wvB = sin(wvBase * 1.7 - warped.x * 1.4 - t * 0.4) * 0.45;
    float wvHeight = (wvA + wvB * sp.z) * 0.5;
    colorPosition = wrapT(basePosition * 0.45 + wvHeight * 0.5 + 0.4);
    rimLight = smoothstep(0.55, 0.95, wvHeight) * sp.w;
  } else if (uStyle < 14.5) {
    /* topography: sp = line density, line width, relief, line emphasis */
    float tpHeight = basePosition * 0.55 + field(warped * 1.1 + r * 0.8 + vec2(t * 0.02, 0.0)) * sp.z * 1.1 + 0.35;
    float tpScaled = tpHeight * max(sp.x, 2.0);
    float tpDist = min(fract(tpScaled), 1.0 - fract(tpScaled));
    float tpLine = 1.0 - smoothstep(sp.y * 0.25, sp.y * 0.25 + 0.04, tpDist);
    colorPosition = wrapT(tpHeight * 0.9 + 0.05);
    alpha *= mix(1.0, 0.25 + 0.75 * tpLine, sp.w);
    rimLight = tpLine * 0.25;
  } else if (uStyle < 15.5) {
    /* crystal cells: sp = cell count, edge glow, jitter, motion */
    vec2 vcP = warped * max(sp.x, 1.0) + r * 0.35;
    vec2 vcCell = floor(vcP);
    vec2 vcF = fract(vcP);
    float vcMin1 = 8.0;
    float vcMin2 = 8.0;
    float vcId = 0.0;
    for (int vj = -1; vj <= 1; vj++) {
      for (int vi = -1; vi <= 1; vi++) {
        vec2 vcOff = vec2(float(vi), float(vj));
        vec2 vcRand = 0.5 + 0.5 * hash22(vcCell + vcOff);
        vec2 vcPt = vcOff + 0.5 + (vcRand - 0.5) * sp.z + 0.35 * sp.w * sin(t * 1.2 + 6.2831853 * vcRand);
        float vcD = length(vcPt - vcF);
        if (vcD < vcMin1) {
          vcMin2 = vcMin1;
          vcMin1 = vcD;
          vcId = dot(vcCell + vcOff, vec2(7.13, 3.77));
        } else if (vcD < vcMin2) {
          vcMin2 = vcD;
        }
      }
    }
    float vcEdge = smoothstep(0.0, 0.12, vcMin2 - vcMin1);
    float vcHash = fract(sin(vcId * 12.9898) * 43758.5453);
    colorPosition = wrapT(basePosition * 0.35 + vcHash * 0.65);
    rimLight = (1.0 - vcEdge) * sp.y * 0.9;
  } else if (uStyle < 16.5) {
    /* blueprint grid: sp = cells, line width, warp, glow */
    vec2 grP = warped * max(sp.x, 2.0) + vec2(field(warped * 1.4 + r), field(warped * 1.4 + vec2(3.1, 7.7) + r)) * sp.z * 2.0;
    vec2 grF = abs(fract(grP) - 0.5);
    float grW = max(sp.y, 0.01) * 0.5;
    float grLine = smoothstep(0.5 - grW - 0.03, 0.5 - grW, max(grF.x, grF.y));
    float grHash = fract(sin(dot(floor(grP), vec2(12.9898, 78.233))) * 43758.5453);
    colorPosition = wrapT(basePosition * 0.6 + grHash * 0.25 + n * 0.2 + 0.2);
    alpha *= 0.35 + 0.65 * grLine;
    rimLight = grLine * sp.w * 0.6;
  } else if (uStyle < 17.5) {
    /* interference: sp = sources, frequency, speed, contrast */
    float ifSum = 0.0;
    float ifCount = clamp(floor(sp.x + 0.5), 2.0, 5.0);
    for (int ii = 0; ii < 5; ii++) {
      if (float(ii) >= ifCount) break;
      float ifI = float(ii);
      vec2 ifC = vec2(sin(t * 0.21 * sp.z + ifI * 2.1) * 0.55, cos(t * 0.17 * sp.z + ifI * 1.7) * 0.4);
      ifSum += sin(length(warped - ifC) * sp.y - t * sp.z * 1.5 + ifI);
    }
    ifSum /= ifCount;
    colorPosition = wrapT(basePosition * 0.3 + ifSum * (0.25 + sp.w * 0.5) + 0.5);
    rimLight = pow(abs(ifSum), 6.0) * 0.25 * sp.w;
  } else if (uStyle < 18.5) {
    /* lava lamp: sp = blob count, size, rise speed, gooeyness */
    float lvField = 0.0;
    float lvCount = clamp(floor(sp.x + 0.5), 2.0, 8.0);
    for (int li = 0; li < 8; li++) {
      if (float(li) >= lvCount) break;
      float lvI = float(li);
      float lvX = sin(lvI * 2.399 + t * 0.12) * 0.42 * uAspect;
      float lvY = (fract(lvI * 0.381966 + t * sp.z * 0.06) - 0.5) * 1.8;
      float lvSize = sp.y * (0.7 + 0.5 * fract(lvI * 0.618));
      vec2 lvD = warped - vec2(lvX, lvY);
      lvField += lvSize * lvSize / (dot(lvD, lvD) + 0.002);
    }
    float lvSoft = 0.05 + sp.w * 0.6;
    float lvBlob = smoothstep(1.0 - lvSoft, 1.0 + lvSoft, lvField);
    colorPosition = wrapT(basePosition * 0.4 + lvBlob * 0.3 + min(lvField, 3.0) * 0.08 + 0.1);
    rimLight = exp(-abs(lvField - 1.0) * 5.0) * 0.6;
  } else if (uStyle < 19.5) {
    /* light rays: sp = ray count, sharpness, ray strength, origin height */
    vec2 ryD = warped - vec2(0.0, sp.w);
    float ryAng = atan(ryD.x, ryD.y);
    float ryCnt = max(floor(sp.x + 0.5), 1.0);
    float ryWave = sin(ryAng * ryCnt + t * 0.25 + n * 1.5) * 0.5 + 0.5;
    float ryRay = pow(ryWave, mix(1.0, 10.0, sp.y));
    float ryDist = length(ryD);
    float ryFade = exp(-ryDist * 1.4);
    colorPosition = wrapT(basePosition * 0.45 + ryRay * 0.25 + ryDist * 0.3);
    alpha *= clamp(mix(1.0, 0.15 + 0.85 * ryRay * (0.35 + ryFade), sp.z), 0.0, 1.0);
    rimLight = ryRay * ryFade * 0.35;
  } else if (uStyle < 20.5) {
    /* facets: sp = facet count, shade, colour shift, motion */
    vec2 fcP = warped * max(sp.x, 2.0) + r * 0.25 * sp.w;
    vec2 fcG = vec2(fcP.x + fcP.y * 0.5, fcP.y);
    vec2 fcCell = floor(fcG);
    vec2 fcF = fract(fcG);
    float fcTri = step(fcF.y, fcF.x);
    float fcId = fract(sin(dot(fcCell + vec2(fcTri * 17.0), vec2(12.9898, 78.233))) * 43758.5453);
    colorPosition = wrapT(basePosition * 0.45 + 0.1 + fcId * sp.z * 0.55 + (fcTri - 0.5) * sp.y * 0.12 + sin(t * 0.3 + fcId * 6.2831853) * 0.04 * sp.w);
    float fcEdge = 1.0 - smoothstep(0.0, 0.03, min(min(fcF.x, fcF.y), abs(fcF.x - fcF.y)));
    rimLight = fcEdge * sp.y * 0.5;
  } else if (uStyle < 21.5) {
    /* ink bleed: sp = bloom, edge darkening, paper grain, flow */
    vec2 ikQ = vec2(field(warped * 1.1 + vec2(t * 0.05 * sp.w, 0.0)), field(warped * 1.1 + vec2(4.2, 1.9) - vec2(0.0, t * 0.04 * sp.w)));
    float ikInk = field(warped * 1.8 + ikQ * 2.2 * (0.3 + sp.x) + r * 1.5);
    float ikPool = smoothstep(-0.18, 0.28, ikInk);
    float ikEdge = smoothstep(-0.02, 0.06, ikInk) * (1.0 - smoothstep(0.08, 0.2, ikInk));
    float ikPaper = field(warped * 90.0);
    colorPosition = wrapT(basePosition * 0.3 + 0.1 + ikPool * 0.55 - ikEdge * sp.y * 0.18 + ikPaper * sp.z * 0.08);
  } else if (uStyle < 22.5) {
    /* fluted glass: sp = ribs, refraction, frost, angle */
    float flA = sp.w * 0.0174533;
    vec2 flDir = vec2(cos(flA), sin(flA));
    float flRib = fract(dot(warped, flDir) * max(sp.x, 2.0)) - 0.5;
    float flLens = flRib * sp.y;
    colorPosition = wrapT((basePosition + flLens * 0.9) * 0.8 + 0.1 + n * 0.12 + field(warped * 3.0 + flDir * flLens) * sp.z * 0.2);
    rimLight = smoothstep(0.42, 0.5, abs(flRib)) * 0.3;
  } else if (uStyle < 23.5) {
    /* mist: sp = layers, softness, drift, density */
    float msFog = 0.0;
    float msCount = clamp(floor(sp.x + 0.5), 1.0, 6.0);
    for (int mi = 0; mi < 6; mi++) {
      if (float(mi) >= msCount) break;
      float msI = float(mi);
      float msDir = 1.0 - 2.0 * mod(msI, 2.0);
      msFog += field(vec2(warped.x * 0.8 + t * sp.z * 0.1 * (1.0 + msI * 0.4) * msDir, warped.y * (1.6 + msI * 0.7) + msI * 3.3));
    }
    float msV = msFog / msCount * 2.0 + 0.5;
    float msAlpha = smoothstep(0.1 + (1.0 - sp.w) * 0.35, 0.6 + sp.y * 0.5, msV);
    colorPosition = wrapT(basePosition * 0.4 + msV * 0.35 + 0.2);
    alpha *= msAlpha;
  } else if (uStyle < 24.5) {
    /* retro sunset: sp = horizon, slit density, sun size, glow */
    float ssR = max(sp.z, 0.05);
    vec2 ssC = vec2(0.0, sp.x);
    float ssD = length(warped - ssC);
    float ssSun = 1.0 - smoothstep(ssR - 0.012, ssR + 0.012, ssD);
    float ssLow = clamp((ssC.y - warped.y) / ssR, 0.0, 1.0);
    float ssSlit = 1.0 - step(0.5, fract(warped.y * sp.y * 4.0)) * smoothstep(0.0, 0.8, ssLow);
    float ssDisc = 0.78 + 0.2 * clamp(1.0 - ssD / ssR, 0.0, 1.0);
    colorPosition = mix(basePosition * 0.6, ssDisc, ssSun * ssSlit);
    colorPosition = wrapT(colorPosition * (0.55 + 0.45 * smoothstep(ssC.y - 0.03, ssC.y + 0.03, warped.y)));
    rimLight = exp(-max(ssD - ssR, 0.0) * 7.0) * sp.w * 0.7;
  } else if (uStyle < 25.5) {
    /* pixel mosaic: sp = tiles, gap, shuffle speed, contrast */
    float pxN = max(sp.x, 4.0);
    vec2 pxCell = floor(warped * pxN);
    vec2 pxF = fract(warped * pxN);
    float pxV = field(pxCell * 0.17 + vec2(t * sp.z * 0.2, -t * sp.z * 0.13));
    float pxHash = fract(sin(dot(pxCell, vec2(12.9898, 78.233))) * 43758.5453);
    colorPosition = wrapT(basePosition * 0.35 + pxV * 0.9 * (0.4 + sp.w) + pxHash * 0.12 * sp.w + 0.4);
    float pxEdge = smoothstep(0.5 - sp.y - 0.02, 0.5 - sp.y + 0.01, max(abs(pxF.x - 0.5), abs(pxF.y - 0.5)));
    alpha *= 1.0 - pxEdge * step(0.001, sp.y);
  } else if (uStyle < 26.5) {
    /* galaxy spiral: sp = arms, twist, core size, spin */
    float gxR = length(warped) + 0.0001;
    float gxA = atan(warped.y, warped.x);
    float gxArms = max(floor(sp.x + 0.5), 1.0);
    float gxSpiral = sin(gxA * gxArms + gxR * sp.y * 2.0 - t * sp.w * 1.2 + n * 1.4) * 0.5 + 0.5;
    float gxCore = exp(-gxR / max(sp.z * 0.4, 0.02));
    colorPosition = wrapT(basePosition * 0.3 + gxSpiral * 0.3 + (1.0 - gxR) * 0.25 + 0.25);
    alpha *= clamp(0.45 + 0.55 * gxSpiral * exp(-gxR * 0.9) + gxCore, 0.0, 1.0);
    rimLight = gxCore * 0.9;
  } else if (uStyle < 27.5) {
    /* vortex flow: sp = turns, turbulence, speed, centre offset */
    vec2 vxD = warped - vec2(sp.w * 0.2, 0.0);
    float vxR = length(vxD);
    float vxN = field(vxD * 3.0 + vec2(t * sp.z * 0.15, -t * sp.z * 0.1));
    float vxA = atan(vxD.y, vxD.x) + vxR * sp.x + (vxN - 0.5) * sp.y * 2.0;
    colorPosition = wrapT(basePosition * 0.35 + vxA * 0.09 + vxN * 0.3 + 0.45);
    rimLight = exp(-abs(sin(vxA * 2.0)) * 8.0) * 0.28;
  } else if (uStyle < 28.5) {
    /* embers: sp = density, drift, glow, flicker */
    vec2 emP = warped * sp.x + vec2(0.0, t * sp.y * 0.6);
    vec2 emCell = floor(emP);
    vec2 emF = fract(emP) - 0.5;
    float emHash = fract(sin(dot(emCell, vec2(12.9898, 78.233))) * 43758.5453);
    float emPulse = 0.5 + 0.5 * sin(t * (2.0 + emHash * 5.0) + emHash * 36.0);
    float emDot = exp(-dot(emF, emF) * (18.0 + sp.z * 22.0)) * step(0.62 - sp.w * 0.25, emHash) * emPulse;
    float emSmoke = field(warped * 2.0 + vec2(0.0, -t * 0.08));
    colorPosition = wrapT(basePosition * 0.25 + emSmoke * 0.45 + emHash * 0.15 + 0.15);
    rimLight = emDot * sp.z;
    alpha *= clamp(0.65 + emDot * 0.8, 0.0, 1.0);
  } else if (uStyle < 29.5) {
    /* woven textile: sp = thread count, width, relief, motion */
    vec2 weP = warped * sp.x + vec2(t * sp.w * 0.12, -t * sp.w * 0.08);
    vec2 weF = fract(weP);
    float weX = 1.0 - smoothstep(sp.y, sp.y + 0.12, abs(weF.x - 0.5) * 2.0);
    float weY = 1.0 - smoothstep(sp.y, sp.y + 0.12, abs(weF.y - 0.5) * 2.0);
    float weThread = max(weX, weY);
    float weShade = mix(0.65, 1.2, mix(weX, weY, step(0.5, fract(weP.x + weP.y))));
    colorPosition = wrapT(basePosition * 0.65 + (weX - weY) * sp.z * 0.16 + 0.18 + (weShade - 1.0) * 0.08);
    rimLight = weThread * sp.z * 0.18;
  } else if (uStyle < 30.5) {
    /* liquid chrome: sp = band scale, reflection, warp, motion */
    float chN = field(warped * (2.0 + sp.z * 4.0) + r * 1.2 + vec2(t * sp.w * 0.08, 0.0));
    float chBand = 0.5 + 0.5 * cos((warped.y * sp.x + chN * sp.z * 3.0 + t * sp.w) * 3.14159265);
    colorPosition = wrapT(basePosition * 0.28 + chBand * 0.58 + chN * 0.14);
    rimLight = pow(chBand, 8.0) * sp.y;
  } else if (uStyle < 31.5) {
    /* organic cells: sp = cell scale, edge glow, drift, irregularity */
    vec2 ocP = warped * sp.x + r * sp.w * 0.35;
    float ocN = field(ocP + vec2(t * sp.z * 0.08, -t * sp.z * 0.06));
    float ocCell = abs(sin(ocP.x * 2.1 + ocP.y * 1.7 + ocN * 5.0));
    float ocEdge = exp(-abs(ocCell - 0.28) * 24.0);
    colorPosition = wrapT(basePosition * 0.3 + ocN * 0.55 + ocCell * 0.2);
    rimLight = ocEdge * sp.y * 0.55;
  } else if (uStyle < 32.5) {
    /* botanical bloom: sp = petal count, fold, motion, core */
    float btR = length(warped);
    float btA = atan(warped.y, warped.x) + t * sp.z * 0.15;
    float btPetal = 0.5 + 0.5 * cos(btA * max(sp.x, 3.0) + btR * (3.0 + sp.y * 5.0));
    float btForm = 1.0 - smoothstep(0.15, 0.9, btR - btPetal * (0.18 + sp.y * 0.22));
    float btCore = exp(-btR * btR * (5.0 + sp.w * 14.0));
    colorPosition = wrapT(basePosition * 0.35 + btPetal * 0.4 + btCore * 0.2 + 0.1);
    alpha *= clamp(0.35 + btForm * 0.65, 0.0, 1.0);
    rimLight = btCore * sp.w;
  } else if (uStyle < 33.5) {
    /* synthwave grid: sp = grid density, horizon, glow, travel */
    float syD = max(0.04, warped.y - sp.y);
    vec2 syP = vec2(warped.x / syD, 1.0 / syD + t * sp.w);
    vec2 syF = abs(fract(syP * sp.x) - 0.5);
    float syGrid = 1.0 - smoothstep(0.44, 0.5, max(syF.x, syF.y));
    colorPosition = wrapT(basePosition * 0.45 + 0.25 + fract(syP.y * 0.04) * 0.25);
    rimLight = syGrid * sp.z * 0.75;
  } else {
    /* CRT phosphor: sp = scanline count, curvature, glow, flicker */
    vec2 crP = warped * (1.0 + dot(warped, warped) * sp.y * 0.35);
    float crLine = 0.72 + 0.28 * sin(crP.y * sp.x * 3.14159265);
    float crFlicker = 1.0 - sp.w * (0.03 + 0.03 * sin(t * 47.0));
    float crNoise = field(crP * vec2(90.0, 4.0) + vec2(0.0, t * 0.4));
    colorPosition = wrapT(basePosition + (crNoise - 0.5) * 0.04);
    alpha *= crLine * crFlicker;
    rimLight = sp.z * (1.0 - crLine) * 0.35;
  }

  float colorDistortion = interactionWarp * (interactionWave * 0.12 + cos(pointerDistance * 13.0 + uClock) * 0.06);
  colorPosition = wrapT(colorPosition + colorDistortion + displacement * displacementDirection * 0.8 + rgPal);
  cssPosition = clamp(cssPosition + colorDistortion, 0.0, 1.0);
  vec4 color = samplePalette(colorPosition);
  color.rgb += samplePalette(wrapT(colorPosition + 0.06)).rgb * rimLight * 0.22;
  if (uMeshCount > 0.5) {
    vec4 meshColor = sampleMesh(warped / vec2(uAspect, 1.0) + 0.5);
    color.rgb = mix(color.rgb, meshColor.rgb, clamp(uMeshBlend, 0.0, 1.0));
    color.a = meshColor.a;
  }
  if (uLayerMixEnabled > 0.5) {
    float mixMotion = sin(uClock * uLayerMixSpeed + colorPosition * 6.2831853 + n * 2.0) * 0.055;
    vec4 otherLayer = texture2D(uLayerMixLut, vec2(wrapT(colorPosition + mixMotion), 0.5));
    float mixAmount = clamp(uLayerMixStrength * (0.72 + 0.18 * sin(uClock * uLayerMixSpeed + n * 3.0) + influence * 0.45), 0.0, 1.0) * otherLayer.a;
    color.rgb = mix(color.rgb, blendLayerColors(color.rgb, otherLayer.rgb, uLayerMixMode), mixAmount);
  }
  if (rgChroma != 0.0) {
    float chroma = clamp(abs(rgChroma), 0.0, 1.0) * sign(rgChroma);
    vec3 refracted = vec3(
      samplePalette(wrapT(colorPosition + chroma * 0.09)).r,
      samplePalette(colorPosition).g,
      samplePalette(wrapT(colorPosition - chroma * 0.09)).b
    );
    color.rgb = mix(color.rgb, refracted, abs(chroma));
  }
  float pointerGlow = exp(-pointerDistance * pointerDistance / max(0.0001, uInteractionRadius * uInteractionRadius * 0.32));
  float glow = pointerGlow * uPointerActive * uGlow * uInteractionStrength * (1.0 + velocityResponse);
  float interactionColorPosition = fract(pointerDistance / max(0.001, uInteractionRadius) + uClock * uInteractionColorSpeed);
  vec3 paletteHighlight = sampleInteractionPalette(interactionColorPosition);
  vec3 highlight = mix(uInteractionColor, paletteHighlight, uInteractionColorMix);
  if (uSheen > 0.0) {
    vec3 pseudoNormal = normalize(vec3(-surfaceGradient * 18.0, 1.0));
    float specular = pow(max(0.0, dot(pseudoNormal, normalize(vec3(-0.35, 0.55, 1.0)))), 12.0);
    if (uStyle > 4.5 && uStyle < 5.5) specular = pow(max(0.0, 1.0 - abs(surfaceGradient.y * 18.0)), 4.0);
    specular *= uSheen;
    color.rgb += highlight * specular * 0.45;
  }
  alpha *= max(color.a, 0.0);
  alpha *= clamp(uIntensity, 0.0, 1.0);
  if (uProjectOutput < 0.5) alpha *= clamp(0.62 + glow * 0.6 + rippleGlow * 0.5, 0.0, 1.0);
  vec4 cssColor = samplePalette(cssPosition);
  float shaderMix = uGradientKind < 2.5 ? clamp(uShaderMix, 0.0, 1.0) : 1.0;
  color.rgb = mix(cssColor.rgb, color.rgb, shaderMix);
  alpha = mix(uProjectOutput > 0.5 ? cssColor.a : 0.0, alpha, shaderMix);
  if (glitchAmount > 0.001) {
    vec3 glitchRed = samplePalette(wrapT(colorPosition + glitchAmount * 0.09)).rgb;
    vec3 glitchBlue = samplePalette(wrapT(colorPosition - glitchAmount * 0.09)).rgb;
    vec3 splitColor = vec3(glitchRed.r, color.g, glitchBlue.b);
    color.rgb = mix(color.rgb, splitColor, clamp(glitchAmount * (0.4 + glitchGate * 0.6), 0.0, 0.8));
  }
  /* interaction rig colour / light stage: after the CSS-ramp mix so reactions stay visible when shader mix is zero */
  color.rgb = rigPost(color.rgb, vUv, colorPosition);
  color.rgb += vec3(1.0) * rgSpec * 0.75;
  color.rgb = mix(color.rgb, highlight, clamp(rippleGlow, 0.0, 0.85));
  float interactionAlpha = clamp(rgAlpha + rgSpec * 0.6 + rippleGlow * 0.5, 0.0, 0.85);
  alpha = 1.0 - (1.0 - alpha) * (1.0 - interactionAlpha);
  color.rgb = finish(color.rgb, vUv, gl_FragCoord.xy);
  gl_FragColor = vec4(color.rgb, alpha);
}
