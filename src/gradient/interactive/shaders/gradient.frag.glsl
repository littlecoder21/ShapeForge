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
uniform vec4 uPalette[8];
uniform float uPaletteAlpha[8];
uniform vec4 uRipples[8];
uniform vec4 uMeshPoints[8];
uniform vec4 uMeshColors[8];
uniform vec4 uMeshBase;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float field(vec2 p) {
  float value = 0.0;
  float amplitude = 0.57;
  for (int octave = 0; octave < 3; octave++) {
    value += (noise2(p) - 0.5) * amplitude;
    p = p * 2.03 + vec2(13.1, 7.7);
    amplitude *= 0.48;
  }
  return value;
}

float rippleLight(vec4 ripple, vec2 p) {
  float age = max(0.0, uClock - ripple.z);
  vec2 delta = (p - ripple.xy) * vec2(uAspect, 1.0);
  float radius = age * uRippleSpeed;
  return exp(-abs(length(delta) - radius) * 38.0) * exp(-age * 1.25) * ripple.w;
}

vec4 samplePalette(float t) {
  t = clamp(t, 0.0, 1.0);
  if (uStopCount < 1.5) return vec4(uPalette[0].rgb, uPaletteAlpha[0]);
  if (t <= uPalette[1].a) {
    float f = clamp((t - uPalette[0].a) / max(0.0001, uPalette[1].a - uPalette[0].a), 0.0, 1.0);
    return vec4(mix(uPalette[0].rgb, uPalette[1].rgb, f), mix(uPaletteAlpha[0], uPaletteAlpha[1], f));
  }
  if (uStopCount > 2.5 && t <= uPalette[2].a) {
    float f = clamp((t - uPalette[1].a) / max(0.0001, uPalette[2].a - uPalette[1].a), 0.0, 1.0);
    return vec4(mix(uPalette[1].rgb, uPalette[2].rgb, f), mix(uPaletteAlpha[1], uPaletteAlpha[2], f));
  }
  if (uStopCount > 3.5 && t <= uPalette[3].a) {
    float f = clamp((t - uPalette[2].a) / max(0.0001, uPalette[3].a - uPalette[2].a), 0.0, 1.0);
    return vec4(mix(uPalette[2].rgb, uPalette[3].rgb, f), mix(uPaletteAlpha[2], uPaletteAlpha[3], f));
  }
  if (uStopCount > 4.5 && t <= uPalette[4].a) {
    float f = clamp((t - uPalette[3].a) / max(0.0001, uPalette[4].a - uPalette[3].a), 0.0, 1.0);
    return vec4(mix(uPalette[3].rgb, uPalette[4].rgb, f), mix(uPaletteAlpha[3], uPaletteAlpha[4], f));
  }
  if (uStopCount > 5.5 && t <= uPalette[5].a) {
    float f = clamp((t - uPalette[4].a) / max(0.0001, uPalette[5].a - uPalette[4].a), 0.0, 1.0);
    return vec4(mix(uPalette[4].rgb, uPalette[5].rgb, f), mix(uPaletteAlpha[4], uPaletteAlpha[5], f));
  }
  if (uStopCount > 6.5 && t <= uPalette[6].a) {
    float f = clamp((t - uPalette[5].a) / max(0.0001, uPalette[6].a - uPalette[5].a), 0.0, 1.0);
    return vec4(mix(uPalette[5].rgb, uPalette[6].rgb, f), mix(uPaletteAlpha[5], uPaletteAlpha[6], f));
  }
  if (uStopCount > 7.5 && t <= uPalette[7].a) {
    float f = clamp((t - uPalette[6].a) / max(0.0001, uPalette[7].a - uPalette[6].a), 0.0, 1.0);
    return vec4(mix(uPalette[6].rgb, uPalette[7].rgb, f), mix(uPaletteAlpha[6], uPaletteAlpha[7], f));
  }
  if (uStopCount > 7.5) return vec4(uPalette[7].rgb, uPaletteAlpha[7]);
  if (uStopCount > 6.5) return vec4(uPalette[6].rgb, uPaletteAlpha[6]);
  if (uStopCount > 5.5) return vec4(uPalette[5].rgb, uPaletteAlpha[5]);
  if (uStopCount > 4.5) return vec4(uPalette[4].rgb, uPaletteAlpha[4]);
  if (uStopCount > 3.5) return vec4(uPalette[3].rgb, uPaletteAlpha[3]);
  if (uStopCount > 2.5) return vec4(uPalette[2].rgb, uPaletteAlpha[2]);
  return vec4(uPalette[1].rgb, uPaletteAlpha[1]);
}

