/* ═══════════════════════ Interaction rig — data model ═══════════════════════
 * An interaction is a short stack of rules. Each rule combines:
 *   • an EFFECT   what happens (pull, swirl, glow, hue shift, glass bump…)
 *   • a SOURCE    where it comes from (pointer, motion trail, click anchors, second finger, fixed / orbiting point, symmetric copies)
 *   • a SHAPE     the silhouette of its influence, plus an organic edge
 *   • a FALLOFF   how the influence fades with distance
 *   • DRIVES      what controls its numbers live (press, hold, speed, pointer X / Y, LFOs, pinch, twist …)
 * Only the structural fields (effect, shape, falloff, source, colour mode, blend, follow) change the generated shader;
 * everything else is a uniform, so sliders never trigger a recompile.
 */

export const RIG_MAX_RULES = 8;
export const RIG_MAX_DRIVES = 3;

export type RigEffectId =
  | 'attract' | 'swirl' | 'twist' | 'vortex' | 'magnet' | 'smear' | 'bend' | 'shake'
  | 'wave' | 'pulse' | 'spiral' | 'noise' | 'melt'
  | 'lens' | 'bump' | 'mosaic' | 'mirror' | 'kaleido'
  | 'palette' | 'prism' | 'timewarp' | 'hue' | 'saturate' | 'tone' | 'invert' | 'posterize' | 'tint' | 'thinfilm'
  | 'glow' | 'light' | 'spotlight' | 'sparkle' | 'lightning' | 'rings'
  | 'glitch' | 'scanlines' | 'halftone' | 'grain' | 'stripes' | 'checker' | 'crosshatch';
export type RigStage = 'warp' | 'pre' | 'post';
export type RigShapeId = 'circle' | 'ellipse' | 'box' | 'diamond' | 'line' | 'cross' | 'star' | 'poly'
  | 'capsule' | 'roundBox' | 'triangle' | 'hexagon' | 'ringShape' | 'heart' | 'clover';
export type RigFalloffId = 'gauss' | 'smooth' | 'linear' | 'plateau' | 'ring' | 'spike' | 'hard' | 'bands' | 'tail' | 'dome'
  | 'cosine' | 'exponential' | 'power' | 'bell' | 'softstep' | 'quadratic' | 'cubic' | 'quintic' | 'sine' | 'logarithmic';
export type RigSourceId = 'pointer' | 'trail' | 'clicks' | 'touch2' | 'fixed' | 'orbit' | 'symmetry';
export type RigColorMode = 'palette' | 'scene' | 'custom' | 'spectrum';
export type RigBlend = 'mix' | 'add' | 'screen' | 'multiply';
export type RigDriveSource =
  | 'always' | 'hover' | 'press' | 'hold' | 'click' | 'speed' | 'still' | 'pointerX' | 'pointerY'
  | 'lfoSine' | 'lfoTri' | 'lfoSaw' | 'lfoSquare' | 'lfoNoise' | 'pinch' | 'twist';
export type RigDriveTarget = 'amount' | 'radius' | 'p1' | 'p2' | 'p3' | 'p4';
export type RigDriveMode = 'scale' | 'boost' | 'swing';
export type RigDriveCurve = 'linear' | 'ease' | 'invert' | 'step' | 'sqrt';
export type RigEffectGroup = 'Move' | 'Waves' | 'Lens' | 'Colour' | 'Light' | 'Texture' | 'Glitch & time';

export interface RigDrive {
  source: RigDriveSource;
  target: RigDriveTarget;
  mode: RigDriveMode;
  depth: number;
  curve: RigDriveCurve;
  /** LFO frequency in Hz, or decay time in seconds for the click pulse */
  rate: number;
}

export interface RigRule {
  id: string;
  enabled: boolean;
  effect: RigEffectId;
  shape: RigShapeId;
  falloff: RigFalloffId;
  source: RigSourceId;
  colorMode: RigColorMode;
  color: string;
  blend: RigBlend;
  /** turn the shape to face the direction of pointer motion */
  follow: boolean;
  amount: number;
  /** relative to the global influence radius */
  radius: number;
  p: [number, number, number, number];
  aspect: number;
  rotation: number;
  shapeN: number;
  edge: number;
  fadePower: number;
  fadeWidth: number;
  sp1: number;
  sp2: number;
  drives: RigDrive[];
}

export interface RigPhysics {
  mode: 'smooth' | 'spring';
  stiffness: number;
  damping: number;
  pressAttack: number;
  pressRelease: number;
  holdTime: number;
  trailLife: number;
}

export interface InteractionRig {
  name: string;
  presetId: string;
  gain: number;
  physics: RigPhysics;
  rules: RigRule[];
}

/* ───────────────────────── catalogs ───────────────────────── */

