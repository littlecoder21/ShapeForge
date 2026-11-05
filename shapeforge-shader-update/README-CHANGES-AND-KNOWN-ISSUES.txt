SHAPEFORGE - SHADER PANEL / INTERACT BUILDER / PERFORMANCE UPDATE
=================================================================

HOW TO APPLY
------------
Unzip over your repo root (paths inside the zip are repo paths: src/gradient/...).
All files are new or replace the existing file with the same path. Nothing needs deleting.
Then run:  npm run typecheck   (and   npm run build )

Files that are NEW:
  src/gradient/shader-panel.css
  src/gradient/components/shader/*            (LayerStrip, StylePanel, SetupPanel, MotionPanel, InteractPanel, RuleCard, FinishPanel, context, parts)
  src/gradient/interactive/styles.ts          (27 shader styles + their parameters, single source of truth)
  src/gradient/interactive/rigRuntime.js      (+ rigRuntime.d.ts)  shared pointer/touch/drive runtime
  src/gradient/interactive/rig/model.ts, glsl.ts, presets.ts      the interaction builder
  src/gradient/interactive/rig.test.ts

Files that REPLACE existing ones:
  src/gradient/components/InteractivePanel.tsx, InteractiveCanvas.tsx
  src/gradient/interactive/types.ts, uniforms.ts, export.ts, paletteLut.test.ts
  src/gradient/interactive/core/InteractiveRenderer.ts
  src/gradient/interactive/input/PointerManager.ts
  src/gradient/interactive/shaders/gradient.frag.glsl

Untouched and still used: pointerModes.ts (legacy ids, used to migrate old projects), presets.ts, adapter.ts,
paletteLut.ts, gradient.vert.glsl, LayersPanel, PreviewStage, LayeredArt, GradientStudio.


WHAT YOU GET
------------
1. Shader panel: one overview with a minimal layer list (tick layers, Select all / none, Shader on / off per layer, no
   more going back to the Layers panel) and 5 sub-panels that open when clicked: Style, Setup, Motion, Interact,
   Finish & quality. Edits apply to every ticked layer.
2. 27 styles in ONE library (the duplicate style pickers are gone). 15 new, each with 4 customisable controls:
   Marble, Ocean waves, Topography, Crystal cells, Blueprint grid, Interference, Lava lamp, Light rays, Low-poly facets,
   Ink bleed, Fluted glass, Mist layers, Retro sunset, Pixel mosaic, Galaxy spiral.
3. Advanced Motion sub-panel: pattern angle, drift, slow spin, zoom, breathing, time offset, idle-pointer paths, and
   independent per-layer motion.
4. Interact builder (no code): up to 8 rules. Each rule = effect (37) + source (pointer, motion trail, click anchors,
   second finger, fixed point, orbiting point, symmetric copies) + shape (8) + falloff (10, with live curve) + up to 3
   DRIVES (press, hold-charge, click pulse, speed, resting, pointer X/Y, 5 LFOs, two-finger pinch/twist) that control any
   number of the rule live. Spring / smooth pointer physics, press attack/release, hold time, trail length, master gain.
   87 ready-made interactions: all 75 old pointer styles rebuilt (same ids, so old projects keep working) + 12 that only
   the builder can do. Save / import / export JSON, "Surprise me".
   Compared with the particalestudio builder: multi-touch, spring physics, click anchors, symmetry, 3 drives per rule
   with curves, per-layer reaction (incl. negative = parallax), generated shader compiles only what a rule uses.
5. Exports (HTML / JS / React / GLSL) embed the same runtime and the same generated shader as the editor.


PERFORMANCE - ROOT CAUSES FOUND AND FIXED (no preview-quality reduction)
-------------------------------------------------------------------------
 1. InteractiveCanvas recomputed the layer palette from the WHOLE project on every project change (every slider tick in
    any panel), which gave the renderer a new palette array, which re-baked the 512-entry colour LUT and re-uploaded two
    textures per shader layer. Now keyed on [layer, canvas, background]; component wrapped in memo with a comparator;
    text-mask data URI is memoised (it was generated twice per render).
 2. Renderer.update() reset adaptive resolution and the frame average on EVERY settings object, so dragging any slider
    snapped the render back to full resolution each tick (adaptive scaling could never settle). It now resets only when
    quality / resolution scale change, and skips identical updates (structural compare) for settings, palette, geometry,
    mesh and layer-mix.
 3. resize() (forces a layout read) ran on every update; now only when it can change the size.
 4. The 38 KB fragment shader contained a 75-way pointer-mode if/else chain plus a per-pixel 6-octave noise call for the
    pointer silhouette. Replaced by generated code containing ONLY the rules in use.
 5. Noise octaves / warp depth were uniforms with a dynamic loop; they are now compile-time constants per quality level
    (identical output, loop can be unrolled).
 6. Shader compile is no longer a blocking main-thread stall when a shader layer is created or the interaction structure
    changes: KHR_parallel_shader_compile is used where available and the previous program keeps drawing while the new
    one builds. If a rig variant ever fails to compile, the renderer falls back to the base shader and shows why.
 7. WebGL contexts are now released explicitly (loseContext) when a shader layer is removed; browsers cap live contexts
    (about 16) and creating/removing layers used to push live layers into "context lost".
 8. Per-frame garbage removed (new Float32Array + hex parsing every frame); pointer rect cached (no layout read per
    pointermove); uniforms for the rig are uploaded only when rules exist; the loop keeps running only while something
    animates.
 NOTE: I could not benchmark old-vs-new inside your running app (no access to it). The fixes above come from reading the
 code paths; items 1-3 and 7 are the ones that make creating / editing shaders feel laggy.


WHAT WAS VERIFIED (and how)
---------------------------
 - Real WebGL (headless Chromium, SwiftShader), WebGL1 AND WebGL2 syntax: 143 generated shader variants compiled (every
   effect, shape x falloff, source, colour mode x blend, kitchen-sink, low quality) - 0 failures.
 - Real renderer in the browser: all 87 interaction presets reach "ready"; pointer movement changes the picture; changing
   the rig structure rebuilds without blanking; all 15 new styles render; exported runtime (new Function) starts, reaches
   "ready" and reacts to pointer. No console errors. Visual spot-check of styles and presets.
 - rig.test.ts: 13 tests pass (run in isolation).
 - tsc (strict flags like yours) passes for all non-test files, but against STUBS of your engine modules (model, store,
   controls, ui, adapter ...) because I do not have them locally.


INTEGRATION STATUS / REMAINING LIMITATIONS
------------------------------------------
 A. RESOLVED: `npm run typecheck` and `npm run build` both pass against the real project modules.
 B. RESOLVED: `focusLayer` now calls the typed `store.select(id)` API directly.
 C. RESOLVED: both interactive shader test files pass (24 tests total), including palette, adapter and export coverage.
 D. RESOLVED: the installed lucide-react version supports the imported icons; typecheck and build pass.
 E. Browser smoke check confirmed the Shader panel, 27-style library, multi-layer selection and panel navigation render.
    Fine-grained visual tuning against every viewport/theme was not performed.
 F. INTENTIONAL: the legacy Glow control remains overlay-opacity response; pointer lighting is the Glow effect in Interact.
 G. LIMITATION: legacy interaction presets retain their IDs and behavior mappings, but are approximate visual recreations.
 H. LIMITATION: stacked shader layers still use independent WebGL contexts, so GPU work scales with layer count.
 I. LIMITATION: no representative hardware benchmark was run; build output retains existing missing-font and large-chunk warnings.
