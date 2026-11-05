import { instantiateRig, makeDrive, makeRig, makeRule, type InteractionRig, type RigDrive, type RigEffectId, type RigPhysics, type RigRule } from './model';

/* Predefined interactions. Every preset is just a rig, so each one can be opened in the builder and changed.
 * The first 75 reuse the ids of the previous pointer styles, which is how old projects keep their look. */

export interface RigPreset {
  id: string;
  label: string;
  group: string;
  description: string;
  build: () => InteractionRig;
}

type RuleOver = Parameters<typeof makeRule>[1];
const r = (effect: RigEffectId, over: RuleOver = {}, p: (number | undefined)[] = []): RigRule => {
  const rule = makeRule(effect, over);
  rule.p = rule.p.map((value, index) => p[index] ?? value) as RigRule['p'];
  return rule;
};
const drive = (source: RigDrive['source'], target: RigDrive['target'], over: Partial<RigDrive> = {}): RigDrive => makeDrive({ source, target, ...over });

const GROUP = {
  essentials: 'Essentials',
  colour: 'Color & spectrum',
  forces: 'Field & forces',
  waves: 'Waves & pulses',
  light: 'Light & optics',
  trails: 'Trails & texture',
  material: '3D materials',
  chaos: 'Chaos & electricity',
  builder: 'Builder showcase',
} as const;
export const RIG_PRESET_GROUPS: string[] = Object.values(GROUP);

function preset(id: string, label: string, group: string, description: string, rules: RigRule[] | (() => RigRule[]), extras: { physics?: Partial<RigPhysics>; gain?: number } = {}): RigPreset {
  return {
    id, label, group, description,
    build: () => {
      const list = typeof rules === 'function' ? rules() : rules.map(rule => ({ ...rule, p: [...rule.p] as RigRule['p'], drives: rule.drives.map(item => ({ ...item })) }));
      const rig = makeRig(label, list, { presetId: id, ...(extras.gain !== undefined ? { gain: extras.gain } : {}) });
      if (extras.physics) rig.physics = { ...rig.physics, ...extras.physics };
      return instantiateRig(rig);
    },
  };
}

/** Rules are created inside a function so every build gets independent ids and objects. */
const make = (id: string, label: string, group: string, description: string, rules: () => RigRule[], extras?: { physics?: Partial<RigPhysics>; gain?: number }) =>
  preset(id, label, group, description, rules, extras);

const E = GROUP.essentials;
const C = GROUP.colour;
const F = GROUP.forces;
const W = GROUP.waves;
const L = GROUP.light;
const T = GROUP.trails;
const M = GROUP.material;
const X = GROUP.chaos;
const B = GROUP.builder;