export interface RigParamDef { label: string; min: number; max: number; step: number; def: number; unit?: string }
export interface RigEffectDef {
  id: RigEffectId;
  label: string;
  stage: RigStage;
  group: RigEffectGroup;
  icon: string;
  blurb: string;
  amount: { label: string; min: number; max: number; def: number };
  params: RigParamDef[];
  usesColor?: boolean;
  usesBlend?: boolean;
  /** no distance guard: the effect is meaningful away from the centre too (spotlight) */
  global?: boolean;
  defaults?: Partial<Pick<RigRule, 'falloff' | 'shape' | 'radius' | 'source'>>;
}

const par = (label: string, min: number, max: number, def: number, step = 0.05, unit?: string): RigParamDef => ({ label, min, max, def, step, ...(unit ? { unit } : {}) });
const amt = (label: string, min: number, max: number, def: number) => ({ label, min, max, def });

export const RIG_EFFECTS: RigEffectDef[] = [
  { id: 'attract', label: 'Pull / push', stage: 'warp', group: 'Move', icon: '⊙', blurb: 'Bends the field toward the centre; negative values push it away.', amount: amt('Force', -2, 2, 1), params: [] },
  { id: 'swirl', label: 'Swirl', stage: 'warp', group: 'Move', icon: '↻', blurb: 'A tangential push that grows with pointer speed.', amount: amt('Swirl', -2, 2, 1), params: [par('Motion boost', 0, 1.5, 0.6)] },
  { id: 'twist', label: 'Twist', stage: 'warp', group: 'Move', icon: '⟲', blurb: 'Rotates the area like a turned dial.', amount: amt('Twist', -2, 2, 1), params: [par('Turns', 0.2, 3, 1)], defaults: { falloff: 'smooth' } },
  { id: 'vortex', label: 'Vortex', stage: 'warp', group: 'Move', icon: '◎', blurb: 'Spins the field while sucking it in (or blowing it out).', amount: amt('Strength', -2, 2, 1), params: [par('Spin', 0, 3, 1.4), par('Suction', -1.5, 1.5, 0.5)] },
  { id: 'magnet', label: 'Magnetic field', stage: 'warp', group: 'Move', icon: '⌖', blurb: 'Bends colours along dipole field lines.', amount: amt('Strength', -2, 2, 1), params: [par('Poles', 1, 6, 2, 1)], defaults: { falloff: 'smooth', radius: 1.4 } },
  { id: 'smear', label: 'Smear', stage: 'warp', group: 'Move', icon: '⇢', blurb: 'Drags the field along with pointer velocity.', amount: amt('Drag', -2, 2, 1.2), params: [par('Length', 0.2, 3, 1)], defaults: { radius: 1.2 } },
  { id: 'bend', label: 'Directional push', stage: 'warp', group: 'Move', icon: '→', blurb: 'Pushes the field in a fixed direction.', amount: amt('Push', -2, 2, 1), params: [par('Angle', -180, 180, 0, 1, '°')] },
  { id: 'shake', label: 'Shake', stage: 'warp', group: 'Move', icon: '≈', blurb: 'Jitters the field like a handheld camera.', amount: amt('Shake', 0, 2, 1), params: [par('Size', 0, 2, 1), par('Rate', 4, 60, 24, 1, 'Hz')], defaults: { falloff: 'smooth' } },

  { id: 'wave', label: 'Waves', stage: 'warp', group: 'Waves', icon: '◠', blurb: 'Concentric waves travelling away from the centre.', amount: amt('Height', -2, 2, 1.1), params: [par('Frequency', 4, 60, 22, 1), par('Speed', -10, 10, 4, 0.25), par('Sharpness', 0, 1, 0.2), par('Damping', 0, 4, 1)], defaults: { radius: 1.5 } },
  { id: 'pulse', label: 'Pulse rings', stage: 'warp', group: 'Waves', icon: '◯', blurb: 'Rings that burst outward again and again (or once per click).', amount: amt('Push', -2, 2, 1.1), params: [par('Ring width', 0.3, 3, 1), par('Rate', 0.2, 4, 1, 0.1), par('Spread', 1, 4, 2.4), par('Repeat', 0, 1, 1, 1)], defaults: { falloff: 'plateau', radius: 2.2 } },
  { id: 'spiral', label: 'Spiral arms', stage: 'warp', group: 'Waves', icon: '✺', blurb: 'Bends the field into rotating spiral arms.', amount: amt('Strength', -2, 2, 1), params: [par('Arms', 1, 8, 3, 1), par('Tightness', 0, 20, 8, 0.5), par('Spin', -4, 4, 1)], defaults: { falloff: 'smooth', radius: 1.4 } },
  { id: 'noise', label: 'Turbulence', stage: 'warp', group: 'Waves', icon: '≋', blurb: 'Churns the field with flowing noise.', amount: amt('Churn', 0, 2, 1.2), params: [par('Scale', 1, 14, 5, 0.5), par('Speed', 0, 4, 1, 0.1)], defaults: { falloff: 'smooth', radius: 1.3 } },
  { id: 'melt', label: 'Melt drips', stage: 'warp', group: 'Waves', icon: '⍒', blurb: 'Pulls colours downward in gravity-driven drips.', amount: amt('Melt', 0, 2, 1), params: [par('Length', 0.2, 2, 1), par('Columns', 2, 20, 7, 1)], defaults: { falloff: 'smooth', radius: 1.4 } },
  { id: 'grain', label: 'Colour grain', stage: 'post', group: 'Texture', icon: '⁙', blurb: 'Adds a coloured, animated grain texture inside the influence shape.', amount: amt('Strength', 0, 1.5, 0.7), params: [par('Grain size', 8, 160, 48, 1), par('Animation', 0, 2, 0.4)], usesColor: true, usesBlend: true, defaults: { falloff: 'smooth' } },
  { id: 'stripes', label: 'Tinted stripes', stage: 'post', group: 'Texture', icon: '▤', blurb: 'Overlays adjustable diagonal stripes.', amount: amt('Strength', 0, 1.5, 0.8), params: [par('Density', 4, 120, 32, 1), par('Width', 0.05, 0.95, 0.35), par('Angle', -180, 180, 35, 1, '°')], usesColor: true, usesBlend: true, defaults: { falloff: 'smooth' } },
  { id: 'checker', label: 'Colour checker', stage: 'post', group: 'Texture', icon: '▦', blurb: 'Adds a two-tone checker texture with adjustable scale and rotation.', amount: amt('Strength', 0, 1.5, 0.7), params: [par('Cells', 2, 100, 18, 1), par('Angle', -180, 180, 0, 1, '°')], usesColor: true, usesBlend: true, defaults: { falloff: 'smooth' } },
  { id: 'crosshatch', label: 'Crosshatch', stage: 'post', group: 'Texture', icon: '▧', blurb: 'Draws a hand-printed crosshatch pattern in the selected colour.', amount: amt('Strength', 0, 1.5, 0.8), params: [par('Density', 4, 100, 28, 1), par('Line width', 0.03, 0.45, 0.12)], usesColor: true, usesBlend: true, defaults: { falloff: 'smooth' } },

  { id: 'lens', label: 'Lens', stage: 'warp', group: 'Lens', icon: '◍', blurb: 'A magnifying glass; negative values pinch.', amount: amt('Magnify', -1, 1, 0.9), params: [par('Profile', 0.3, 4, 1.5)], defaults: { falloff: 'dome', radius: 1.1 } },
  { id: 'bump', label: 'Glossy bump (3D)', stage: 'warp', group: 'Lens', icon: '◉', blurb: 'Embosses a glossy dome with specular light and colour fringes.', amount: amt('Height', -2, 2, 1.2), params: [par('Depth', 0, 2, 1), par('Shine', 2, 60, 24, 1), par('Light angle', -180, 180, 45, 1, '°'), par('Colour fringe', 0, 1, 0.3)], defaults: { falloff: 'dome', radius: 1.2 } },
  { id: 'mosaic', label: 'Pixel lens', stage: 'warp', group: 'Lens', icon: '▦', blurb: 'Snaps the field into square tiles inside the shape.', amount: amt('Amount', 0, 1, 1), params: [par('Cells', 6, 90, 28, 1)], defaults: { falloff: 'plateau' } },
  { id: 'mirror', label: 'Mirror', stage: 'warp', group: 'Lens', icon: '⫴', blurb: 'Reflects the field across a line through the centre.', amount: amt('Amount', 0, 1, 1), params: [par('Axis angle', 0, 180, 0, 1, '°')], defaults: { falloff: 'plateau', radius: 1.4 } },
  { id: 'kaleido', label: 'Kaleidoscope', stage: 'warp', group: 'Lens', icon: '✲', blurb: 'Folds space into mirrored segments.', amount: amt('Amount', 0, 1, 1), params: [par('Segments', 2, 16, 6, 1), par('Spin', -2, 2, 0.4)], defaults: { falloff: 'plateau', radius: 1.3 } },

  { id: 'palette', label: 'Palette slide', stage: 'pre', group: 'Colour', icon: '♨', blurb: 'Slides the colour ramp near the centre, like heat.', amount: amt('Amount', -2, 2, 1), params: [par('Push', -1, 1, 0.5, 0.02), par('Ripple', 0, 1, 0)], defaults: { falloff: 'smooth', radius: 1.4 } },
  { id: 'prism', label: 'Chromatic split', stage: 'pre', group: 'Colour', icon: '◭', blurb: 'Separates red and blue like light through glass.', amount: amt('Amount', -2, 2, 1), params: [par('Spread', 0, 3, 1)], defaults: { falloff: 'smooth', radius: 1.5 } },
  { id: 'hue', label: 'Hue shift', stage: 'post', group: 'Colour', icon: '◑', blurb: 'Rotates colours around the colour wheel.', amount: amt('Amount', -1.5, 1.5, 1), params: [par('Degrees', -180, 180, 100, 1, '°')], defaults: { falloff: 'smooth', radius: 1.3 } },
  { id: 'saturate', label: 'Saturation', stage: 'post', group: 'Colour', icon: '◐', blurb: 'Boosts or drains colour.', amount: amt('Amount', -1, 1, 1), params: [par('Gain', 0, 3, 1.5)], defaults: { falloff: 'smooth' } },
  { id: 'tone', label: 'Contrast & exposure', stage: 'post', group: 'Colour', icon: '◒', blurb: 'Adds contrast and lifts or dims exposure.', amount: amt('Amount', -1, 1, 1), params: [par('Contrast', -1, 2, 0.5), par('Brightness', -1, 1, 0)], defaults: { falloff: 'smooth' } },
  { id: 'invert', label: 'Negative', stage: 'post', group: 'Colour', icon: '◪', blurb: 'Flips colours into a photographic negative.', amount: amt('Amount', 0, 1, 1), params: [], defaults: { falloff: 'plateau' } },
  { id: 'posterize', label: 'Posterize', stage: 'post', group: 'Colour', icon: '▤', blurb: 'Reduces colours to flat bands.', amount: amt('Amount', 0, 1, 1), params: [par('Levels', 2, 12, 5, 1)], defaults: { falloff: 'plateau' } },
  { id: 'tint', label: 'Colour wash', stage: 'post', group: 'Colour', icon: '⬤', blurb: 'Washes a colour over the area with any blend mode.', amount: amt('Amount', 0, 1.5, 0.8), params: [], usesColor: true, usesBlend: true, defaults: { falloff: 'smooth' } },
  { id: 'thinfilm', label: 'Thin-film sheen', stage: 'post', group: 'Colour', icon: '✺', blurb: 'Oil-slick interference colours.', amount: amt('Amount', 0, 1.5, 0.8), params: [par('Bands', 1, 12, 5, 0.5), par('Drift', 0, 3, 0.5)], defaults: { falloff: 'smooth', radius: 1.3 } },

  { id: 'glow', label: 'Glow', stage: 'post', group: 'Light', icon: '☼', blurb: 'Adds a soft bloom of light.', amount: amt('Intensity', 0, 2, 1.1), params: [par('Scene tint', 0, 1, 0.2)], usesColor: true, defaults: { falloff: 'smooth', radius: 1.1 } },
  { id: 'light', label: 'Brighten', stage: 'post', group: 'Light', icon: '✦', blurb: 'Brightens or dims what is under the centre.', amount: amt('Amount', -1, 2, 1), params: [par('Gain', 0, 3, 1)], defaults: { falloff: 'smooth', radius: 1.2 } },
  { id: 'spotlight', label: 'Spotlight', stage: 'post', group: 'Light', icon: '◔', blurb: 'Darkens everything outside a pool of light.', amount: amt('Darkness', 0, 1, 0.9), params: [], global: true, defaults: { falloff: 'smooth', radius: 1.4 } },
  { id: 'sparkle', label: 'Sparkle', stage: 'post', group: 'Light', icon: '✧', blurb: 'Twinkling star glints.', amount: amt('Intensity', 0, 2, 1), params: [par('Density', 10, 120, 40, 1), par('Amount', 0, 1, 0.18)], usesColor: true, defaults: { falloff: 'smooth', radius: 1.3 } },
  { id: 'lightning', label: 'Lightning', stage: 'post', group: 'Light', icon: 'ϟ', blurb: 'Branching electric arcs.', amount: amt('Intensity', 0, 2, 1), params: [par('Branching', 3, 30, 12, 0.5), par('Flicker', 1, 40, 18, 1, 'Hz'), par('Thickness', 0, 1, 0.5)], usesColor: true, defaults: { falloff: 'smooth', radius: 1.4 } },
  { id: 'rings', label: 'Contour rings', stage: 'post', group: 'Light', icon: '◌', blurb: 'Crisp concentric lines that travel outward.', amount: amt('Intensity', 0, 2, 1), params: [par('Frequency', 6, 80, 30, 1), par('Speed', -6, 6, 2, 0.25), par('Width', 0.02, 0.5, 0.12, 0.01)], usesColor: true, usesBlend: true, defaults: { falloff: 'smooth', radius: 1.4 } },

  { id: 'glitch', label: 'Glitch', stage: 'warp', group: 'Glitch & time', icon: '▥', blurb: 'Slices the field into bands that jump sideways.', amount: amt('Amount', 0, 2, 1), params: [par('Bands', 8, 140, 44, 1), par('Rate', 1, 30, 10, 1, 'Hz')], defaults: { falloff: 'plateau' } },
  { id: 'scanlines', label: 'Scanlines', stage: 'post', group: 'Glitch & time', icon: '≡', blurb: 'CRT-style scanlines.', amount: amt('Amount', 0, 1, 1), params: [par('Lines', 100, 1200, 500, 10), par('Darkness', 0, 1, 0.6)], defaults: { falloff: 'plateau' } },
  { id: 'halftone', label: 'Halftone', stage: 'post', group: 'Glitch & time', icon: '⁙', blurb: 'Print-style dots sized by brightness.', amount: amt('Amount', 0, 1, 1), params: [par('Dots', 20, 140, 60, 1), par('Angle', 0, 90, 30, 1, '°')], defaults: { falloff: 'plateau' } },
  { id: 'timewarp', label: 'Time warp', stage: 'pre', group: 'Glitch & time', icon: '⏱', blurb: 'Shifts the animation clock locally so patterns ripple in time.', amount: amt('Amount', -2, 2, 1), params: [par('Shift', -3, 3, 1.5)], defaults: { falloff: 'smooth', radius: 1.4 } },
];

