import { PROCEDURAL_UNIFORM_NAMES } from '../procedural/types';

/** Every uniform the fragment shader declares. `uOctaves`, `uWarpDepth` and the old `uPointerMode` are gone:
 *  quality is a compile-time constant now and the pointer reaction is generated from the interaction rig.
 *  The `uProc*` names belong to the procedural engine; they only exist in the shader when a layer uses it,
 *  and a location that is missing is simply null (uploads to it are no-ops). */
export const UNIFORM_NAMES = [
  'uResolution', 'uPointer', 'uVelocity', 'uPointerActive', 'uPointerDown', 'uTime', 'uClock', 'uAspect',
  'uStyle', 'uStyleP', 'uGradientKind', 'uGradientAngle', 'uGradientOrigin', 'uGradientRadius', 'uShaderMix',
  'uInteractionColor', 'uInteractionColors[0]', 'uInteractionColorCount', 'uInteractionColorMix',
  'uInteractionColorSpeed', 'uInteractionFalloff', 'uInteractionDistortion', 'uInteractionDisplacement',
  'uInteractionDisplacementMode', 'uInteractionVelocityReaction', 'uInteractionGlitch', 'uStopCount', 'uSpeed', 'uIntensity', 'uDistortion', 'uDistortionScale',
  'uTurbulence', 'uTimeOffset', 'uFlowAngle', 'uFlowDrift', 'uBreath', 'uBreathRate', 'uRotation', 'uZoom',
  'uMeshDrift', 'uMeshSpread', 'uMeshBlend',
  'uInteractionRadius', 'uInteractionStrength', 'uGlow', 'uRippleStrength', 'uRippleSpeed',
  'uRippleCount', 'uMeshCount', 'uMeshBase', 'uMeshPoints[0]', 'uMeshColors[0]', 'uPalette[0]',
  'uPaletteAlpha[0]', 'uRipples[0]', 'uWrapMode', 'uToneMap', 'uVignette',
  'uSheen', 'uGrain', 'uLutEnabled', 'uPaletteLut', 'uProjectOutput',
  'uLayerMixEnabled', 'uLayerMixMode', 'uLayerMixStrength', 'uLayerMixSpeed', 'uLayerMixLut',
  'uRuleB[0]', 'uRuleC[0]', 'uRuleD[0]', 'uRuleE[0]', 'uRuleF[0]', 'uTrail[0]', 'uTouch2',
  ...PROCEDURAL_UNIFORM_NAMES,
] as const;
