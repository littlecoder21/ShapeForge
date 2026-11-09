import { PROCEDURAL_UNIFORM_NAMES } from '../procedural/types';

/** Every uniform the fragment shader declares. `uOctaves`, `uWarpDepth` and the old `uPointerMode` are gone:
 *  quality is a compile-time constant now and the pointer reaction is generated from the interaction rig.
 *  The `uProc*` names belong to the procedural engine; they only exist in the shader when a layer uses it,
 *  and a location that is missing is simply null (uploads to it are no-ops).
 *
 *  IMPORTANT: a uniform that is declared in the shader but missing from this list is never looked up, so the renderer
 *  silently uploads nothing to it and it stays 0. `uRuleG` (fade strength) used to be missing here, which made every rule's
 *  influence 0 and left only the built-in base reaction on screen for every interaction style. `uniforms.test.ts` now
 *  checks that every uniform the template and the generated rule code declare is listed. */
export const UNIFORM_NAMES = [
  'uResolution', 'uPointer', 'uVelocity', 'uPointerActive', 'uInputActive', 'uPointerDown', 'uTime', 'uClock', 'uAspect',
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
  'uRuleB[0]', 'uRuleC[0]', 'uRuleD[0]', 'uRuleE[0]', 'uRuleF[0]', 'uRuleG[0]', 'uRuleH[0]', 'uRuleI[0]', 'uRuleJ[0]', 'uRuleK[0]',
  'uRuleTextureAtlas', 'uRuleShapeAtlas', 'uTrail[0]', 'uTouch2',
  ...PROCEDURAL_UNIFORM_NAMES,
] as const;