vec4 sampleMesh(vec2 p) {
  vec3 weightedColor = uMeshBase.rgb * uMeshBase.a;
  float totalWeight = uMeshBase.a;
  float coverage = uMeshBase.a;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uMeshCount) break;
    vec4 point = uMeshPoints[i];
    vec2 delta = (p - point.xy) * vec2(uAspect, 1.0);
    float radius = max(0.01, point.z * uAspect);
    float weight = pow(max(0.0, 1.0 - length(delta) / radius), 2.0) * point.w;
    weightedColor += uMeshColors[i].rgb * weight;
    totalWeight += weight;
    coverage = max(coverage, weight);
  }
  if (totalWeight < 0.0001) return vec4(0.0);
  return vec4(weightedColor / totalWeight, clamp(coverage, 0.0, 1.0));
}

void main() {
  vec2 p = vUv;
  vec2 centered = (p - 0.5) * vec2(uAspect, 1.0);
  float t = uTime;
  float n = field(centered * uDistortionScale + vec2(t * 0.13, -t * 0.09));

  vec2 pointerDelta = centered - (uPointer - 0.5) * vec2(uAspect, 1.0);
  float pointerDistance = length(pointerDelta);
  float pointerFalloff = 1.0 - smoothstep(0.0, max(0.001, uInteractionRadius), pointerDistance);
  float influence = pointerFalloff * uPointerActive * uInteractionStrength;
  vec2 direction = normalize(pointerDelta + vec2(0.0001));
  if (uPointerMode < 0.5) p -= direction * influence * 0.08;
  else if (uPointerMode < 1.5) p += direction * influence * 0.08;
  else if (uPointerMode < 2.5) p += vec2(-direction.y, direction.x) * influence * 0.1;
  else if (uPointerMode < 3.5) { }
  else if (uPointerMode < 4.5) p += (uPointer - p) * influence * 0.055;
  else if (uPointerMode < 5.5) p += direction * sin(pointerDistance * 38.0 - uClock * 8.0) * influence * 0.018;
  else if (uPointerMode < 6.5) p += vec2(-direction.y, direction.x) * influence * 0.1 - direction * influence * 0.035;
  else if (uPointerMode < 7.5) p -= direction * influence * 0.14;
  else if (uPointerMode < 8.5) p += direction * sin(pointerDistance * 50.0 - uClock * 10.0) * influence * 0.025;
  else if (uPointerMode < 9.5) p += direction * sin(uClock * 6.0) * influence * 0.01;
  else if (uPointerMode < 10.5) p += uVelocity * influence * 0.045;
  p += uVelocity * influence * 0.012;

  vec2 warped = (p - 0.5) * vec2(uAspect, 1.0);
  float turbulence = field(warped * uDistortionScale * 2.1 + vec2(t * 0.17, t * 0.11));
  warped += vec2(turbulence, n) * uDistortion * (0.25 + uTurbulence);
  float colorPosition;
  float alpha = 1.0;
  float bands = 1.0;
  vec2 gradientDelta = (p - uGradientOrigin) * vec2(uAspect, 1.0);
  vec2 gradientDirection = vec2(sin(uGradientAngle), cos(uGradientAngle));
  float lineSpan = max(0.001, abs(gradientDirection.x) * uAspect + abs(gradientDirection.y));
  float basePosition = clamp(0.5 + dot(gradientDelta, gradientDirection) / lineSpan, 0.0, 1.0);
  float radialPosition = clamp(length((p - uGradientOrigin) / max(uGradientRadius, vec2(0.001))), 0.0, 1.0);
  float conicPosition = fract((atan(gradientDelta.y, gradientDelta.x) + 3.14159265) / 6.2831853 + uGradientAngle / 6.2831853);
  if (uGradientKind > 0.5 && uGradientKind < 1.5) basePosition = radialPosition;
  else if (uGradientKind > 1.5 && uGradientKind < 2.5) basePosition = conicPosition;
  else if (uGradientKind > 3.5 && uGradientKind < 4.5) basePosition = radialPosition;

  if (uStyle < 0.5) {
    colorPosition = fract(basePosition + 0.13 * sin(warped.x * 4.1 + warped.y * 2.3 + n * 3.0 + t * 0.34));
  } else if (uStyle < 1.5) {
    float wave = sin(warped.x * 3.2 + n * 4.0 + t * 0.28) * 0.16;
    float ridge = warped.y + wave;
    bands = smoothstep(0.43, 0.52, ridge) * (1.0 - smoothstep(0.62, 0.77, ridge));
    bands += smoothstep(0.02, 0.13, ridge) * (1.0 - smoothstep(0.22, 0.35, ridge)) * 0.62;
    colorPosition = fract(basePosition * 0.55 + p.x * 0.28 + n * 0.4 + t * 0.025);
    alpha = clamp(bands, 0.0, 1.0);
  } else if (uStyle < 2.5) {
    colorPosition = fract(basePosition + 0.22 * sin((warped.x + warped.y * 0.73 + n * 0.8) * 4.8 + t * 0.24));
  } else if (uStyle < 3.5) {
    colorPosition = fract(conicPosition * 0.48 + basePosition * 0.3 + n * 0.25 + t * 0.018);
  } else if (uStyle < 4.5) {
    float plasma = sin(warped.x * 5.2 + t * 0.3) + cos(warped.y * 5.4 - t * 0.24) + sin((warped.x + warped.y) * 3.8 + t * 0.19);
    colorPosition = fract(basePosition * 0.42 + plasma * 0.12 + n * 0.2 + 0.5);
  } else if (uStyle < 5.5) {
    float silk = sin(warped.y * 7.0 + sin(warped.x * 2.1 + t * 0.16) * 1.7 + n * 2.0);
    colorPosition = fract(basePosition * 0.62 + silk * 0.13 + 0.3);
  } else if (uStyle < 6.5) {
    float nebula = field(warped * 2.4 + vec2(t * 0.06, -t * 0.04));
    colorPosition = fract(basePosition * 0.45 + nebula * 1.15 + 0.5);
    alpha *= smoothstep(-0.2, 0.42, nebula + 0.28);
  } else if (uStyle < 7.5) {
    float ribbon = sin(warped.y * 5.0 + sin(warped.x * 2.0 + t * 0.2) * 1.4 + n * 2.0);
    float secondRibbon = sin(warped.y * 3.3 - warped.x * 1.3 - t * 0.17);
    colorPosition = fract(basePosition * 0.45 + ribbon * 0.12 + 0.32);
    bands = smoothstep(0.18, 0.5, max(ribbon, secondRibbon));
    alpha *= 0.58 + bands * 0.42;
  } else if (uStyle < 8.5) {
    vec2 centers[4];
    centers[0] = vec2(0.27, 0.32);
    centers[1] = vec2(0.72, 0.35);
    centers[2] = vec2(0.43, 0.73);
    centers[3] = vec2(0.82, 0.78);
    float blobs = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 center = centers[i] + vec2(sin(t * 0.12 + float(i)) * 0.08, cos(t * 0.1 + float(i) * 1.7) * 0.07);
      blobs += 0.085 / (dot((p - center) * vec2(uAspect, 1.0), (p - center) * vec2(uAspect, 1.0)) + 0.045);
    }
    colorPosition = fract(basePosition * 0.32 + blobs * 0.12 + n * 0.15);
  } else {
    float contours = sin((basePosition * 7.0 + n * 2.8) * 6.2831853);
    colorPosition = fract(basePosition + 0.12 * n + 0.5);
    bands = 1.0 - smoothstep(0.14, 0.34, abs(contours));
    alpha *= 0.45 + bands * 0.55;
  }

  vec4 color = samplePalette(colorPosition);
  if (uMeshCount > 0.5) {
    color = sampleMesh(p);
  }
  float customLight = 0.0;
  if (uPointerMode > 2.5 && uPointerMode < 3.5) customLight = influence * uGlow;
  else if (uPointerMode > 10.5 && uPointerMode < 11.5) customLight = pointerFalloff * uPointerActive * uInteractionStrength;
  else if (uPointerMode > 11.5) {
    if (uMeshCount > 0.5) color.rgb = mix(color.rgb, uInteractionColor, influence * 0.35);
    else {
      colorPosition = fract(colorPosition + influence * 0.22);
      color = samplePalette(colorPosition);
    }
    customLight = influence * 0.22;
  }
  color.rgb = mix(color.rgb, uInteractionColor, clamp(customLight, 0.0, 1.0));
  float pointerGlow = exp(-pointerDistance * pointerDistance / max(0.0001, uInteractionRadius * uInteractionRadius * 0.12));
  float glow = pointerGlow * uPointerActive * uGlow * (0.2 + uPointerDown * 0.45);
  vec3 highlight = uMeshCount > 0.5 ? uInteractionColor : samplePalette(fract(colorPosition + 0.23)).rgb;
  color.rgb = mix(color.rgb, highlight, clamp(glow, 0.0, 0.8));

  float ripples = 0.0;
  if (uRippleCount > 0.5) ripples += rippleLight(uRipples[0], p);
  if (uRippleCount > 1.5) ripples += rippleLight(uRipples[1], p);
  if (uRippleCount > 2.5) ripples += rippleLight(uRipples[2], p);
  if (uRippleCount > 3.5) ripples += rippleLight(uRipples[3], p);
  if (uRippleCount > 4.5) ripples += rippleLight(uRipples[4], p);
  if (uRippleCount > 5.5) ripples += rippleLight(uRipples[5], p);
  if (uRippleCount > 6.5) ripples += rippleLight(uRipples[6], p);
  if (uRippleCount > 7.5) ripples += rippleLight(uRipples[7], p);
  float rippleGlow = ripples * uRippleStrength;
  color.rgb = mix(color.rgb, highlight, clamp(rippleGlow, 0.0, 0.85));
  alpha *= max(color.a, 0.0);
  alpha *= clamp(uIntensity, 0.0, 1.0);
  alpha *= clamp(0.62 + glow * 0.6 + rippleGlow * 0.5, 0.0, 1.0);
  gl_FragColor = vec4(color.rgb, alpha);
}
