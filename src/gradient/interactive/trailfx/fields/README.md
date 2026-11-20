# Trail FX field generators

25 generators and 4 finish passes for the Trail FX builder. They appear in the **Add pass** menu under
*Ink fields · Fluid · Water · Growth · Shatter & burn* (and *Finish*), and as one preset each in the preset list.

## How a generator works

Every generator is two shaders that share one set of uniforms:

1. **Simulation (feedback) shader**: the pointer paints into a field that lives in a ping-pong buffer. Five engines:

| Engine | Field | The pointer… |
| --- | --- | --- |
| `ink` | one scalar that bleeds, drifts and fades | deposits ink |
| `flow` | velocity + dye, self-advecting | stirs the fluid |
| `wave` | height + velocity (a real wave equation, 4 steps/frame) | pushes the surface |
| `growth` | Gray–Scott reaction–diffusion (10 steps/frame) | plants a seed that grows on its own |
| `age` | fresh energy + a slow "scar" | marks how recently and how often a spot was touched |

2. **Render shader**: turns the field into a look and says how it meets the picture underneath
   (`gen(uv, out vec4 L, out vec2 warp)`: `L` is a premultiplied layer, `warp` bends the picture below).
   Glow, contrast, saturation, grain, vignette, colour split and opacity are applied for every generator by `compose()`.

Shared controls (all generators): **Pointer** (brush width, strength, speed gain, press-to-flood, burst on click, smoothing,
ambient wander), **Memory / Fluid / Water / Growth** (per engine), **Colour** (hard or smooth palette, shift, cycling, brightness),
**Finish**, **Render**. Each generator adds its own **Look** controls.

## Adding a 26th generator

Add one `defineField({...})` to `gens.*.ts`: its id, engine, extra look params, default colours, the `gen()` GLSL and a preset.
Nothing else needs touching: the uniform list is generated from the parameter list, the kind is added to the catalogue in
`model.ts`, the sources are merged in `shaders.generated.ts`, and the preset is created from `spec.preset`.

Rules worth knowing:
- parameter keys become uniforms `u<Key>`; avoid `tint` (reserved: the runtime sets `uTint` as a colour), `time`, `speed`, `down`, `click`
- wave state is stored as separate +/− channels, flow state as `0.5 + v/8`; unwritten texels are read as "nothing yet" (see `EMPTY` in `chunks.ts`)
- exports only embed the shader kinds an effect actually uses (`libraryFor` in `exportStandalone.ts`)
