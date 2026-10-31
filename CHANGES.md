# Shared CSS and WebGL Gradient Renderer

## Summary

The gradient studio now supports rendering the same `GradientProject` through CSS, WebGL, or the existing CSS-plus-WebGL overlay. CSS remains the default fallback, and the WebGL backend can add shader effects that CSS gradients do not support.

## Renderer behavior

- **CSS** keeps the project rendered by the existing CSS gradient pipeline and disables the shader canvas.
- **WebGL** renders supported gradient layers in the shader. The CSS gradient remains visible until WebGL is ready or if WebGL initialization fails.
- **Overlay** keeps the existing CSS-plus-shader composition and is the default for compatibility with existing projects.
- Repeating gradients use CSS plus the shader overlay because repeating geometry is not reproduced by the WebGL gradient layer.

The shared project adapter now passes gradient stop metadata and color-space information to the shader renderer. Palette LUTs preserve ramp sampling for WebGL and standalone exports. The shader adds noise/warp, mirror wrapping, ripples/refraction, interaction, sheen, dithering, and finishing controls. Standalone HTML and React exports include the renderer settings and LUT data.

## Changed files

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
