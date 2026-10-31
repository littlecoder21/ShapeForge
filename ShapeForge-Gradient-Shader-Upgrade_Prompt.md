# ShapeForge: Interactive Gradient Shader, In-Place Quality Upgrade

## 0. Mission

Improve the existing interactive shader system in `src/gradient/interactive/` so its output reaches the quality of a reference flowing-gradient shader: domain-warped gradient noise, seam-free palette mapping, soft highlight roll-off, dithering, cursor stirring and refractive shockwaves.

**This is an upgrade, not a rewrite.**

- Keep the same files, function names, uniform names, 10 styles, 13 pointer modes, settings, exports and project JSON.
- Prefer small, surgical edits. Every new capability is additive and defaulted, so existing projects load and still look like themselves, only cleaner.
- If a change would delete or rename anything in section 3, stop and find another way.
- Do not touch the CSS/raster engine (`css.ts`, `raster.ts`, `svg.ts`, texture files), `src/shape/`, or the project data shape beyond additive optional fields. `GradientProject.version` stays `1`.

## 1. Read these files first (do not edit before reading)

- `src/gradient/interactive/shaders/gradient.frag.glsl`, `gradient.vert.glsl`
- `src/gradient/interactive/core/InteractiveRenderer.ts`
- `src/gradient/interactive/types.ts`, `adapter.ts`, `export.ts`, `presets.ts`
- `src/gradient/interactive/input/` (PointerManager; not yet inspected, keep its public API)
- `src/gradient/engine/model.ts` (`ColorStop` has `curve`, `hard`, `mid`; `GradientLayer.space` is `srgb | srgb-linear | oklab | oklch`)
- `src/gradient/engine/color.ts`, `ramp.ts`, `curve.ts` (look for colour-space and easing helpers to reuse instead of rewriting)
- The Studio panel that renders the shader controls under `src/gradient/components/` and `GradientStudio.tsx`. Follow whatever pattern it already uses.

## 2. Audit: verified problems to fix

1. **Palette seam.** Every style ends with `colorPosition = fract(...)`, and `highlight` uses `fract(colorPosition + 0.23)`. When the value wraps, the last stop jumps hard to the first, so visible seams appear.
2. **Weak noise.** `noise2` is value noise with a cubic fade, and `field()` uses 3 octaves with no per-octave rotation. That gives grid-aligned blotches and no fine filament detail.
3. **Shallow warping.** `n` and `turbulence` are two independent fields added together. There is no warp-of-a-warp, which is what gives smoke and silk its flowing structure.
4. **Time jumps.** The renderer sets `uTime = clock * speed`. Moving the Speed slider makes the whole pattern leap. Pausing or reduced motion sets `uTime = 0`, so the pattern snaps back to its start instead of freezing.
5. **Banding and flat highlights.** There is no dithering, no highlight roll-off and no vignette. Dark, smooth gradients band badly on 8-bit displays.
6. **Palette limits.** `samplePalette` is an unrolled if-chain capped at 8 stops. It ignores `ColorStop.curve`, `hard`, `mid` and the layer's colour space, and `adapter.ts` drops them. Beyond 8 stops the renderer and export just take the first 8 (`Math.min(i, length-1)` and `palette.slice(0, maxStops)`), which truncates the ramp.
7. **Aspect mismatch.** In the pointer modes, `direction` is computed in aspect-corrected space but is added to the raw `uv` `p`, so displacement is skewed on wide canvases.
8. **Ripples only brighten.** `rippleLight` mixes toward `highlight` after the colour is already chosen. There is no refraction of the gradient, and the 8 ripple branches are hand-unrolled.
9. **Mesh sampling.** `sampleMesh` uses `pow(1 - d/r, 2)` weights, so points have a visible hard edge at their radius. They are static, and they are sampled from `p`, not the warped coordinates.
10. **Hard-coded geometry.** Metaballs use 4 hard-coded centres. Geometry kinds `curve` (3) and `noise` (5) silently fall back to the linear position.
11. **Renderer waste.** `draw()` allocates new `Float32Array`s every frame (palette, alpha, mesh points, mesh colours, ripples), in both `InteractiveRenderer.ts` and the export runtime. The context uses `powerPreference: 'low-power'` even on high/ultra. There is no adaptive resolution, and `ultra` can reach a 2x pixel scale.
12. **Duplicated plumbing.** Uniform names and `draw()` logic are duplicated between `InteractiveRenderer.ts` and the `shaderRuntime()` string in `export.ts`. The React export also hand-copies the `ShaderSettings` interface. Any new uniform must be added in all of them.