export const RIG_EFFECT_MAP = Object.fromEntries(RIG_EFFECTS.map(effect => [effect.id, effect])) as Record<RigEffectId, RigEffectDef>;
export const RIG_EFFECT_GROUPS: RigEffectGroup[] = ['Move', 'Waves', 'Lens', 'Colour', 'Light', 'Texture', 'Glitch & time'];

export const RIG_SHAPES: { id: RigShapeId; label: string; hint: string }[] = [
  { id: 'circle', label: 'Circle', hint: 'Round influence' },
  { id: 'ellipse', label: 'Ellipse', hint: 'Stretch with aspect, turn with rotation' },
  { id: 'box', label: 'Box', hint: 'Rounded-square window' },
  { id: 'diamond', label: 'Diamond', hint: 'Rotated square' },
  { id: 'line', label: 'Beam', hint: 'An infinite band through the centre' },
  { id: 'cross', label: 'Cross', hint: 'Two crossing beams' },
  { id: 'star', label: 'Star', hint: 'Lobes set by “Points”' },
  { id: 'poly', label: 'Polygon', hint: 'Regular polygon set by “Sides”' },
  { id: 'capsule', label: 'Capsule', hint: 'Rounded bar with adjustable aspect and angle' },
  { id: 'roundBox', label: 'Rounded box', hint: 'Soft-cornered square' },
  { id: 'triangle', label: 'Triangle', hint: 'Three-sided radial influence' },
  { id: 'hexagon', label: 'Hexagon', hint: 'Six-sided radial influence' },
  { id: 'ringShape', label: 'Ring', hint: 'Hollow circular band' },
  { id: 'heart', label: 'Heart', hint: 'Heart-shaped influence' },
  { id: 'clover', label: 'Clover', hint: 'Four-lobed flower influence' },
];