export const RIG_PRESETS: RigPreset[] = [
  /* ── Essentials ── */
  make('attract', 'Attract', E, 'Pulls the gradient field toward the pointer.', () => [r('attract', { amount: 1 })]),
  make('repel', 'Repel', E, 'Pushes the gradient field away from the pointer.', () => [r('attract', { amount: -1 })]),
  make('swirl', 'Swirl', E, 'Rotates nearby colour contours around the pointer.', () => [r('swirl', { amount: 1.1 }, [0.7])]),
  make('glow', 'Glow light', E, 'Adds a soft interaction-coloured light under the pointer.', () => [r('glow', { amount: 1.2, radius: 1.1 })]),
  make('drag', 'Drag field', E, 'Drags the colour field along with the pointer.', () => [r('smear', { amount: 1.4, radius: 1.2 }, [1.2])]),
  make('wave', 'Wave', E, 'Sends wavefronts outward from the pointer.', () => [r('wave', { amount: 1.1 }, [22, 4, 0.2, 1])]),
  make('orbit', 'Orbit', E, 'Combines orbiting motion with a gentle inward pull.', () => [r('swirl', { amount: 1.3 }, [0.8]), r('attract', { amount: 0.5 })]),
  make('magnet', 'Magnet', E, 'Strongly attracts the field with a rippling magnetic edge.', () => [r('attract', { amount: 1.6 }), r('wave', { amount: 0.4, radius: 1.2 }, [30, 6, 0.1, 1.2])]),
  make('ripple', 'Cursor ripple', E, 'Continuously emits a moving ring from the pointer.', () => [r('pulse', { amount: 1.1 }, [1, 1.2, 2.4, 1])]),
  make('pulse', 'Pulse', E, 'Pulses a focused ring at the pointer position.', () => [r('glow', { amount: 1.3, falloff: 'ring', radius: 1, drives: [drive('lfoSine', 'radius', { mode: 'swing', depth: 0.5, rate: 0.8 })] })]),
  make('trail', 'Motion trail', E, 'Leaves a fading streak along the pointer movement path.', () => [r('smear', { amount: 1.1, source: 'trail', radius: 0.9 }, [1])]),
  make('spotlight', 'Spotlight', E, 'Illuminates a tighter area around the pointer.', () => [r('spotlight', { amount: 0.85, radius: 1.3 }), r('light', { amount: 0.6, radius: 1 })]),
  make('hue', 'Hue shift', E, 'Shifts through the current layer palette around the pointer.', () => [r('palette', { amount: 1.2, radius: 1.4 }, [0.5, 0])]),

  /* ── Colour & spectrum ── */
  make('chromatic-flow', 'Chromatic flow', C, 'Sweeps interaction colours through a flowing field.', () => [r('palette', { amount: 1.2, radius: 1.6 }, [0.6, 0.5]), r('tint', { amount: 0.5, radius: 1.5, colorMode: 'spectrum', blend: 'screen' })]),
  make('prism-ripple', 'Prism ripple', C, 'Refracts the multicolour palette into radial ripples.', () => [r('wave', { amount: 0.8 }, [24, 3, 0.2, 1]), r('rings', { amount: 0.9, colorMode: 'spectrum', radius: 1.4 }, [30, 2, 0.14])]),
  make('spectral-orbit', 'Spectral orbit', C, 'Orbits palette colours around the pointer in a rotating halo.', () => [r('tint', { amount: 0.7, source: 'symmetry', sp1: 3, sp2: 0.7, radius: 0.7, colorMode: 'spectrum', blend: 'add' })]),
  make('chroma-wave', 'Chroma wave', C, 'Bends the colour field with a moving chromatic wave.', () => [r('wave', { amount: 1 }, [18, 3, 0.1, 0.8]), r('hue', { amount: 1, falloff: 'bands', radius: 1.5 }, [140])]),
  make('neon-pulse', 'Neon pulse', C, 'Pulses a saturated, multicolour neon ring.', () => [r('rings', { amount: 1.3, colorMode: 'spectrum', radius: 1.3 }, [24, 3, 0.1]), r('glow', { amount: 0.6, colorMode: 'spectrum' })]),
  make('color-chase', 'Color chase', C, 'Cycles interaction colours along the pointer path.', () => [r('tint', { amount: 1, source: 'trail', radius: 0.7, colorMode: 'spectrum', blend: 'add' })]),
  make('aurora-trail', 'Aurora trail', C, 'Leaves a broad, shifting aurora wake.', () => [r('tint', { amount: 0.8, source: 'trail', radius: 1.4, blend: 'screen' }), r('swirl', { amount: 0.5, source: 'trail', radius: 1.2 })], { physics: { trailLife: 1.4 } }),
  make('iridescent-sheen', 'Iridescent sheen', C, 'Shifts a spectrum sheen across the pointer field.', () => [r('thinfilm', { amount: 1, radius: 1.5 })]),
  make('spectrum-bloom', 'Spectrum bloom', C, 'Expands a soft bloom that cycles through interaction colours.', () => [r('glow', { amount: 1.2, radius: 1.6, colorMode: 'spectrum', falloff: 'gauss', drives: [drive('lfoSine', 'radius', { mode: 'swing', depth: 0.3, rate: 0.4 })] })]),
  make('rainbow-turbulence', 'Rainbow turbulence', C, 'Injects swirling spectrum turbulence into the gradient.', () => [r('noise', { amount: 1.3 }), r('hue', { amount: 0.8, radius: 1.4 }, [160])]),

  /* ── Field & forces ── */
  make('vortex-pull', 'Vortex pull', F, 'Pulls the field inward while twisting it into a vortex.', () => [r('vortex', { amount: 1.2 }, [1.4, 0.7])]),
  make('vortex-push', 'Vortex push', F, 'Pushes the field outward with a rotating vortex edge.', () => [r('vortex', { amount: 1.2 }, [1.4, -0.7])]),
  make('spiral-galaxy', 'Spiral galaxy', F, 'Bends colours into a multi-arm spiral around the pointer.', () => [r('spiral', { amount: 1.2 }, [4, 9, 1])]),
  make('whirlpool', 'Whirlpool', F, 'Swirls a deep, water-like field toward the pointer.', () => [r('vortex', { amount: 1.5, falloff: 'smooth', radius: 1.4 }, [2.2, 0.9]), r('twist', { amount: 0.6, radius: 1.2 })]),
  make('tornado', 'Tornado', F, 'Funnels the field into a narrow rotating column.', () => [r('vortex', { amount: 1.5, falloff: 'spike', radius: 1.3 }, [2.8, 0.5])]),
  make('orbital-sling', 'Orbital sling', F, 'Slings nearby colours into a fast orbital path.', () => [r('swirl', { amount: 1.6, falloff: 'ring', radius: 1.1 }, [1.2]), r('attract', { amount: 0.4 })]),
  make('gravity-well', 'Gravity well', F, 'Compresses the gradient into a soft gravitational lens.', () => [r('lens', { amount: 0.9, radius: 1.2 }), r('attract', { amount: 0.6 })]),
  make('magnetic-flux', 'Magnetic flux', F, 'Draws curved magnetic flux lines through the field.', () => [r('magnet', { amount: 1.1 }, [2])]),
  make('lens-distort', 'Lens distort', F, 'Magnifies and bends the gradient below the pointer.', () => [r('lens', { amount: 0.9 }, [1.5])]),
  make('spacetime-warp', 'Spacetime warp', F, 'Warps the field into a broad relativistic wave.', () => [r('wave', { amount: 1.3, radius: 2.4 }, [10, 2, 0.1, 0.6])]),

  /* ── Waves & pulses ── */
  make('shockwave', 'Shockwave', W, 'Sends a sharp expanding shockwave through the gradient.', () => [r('pulse', { amount: 1.6, radius: 2.4 }, [0.8, 1.4, 3, 1])]),
  make('concentric-rings', 'Concentric rings', W, 'Draws several interference rings around the pointer.', () => [r('rings', { amount: 1, radius: 1.4 }, [36, 2, 0.15]), r('wave', { amount: 0.5 }, [20, 3, 0.1, 1])]),
  make('radial-burst', 'Radial burst', W, 'Radiates a burst of colour from where you click.', () => [r('glow', { amount: 1.1, source: 'clicks', radius: 1 }), r('pulse', { amount: 1.2, source: 'clicks', radius: 2.2, sp1: 1.4 }, [1, 1.1, 2.6, 0])]),
  make('ripple-cascade', 'Ripple cascade', W, 'Stacks multiple offset ripple fronts.', () => [r('pulse', { amount: 1 }, [1, 0.8, 2.4, 1]), r('pulse', { amount: 0.8 }, [1, 1.3, 3, 1])]),
  make('sonar-ping', 'Sonar ping', W, 'Emits a bright sonar sweep with a fading echo.', () => [r('rings', { amount: 1.2, radius: 1.6 }, [14, 4, 0.08]), r('pulse', { amount: 0.6 }, [1, 0.6, 2.4, 1])]),
  make('water-drop', 'Water drop', W, 'Refracts the field like a drop falling into water.', () => [r('pulse', { amount: 1.4, source: 'clicks', radius: 2.4, sp1: 1.8 }, [1.2, 1, 2.6, 0]), r('lens', { amount: 0.4 })]),
  make('wavefront', 'Wavefront', W, 'Pushes a broad curved wavefront across the field.', () => [r('wave', { amount: 1.2, radius: 2.2 }, [8, 3, 0.4, 0.5])]),
  make('interference', 'Interference', W, 'Layers crossing wave patterns into an interference field.', () => [r('wave', { amount: 0.9 }, [26, 3, 0.1, 0.8]), r('wave', { amount: 0.9, source: 'orbit', sp1: 0.22, sp2: 0.5 }, [26, 3, 0.1, 0.8])]),
  make('heartbeat', 'Heartbeat', W, 'Pulses the colour field in a double-beat rhythm.', () => [r('pulse', { amount: 1.3 }, [1, 1.6, 2.4, 1]), r('attract', { amount: 0.5, drives: [drive('lfoSine', 'amount', { mode: 'swing', depth: 1, rate: 1.2 })] })]),
  make('pulse-grid', 'Pulse grid', W, 'Creates a responsive grid of pulsing colour cells.', () => [r('mosaic', { amount: 1, radius: 1.3 }, [18]), r('pulse', { amount: 0.5 }, [1, 1, 2.4, 1])]),

  /* ── Light & optics ── */
  make('spotlight-sweep', 'Spotlight sweep', L, 'Sweeps a narrow coloured beam along pointer motion.', () => [r('glow', { amount: 1.3, shape: 'ellipse', aspect: 3.5, follow: true, radius: 1.1 })]),
  make('laser-scan', 'Laser scan', L, 'Scans a bright line across the gradient field.', () => [r('glow', { amount: 1.6, shape: 'line', falloff: 'spike', radius: 0.5, colorMode: 'spectrum' })]),
  make('flare-burst', 'Flare burst', L, 'Adds a bright lens flare with radial streaks.', () => [r('glow', { amount: 1.4, falloff: 'spike', radius: 1.4 }), r('glow', { amount: 0.8, shape: 'star', shapeN: 8, radius: 1.2 }), r('sparkle', { amount: 1, radius: 1.6 })]),
  make('soft-focus', 'Soft focus', L, 'Softens colours into a wide, defocused light field.', () => [r('light', { amount: 0.7, radius: 2.2 }), r('saturate', { amount: -0.5, radius: 2 }, [1]), r('glow', { amount: 0.6, radius: 1.8 })]),
  make('prism-light', 'Prism light', L, 'Splits interaction light into prismatic colour bands.', () => [r('prism', { amount: 1.6, radius: 1.6 }, [1.4]), r('glow', { amount: 0.6, colorMode: 'spectrum' })]),
  make('caustic-shimmer', 'Caustic shimmer', L, 'Creates shifting caustic highlights around the pointer.', () => [r('noise', { amount: 0.7, radius: 1.3 }, [7, 1.5]), r('rings', { amount: 0.8, radius: 1.4 }, [22, 1, 0.1])]),
  make('specular-glint', 'Specular glint', L, 'Tracks a crisp specular glint across the gradient.', () => [r('bump', { amount: 1, radius: 1 }, [1.2, 40, 45, 0.2])]),
  make('shadow-well', 'Shadow well', L, 'Dips the colours into a soft, illuminated shadow.', () => [r('light', { amount: -0.7, radius: 1.4 }), r('glow', { amount: 0.5, falloff: 'ring' })]),
  make('halo', 'Halo', L, 'Builds a layered, multicolour halo around the pointer.', () => [r('glow', { amount: 1, falloff: 'ring', radius: 1.1 }), r('glow', { amount: 0.6, falloff: 'ring', radius: 1.5, colorMode: 'spectrum' })]),
  make('flashlight', 'Flashlight', L, 'Reveals a concentrated moving pool of colour.', () => [r('spotlight', { amount: 0.95, radius: 1.2 })]),

  /* ── Trails & texture ── */
  make('comet-trail', 'Comet trail', T, 'Streams a bright tail behind fast pointer movement.', () => [r('glow', { amount: 1.3, source: 'trail', radius: 0.8, falloff: 'tail' }), r('glow', { amount: 1, radius: 0.5 })]),
  make('afterimage', 'Afterimage', T, 'Leaves a soft, delayed afterimage in the field.', () => [r('tint', { amount: 0.6, source: 'trail', radius: 1.2, blend: 'screen' })], { physics: { trailLife: 1.5 } }),
  make('particle-stream', 'Particle stream', T, 'Scatters animated particles along the motion path.', () => [r('sparkle', { amount: 1.4, source: 'trail', radius: 1 }, [70, 0.25])]),
  make('ribbon-trail', 'Ribbon trail', T, 'Draws a flowing ribbon that follows pointer direction.', () => [r('swirl', { amount: 1, source: 'trail' }), r('tint', { amount: 0.6, source: 'trail', shape: 'ellipse', aspect: 2.5, follow: true, radius: 1 })]),
  make('orbiting-dots', 'Orbiting dots', T, 'Places moving colour dots along a tiny orbital field.', () => [r('glow', { amount: 1.2, source: 'symmetry', sp1: 5, sp2: 1, radius: 0.3 })]),
  make('ember-trail', 'Ember trail', T, 'Leaves a flickering, warm multicolour wake.', () => [r('glow', { amount: 1.2, source: 'trail', colorMode: 'custom', color: '#ff7a2a', radius: 0.9 }), r('sparkle', { amount: 1.1, source: 'trail', colorMode: 'custom', color: '#ffb347', radius: 1.1 }, [60, 0.22])]),
  make('starfall', 'Starfall', T, 'Scatters sharp glints through the pointer wake.', () => [r('sparkle', { amount: 1.6, source: 'trail', radius: 1.2 }, [55, 0.3])]),
  make('paint-streak', 'Paint streak', T, 'Smears the gradient like wet, flowing paint.', () => [r('smear', { amount: 1.8, source: 'trail', radius: 1.3 }, [1.3])]),
  make('velocity-smear', 'Velocity smear', T, 'Stretches the colour field in the direction of motion.', () => [r('smear', { amount: 2, radius: 1.4 }, [2])]),
  make('echo-trail', 'Echo trail', T, 'Repeats offset fading echoes behind the pointer.', () => [r('glow', { amount: 0.9, source: 'trail', falloff: 'ring', radius: 0.6 })]),

  /* ── 3D materials ── */
  make('liquid-silk', 'Iridescent liquid silk', M, 'Glossy, multicolour folds that ripple under the cursor.', () => [r('bump', { amount: 1.1, radius: 1.3 }, [1.3, 30, 45, 0.4]), r('wave', { amount: 0.7 }, [18, 2.5, 0.1, 1])]),
  make('liquid-image', 'Image-to-liquid distortion', M, 'Warps the colour field like an image submerged in liquid.', () => [r('noise', { amount: 1.6, radius: 1.6 }, [4, 1.2])]),
  make('holographic-glass', 'Holographic glass', M, 'Bends colours through a glassy lens with prismatic rims.', () => [r('lens', { amount: 0.7 }), r('prism', { amount: 1.5, radius: 1.4 }), r('thinfilm', { amount: 0.5, radius: 1.3 })]),
  make('liquid-metal', 'Liquid metal', M, 'Chrome-like reflections and sharp specular glints.', () => [r('bump', { amount: 1.4, radius: 1.2 }, [1.6, 55, 45, 0.1]), r('noise', { amount: 0.5 }), r('saturate', { amount: -0.8, radius: 1.3 }, [1.2])]),
  make('fluid-waves-3d', '3D fluid waves', M, 'Layered glossy wave crests pushed outward from the cursor.', () => [r('wave', { amount: 1.3, radius: 1.8 }, [16, 3, 0.15, 0.8]), r('bump', { amount: 0.8, radius: 1.6 }, [1, 22, 45, 0.2])]),
  make('chromatic-refraction', 'Chromatic refraction', M, 'Separates the palette into moving RGB refraction fringes.', () => [r('lens', { amount: 0.8 }), r('prism', { amount: 2, radius: 1.5 }, [1.8])]),
  make('melting-image', 'Melting image', M, 'Pulls the layer colours into gravity-driven liquid drips.', () => [r('melt', { amount: 1.5, radius: 1.6 }, [1.2, 7])]),
  make('magnetic-goo', 'Magnetic goo', M, 'Stretches glossy, merging colour masses toward the pointer.', () => [r('attract', { amount: 1.5, radius: 1.1 }), r('bump', { amount: 0.9 }, [1.4, 18, 45, 0.1])]),
  make('oil-slick', 'Oil-slick interference', M, 'Shimmering thin-film interference bands around the cursor.', () => [r('thinfilm', { amount: 1.2, radius: 1.6 }, [6, 0.8])]),
  make('displacement-texture', 'Reactive displacement texture', M, 'Embosses the colour field into reactive, specular ridges.', () => [r('bump', { amount: 1.2, radius: 1.2 }, [1.4, 40, 45, 0.2]), r('noise', { amount: 0.5 }, [12, 0])]),

  /* ── Chaos & electricity ── */
  make('tesla-coil', 'Tesla coil', X, 'Branching electric arcs and a pulsing coil.', () => [r('lightning', { amount: 1.4 }, [14, 20, 0.5]), r('glow', { amount: 0.6, colorMode: 'custom', color: '#9fd4ff' })]),
  make('lightning-bolt', 'Branching lightning', X, 'Jagged, branching bolts that crackle outward from the pointer.', () => [r('lightning', { amount: 1.8 }, [9, 26, 0.35]), r('shake', { amount: 0.4 })]),

  /* ── Builder showcase: things only the builder can do ── */
  make('click-shockwave', 'Click shockwave', B, 'Every tap fires a ring that travels outward and fades.', () => [r('pulse', { amount: 1.6, source: 'clicks', radius: 2.4, sp1: 1.6 }, [0.9, 1.2, 3, 0]), r('rings', { amount: 0.9, source: 'clicks', radius: 2.2, sp1: 1.2 }, [26, 4, 0.12])]),
  make('mandala', 'Mandala mirror', B, 'The pointer is mirrored into six rotating copies.', () => [r('swirl', { amount: 1, source: 'symmetry', sp1: 6, sp2: 0.15, radius: 0.8 }), r('glow', { amount: 0.8, source: 'symmetry', sp1: 6, sp2: 0.15, radius: 0.45, colorMode: 'spectrum' })]),
  make('pinch-twist', 'Pinch & twist', B, 'Two fingers: spread to magnify, rotate to twist the field.', () => [r('lens', { amount: 0.8, radius: 1.3, drives: [drive('pinch', 'radius', { mode: 'boost', depth: 1.2 })] }), r('twist', { amount: 1.2, radius: 1.4, drives: [drive('twist', 'amount', { mode: 'swing', depth: 1.6 })] })]),
  make('hold-charge', 'Hold to charge', B, 'Press and hold to charge a growing well, release for a burst.', () => [r('attract', { amount: 1.7, radius: 1, drives: [drive('hold', 'amount', { mode: 'scale', depth: 1, curve: 'ease' })] }), r('glow', { amount: 1.2, drives: [drive('hold', 'radius', { mode: 'boost', depth: 1.2 }), drive('hold', 'amount', { mode: 'scale', depth: 0.8 })] }), r('pulse', { amount: 1.5, source: 'clicks', radius: 2.4, sp1: 1.2 }, [1, 1.4, 3, 0])], { physics: { holdTime: 1.1 } }),
  make('spring-jelly', 'Spring jelly', B, 'A springy pointer that overshoots and wobbles.', () => [r('lens', { amount: 1, radius: 1.3 }), r('swirl', { amount: 0.8, drives: [drive('speed', 'amount', { mode: 'boost', depth: 1.5 })] })], { physics: { mode: 'spring', stiffness: 140, damping: 0.26 } }),
  make('pointer-colour-map', 'Pointer colour map', B, 'Pointer X rotates the hue, pointer Y slides the palette.', () => [r('hue', { amount: 1, radius: 4, falloff: 'plateau', drives: [drive('pointerX', 'p1', { mode: 'scale', depth: 1 })] }), r('palette', { amount: 1, radius: 4, falloff: 'plateau', drives: [drive('pointerY', 'amount', { mode: 'swing', depth: 1.4 })] }, [0.6, 0])]),
  make('ambient-orbit', 'Ambient orbit', B, 'A vortex and a glow orbit the canvas on their own.', () => [r('vortex', { amount: 0.9, source: 'orbit', sp1: 0.25, sp2: 0.5, radius: 1.4 }, [1.2, 0.4]), r('glow', { amount: 0.8, source: 'orbit', sp1: 0.25, sp2: 0.5, radius: 0.9, colorMode: 'spectrum' })]),
  make('breathing-lens', 'Breathing lens', B, 'A lens breathes in the centre; the pointer bends it further.', () => [r('lens', { amount: 0.7, source: 'fixed', sp1: 0.5, sp2: 0.5, radius: 2, drives: [drive('lfoSine', 'amount', { mode: 'swing', depth: 0.8, rate: 0.25 })] }), r('swirl', { amount: 0.9 })]),
  make('speed-heat', 'Speed heat', B, 'Fast movement heats the field: colours slide and glow.', () => [r('palette', { amount: 1.6, radius: 1.6, drives: [drive('speed', 'amount', { mode: 'scale', depth: 1 })] }, [0.7, 0.2]), r('glow', { amount: 1.3, drives: [drive('speed', 'amount', { mode: 'scale', depth: 0.9 })] })]),
  make('neon-hold-trail', 'Neon trail', B, 'A neon wake that burns brighter while you press.', () => [r('glow', { amount: 1.1, source: 'trail', colorMode: 'spectrum', radius: 0.8, drives: [drive('press', 'amount', { mode: 'boost', depth: 1.6 })] }), r('rings', { amount: 0.6, source: 'trail', colorMode: 'spectrum', radius: 0.9 }, [30, 2, 0.1])]),
  make('kaleido-lens', 'Kaleidoscope lens', B, 'Press to fold the area under the pointer into mirrored segments.', () => [r('kaleido', { amount: 1, radius: 1.6, drives: [drive('press', 'amount', { mode: 'scale', depth: 1 })] }, [8, 0.5])]),
  make('glitch-on-press', 'Glitch on press', B, 'Pressing tears the field into jumping, colour-split bands.', () => [r('glitch', { amount: 1.3, radius: 1.8, drives: [drive('press', 'amount', { mode: 'scale', depth: 1 })] }), r('prism', { amount: 1.2, radius: 1.8, drives: [drive('press', 'amount', { mode: 'scale', depth: 1 })] })]),
];

export const RIG_PRESET_MAP = Object.fromEntries(RIG_PRESETS.map(item => [item.id, item])) as Record<string, RigPreset>;
export const DEFAULT_RIG_PRESET_ID = 'swirl';

export function buildPreset(id: string): InteractionRig | null {
  const item = RIG_PRESET_MAP[id];
  return item ? item.build() : null;
}

/** Old projects stored a `pointerMode` id; every one of those ids exists as a preset above. */
export function rigFromLegacyMode(mode: string): InteractionRig {
  return buildPreset(mode) ?? (buildPreset(DEFAULT_RIG_PRESET_ID) as InteractionRig);
}

export function defaultRig(): InteractionRig {
  return buildPreset(DEFAULT_RIG_PRESET_ID) as InteractionRig;
}