## 3. Compatibility contract (do not break)

- **Shader source transforms.** Both the renderer and the export runtime convert the GLSL for WebGL2 by regex-replacing `attribute`, `varying`, `gl_FragColor` and the literal `precision highp float;`. The fragment shader must keep `varying vec2 vUv;`, `gl_FragColor` and that precision line, and stay valid GLSL ES 1.00:
  - no `in`/`out`, no `#version`, no bitwise operators or `%`
  - constant loop bounds only, using `if (float(i) >= x) break;` for variable counts
  - no `fwidth`/derivatives
  - no dynamic indexing except by loop index
- **If you add a texture sampler,** `texture2D` does not exist in GLSL ES 3.00. Add `.replace(/\btexture2D\b/g, 'texture')` to the WebGL2 transform in both `InteractiveRenderer.ts` and `export.ts`.
- **Unchanged IDs and names:** `STYLE_ID` (flow 0, aurora 1, liquid 2, holographic 3, plasma 4, silk 5, nebula 6, ribbons 7, metaballs 8, contours 9), `POINTER_MODE_ID` (0 to 12), `GEOMETRY_ID`, and all existing uniform names and `InteractiveSettings` fields with their current ranges.
- **Alpha pipeline:** `premultipliedAlpha: false`, `SRC_ALPHA / ONE_MINUS_SRC_ALPHA`, and the existing `alpha *= clamp(0.62 + glow*0.6 + rippleGlow*0.5)` overlay behaviour. New effects change `rgb` only.
- **Public APIs:** `InteractiveRenderer` constructor and methods (`update`, `setPaused`, `resetInteraction`, `destroy`, `getStatus`), `normalizeInteractiveSettings`, `normalizeShaderLayer`, `gradientLayerToShader`, `gradientProjectToShaderPalette`, `interactiveExports` (html, glsl, react).
- **Uniform budget:** keep every uniform array at 8 entries. Query `gl.MAX_FRAGMENT_UNIFORM_VECTORS` rather than growing arrays.
- **Old projects must load.** JSON saved before this upgrade (no new fields) must normalise to defaults and render without errors.
- **Defaults preserve the look.** At default settings each style must remain recognisable. Only the seam, the blotchy noise and the banding should disappear.

## 4. Upgrade work

Work in this order. After each step the app must build and the existing tests must pass (use the scripts in `package.json`).

### 4.1 Shader core (`gradient.frag.glsl`)

1. **Replace the noise internals, keep the names.** Swap `noise2`/`field` internals for gradient noise with quintic interpolation and rotated octaves (see section 5). Keep `field(vec2)`, and calibrate its output so its standard deviation matches the old `field()`. All the style constants were tuned against the old amplitude, so use a single `FIELD_GAIN` constant for that.
2. **Quality-tiered octaves.** Add `uniform float uOctaves;` (low 3, medium 4, high 5, ultra 6) and use it as a loop break inside `field`.
3. **Warp chain.** Add `warpFlow(p, t)` that returns `r`, the warp of a warp (see section 5). Feed it into the existing `n`/`turbulence` computation, scaled by the existing `uDistortion`/`uTurbulence`, so those sliders keep their meaning. Add `uniform float uWarpDepth;` (low 1, others 2) to skip the second level on weak GPUs.
4. **Remove seams.** Add `wrapT(float t)` and use it everywhere `fract(colorPosition...)` appears, including the highlight sample. Mode 0 is mirror ping-pong (default), mode 2 is legacy `fract` for users who want the old look. Add `uniform float uWrapMode;`.
5. **Finishing pass** (applied to `color.rgb` only, never alpha), as a `finish()` function called last:
   - soft tone map: `mix(c, 1.0 - exp(-c * 1.4), uToneMap)` (default 0 = unchanged)
   - vignette: `uVignette` (default 0)
   - **always-on dithering** (about +/- 0.5/255), which is the banding fix
   - optional visible film grain via `uGrain` (default 0)
