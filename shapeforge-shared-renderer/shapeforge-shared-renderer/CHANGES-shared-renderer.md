# ShapeForge · shared shader renderer + "Use as single layer"

Copy every file in this folder over your repo at the same path (all paths are repo-relative). Nothing is deleted.

## 1. What changed in shader rendering

**Before:** every shader layer created its own `<canvas>` with its **own WebGL context**, compiled its **own program**, uploaded
its **own palette textures**, ran its own adaptive-resolution controller, listened to its own pointer events, and the preview
re-dispatched every real pointer event as a synthetic DOM `PointerEvent` to every canvas. Resolution was divided by `sqrt(layers)`
inside every layer, so N controllers reacted to one slow frame.

**Now** (`src/interactive/core/gpu/`):

| Piece | What it does |
|---|---|
| `SharedGpuContext` | ONE WebGL context for the page (detached canvas). Each layer is drawn into a rectangle of it and GPU-copied into the layer's own 2D canvas. Context loss / restore handled once. |
| `ShaderProgramManager` | Programs cached by structure key and **shared** by layers with the same key (compiled once, linked once). Async compile with `KHR_parallel_shader_compile`, failed keys remembered, unused programs deleted after a grace period. |
| `GpuResourceManager` | ONE quad buffer; palette textures shared **by content** and ref-counted (deleted with the last user). No FBOs are needed (direct rendering), so the FBO count stays 0. |
| `GlobalRenderBudget` | One budget for the whole composition: same total GPU work as the old rule, redistributed by layer cost (cheap layers get more pixels, heavy procedural ones fewer), **one** frame-time controller, quantised so resolution doesn't flicker. Quality presets (low/medium/high/ultra) are defined in one place. |
| `SharedRenderer` | The hub: one frame loop (the existing `FrameScheduler`), dirty-state rendering (only layers that asked for a frame render), shared program binding, diagnostics. |
| `PointerHub` | The preview hands each real pointer event to the hub once; the hub calls every layer's own pointer engine directly. No synthetic events. |
| `RenderDiagnostics` + `PerfOverlay` | Dev overlay (see below). |

`InteractiveRenderer` keeps its public API (`constructor`, `update`, `setPaused`, `resetInteraction`, `getStatus`, `destroy`),
the same GLSL, the same uniforms and the same fallback ladder. It additionally: skips re-uploading settings uniforms that did not
change, skips the CPU procedural simulation when nothing can have changed, and shares baked palette LUTs between identical palettes.
`InteractiveCanvas` no longer divides resolution per layer and no longer recomputes its settings when unrelated layers change.

**Layer compositing is unchanged on purpose.** Each layer still lives in its own CSS layer, so opacity, blend modes, filters, masks,
text masks, transforms and stacking with CSS layers are done by the browser exactly as before. A WebGL-side compositor (the
"shared compositing pipeline" box in your diagram) would have to re-implement all 17 blend modes + filters + masks and could not
interleave with CSS layers; I did not do that without being able to compare pixels.

### Dev overlay
Dev builds show it automatically; in any build open the page with `?perf=1` (remembered; `?perf=0` clears). `Ctrl+Alt+P` toggles it.
It shows shader/procedural layer counts, WebGL contexts, programs (compiled/failed), compile time, textures, buffers, FBOs, FPS,
CPU frame time (render callbacks only), **GPU frame time when the browser exposes `EXT_disjoint_timer_query_webgl2`** (otherwise
"n/a": it is never estimated), render size, rendered pixels, budget scale/effort, pointer events → deliveries. "Copy report" puts a
JSON snapshot on the clipboard.

## 2. "Use as single layer"
Shader tab → **Procedural** sub-panel → switch at the top (project-level, stored as optional `project.shader.singleLayer`; projects
that never used it serialise exactly as before).

When on, all **visible layers with the shader on** render as ONE procedural layer:
* every layer becomes **one colour stop** of a combined palette (its average colour, alpha-weighted, in linear light; order = painting
  order, bottom layer first);
* the procedural settings of the **top-most procedural layer** drive it (colours come from the combined palette; at least one colour
  centre per layer, up to the engine's 12; pinned anchors are released since they carried the host's own colours);
* the other layers are not rendered separately: one canvas, one shader pass instead of N.
It is a pure transform used by the preview (`resolveRenderProject`), so the stored project is never modified and switching it off
restores every layer exactly. Layers without a shader stay normal CSS layers. The switch explains why it is unavailable (shader off,
CSS backend, fewer than two shader layers, no procedural layer).

**Not covered:** the Output panel's code export still exports the layers separately (I did not touch `OutputPanel`/`export.ts`).
A merged layer's text mask / layer-mix reference come from the host layer; the layer-mix link is cleared on the merged layer.

## 3. Files
New: `src/interactive/core/gpu/*` (8 modules + `testing/fakeGl.ts`), `src/gradient/interactive/singleLayer.ts`,
`src/gradient/components/shader/SingleLayerSwitch.tsx`, and tests.
Changed: `InteractiveRenderer.ts`, `PointerManager.ts`, `gradient/interactive/types.ts` (+ optional `singleLayer`),
`InteractiveCanvas.tsx`, `LayeredArt.tsx`, `InteractivePanel.tsx`, `PreviewStage.tsx` (pointer relay only).

## 4. What was verified, and what was not
Verified here (no browser, no `npm install` possible): **63 unit tests pass** (budget allocator, program cache/sharing/failure/grace,
resource sharing, rectangle placement, frame loop & dirty-state, context loss/restore, pointer hub, single-layer merge, and the real
`InteractiveRenderer` running against a fake GPU: 5 layers → 1 context, 1 program, 1 texture, 5 draws; static layers drawn once;
settings uploads skipped when unchanged) and a strict `tsc` pass of the new/changed modules against API stubs of the files I did not
change. The tests use a small vitest shim because the repo's dependencies were not installed.

**Not verified: anything visual or any FPS/GPU number.** I have not run the app in a browser, so: (a) pixel parity with the old
renderer, (b) the `drawImage` copy path on your browsers/GPUs, (c) real speed-ups. **No performance improvement is claimed.**
Please run `npm test`, `npm run build`, then compare with the overlay (open `?perf=1`): load a project with 1, 5 and 10–15 shader
layers (mix of plain and procedural) on the old and new code and look at: contexts (N → 1), programs, compile time, FPS, CPU/GPU
frame time; then toggle "Use as single layer" and watch layers drawn/frame and GPU time. If anything looks different from before,
tell me which layer type / blend and I will fix it.
