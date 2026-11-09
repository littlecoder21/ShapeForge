/* Texture motion & shading for interaction rules.
 *
 * A rule can already lay one of the CSS textures inside its influence. These settings turn that texture from a static overlay
 * into a living material, so the same texture engine can build looks such as Starfall, Ember trail, snow, fireflies or rain:
 *   • anchor      pin the pattern to the canvas (a field that the pointer reveals) or let it travel with the pointer
 *   • scroll      the pattern drifts in any direction (falling stars, rising embers)
 *   • spin        the pattern turns around its anchor
 *   • twinkle     every cell of the pattern flickers on its own phase
 *   • flutter     the pattern sways sideways while it moves
 *   • dropout     a share of the repeats is left out at random, so the pattern stops looking tiled
 *   • depth       a second, slower copy of the pattern behind the first (parallax)
 *   • tint        pulls the pattern towards the rule colour (palette, scene, spectrum or custom)
 *   • gain        brightness multiplier, for glowing particles with additive blends
 * Every value here is a shader uniform: moving a slider never recompiles the shader. Nothing in this file touches the DOM. */

export type RigTexAnchor = 'pointer' | 'screen';

export interface RigTextureFx {
  anchor: RigTexAnchor;
  /** design px per second along `scrollAngle` */
  scrollSpeed: number;
  /** degrees: 0 = right, 90 = up, 270 = down */
  scrollAngle: number;
  /** degrees per second */
  spin: number;
  twinkle: number;
  /** Hz */
  twinkleRate: number;
  flutter: number;
  /** Hz */
  flutterRate: number;
  dropout: number;
  gain: number;
  tint: number;
  depth: number;
}

export type RigTextureFxNumberKey = Exclude<keyof RigTextureFx, 'anchor'>;

export const TEXFX_DEFAULTS: Readonly<RigTextureFx> = Object.freeze({
  anchor: 'pointer',
  scrollSpeed: 0,
  scrollAngle: 270,
  spin: 0,
  twinkle: 0,
  twinkleRate: 2,
  flutter: 0,
  flutterRate: 1,
  dropout: 0,
  gain: 1,
  tint: 0,
  depth: 0,
});

export interface TexFxControl {
  id: RigTextureFxNumberKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  /** shown only when this predicate holds (keeps the panel short) */
  when?: (fx: RigTextureFx) => boolean;
}

export const TEXFX_CONTROLS: TexFxControl[] = [
  { id: 'scrollSpeed', label: 'Drift speed', hint: 'How fast the pattern travels, in design pixels per second.', min: -600, max: 600, step: 5, def: 0, unit: 'px/s' },
  { id: 'scrollAngle', label: 'Drift direction', hint: '0° moves right, 90° up, 180° left, 270° down.', min: 0, max: 360, step: 1, def: 270, unit: '°', when: fx => fx.scrollSpeed !== 0 },
  { id: 'spin', label: 'Spin', hint: 'Turns the pattern around its anchor.', min: -180, max: 180, step: 1, def: 0, unit: '°/s' },
  { id: 'flutter', label: 'Flutter', hint: 'Sways the pattern from side to side while it moves.', min: 0, max: 1, step: 0.01, def: 0 },
  { id: 'flutterRate', label: 'Flutter rate', hint: 'How quickly the sway repeats.', min: 0.1, max: 4, step: 0.05, def: 1, unit: 'Hz', when: fx => fx.flutter > 0 },
  { id: 'twinkle', label: 'Twinkle', hint: 'Cells of the pattern fade in and out, each on its own rhythm.', min: 0, max: 1, step: 0.01, def: 0 },
  { id: 'twinkleRate', label: 'Twinkle rate', hint: 'How quickly the cells flicker.', min: 0.2, max: 8, step: 0.1, def: 2, unit: 'Hz', when: fx => fx.twinkle > 0 },
  { id: 'dropout', label: 'Random gaps', hint: 'Leaves out a share of the repeats at random so the pattern no longer looks tiled.', min: 0, max: 0.95, step: 0.01, def: 0 },
  { id: 'depth', label: 'Depth layer', hint: 'Adds a second, slower copy of the pattern behind the first.', min: 0, max: 1, step: 0.01, def: 0 },
  { id: 'tint', label: 'Colour from rule', hint: 'Blends the texture colour towards the rule colour (set under Colour).', min: 0, max: 1, step: 0.01, def: 0 },
  { id: 'gain', label: 'Glow gain', hint: 'Brightens the pattern. Combine with the Add or Screen blend for glowing particles.', min: 0, max: 4, step: 0.05, def: 1, unit: '×' },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const defaultTexFx = (): RigTextureFx => ({ ...TEXFX_DEFAULTS });

/** Repairs untrusted data: unknown keys are dropped, numbers are clamped into their ranges. */
export function normalizeTexFx(raw: unknown): RigTextureFx {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const out: RigTextureFx = defaultTexFx();
  out.anchor = value.anchor === 'screen' ? 'screen' : 'pointer';
  for (const control of TEXFX_CONTROLS) {
    const candidate = Number(value[control.id]);
    out[control.id] = Number.isFinite(candidate) ? clamp(candidate, control.min, control.max) : control.def;
  }
  return out;
}

export const isDefaultTexFx = (fx: RigTextureFx): boolean =>
  fx.anchor === TEXFX_DEFAULTS.anchor && TEXFX_CONTROLS.every(control => fx[control.id] === control.def);
