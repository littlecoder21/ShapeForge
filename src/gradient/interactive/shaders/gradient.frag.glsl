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
  float pointerShapeDistance = pointerDistance;
  float pointerAngle = atan(pointerDelta.y, pointerDelta.x);
  bool roundInteraction = uPointerMode > 2.5 && uPointerMode < 3.5
    || uPointerMode > 7.5 && uPointerMode < 9.5
    || uPointerMode > 10.5 && uPointerMode < 11.5
    || uPointerMode > 44.5 && uPointerMode < 45.5
    || uPointerMode > 50.5 && uPointerMode < 51.5;
  if (!roundInteraction) {
    float edgeNoise = field(pointerDelta * 6.2 + vec2(uClock * 0.21, -uClock * 0.16));
    float lobes = sin(pointerAngle * (3.0 + mod(uPointerMode, 5.0)) + edgeNoise * 5.0 + uClock * 0.3);
    float spikes = abs(sin(pointerAngle * (7.0 + mod(uPointerMode, 4.0)) + edgeNoise * 3.0));
    pointerShapeDistance = max(0.0, pointerDistance
      + uInteractionRadius * ((edgeNoise - 0.5) * 0.4 + lobes * 0.24 + (spikes - 0.5) * 0.2));
  }
  float pointerRatio = clamp(pointerShapeDistance / max(0.001, uInteractionRadius), 0.0, 1.0);
  float pointerFalloff = 1.0 - smoothstep(0.0, 1.0, pointerRatio);
  if (uInteractionFalloff > 0.5 && uInteractionFalloff < 1.5) pointerFalloff = 1.0 - pointerRatio;
  else if (uInteractionFalloff > 1.5 && uInteractionFalloff < 2.5) pointerFalloff = pow(pointerFalloff, 2.4);
  else if (uInteractionFalloff > 2.5) pointerFalloff = exp(-4.5 * pointerRatio * pointerRatio);
  float influence = pointerFalloff * uPointerActive * uInteractionStrength;
  vec2 direction = normalize(pointerDelta + vec2(0.0001));
  vec2 directionUv = direction / vec2(uAspect, 1.0);
  vec2 perpendicularUv = vec2(-direction.y, direction.x) / vec2(uAspect, 1.0);
  vec2 velocityDirection = normalize(uVelocity + vec2(0.0001));
  vec2 velocitySide = vec2(-velocityDirection.y, velocityDirection.x);
  float pointerSpeed = length(uVelocity);
  float velocityResponse = clamp(pointerSpeed * 1.5, 0.0, 1.0) * uInteractionVelocityReaction;
  float velocityGain = 1.0 + velocityResponse * 1.8;
  float glitchAmount = uInteractionGlitch * pointerFalloff * uPointerActive * uInteractionStrength
    * (0.35 + velocityResponse * 0.65);
  float glitchRow = floor(p.y * (18.0 + uResolution.y * 0.08));
  float glitchTick = floor(uClock * 20.0);
  float glitchRandom = fract(sin(glitchRow * 12.9898 + glitchTick * 78.233) * 43758.5453);
  float glitchGate = step(0.76, glitchRandom);
  float trailSide = dot(pointerDelta, velocitySide);
  float trailBehind = max(-dot(pointerDelta, velocityDirection), 0.0);
  float trailMask = exp(-pow(trailSide / max(0.012, uInteractionRadius * 0.42), 2.0))
    * exp(-trailBehind / max(0.02, uInteractionRadius * 1.8))
    * smoothstep(0.03, 0.22, pointerSpeed) * uPointerActive;
  float advancedEffect = uPointerMode - 63.0;
  float advancedLight = 0.0;
  float advancedSpecular = 0.0;
  float advancedChromatic = 0.0;
  float advancedPaletteShift = 0.0;
  float electricLight = 0.0;
  float electricArc = 0.0;
  float extraMode = uPointerMode - 13.0;
  float extraGroup = floor(extraMode / 10.0);
  float extraVariant = mod(extraMode, 10.0);
  if (uPointerMode < 0.5) p -= directionUv * influence * 0.14;
  else if (uPointerMode < 1.5) p += directionUv * influence * 0.14;
  else if (uPointerMode < 2.5) p += perpendicularUv * influence * 0.18;
  else if (uPointerMode < 3.5) { }
  else if (uPointerMode < 4.5) p += (uPointer - p) * influence * 0.24;
  else if (uPointerMode < 5.5) p += directionUv * sin(pointerShapeDistance * 34.0 - uClock * 9.0 + sin(pointerAngle * 5.0) * 1.7) * influence * 0.035;
  else if (uPointerMode < 6.5) p += perpendicularUv * influence * 0.2 - directionUv * influence * 0.045;
  else if (uPointerMode < 7.5) {
    p -= directionUv * influence * 0.22;
    p += directionUv * sin(pointerDistance * 24.0 - uClock * 3.0) * influence * 0.025;
  } else if (uPointerMode < 8.5) p += directionUv * sin(pointerDistance * 46.0 - uClock * 10.0) * influence * 0.04;
  else if (uPointerMode < 9.5) p += directionUv * sin(pointerDistance * 18.0 - uClock * 6.0) * influence * 0.018;
  else if (uPointerMode < 10.5) p += velocityDirection / vec2(uAspect, 1.0) * trailMask * uInteractionStrength * 0.08;
  else if (uPointerMode >= 13.0 && uPointerMode < 63.0) {
    float phase = extraVariant * 0.6283185;
    float wave = sin(pointerDistance * (18.0 + extraVariant * 3.2) - uClock * (2.0 + extraVariant * 0.35) + phase);
    if (extraGroup < 0.5) {
      float colorWarp = wave;
      if (extraVariant > 2.5 && extraVariant < 5.5) colorWarp = sin(atan(direction.y, direction.x) * (2.0 + extraVariant) + uClock * 2.0);
      else if (extraVariant >= 5.5) colorWarp = sin(pointerDistance * (12.0 + extraVariant * 2.0) + atan(direction.y, direction.x) * 3.0 - uClock * 4.0);
      p += (directionUv * colorWarp + perpendicularUv * cos(phase + uClock)) * influence * (0.025 + extraVariant * 0.0015);
    } else if (extraGroup < 1.5) {
      float force = influence * (0.07 + extraVariant * 0.012);
      if (extraVariant < 0.5) p -= directionUv * force;
      else if (extraVariant < 1.5) p += directionUv * force;
      else if (extraVariant < 2.5) p += perpendicularUv * force;
      else if (extraVariant < 3.5) p -= perpendicularUv * force;
      else if (extraVariant < 4.5) p += (directionUv + perpendicularUv * wave) * force;
      else if (extraVariant < 5.5) p += (perpendicularUv + directionUv * wave) * force;
      else if (extraVariant < 6.5) p += vec2(direction.x, 0.0) * force;
      else if (extraVariant < 7.5) p += vec2(0.0, direction.y) * force;
      else if (extraVariant < 8.5) p -= directionUv * force * (1.0 + wave * 0.5);
      else p += directionUv * force * (1.0 - influence);
    } else if (extraGroup < 2.5) {
      float angle = atan(direction.y, direction.x);
      float frequency = 22.0 + extraVariant * 4.0;
      float rings = sin(pointerDistance * frequency - uClock * (4.0 + extraVariant * 0.5) + angle * (1.0 + mod(extraVariant, 4.0)));
      if (extraVariant < 1.5) rings = sin(pointerDistance * frequency - uClock * 4.0);
      else if (extraVariant < 2.5) rings = sin(pointerDistance * frequency + angle * 3.0);
      else if (extraVariant < 3.5) rings = sin(pointerDistance * frequency + sin(angle * 4.0) * 0.6 - uClock * 3.0);
      else if (extraVariant < 4.5) rings = sin(pointerDistance * frequency - uClock * 2.0) * cos(angle * 5.0);
      else if (extraVariant < 5.5) rings = sin(pointerDistance * frequency - uClock * (3.0 + 2.0 * sin(uClock)));
      else if (extraVariant < 6.5) rings = sin(pointerDistance * frequency + angle * 2.0) + sin(pointerDistance * frequency * 0.5 - uClock * 5.0);
      else if (extraVariant < 7.5) rings = sin(pointerDistance * frequency * 0.7 - uClock * 4.0) * sin(pointerDistance * frequency * 1.4);
      else if (extraVariant < 8.5) rings = sin(pointerDistance * frequency + angle * 6.0 - uClock * 2.0);
      p += directionUv * rings * influence * (0.018 + extraVariant * 0.002);
    } else if (extraGroup > 3.5) {
      float trailShape = trailMask;
      if (extraVariant < 1.5) trailShape *= smoothstep(0.08, 0.7, pointerSpeed);
      else if (extraVariant < 2.5) trailShape *= 0.5 + 0.5 * sin(trailBehind * 32.0 - uClock * 8.0);
      else if (extraVariant < 3.5) trailShape *= exp(-trailBehind / max(0.02, uInteractionRadius * 0.7));
      else if (extraVariant < 4.5) trailShape *= 0.65 + 0.35 * sin(trailSide * 38.0 + uClock * 5.0);
      else if (extraVariant < 5.5) trailShape *= 0.5 + 0.5 * cos(trailBehind * 18.0 + uClock * 3.0);
      else if (extraVariant < 6.5) trailShape *= exp(-abs(trailSide) / max(0.01, uInteractionRadius * 0.12));
      else if (extraVariant < 7.5) trailShape *= 0.5 + 0.5 * sin(trailSide * 24.0 + trailBehind * 16.0);
      else if (extraVariant < 8.5) trailShape *= smoothstep(0.0, 0.8, pointerSpeed) * (1.0 - smoothstep(0.5, 1.5, trailBehind));
      float smear = trailShape * (0.03 + extraVariant * 0.006);
      p += velocityDirection / vec2(uAspect, 1.0) * smear;
      p += perpendicularUv * sin(trailBehind * (9.0 + extraVariant * 2.0) + uClock * 3.0) * smear * 0.35;
    }
  } else if (uPointerMode >= 63.0 && uPointerMode < 73.0) {
    influence *= 1.0 + velocityResponse;
    float angle = atan(direction.y, direction.x);
    float phase = uClock * (2.1 + advancedEffect * 0.17) + advancedEffect * 0.71;
    float ringWave = sin(pointerShapeDistance * (24.0 + advancedEffect * 2.8) - phase);
    if (advancedEffect < 0.5) {
      float fold = sin(pointerShapeDistance * 19.0 + angle * 2.2 - phase * 1.4);
      p += perpendicularUv * fold * influence * 0.075 + directionUv * ringWave * influence * 0.025;
      advancedSpecular = pow(max(0.0, 1.0 - abs(fold)), 8.0) * influence;
      advancedLight = (0.25 + 0.35 * abs(fold)) * influence;
      advancedPaletteShift = fold * influence * 0.09;
    } else if (advancedEffect < 1.5) {
      vec2 liquidInput = pointerDelta * 5.2 + vec2(phase, -phase * 0.7);
      vec2 liquidWarp = vec2(field(liquidInput), field(liquidInput + vec2(4.7, 8.2)));
      p += liquidWarp * influence * 0.09;
      advancedPaletteShift = (liquidWarp.x - liquidWarp.y) * influence * 0.16;
      advancedLight = abs(ringWave) * influence * 0.55;
      advancedSpecular = pow(max(0.0, 1.0 - abs(ringWave)), 10.0) * influence;
    } else if (advancedEffect < 2.5) {
      float lens = exp(-pointerShapeDistance * pointerShapeDistance / max(0.0001, uInteractionRadius * uInteractionRadius * 0.45));
      float rim = exp(-pow((pointerShapeDistance - uInteractionRadius * 0.72) / max(0.008, uInteractionRadius * 0.09), 2.0));
      p -= directionUv * lens * influence * 0.07;
      p += directionUv * ringWave * influence * 0.025;
      advancedLight = rim * influence;
      advancedSpecular = pow(rim, 2.0) * influence * 0.85;
      advancedPaletteShift = rim * influence * 0.16;
    } else if (advancedEffect < 3.5) {
      float chromeFold = sin(pointerDistance * 31.0 - phase * 1.7 + sin(angle * 3.0) * 1.3);
      p += directionUv * chromeFold * influence * 0.065;
      p += perpendicularUv * sin(chromeFold * 2.2) * influence * 0.035;
      advancedSpecular = pow(max(0.0, 1.0 - abs(chromeFold)), 16.0) * influence;
      advancedLight = pow(max(0.0, chromeFold), 3.0) * influence * 0.7;
      advancedPaletteShift = chromeFold * influence * 0.12;
    } else if (advancedEffect < 4.5) {
      float waveHeight = sin(pointerShapeDistance * 18.0 - phase * 1.2) * 0.65 + sin(angle * 3.0 + phase) * 0.35;
      p += directionUv * waveHeight * influence * 0.07;
      p += perpendicularUv * sin(pointerDistance * 11.0 - phase) * influence * 0.045;
      advancedSpecular = pow(max(0.0, 1.0 - abs(waveHeight)), 9.0) * influence;
      advancedLight = (0.3 + 0.35 * waveHeight) * influence;
      advancedPaletteShift = waveHeight * influence * 0.11;
    } else if (advancedEffect < 5.5) {
      float refraction = ringWave * influence * 0.085;
      p += directionUv * refraction;
      p += perpendicularUv * sin(angle * 4.0 + phase) * influence * 0.025;
      advancedChromatic = influence * (0.35 + 0.45 * abs(ringWave));
      advancedLight = abs(ringWave) * influence * 0.4;
      advancedSpecular = pow(max(0.0, 1.0 - abs(ringWave)), 12.0) * influence;
    } else if (advancedEffect < 6.5) {
      float dripLane = fract((p.x * 7.0 + field(p * 4.0) * 0.8) * 0.5);
      float dripLength = smoothstep(0.05, 0.92, dripLane);
      float drip = sin((p.x * 7.0 + field(p * 4.0)) * 6.2831853 + phase) * 0.025;
      p.x += drip * influence;
      p.y -= dripLength * influence * 0.075;
      advancedSpecular = exp(-abs(drip) * 80.0) * influence * dripLength;
      advancedLight = dripLength * influence * 0.55;
      advancedPaletteShift = dripLength * influence * 0.14;
    } else if (advancedEffect < 7.5) {
      float gooField = uInteractionRadius * 0.72 - pointerShapeDistance + sin(angle * 3.0 + phase) * uInteractionRadius * 0.1;
      float gooMask = smoothstep(-0.035, 0.045, gooField);
      float gooRim = exp(-abs(gooField) * 55.0);
      p -= directionUv * gooMask * influence * 0.075;
      p += perpendicularUv * sin(angle * 2.0 + phase) * gooMask * influence * 0.045;
      advancedLight = gooMask * influence * 0.5;
      advancedSpecular = gooRim * influence;
      advancedPaletteShift = gooMask * 0.13;
    } else if (advancedEffect < 8.5) {
      float film = sin(pointerShapeDistance * 17.0 - phase + sin(angle * 2.0) * 1.5);
      float interference = sin(film * 3.1 + pointerShapeDistance * 29.0 + phase * 0.4);
      p += directionUv * film * influence * 0.05;
      advancedPaletteShift = (film * 0.12 + interference * 0.08) * influence;
      advancedLight = (0.25 + 0.35 * abs(interference)) * influence;
      advancedSpecular = pow(max(0.0, 1.0 - abs(film)), 11.0) * influence;
    } else {
      float height = sin(p.x * 105.0 + phase) * cos(p.y * 86.0 - phase * 0.8);
      float ridge = 1.0 - smoothstep(0.0, 0.22, abs(height));
      p += vec2(cos(p.x * 105.0 + phase), sin(p.y * 86.0 - phase * 0.8))
        * height * influence * 0.018;
      advancedLight = ridge * influence * 0.52;
      advancedSpecular = ridge * influence * 0.72;
      advancedPaletteShift = height * influence * 0.08;
    }
  } else if (uPointerMode >= 73.0 && uPointerMode < 75.0) {
    float electricNoise = field(pointerDelta * 18.0 + vec2(uClock * 0.7, -uClock * 0.43));
    if (uPointerMode < 73.5) {
      float coil = sin(pointerAngle * 7.0 + pointerShapeDistance * 46.0 - uClock * 8.0 + electricNoise * 4.0);
      float branches = sin(pointerAngle * 17.0 - pointerShapeDistance * 31.0 + electricNoise * 6.0);
      electricArc = exp(-abs(coil) * 22.0) * (0.45 + 0.55 * exp(-abs(branches) * 13.0))
        * exp(-pointerShapeDistance / max(0.01, uInteractionRadius * 1.05));
      p += (directionUv * coil + perpendicularUv * branches) * influence * 0.085;
      electricLight = electricArc * influence * (0.65 + 0.35 * sin(uClock * 19.0 + electricNoise * 9.0));
    } else {
      float bolt = sin(pointerAngle * 5.0 + pointerShapeDistance * 22.0 + electricNoise * 8.0 + uClock * 2.0);
      float fork = sin(pointerAngle * 11.0 - pointerShapeDistance * 38.0 + electricNoise * 12.0 - uClock * 3.0);
      electricArc = exp(-abs(bolt) * 28.0) + 0.72 * exp(-abs(fork) * 34.0);
      electricArc *= smoothstep(0.015, 0.09, pointerShapeDistance)
        * (1.0 - smoothstep(uInteractionRadius * 0.9, uInteractionRadius * 1.8, pointerShapeDistance));
      p += (perpendicularUv * bolt + directionUv * fork) * influence * 0.11;
      electricLight = electricArc * influence * step(0.48, fract(sin(floor(uClock * 24.0) + electricNoise * 91.0) * 43758.5453));
    }
    advancedPaletteShift = electricNoise * electricArc * 0.22;
  }

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
  } else {
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
  }

  float colorDistortion = interactionWarp * (interactionWave * 0.12 + cos(pointerDistance * 13.0 + uClock) * 0.06);
  colorPosition = wrapT(colorPosition + colorDistortion + displacement * displacementDirection * 0.8 + advancedPaletteShift);
  cssPosition = clamp(cssPosition + colorDistortion, 0.0, 1.0);
  vec4 color = samplePalette(colorPosition);
  color.rgb += samplePalette(wrapT(colorPosition + 0.06)).rgb * rimLight * 0.22;
  if (uMeshCount > 0.5) {
    vec4 meshColor = sampleMesh(warped / vec2(uAspect, 1.0) + 0.5);
    color.rgb = mix(color.rgb, meshColor.rgb, 0.82);
    color.a = meshColor.a;
  }
  if (uLayerMixEnabled > 0.5) {
    float mixMotion = sin(uClock * uLayerMixSpeed + colorPosition * 6.2831853 + n * 2.0) * 0.055;
    vec4 otherLayer = texture2D(uLayerMixLut, vec2(wrapT(colorPosition + mixMotion), 0.5));
    float mixAmount = clamp(uLayerMixStrength * (0.72 + 0.18 * sin(uClock * uLayerMixSpeed + n * 3.0) + influence * 0.45), 0.0, 1.0) * otherLayer.a;
    color.rgb = mix(color.rgb, blendLayerColors(color.rgb, otherLayer.rgb, uLayerMixMode), mixAmount);
  }
  if (advancedChromatic > 0.0) {
    vec3 refracted = vec3(
      samplePalette(wrapT(colorPosition + advancedChromatic * 0.09)).r,
      samplePalette(colorPosition).g,
      samplePalette(wrapT(colorPosition - advancedChromatic * 0.09)).b
    );
    color.rgb = mix(color.rgb, refracted, advancedChromatic);
  }
  float pointerGlow = exp(-pointerDistance * pointerDistance / max(0.0001, uInteractionRadius * uInteractionRadius * 0.32));
  float glow = pointerGlow * uPointerActive * uGlow * uInteractionStrength * (1.0 + velocityResponse);
  float waveBands = pow(max(0.0, sin(pointerShapeDistance * 46.0 - uClock * 8.0)), 10.0)
    * pointerFalloff * uPointerActive * uInteractionStrength;
  float pulseRadius = uInteractionRadius * (0.18 + 0.82 * (0.5 + 0.5 * sin(uClock * 6.0)));
  float pulseRing = exp(-pow((pointerDistance - pulseRadius) / max(0.008, uInteractionRadius * 0.12), 2.0)) * uPointerActive * uInteractionStrength;
  float rippleRadius = fract(uClock * uRippleSpeed) * uInteractionRadius * 1.5;
  float pointerRipple = exp(-pow((pointerDistance - rippleRadius) / max(0.008, uInteractionRadius * 0.1), 2.0))
    * uPointerActive * uInteractionStrength * (1.0 - fract(uClock * uRippleSpeed) * 0.55);
  float spotlight = (1.0 - smoothstep(uInteractionRadius * 0.12, uInteractionRadius, pointerDistance))
    * uPointerActive * uInteractionStrength;
  float interactionColorPosition = fract(pointerDistance / max(0.001, uInteractionRadius) + uClock * uInteractionColorSpeed);
  vec3 paletteHighlight = sampleInteractionPalette(interactionColorPosition);
  vec3 highlight = mix(uInteractionColor, paletteHighlight, uInteractionColorMix);
  float modeLight = 0.0;
  if (uPointerMode > 2.5 && uPointerMode < 3.5) modeLight = glow;
  else if (uPointerMode > 4.5 && uPointerMode < 5.5) modeLight = waveBands;
  else if (uPointerMode > 7.5 && uPointerMode < 8.5) modeLight = pointerRipple;
  else if (uPointerMode > 8.5 && uPointerMode < 9.5) modeLight = pulseRing;
  else if (uPointerMode > 9.5 && uPointerMode < 10.5) modeLight = trailMask * uInteractionStrength;
  else if (uPointerMode > 10.5 && uPointerMode < 11.5) modeLight = spotlight;
  if (uPointerMode >= 13.0 && uPointerMode < 63.0) {
    float phase = extraVariant * 0.6283185;
    float rings = 0.5 + 0.5 * sin(pointerDistance * (20.0 + extraVariant * 4.0) - uClock * (3.0 + extraVariant * 0.4) + phase);
    if (extraGroup < 0.5) modeLight = pointerFalloff * (0.35 + 0.35 * rings) * uPointerActive * uInteractionStrength;
    else if (extraGroup < 1.5) modeLight = pointerFalloff * (0.3 + 0.3 * abs(sin(atan(direction.y, direction.x) * (2.0 + mod(extraVariant, 6.0)) + phase))) * uPointerActive * uInteractionStrength;
    else if (extraGroup < 2.5) modeLight = pow(rings, 2.0 + mod(extraVariant, 4.0)) * pointerFalloff * uPointerActive * uInteractionStrength;
    else if (extraGroup < 3.5) {
      float angle = atan(direction.y, direction.x);
      float beam = abs(sin(angle * (1.0 + mod(extraVariant, 5.0)) + phase + uClock * 0.25));
      float flare = exp(-pointerDistance * pointerDistance / max(0.0001, uInteractionRadius * uInteractionRadius * 0.1));
      if (extraVariant < 1.5) modeLight = pointerFalloff;
      else if (extraVariant < 2.5) modeLight = (1.0 - smoothstep(0.04, 0.16, abs(direction.y))) * pointerFalloff;
      else if (extraVariant < 3.5) modeLight = (1.0 - smoothstep(0.04, 0.16, abs(direction.x * direction.y))) * pointerFalloff;
      else if (extraVariant < 4.5) modeLight = flare * (0.4 + 0.6 * rings);
      else if (extraVariant < 5.5) modeLight = pointerFalloff * (1.0 - smoothstep(0.08, 0.25, beam));
      else if (extraVariant < 6.5) modeLight = rings * rings * pointerFalloff;
      else if (extraVariant < 7.5) modeLight = pointerFalloff * (1.0 - smoothstep(0.0, 0.25, abs(sin(angle * 8.0 + phase))));
      else if (extraVariant < 8.5) modeLight = pointerFalloff * (0.25 + 0.75 * beam);
      else modeLight = max(pointerFalloff * (1.0 - rings), flare);
      modeLight *= uPointerActive * uInteractionStrength;
    } else {
      float trailShape = trailMask;
      if (extraVariant < 1.5) trailShape *= smoothstep(0.05, 0.6, pointerSpeed);
      else if (extraVariant < 2.5) trailShape *= 0.5 + 0.5 * sin(trailBehind * 30.0 - uClock * 6.0);
      else if (extraVariant < 3.5) trailShape *= exp(-trailBehind / max(0.02, uInteractionRadius * 0.7));
      else if (extraVariant < 4.5) trailShape *= 0.65 + 0.35 * sin(trailSide * 32.0);
      else if (extraVariant < 5.5) trailShape *= 0.5 + 0.5 * cos(trailBehind * 16.0 + uClock * 3.0);
      else if (extraVariant < 6.5) trailShape *= exp(-abs(trailSide) / max(0.01, uInteractionRadius * 0.12));
      else if (extraVariant < 7.5) trailShape *= 0.5 + 0.5 * sin(trailSide * 20.0 + trailBehind * 14.0);
      else if (extraVariant < 8.5) trailShape *= smoothstep(0.0, 0.8, pointerSpeed);
      modeLight = max(trailShape, pointerFalloff * (0.18 + 0.22 * rings)) * uPointerActive * uInteractionStrength;
    }
  }
  if (uPointerMode >= 63.0 && uPointerMode < 73.0) {
    vec3 materialColor = sampleInteractionPalette(fract(pointerRatio * 0.65 + uClock * uInteractionColorSpeed + advancedEffect * 0.13));
    color.rgb = mix(color.rgb, materialColor, clamp(advancedLight * 0.78, 0.0, 0.72));
    color.rgb += vec3(1.0) * advancedSpecular * 0.82;
    modeLight = clamp(advancedLight * 0.6 + advancedSpecular * 0.45, 0.0, 0.82);
  }
  if (uPointerMode >= 73.0 && uPointerMode < 75.0) {
    vec3 electricColor = sampleInteractionPalette(fract(pointerShapeDistance * 4.0 + uClock * uInteractionColorSpeed));
    color.rgb = mix(color.rgb, electricColor, clamp(electricLight * 0.8, 0.0, 0.85));
    color.rgb += vec3(0.72, 0.88, 1.0) * electricLight * 0.75;
    modeLight = clamp(electricLight * 0.85 + electricArc * 0.18, 0.0, 0.88);
  }
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
  if (uPointerMode > 11.5 && uPointerMode < 63.0) {
    vec3 shiftedPaletteColor = samplePalette(wrapT(cssPosition + influence * 0.42)).rgb;
    color.rgb = mix(color.rgb, shiftedPaletteColor, influence);
  }
  color.rgb = mix(color.rgb, highlight, clamp(modeLight, 0.0, 0.85));
  color.rgb = mix(color.rgb, highlight, clamp(rippleGlow, 0.0, 0.85));
  float interactionAlpha = clamp(modeLight + rippleGlow * 0.5, 0.0, 0.85);
  alpha = 1.0 - (1.0 - alpha) * (1.0 - interactionAlpha);
  color.rgb = finish(color.rgb, vUv, gl_FragCoord.xy);
  gl_FragColor = vec4(color.rgb, alpha);
}