export const RIG_FALLOFFS: { id: RigFalloffId; label: string }[] = [
  { id: 'gauss', label: 'Gaussian' }, { id: 'smooth', label: 'Smooth' }, { id: 'linear', label: 'Linear' }, { id: 'plateau', label: 'Plateau' },
  { id: 'dome', label: 'Dome' }, { id: 'ring', label: 'Ring' }, { id: 'spike', label: 'Spike' }, { id: 'hard', label: 'Hard disc' },
  { id: 'bands', label: 'Bands' }, { id: 'tail', label: 'Long tail' },
  { id: 'cosine', label: 'Cosine' }, { id: 'exponential', label: 'Exponential' },
  { id: 'power', label: 'Power' }, { id: 'bell', label: 'Bell' }, { id: 'softstep', label: 'Soft step' },
  { id: 'quadratic', label: 'Quadratic' }, { id: 'cubic', label: 'Cubic' }, { id: 'quintic', label: 'Quintic' },
  { id: 'sine', label: 'Sine' }, { id: 'logarithmic', label: 'Logarithmic' },
];

/** The same curves as the GLSL, for the little chart on each rule card. */
export const RIG_FALLOFF_FN: Record<RigFalloffId, (q: number) => number> = {
  gauss: q => Math.exp(-q * q * 1.8),
  smooth: q => { const t = Math.min(1, Math.max(0, q)); return 1 - t * t * (3 - 2 * t); },
  linear: q => Math.max(1 - q, 0),
  plateau: q => { const t = Math.min(1, Math.max(0, (q - 0.55) / 0.45)); return 1 - t * t * (3 - 2 * t); },
  ring: q => Math.exp(-(((q - 0.62) * 3.4) ** 2)),
  spike: q => Math.max(1 / (1 + 10 * q * q) - 0.06, 0),
  hard: q => { const t = Math.min(1, Math.max(0, (q - 0.94) / 0.06)); return 1 - t * t * (3 - 2 * t); },
  bands: q => (0.5 + 0.5 * Math.cos(q * 18)) * (1 - (Math.min(1, Math.max(0, q)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, q))))),
  tail: q => Math.exp(-q * 3),
  dome: q => Math.sqrt(Math.max(1 - q * q, 0)),
  cosine: q => q <= 1 ? 0.5 + 0.5 * Math.cos(Math.PI * q) : 0,
  exponential: q => Math.exp(-q * 4.5),
  power: q => Math.max(1 - q, 0) ** 2.8,
  bell: q => Math.exp(-(((q - 0.35) * 3) ** 2)),
  softstep: q => 1 - (Math.min(1, Math.max(0, (q - 0.2) / 0.65)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (q - 0.2) / 0.65)))),
  quadratic: q => Math.max(1 - q, 0) ** 2,
  cubic: q => Math.max(1 - q, 0) ** 3,
  quintic: q => Math.max(1 - q, 0) ** 5,
  sine: q => Math.sin(Math.PI * 0.5 * Math.min(1, Math.max(0, 1 - q))),
  logarithmic: q => Math.log(1 + 8 * Math.max(1 - q, 0)) / Math.log(9),
};