6. **Sheen.** Add `uSheen` (default 0). It derives a pseudo-normal from `field` with two extra finite-difference samples (skip them when `uSheen == 0`) and adds a soft specular highlight tinted from the palette. Silk, liquid and holographic use it most.

### 4.2 Palette pipeline (the `samplePalette` entry point stays)

1. Add `src/gradient/interactive/paletteLut.ts` with `bakePaletteLut(stops, space, size = 512): Uint8Array` (RGBA). It honours stop `curve` (cubic-bezier), `hard`, `mid` (colour hint) and the layer's colour space (`oklab`/`oklch`/`srgb-linear`/`srgb`). Reuse helpers from `engine/color.ts` and `ramp.ts` where they exist.
2. Extend `ShaderStop` with optional `hard`, `mid`, `curve`, and `ShaderGeometry` with optional `space`. Update `adapter.ts` to pass them through from `ColorStop`.
3. In the renderer, upload the LUT as a 512x1 RGBA texture (`CLAMP_TO_EDGE`, `LINEAR`, no mipmaps, texture unit 0, `uniform sampler2D uPaletteLut`). In the shader, `samplePalette(t)` becomes `texture2D(uPaletteLut, vec2(clamp(t,0.,1.), 0.5))` when `uLutEnabled > 0.5`.
4. **Keep the old unrolled uniform path as a fallback.** It is used when texture creation fails or `uLutEnabled` is 0, for example when a React-export `palette` override is passed that has no baked LUT.
5. **Fix the >8 stop truncation.** With the LUT there is no stop limit. The fallback path must resample the ramp down to 8 stops instead of taking the first 8. Remove the "supports up to 8 stops" notices in `adapter.ts` and `InteractiveRenderer.paletteNotice()` once the LUT is active.
6. **Single source of truth.** The export must produce byte-identical LUTs to the app. Either bake in TypeScript at export time and embed it as base64 in `data-shader-lut`, or ship one shared plain-JS bake function used by both (see the test in section 6). Recreate the texture in `handleContextRestored`.

### 4.3 Style pass (same IDs, same branch thresholds, same `bands`/`alpha` structure)

Each style keeps its identity and gets one quality pass:

| ID | Style | Upgrade |
|---|---|---|
| 0 | flow | warp-chain driven position, mirror wrap, optional sheen |
| 1 | aurora | stretch the field vertically for curtain streaks, brighter soft edges on the bands, keep the current alpha bands |
| 2 | liquid | two-level warp plus specular sheen from the pseudo-normal |
| 3 | holographic | thin-film iridescence: shift `colorPosition` by the pseudo-normal angle, still palette-driven |
| 4 | plasma | warp the sine inputs with `r` so the pattern evolves instead of sliding, no seams |
| 5 | silk | anisotropic highlight along the ridge direction |
| 6 | nebula | two depth layers (far/near) plus ridged dust lanes (`1.0 - abs(2.0 * field)`), keep the existing alpha mask |
| 7 | ribbons | resolution-independent edge width using `1.0 / uResolution.y`, soft edge glow |
| 8 | metaballs | smooth-min field with rim light. Default to the 4 current centres, but use `uMeshPoints` when a mesh layer supplies points |
| 9 | contours | anti-aliased line width that does not change with canvas size, faint fill between lines |

Also let geometry kind 5 (`noise`) use `field()` as its base position. Curve geometry (kind 3) may stay linear. Note it in the code and do not add uniforms for it.

### 4.4 Interaction

1. **Fix the aspect mismatch.** Convert `direction` back with `direction / vec2(uAspect, 1.0)` before adding it to `p`, in every pointer mode.
2. **Stir.** Add velocity-scaled swirl around the cursor: `stir = clamp(length(uVelocity), 0.0, 1.0)` multiplies the existing influence. Do not change any mode's identity.
3. **Idle motion** (new setting, default off): when `uPointerActive` is near 0, drift a virtual pointer on a slow Lissajous path so touch devices and screenshots stay alive. Do this in the renderer/export runtime, not as a new pointer mode.
4. **Refractive ripples.** Compute ripples in one early loop (`for i < 8`, break on `uRippleCount`). Displace `p` along the wavefront, then add the glow to `rippleGlow`. `uRippleStrength` controls both. The current highlight mix stays as it is.
5. **Mesh.**
   - Replace the weight with a smooth gaussian-like falloff and normalise the blend so there is no hard edge at the radius.
   - Sample the mesh at the warped `p`.
   - Add subtle drift/breathing driven by `uTime`, with amplitude derived from `uDistortion` so it is off when distortion is 0.

