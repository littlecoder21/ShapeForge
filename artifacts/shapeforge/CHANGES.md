# ShapeForge — editor upgrade

New / rewritten source files (everything else is unchanged):

    src/App.tsx                       shell, history, tabs, mobile dock
    src/geometry.ts                   node modes, exact paths, export frames + output units
    src/viewport.ts                   zoom / pan / pinch maths (viewport only, geometry never changes)
    src/edit.ts                       node + handle maths, hit-testing, snapping, transforms, corner geometry
    src/wave.ts                       wave generator (7 waveforms, auto styles)
    src/boundary.ts                   SVG/CSS parser, outer-boundary extraction, exact corner rounding
    src/settings.ts                   editor settings (saved in localStorage)
    src/components/Stage.tsx          touch canvas: pinch zoom, pan, gestures, overlays
    src/components/WavePanel.tsx      Auto + Manual wave maker
    src/components/PrecisionPanel.tsx numeric node / handle / segment / transform editing
    src/components/BoundaryPanel.tsx  Extract Outer Shape + corner radius
    src/components/ShapePanel.tsx     shape properties, export frame, units
    src/components/EditorPanel.tsx    node / touch sizes, snapping
    src/components/controls.tsx       slider, number field, segmented, switch
    src/index.css                     styles (stage, dock, panels, mobile)
    index.html                        viewport-fit=cover

No new dependencies. `dist/` was removed because it is a stale build — run your normal build.


## Round 3 — Gradient Studio (see remaining.txt for what is still open)

    src/gradient/GradientStudio.tsx        studio shell (phone dock + desktop 3-column layout)
    src/gradient/engine/                   model, css, svg, raster, ramp, geom, handles, store, effects, mesh, noise,
                                           aurora, atmosphere, presets (300), output, templates, persist, thumb
    src/gradient/components/               PreviewStage, LayersPanel, GradientPanel, StopEditor, MeshPanel, NoisePanel,
                                           ScenesPanel (Aurora / Atmosphere / Mesh), TransformPanel, EffectsPanel,
                                           AnimationPanel, PresetsPanel + PresetCard, OutputPanel, OutputSettingsForm,
                                           LayerCssPanel, CodeBlock, ProjectMenu, ApplySheet
    src/lib/shape/paint.ts, paintMarkup.ts gradient painted onto ShapeForge shapes (SVG fill/stroke, CSS background)
    src/lib/shape/compound.ts              outer path (page minus shapes) + compound path support in all exports
    src/shape/state/ canvas/ panels/       document model (not wired yet), node menu/bar (not wired yet), panels
    src/shared/                            controls.tsx, useMedia.ts
