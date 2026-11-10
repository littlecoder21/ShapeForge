# Procedural mesh capabilities

The procedural renderer extends the existing shared fragment shader with one shader pass. It does not create its own WebGL
context. Mesh layers can continue using their CSS-compatible renderer; `mesh.source: "layer"` reads the live mesh points.
Configurations remain JSON and use `version: 1`; unknown or invalid values are repaired by `normalizeProcedural`.

## Unified-field interpolation

`field.method` accepts:

| Value | Behavior |
| --- | --- |
| `idw` | Inverse-distance weights; `field.exponent` controls the distance power. |
| `gaussian` | Exponential squared-distance kernel; `field.falloff` controls width. |
| `smooth` | Finite smoothstep support with a tunable falloff exponent. |
| `radial` | Finite linear radial support shaped by `field.exponent`. |
| `smin` | Smooth-min distance union (metaball-like coverage), with soft color selection near the nearest surface. |
| `soft` | A wider Gaussian distance kernel than `gaussian`. |
| `inverse-multiquadric` | Positive radial kernel `1 / sqrt(1 + (epsilon * distance)^2)`; epsilon increases with falloff. |
| `wendland-c2` | Compact-support Wendland C2 kernel `(1-r)^4(4r+1)` for `r < 1`, zero outside. |

The inverse-multiquadric and Wendland options are radial weighting kernels in the existing normalized color blend. They are
not global RBF systems: there is no per-pixel matrix solve and no claim of exact interpolation through every point.

All kernels use the existing per-point position, radius and weight plus the field radius, strength, falloff, exponent and
overlap controls. The CSS-compatible mesh mode continues to match the browser's existing mesh compositing instead of using
these unified-field kernels.

## Other implemented controls

- Color-space encoding: sRGB, linear RGB and OKLab; hue, saturation, exposure, contrast and temperature grade the output.
- Palette cycling animates generated and pinned mesh colors through the layer palette or custom stops at an independent speed.
- Point placement: seeded random, grid, circular, organic and clustered distributions, with deterministic seeded motion.
- Motion: static, orbit, circle, figure-eight, sine, drift, noise, flow, wander and pointer-follow.
- Distortion: up to three ordered stages including FBM, domain/multi-warp, turbulence, curl, polar/radial, wave, flow, rotate
  and scale. Stage types are compiled only when present; their values are uniforms.
- Pointer forces: attract, repel, swirl, vortex, push, pull, ripple, wave and fluid response.
- Mesh rendering: unified field or CSS-compatible background/layered compositing, with snapshot or live-layer point source.
- Full unified procedural meshes export as one WebGL field; the original layered CSS remains the fallback if WebGL is unavailable.
- Presets: built-in and user presets are normalized to the same supported configuration.

## Not currently implemented

Multi-field composition, per-point custom influence shapes, OKLCH/hue-aware palette interpolation, extra distortion targets,
independent multi-pointer zones, material/lighting passes and layer masks are not exposed as supported capabilities. A config
must not use these as if they affected rendering.