### 4.5 Renderer and export runtime

1. **Integrate time.** Keep an accumulated `shaderTime += delta * speed`. `uTime = shaderTime`. When `animate === false`, keep today's behaviour of a fixed `0`. When paused or reduced motion is on, freeze at the current `shaderTime`. `uClock` stays the raw clock for ripples and pointer effects.
2. **No per-frame allocation.** Preallocate the `Float32Array`s as class fields (and as `let`s in the export runtime) and refill them only when the palette, mesh or ripples change.
3. **Context options.** Use `powerPreference: 'default'` (it only applies at context creation).
4. **Adaptive resolution governor.** Track a frame-time EMA. If it stays above about 24 ms for about 45 frames and the effective scale is above 0.5, lower the effective scale by about 15%. Never raise it automatically, reset it when settings change, and report it through the status message. Clamp the `ultra` scale so the final pixel scale never exceeds 1.75.
5. **Shared uniform list.** Move the uniform-name list into one exported constant (for example `UNIFORM_NAMES` in `interactive/uniforms.ts`). The renderer imports it, and `shaderRuntime()` interpolates the same array via `JSON.stringify`.
6. **Keep exports in sync.** Update the HTML, React and GLSL exports:
   - the runtime string (LUT texture, time integration, new uniforms, `texture2D` replace, preallocation)
   - the `ShaderSettings` interface in `interactiveReactExport`
   - the uniform comment block in `interactiveGlslExport`

### 4.6 New settings (additive, all optional, defaulted)

Add to `InteractiveSettings`, `DEFAULT_INTERACTIVE_SETTINGS`, `normalizeInteractiveSettings`, the React-export interface, and the Studio panel:

| Field | Range | Default | Notes |
|---|---|---|---|
| `toneMapping` | 0 to 1 | 0 | |
| `vignette` | 0 to 1 | 0 | |
| `sheen` | 0 to 1 | 0 | |
| `filmGrain` | 0 to 1 | 0 | Visible grain. Banding dither is always on and not a setting |
| `idleMotion` | boolean | false | |
| `paletteWrap` | `'mirror' \| 'repeat'` | `'mirror'` | `repeat` reproduces the legacy `fract` look |

Check `interactive/presets.ts` and add the new fields to a preset only where they clearly improve it, for example sheen on silk-like presets and idle motion on ambient ones. In the Studio UI, put the new controls next to the existing shader controls using the same component pattern, grouped under a "Finish" section.

## 5. Reference GLSL (ES 1.00 safe; adapt names to the existing file)