export interface RigSourceDef { id: RigSourceId; label: string; hint: string; params: RigParamDef[] }
export const RIG_SOURCES: RigSourceDef[] = [
  { id: 'pointer', label: 'Pointer', hint: 'Follows the mouse, finger or pen', params: [] },
  { id: 'trail', label: 'Motion trail', hint: 'Every recent point of the pointer path', params: [] },
  { id: 'clicks', label: 'Click anchors', hint: 'Stays where you tapped and fades over its lifetime', params: [par('Lifetime', 0.2, 5, 1.6, 0.1, 's')] },
  { id: 'touch2', label: 'Second finger', hint: 'The second touch point (multi-touch)', params: [] },
  { id: 'fixed', label: 'Fixed point', hint: 'A point you place; always active, great for ambient looks', params: [par('X', 0, 1, 0.5, 0.01), par('Y', 0, 1, 0.5, 0.01)] },
  { id: 'orbit', label: 'Orbiting point', hint: 'Circles the canvas on its own', params: [par('Orbit size', 0, 0.5, 0.25, 0.01), par('Orbit speed', -4, 4, 0.6, 0.05)] },
  { id: 'symmetry', label: 'Symmetric copies', hint: 'Mirrors the pointer into radial copies around the centre', params: [par('Copies', 2, 8, 6, 1), par('Spin', -2, 2, 0, 0.05)] },
];
export const RIG_SOURCE_MAP = Object.fromEntries(RIG_SOURCES.map(source => [source.id, source])) as Record<RigSourceId, RigSourceDef>;

