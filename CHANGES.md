# Shared CSS and WebGL Gradient Renderer

## Summary

The gradient studio now supports rendering the same `GradientProject` through CSS, WebGL, or the existing CSS-plus-WebGL overlay. CSS remains the default fallback, and the WebGL backend can add shader effects that CSS gradients do not support.

## Renderer behavior

- **CSS** keeps the project rendered by the existing CSS gradient pipeline and disables the shader canvas.
- **WebGL** renders supported gradient layers in the shader. The CSS gradient remains visible until WebGL is ready or if WebGL initialization fails.
- **Overlay** keeps the existing CSS-plus-shader composition and is the default for compatibility with existing projects.
- Linear, radial, and conic gradients preserve their CSS stop ramp and geometry; circle radii account for the canvas aspect ratio and conic stops follow CSS's clockwise angle.
- Curve, noise, and repeating gradients stay CSS-backed when WebGL is selected because their source geometry is not reproduced exactly by the shader.
- New additive setting: `shaderMix` (0–1, default 1); old project JSON normalizes to 1. Set it to zero to render the supported CSS ramp and geometry through WebGL; overlay mode blends shader effects over the original CSS layer.
- Pointer highlights and ripples are composited after the CSS/shader mix so hover remains visible at `shaderMix: 0`, including on translucent layers.
- Pointer modes now have separate field and visual responses; each shader-enabled layer retains its own CSS stop colors or mesh-point palette and blends in the original layer order.
- The pointer menu now offers 75 effects total (62 added modes), including ten 3D-inspired material interactions and two chaos/electric effects, with per-layer automatic colors, editable custom palettes, animated color blending, and configurable falloff.
- A dedicated pointer-driven gradient-distortion control warps the layer’s sampled geometry and color stops together, independently from the shader’s ambient fluid distortion.
- Pointer displacement can push gradient colors away from or pull them toward the cursor; a velocity-reaction control scales the displacement, pointer warp, and glow with cursor speed.
- The pointer panel now includes a configurable mouse/touch response delay and a local glitch control; the material interactions use irregular, noise-warped contours for less rounded shapes.
- Pointer silhouettes now keep only six selected interactions round; the Wave effect and the remaining modes use irregular, angular contours. Added Tesla-coil arcs and branching-lightning interactions.
- Ten pointer-interaction modes add glossy liquid silk, image-to-liquid warping, holographic glass, liquid metal, 3D fluid waves, chromatic refraction, melting, magnetic goo, oil-slick interference, and reactive displacement textures. They use palette-aware specular highlights and Fresnel-like rims while distorting the active gradient or mesh color field; no external image texture is loaded.
- Interactive HTML now includes the generated layered CSS as well as the shader runtime, and a JavaScript export mounts the same exact gradient markup and interaction code into a selected page element.
- Shader controls are grouped into Setup, Motion, Interact, Finish, and Quality subpanels.
- In the Studio preview, mouse hover reaches the shader automatically without blocking gradient editing. Touch input is enabled explicitly with Touch mode, and pointer leave clears the active hover.

The shared project adapter now passes gradient stop metadata, color-space information, and CSS geometry to the shader renderer. Palette LUTs preserve ramp sampling for WebGL and standalone exports. The shader adds noise/warp, mirror wrapping, ripples/refraction, interaction, sheen, dithering, and finishing controls. Standalone HTML and React exports include the renderer settings and LUT data.

## Changed files

- `CHANGES.md`
- `src/gradient/components/InteractiveCanvas.tsx`
- `src/gradient/components/InteractivePanel.tsx`
- `src/gradient/components/LayeredArt.tsx`
- `src/gradient/components/PreviewStage.tsx`
- `src/gradient/interactive/adapter.ts`
- `src/gradient/interactive/core/InteractiveRenderer.ts`
- `src/gradient/interactive/export.ts`
- `src/gradient/interactive/paletteLut.test.ts` (new)
- `src/gradient/interactive/paletteLut.ts` (new)
- `src/gradient/interactive/presets.ts`
- `src/gradient/interactive/shaders/gradient.frag.glsl`
- `src/gradient/interactive/types.ts`
- `src/gradient/interactive/uniforms.ts` (new)
- `src/gradient/studio.css`

## Validation

- `npm run typecheck` passed.
- `npm run build` passed. The build reports existing unresolved font-reference and large-chunk warnings.
- `git diff --check` passed.
- The updated vertex and fragment shaders compiled in WebGL1 and WebGL2.
- Standalone HTML export initialized both shader canvases with status `ready` and the expected 2048-byte palette LUT.
- VS Code test discovery is unavailable in this workspace; there is no configured `npm test` script.
