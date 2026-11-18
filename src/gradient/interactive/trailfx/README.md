# Trail FX

A multi-pass, pointer-driven effect for the shader gradient (the "Chrome trail" look), built into the Shader tab as **Trail FX**.

- `model.ts` — pass catalog (base, reveal, directional blur, diffuse, liquify, metal sheen, colour grade, light rays), config + normalisation, presets.
- `shaders.generated.ts` — GLSL for every pass. The "Chrome trail" passes are the original Unicorn Studio project shaders (effect.json) with their constants lifted into uniforms, so every number is a slider and nothing recompiles when one moves.
- `runtime.js` / `runtime.d.ts` — plain WebGL2 pipeline shared by the preview and the standalone export: feedback trails, pass chaining, pointer/touch bookkeeping, adaptive resolution.
- `exportStandalone.ts` — builds `index.html`, `style.css`, `script.js` and `effect.json` (pass stack + shader library); the JSON can be pasted back into the panel.
- UI: `components/shader/TrailFxPanel.tsx`; preview overlay: `components/TrailFxOverlay.tsx`; stored as the optional `trailFx` field of the project's shader settings.