```glsl
// gradient noise, quintic fade
vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(dot(hash22(i), f),                        dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}

// keep the name and rough range of the existing field(); calibrate FIELD_GAIN against the old one
uniform float uOctaves;
const float FIELD_GAIN = 1.0;
float field(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(0.8, 0.6, -0.6, 0.8) * 2.03;   // rotate + scale each octave: no grid alignment
  for (int i = 0; i < 6; i++) {
    if (float(i) >= uOctaves) break;
    v += a * gnoise(p);
    p = m * p + vec2(7.1);
    a *= 0.5;
  }
  return v * FIELD_GAIN;
}

// warp of a warp: gives the smoke / silk structure
uniform float uWarpDepth;
vec2 warpFlow(vec2 p, float t) {
  vec2 q = vec2(field(p * 1.2 + vec2(0.0, t * 0.05)),
                field(p * 1.2 + vec2(5.2, 1.3) - t * 0.04));
  if (uWarpDepth < 1.5) return q;
  return vec2(field(p * 1.5 + 3.0 * q + vec2(1.7, 9.2) + t * 0.13),
              field(p * 1.5 + 3.0 * q + vec2(8.3, 2.8) - t * 0.11));
}
// usage: n = field(centered * uDistortionScale + (2.0 * uTurbulence) * warpFlow(centered, t));

// seam-free palette position (0 = mirror, 2 = legacy fract)
uniform float uWrapMode;
float wrapT(float t) {
  if (uWrapMode > 1.5) return fract(t);
  return 1.0 - abs(1.0 - 2.0 * fract(t * 0.5));
}

// finishing pass: rgb only
uniform float uToneMap, uVignette, uGrain;
vec3 finish(vec3 c, vec2 uv, vec2 frag) {
  c = mix(c, 1.0 - exp(-c * 1.4), uToneMap);
  vec2 d = uv - 0.5;
  c *= 1.0 - uVignette * dot(d, d) * 1.4;
  float h = fract(sin(dot(frag, vec2(12.9898, 78.233)) + uClock) * 43758.5453);
  c += (h - 0.5) * (1.0 / 200.0 + uGrain * 0.06);   // always-on dither plus optional grain
  return max(c, vec3(0.0));
}

// cursor stir: velocity-scaled swirl (aspect-correct before applying to uv)
vec2 d = (p - uPointer) * vec2(uAspect, 1.0);
float stir = clamp(length(uVelocity), 0.0, 1.0);
p += vec2(-d.y, d.x) / vec2(uAspect, 1.0) * exp(-dot(d, d) * 9.0) * (0.12 + 0.6 * stir) * uInteractionStrength;

// refractive shockwave per ripple (inside one early loop)
float age = max(0.0, uClock - uRipples[i].z);
vec2 dr = (p - uRipples[i].xy) * vec2(uAspect, 1.0);
float r = length(dr) + 1e-4;
float front = age * uRippleSpeed;
float w = exp(-pow((r - front) * 8.0, 2.0)) * exp(-age * 1.25) * uRipples[i].w;
p += dr / r / vec2(uAspect, 1.0) * w * sin((r - front) * 26.0) * 0.05 * uRippleStrength;
rippleGlow += w;
```

## 6. Tests (add to the existing test setup)

- `normalizeInteractiveSettings`: new fields default correctly, clamp out-of-range values, and an old JSON without them normalises with no errors.
- `bakePaletteLut`: hard stops give a hard edge, `mid` shifts the transition midpoint, `curve` changes the ramp, oklab differs from srgb, more than 8 stops are respected, and the output length is `size * 4`.
- **Export parity:** the LUT produced by the export path equals the app's LUT byte for byte.
- **Uniform sync:** the renderer's uniform list equals the export runtime's list.
- **Shader source guard:** the frag source still contains `varying vec2 vUv;`, `gl_FragColor` and `precision highp float;`, and does not contain `#version`, `fwidth` or `%`.
- **Adapter:** `curve`, `hard`, `mid` and `space` are passed through, and a layer with more than 8 stops keeps all of them.

## 7. Delivery

- Deliver every changed file, including import-only edits, in a **zip at its repo path**, so I can manually replace the files in the GitHub repo.
- Include a short `CHANGES.md` in the zip: files changed, new settings and defaults, and any decision you made where this prompt was silent.
- Do not add dependencies.

## 8. Acceptance checklist

- [ ] All 10 styles render with no palette seam, on 2-stop, 4-stop and 8-stop palettes.
- [ ] A project saved before this upgrade loads and looks like itself, only smoother and band-free.
- [ ] Moving the Speed slider never makes the pattern jump. Pause and reduced motion freeze it in place.
- [ ] Pointer modes behave identically in kind, with no skew on wide canvases. Ripples visibly bend the gradient and glow.
- [ ] More than 8 stops, stop `curve`/`hard`/`mid` and OKLab/OKLCH colour spaces are honoured by the shader.
- [ ] Standalone HTML export, React export and GLSL export all work and match the in-app look.
- [ ] WebGL1 fallback still compiles (audit the source by hand against the ES 1.00 rules in section 3) and context loss/restore recreates the program, buffer and LUT texture.
- [ ] `low` quality costs no more than today's shader. The adaptive governor lowers resolution under load and never raises it on its own.
- [ ] The build, type-check and all tests pass.