export const RIG_COLOR_MODES: { id: RigColorMode; label: string }[] = [
  { id: 'palette', label: 'Interaction palette' }, { id: 'scene', label: 'Scene colours' },
  { id: 'custom', label: 'Custom colour' }, { id: 'spectrum', label: 'Spectrum' },
];
export const RIG_BLENDS: { id: RigBlend; label: string }[] = [
  { id: 'mix', label: 'Mix' }, { id: 'add', label: 'Add' }, { id: 'screen', label: 'Screen' }, { id: 'multiply', label: 'Multiply' },
];

export const RIG_DRIVE_SOURCES: { id: RigDriveSource; label: string; group: 'Pointer' | 'Motion' | 'Time' | 'Touch'; rate?: string }[] = [
  { id: 'always', label: 'Always on', group: 'Pointer' },
  { id: 'hover', label: 'Pointer present', group: 'Pointer' },
  { id: 'press', label: 'Pressed', group: 'Pointer' },
  { id: 'hold', label: 'Hold charge', group: 'Pointer' },
  { id: 'click', label: 'Click pulse', group: 'Pointer', rate: 'Decay (s)' },
  { id: 'speed', label: 'Movement speed', group: 'Motion' },
  { id: 'still', label: 'Resting', group: 'Motion' },
  { id: 'pointerX', label: 'Pointer X', group: 'Motion' },
  { id: 'pointerY', label: 'Pointer Y', group: 'Motion' },
  { id: 'lfoSine', label: 'Sine wave', group: 'Time', rate: 'Rate (Hz)' },
  { id: 'lfoTri', label: 'Triangle wave', group: 'Time', rate: 'Rate (Hz)' },
  { id: 'lfoSaw', label: 'Sawtooth', group: 'Time', rate: 'Rate (Hz)' },
  { id: 'lfoSquare', label: 'Square pulse', group: 'Time', rate: 'Rate (Hz)' },
  { id: 'lfoNoise', label: 'Smooth random', group: 'Time', rate: 'Rate (Hz)' },
  { id: 'pinch', label: 'Two-finger pinch', group: 'Touch' },
  { id: 'twist', label: 'Two-finger twist', group: 'Touch' },
];
export const RIG_DRIVE_MODES: { id: RigDriveMode; label: string; hint: string }[] = [
  { id: 'scale', label: 'Scale', hint: 'The value follows the drive (0 → nothing)' },
  { id: 'boost', label: 'Boost', hint: 'The drive adds extra on top of the value' },
  { id: 'swing', label: 'Swing', hint: 'The value swings above and below its setting' },
];
export const RIG_DRIVE_CURVES: { id: RigDriveCurve; label: string }[] = [
  { id: 'linear', label: 'Linear' }, { id: 'ease', label: 'Ease' }, { id: 'sqrt', label: 'Punchy' }, { id: 'invert', label: 'Inverted' }, { id: 'step', label: 'On / off' },
];
export const RIG_DRIVE_TARGETS: RigDriveTarget[] = ['amount', 'radius', 'p1', 'p2', 'p3', 'p4'];

