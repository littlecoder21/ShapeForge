precision highp float;

varying vec2 vUv;

uniform vec2 uResolution;
uniform vec2 uPointer;
uniform vec2 uVelocity;
uniform float uPointerActive;
uniform float uPointerDown;
uniform float uTime;
uniform float uClock;
uniform float uAspect;
uniform float uStyle;
uniform float uGradientKind;
uniform float uGradientAngle;
uniform vec2 uGradientOrigin;
uniform vec2 uGradientRadius;
uniform float uPointerMode;
uniform vec3 uInteractionColor;
uniform float uStopCount;
uniform float uSpeed;
uniform float uIntensity;
uniform float uDistortion;
uniform float uDistortionScale;
uniform float uTurbulence;
uniform float uInteractionRadius;
uniform float uInteractionStrength;
uniform float uGlow;
uniform float uRippleStrength;
uniform float uRippleSpeed;
uniform float uRippleCount;
uniform float uMeshCount;
uniform float uOctaves;
uniform float uWarpDepth;
uniform float uWrapMode;
uniform float uToneMap;
uniform float uVignette;
uniform float uSheen;
uniform float uGrain;
uniform float uLutEnabled;
uniform float uProjectOutput;
uniform sampler2D uPaletteLut;
uniform vec4 uPalette[8];
uniform float uPaletteAlpha[8];
uniform vec4 uRipples[8];
uniform vec4 uMeshPoints[8];
uniform vec4 uMeshColors[8];
uniform vec4 uMeshBase;

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
  for (int octave = 0; octave < 6; octave++) {
    if (float(octave) >= uOctaves) break;
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
  if (uWarpDepth < 1.5) return q;
  return vec2(
    field(p * 1.5 + 3.0 * q + vec2(1.7, 9.2) + t * 0.13),
    field(p * 1.5 + 3.0 * q + vec2(8.3, 2.8) - t * 0.11)
  );
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

vec4 sampleMesh(vec2 p) {
  vec3 weightedColor = uMeshBase.rgb * uMeshBase.a;
  float totalWeight = uMeshBase.a;
  float uncovered = 1.0 - uMeshBase.a;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uMeshCount) break;
    vec4 point = uMeshPoints[i];
    vec2 drift = vec2(sin(uTime * 0.45 + float(i)) * 0.025, cos(uTime * 0.38 + float(i) * 1.7) * 0.02) * uDistortion;
    vec2 delta = (p - point.xy - drift) * vec2(uAspect, 1.0);
    float radius = max(0.01, point.z * uAspect * (1.0 + 0.08 * sin(uTime + float(i)) * uDistortion));
    float weight = exp(-4.5 * dot(delta, delta) / (radius * radius)) * point.w;
    weightedColor += uMeshColors[i].rgb * weight;
    totalWeight += weight;
    uncovered *= 1.0 - clamp(weight, 0.0, 1.0);
  }
  if (totalWeight < 0.0001) return vec4(0.0);
  return vec4(weightedColor / totalWeight, clamp(1.0 - uncovered, uMeshBase.a, 1.0));
}