export const DEFAULT_RIG_PHYSICS: Readonly<RigPhysics> = Object.freeze({
  mode: 'smooth', stiffness: 170, damping: 0.55, pressAttack: 0.06, pressRelease: 0.35, holdTime: 1.2, trailLife: 0.9,
});

/* ───────────────────────── factories ───────────────────────── */

let ruleCounter = 0;
export const newRuleId = () => `rr${Date.now().toString(36).slice(-4)}${(ruleCounter++).toString(36)}${Math.random().toString(36).slice(2, 4)}`;

export function makeDrive(over: Partial<RigDrive> = {}): RigDrive {
  return { source: 'press', target: 'amount', mode: 'scale', depth: 1, curve: 'linear', rate: 0.5, ...over };
}

export function makeRule(effect: RigEffectId, over: Partial<Omit<RigRule, 'id' | 'effect'>> = {}): RigRule {
  const def = RIG_EFFECT_MAP[effect];
  const defaultParams = def.params.map(param => param.def);
  const source = over.source ?? def.defaults?.source ?? 'pointer';
  const sourceDefaults = RIG_SOURCE_MAP[source].params.map(param => param.def);
  const rule: RigRule = {
    id: newRuleId(),
    enabled: true,
    effect,
    shape: def.defaults?.shape ?? 'circle',
    falloff: def.defaults?.falloff ?? 'gauss',
    source,
    colorMode: 'palette',
    color: '#ffffff',
    blend: effect === 'glow' ? 'add' : 'mix',
    follow: false,
    amount: def.amount.def,
    radius: def.defaults?.radius ?? 1,
    p: [defaultParams[0] ?? 0, defaultParams[1] ?? 0, defaultParams[2] ?? 0, defaultParams[3] ?? 0],
    aspect: 1,
    rotation: 0,
    shapeN: 5,
    edge: 0,
    fadePower: 1,
    fadeWidth: 1,
    sp1: sourceDefaults[0] ?? 0,
    sp2: sourceDefaults[1] ?? 0,
    drives: [],
    ...over,
  };
  if (over.sp1 === undefined && over.source) rule.sp1 = sourceDefaults[0] ?? 0;
  if (over.sp2 === undefined && over.source) rule.sp2 = sourceDefaults[1] ?? 0;
  return rule;
}

export function makeRig(name: string, rules: RigRule[], over: Partial<Omit<InteractionRig, 'rules' | 'name'>> = {}): InteractionRig {
  return { name, presetId: '', gain: 1, physics: { ...DEFAULT_RIG_PHYSICS }, rules, ...over };
}

export const EMPTY_RIG: InteractionRig = makeRig('Off', []);

/* ───────────────────────── helpers ───────────────────────── */

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const num = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
};
const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : fallback;
const HEX = /^#[0-9a-f]{6}$/i;

export const activeRules = (rig: Pick<InteractionRig, 'rules'>): RigRule[] => rig.rules.filter(rule => rule.enabled).slice(0, RIG_MAX_RULES);

/** Everything that changes the generated GLSL. Slider values are deliberately absent. */
export function rigSignature(rig: Pick<InteractionRig, 'rules'>): string {
  return activeRules(rig)
    .map(rule => [rule.effect, rule.shape, rule.falloff, rule.source, RIG_EFFECT_MAP[rule.effect].usesColor ? rule.colorMode : '-', RIG_EFFECT_MAP[rule.effect].usesBlend ? rule.blend : '-', rule.follow ? 'f' : '-'].join('.'))
    .join('|');
}

export function describeRig(rig: Pick<InteractionRig, 'rules' | 'name'>): string {
  const rules = activeRules(rig);
  if (!rules.length) return 'No reaction';
  return rules.slice(0, 3).map(rule => RIG_EFFECT_MAP[rule.effect].label).join(' + ') + (rules.length > 3 ? ` +${rules.length - 3}` : '');
}

export function normalizeDrive(raw: unknown): RigDrive | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  return {
    source: pick(value.source, RIG_DRIVE_SOURCES.map(item => item.id), 'press'),
    target: pick(value.target, RIG_DRIVE_TARGETS, 'amount'),
    mode: pick(value.mode, ['scale', 'boost', 'swing'] as const, 'scale'),
    depth: num(value.depth, 0, 2, 1),
    curve: pick(value.curve, ['linear', 'ease', 'invert', 'step', 'sqrt'] as const, 'linear'),
    rate: num(value.rate, 0.05, 12, 0.5),
  };
}

export function normalizeRule(raw: unknown): RigRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const effect = typeof value.effect === 'string' && value.effect in RIG_EFFECT_MAP ? value.effect as RigEffectId : null;
  if (!effect) return null;
  const def = RIG_EFFECT_MAP[effect];
  const base = makeRule(effect);
  const rawP = Array.isArray(value.p) ? value.p : [];
  const p = [0, 1, 2, 3].map(index => {
    const param = def.params[index];
    return param ? num(rawP[index], param.min, param.max, param.def) : 0;
  }) as RigRule['p'];
  const source = pick(value.source, RIG_SOURCES.map(item => item.id), 'pointer');
  const sourceParams = RIG_SOURCE_MAP[source].params;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : base.id,
    enabled: value.enabled !== false,
    effect,
    shape: pick(value.shape, RIG_SHAPES.map(item => item.id), 'circle'),
    falloff: pick(value.falloff, RIG_FALLOFFS.map(item => item.id), base.falloff),
    source,
    colorMode: pick(value.colorMode, RIG_COLOR_MODES.map(item => item.id), 'palette'),
    color: typeof value.color === 'string' && HEX.test(value.color) ? value.color : '#ffffff',
    blend: pick(value.blend, RIG_BLENDS.map(item => item.id), base.blend),
    follow: value.follow === true,
    amount: num(value.amount, def.amount.min, def.amount.max, def.amount.def),
    radius: num(value.radius, 0.1, 4, base.radius),
    p,
    aspect: num(value.aspect, 0.2, 5, 1),
    rotation: num(value.rotation, -360, 360, 0),
    shapeN: Math.round(num(value.shapeN, 2, 12, 5)),
    edge: num(value.edge, 0, 1, 0),
    fadePower: num(value.fadePower, 0.25, 4, 1),
    fadeWidth: num(value.fadeWidth, 0.25, 2, 1),
    sp1: sourceParams[0] ? num(value.sp1, sourceParams[0].min, sourceParams[0].max, sourceParams[0].def) : 0,
    sp2: sourceParams[1] ? num(value.sp2, sourceParams[1].min, sourceParams[1].max, sourceParams[1].def) : 0,
    drives: (Array.isArray(value.drives) ? value.drives : []).map(normalizeDrive).filter((drive): drive is RigDrive => !!drive).slice(0, RIG_MAX_DRIVES),
  };
}

export function normalizePhysics(raw: unknown): RigPhysics {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    mode: value.mode === 'spring' ? 'spring' : 'smooth',
    stiffness: num(value.stiffness, 20, 900, DEFAULT_RIG_PHYSICS.stiffness),
    damping: num(value.damping, 0.05, 2, DEFAULT_RIG_PHYSICS.damping),
    pressAttack: num(value.pressAttack, 0.01, 1.5, DEFAULT_RIG_PHYSICS.pressAttack),
    pressRelease: num(value.pressRelease, 0.01, 3, DEFAULT_RIG_PHYSICS.pressRelease),
    holdTime: num(value.holdTime, 0.1, 6, DEFAULT_RIG_PHYSICS.holdTime),
    trailLife: num(value.trailLife, 0.1, 3, DEFAULT_RIG_PHYSICS.trailLife),
  };
}

/** Returns a rig from untrusted data, or `null` when `raw` is not a rig at all. */
export function normalizeRig(raw: unknown): InteractionRig | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.rules)) return null;
  const rules = value.rules.map(normalizeRule).filter((rule): rule is RigRule => !!rule).slice(0, RIG_MAX_RULES);
  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : 'Custom',
    presetId: typeof value.presetId === 'string' ? value.presetId.slice(0, 60) : '',
    gain: num(value.gain, 0, 3, 1),
    physics: normalizePhysics(value.physics),
    rules,
  };
}

export const cloneRig = (rig: InteractionRig): InteractionRig => JSON.parse(JSON.stringify(rig)) as InteractionRig;

/** Gives every rule a fresh id (presets are shared objects, projects must not alias them). */
export function instantiateRig(rig: InteractionRig): InteractionRig {
  const copy = cloneRig(rig);
  copy.rules.forEach(rule => { rule.id = newRuleId(); });
  return copy;
}