void main() {
  vec2 p = vUv;
  float t = uTime;
  vec2 pointerDelta = (p - uPointer) * vec2(uAspect, 1.0);
  float pointerDistance = length(pointerDelta);
  float pointerFalloff = 1.0 - smoothstep(0.0, max(0.001, uInteractionRadius), pointerDistance);
  float influence = pointerFalloff * uPointerActive * uInteractionStrength;
  vec2 direction = normalize(pointerDelta + vec2(0.0001));
  vec2 directionUv = direction / vec2(uAspect, 1.0);
  vec2 perpendicularUv = vec2(-direction.y, direction.x) / vec2(uAspect, 1.0);
  if (uPointerMode < 0.5) p -= directionUv * influence * 0.08;
  else if (uPointerMode < 1.5) p += directionUv * influence * 0.08;
  else if (uPointerMode < 2.5) p += perpendicularUv * influence * 0.1;
  else if (uPointerMode < 3.5) { }
  else if (uPointerMode < 4.5) p += (uPointer - p) * influence * 0.055;
  else if (uPointerMode < 5.5) p += directionUv * sin(pointerDistance * 38.0 - uClock * 8.0) * influence * 0.018;
  else if (uPointerMode < 6.5) p += perpendicularUv * influence * 0.1 - directionUv * influence * 0.035;
  else if (uPointerMode < 7.5) p -= directionUv * influence * 0.14;
  else if (uPointerMode < 8.5) p += directionUv * sin(pointerDistance * 50.0 - uClock * 10.0) * influence * 0.025;
  else if (uPointerMode < 9.5) p += directionUv * sin(uClock * 6.0) * influence * 0.01;
  else if (uPointerMode < 10.5) p += uVelocity * influence * 0.045;
  p += uVelocity * influence * 0.012;

  float stir = clamp(length(uVelocity), 0.0, 1.0);
  vec2 cursorDelta = (p - uPointer) * vec2(uAspect, 1.0);
  p += vec2(-cursorDelta.y, cursorDelta.x) / vec2(uAspect, 1.0)
    * exp(-dot(cursorDelta, cursorDelta) * 9.0)
    * (0.12 + 0.6 * stir) * uInteractionStrength;

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

  vec2 centered = (p - 0.5) * vec2(uAspect, 1.0);
  vec2 r = warpFlow(centered, t);
  float n = field(centered * uDistortionScale + (2.0 * uTurbulence) * r + vec2(t * 0.13, -t * 0.09));
  vec2 warped = (p - 0.5) * vec2(uAspect, 1.0);
  float turbulence = field(warped * uDistortionScale * 2.1 + (2.0 * uTurbulence) * r + vec2(t * 0.17, t * 0.11));
  warped += vec2(turbulence, n) * uDistortion * (0.25 + uTurbulence);
  vec2 surfaceGradient = vec2(0.0);
  if (uSheen > 0.0 || uStyle > 2.5 && uStyle < 3.5) {
    float surface = field(warped);
    surfaceGradient = vec2(field(warped + vec2(0.012, 0.0)), field(warped + vec2(0.0, 0.012))) - vec2(surface);
  }
  float colorPosition;
  float alpha = 1.0;
  float bands = 1.0;
  float rimLight = 0.0;
  vec2 gradientDelta = (p - uGradientOrigin) * vec2(uAspect, 1.0);
  vec2 gradientDirection = vec2(sin(uGradientAngle), cos(uGradientAngle));
  float lineSpan = max(0.001, abs(gradientDirection.x) * uAspect + abs(gradientDirection.y));
  float basePosition = clamp(0.5 + dot(gradientDelta, gradientDirection) / lineSpan, 0.0, 1.0);
  float radialPosition = clamp(length((p - uGradientOrigin) / max(uGradientRadius, vec2(0.001))), 0.0, 1.0);
  float conicPhase = (atan(gradientDelta.y, gradientDelta.x) + 3.14159265) / 6.2831853 + uGradientAngle / 6.2831853;
  float conicPosition = 0.5 - 0.5 * cos(conicPhase * 6.2831853);
  if (uGradientKind > 0.5 && uGradientKind < 1.5) basePosition = radialPosition;
  else if (uGradientKind > 1.5 && uGradientKind < 2.5) basePosition = conicPosition;
  else if (uGradientKind > 3.5 && uGradientKind < 4.5) basePosition = radialPosition;
  // Curve geometry intentionally retains the linear gradient position.
  else if (uGradientKind > 4.5) basePosition = clamp(0.5 + field(warped * 1.4), 0.0, 1.0);

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
  } else {
    float contours = sin((basePosition * 7.0 + n * 2.8) * 6.2831853);
    colorPosition = wrapT(basePosition + 0.12 * n + 0.5);
    float lineWidth = 0.14 + 1.0 / max(1.0, uResolution.y) * 2.0;
    bands = 1.0 - smoothstep(lineWidth, lineWidth + 0.2, abs(contours));
    alpha *= 0.45 + bands * 0.55;
  }

  vec4 color = samplePalette(colorPosition);
  color.rgb += samplePalette(wrapT(colorPosition + 0.06)).rgb * rimLight * 0.22;
  if (uMeshCount > 0.5) {
    color = sampleMesh(warped / vec2(uAspect, 1.0) + 0.5);
  }
  float customLight = 0.0;
  if (uPointerMode > 2.5 && uPointerMode < 3.5) customLight = influence * uGlow;
  else if (uPointerMode > 10.5 && uPointerMode < 11.5) customLight = pointerFalloff * uPointerActive * uInteractionStrength;
  else if (uPointerMode > 11.5) {
    if (uMeshCount > 0.5) color.rgb = mix(color.rgb, uInteractionColor, influence * 0.35);
    else {
      colorPosition = wrapT(colorPosition + influence * 0.22);
      color = samplePalette(colorPosition);
    }
    customLight = influence * 0.22;
  }
  color.rgb = mix(color.rgb, uInteractionColor, clamp(customLight, 0.0, 1.0));
  float pointerGlow = exp(-pointerDistance * pointerDistance / max(0.0001, uInteractionRadius * uInteractionRadius * 0.12));
  float glow = pointerGlow * uPointerActive * uGlow * (0.2 + uPointerDown * 0.45);
  vec3 highlight = uMeshCount > 0.5 ? uInteractionColor : samplePalette(wrapT(colorPosition + 0.23)).rgb;
  color.rgb = mix(color.rgb, highlight, clamp(glow, 0.0, 0.8));
  color.rgb = mix(color.rgb, highlight, clamp(rippleGlow, 0.0, 0.85));
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
  color.rgb = finish(color.rgb, vUv, gl_FragCoord.xy);
  gl_FragColor = vec4(color.rgb, alpha);
}
