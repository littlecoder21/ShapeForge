import type { TrailFxColorDef, TrailFxParamDef } from '../model';

/* Field generators: 25 pass kinds that share one design.
 *   • a simulation engine keeps a field in a feedback buffer that the pointer paints into
 *       ink     – a scalar that is deposited, bleeds, drifts and fades
 *       flow    – a velocity field with dye (the pointer stirs it, it advects itself)
 *       wave    – a real wave equation (height + velocity): the pointer pushes the surface
 *       growth  – Gray–Scott reaction–diffusion: the pointer seeds a pattern that grows on its own
 *       age     – "energy" (fast fade) plus "scar" (slow fade): how recently and how often a spot was touched
 *   • a render shader turns that field into a look (aurora, oil slick, caustics, shattered glass…).
 * Every number is a uniform; the uniform list is generated from the parameter list, so the controls and the GLSL cannot drift apart. */

export type FieldEngine = 'ink' | 'flow' | 'wave' | 'growth' | 'age';
export type Over = Record<string, number>;

export interface FieldPreset {
  label: string;
  description: string;
  p?: Over;
  colors?: string[];
  opacity?: number;
  blend?: string;
  /** passes added after the generator (usually a finish pass) */
  after?: { kind: string; p?: Over; colors?: string[] }[];
}
export interface FieldSpec {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  family: string;
  engine: FieldEngine;
  params: TrailFxParamDef[];
  colors: TrailFxColorDef;
  /** GLSL: helpers + `void gen(vec2 uv, out vec4 L, out vec2 warp)` (L is premultiplied; warp offsets the picture underneath) */
  gen: string;
  preset: FieldPreset;
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const p = (key: string, label: string, min: number, max: number, def: number, step = 0.01, unit?: string, extra: Partial<TrailFxParamDef> = {}): TrailFxParamDef =>
  ({ key, label, min, max, def, step, ...(unit ? { unit } : {}), ...extra });
export const opt = (key: string, label: string, options: string[], def = 0, extra: Partial<TrailFxParamDef> = {}): TrailFxParamDef =>
  ({ key, label, min: 0, max: options.length - 1, step: 1, def, options, ...extra });
export const g = (group: string, defs: TrailFxParamDef[]): TrailFxParamDef[] => defs.map(def => ({ ...def, group }));
const d = (o: Over, key: string, def: number) => o[key] ?? def;

/* ───────────── shared control groups ───────────── */

export const pointerGroup = (o: Over = {}) => g('Pointer', [
  p('width', 'Brush width', 0.01, 0.4, d(o, 'width', 0.09), 0.005, undefined, { hint: 'How wide an area the pointer touches, as a fraction of the screen height.' }),
  p('strength', 'Strength', 0, 4, d(o, 'strength', 1)),
  p('speedGain', 'Faster pointer, stronger', 0, 3, d(o, 'speedGain', 0.6)),
  p('hold', 'Press to flood', 0, 4, d(o, 'hold', 0), 0.05, undefined, { hint: 'Keeps pouring into the field while the pointer is pressed, even when it is held still.' }),
  p('burst', 'Burst on click / tap', 0, 3, d(o, 'burst', 0)),
  p('momentum', 'Pointer smoothing', 0, 1.5, d(o, 'momentum', 0.3)),
  p('ambient', 'Ambient wander', 0, 1, d(o, 'ambient', 0), 0.01, undefined, { hint: 'Sends an invisible pointer wandering by itself so the effect is alive even when nobody is touching it.' }),
  p('ambientSpeed', 'Wander speed', 0.1, 3, d(o, 'ambientSpeed', 1), 0.05),
]);

export const memoryGroup = (engine: FieldEngine, o: Over = {}): TrailFxParamDef[] => {
  if (engine === 'ink' || engine === 'age') {
    return g('Memory', [
      p('decay', engine === 'age' ? 'Fade of fresh touches' : 'Persistence', 0.5, 0.998, d(o, 'decay', 0.95), 0.001),
      ...(engine === 'age' ? [p('scar', 'Scar permanence', 0, 1, d(o, 'scar', 0.7), 0.01, undefined, { hint: 'How long the mark of an earlier touch stays. 1 keeps it for good.' })] : []),
      p('spread', 'Bleed / diffusion', 0, 1, d(o, 'spread', 0.3)),
      p('driftX', 'Drift X', -0.5, 0.5, d(o, 'driftX', 0), 0.01, 'screen/s'),
      p('driftY', 'Drift Y', -0.5, 0.5, d(o, 'driftY', 0), 0.01, 'screen/s'),
      p('turb', 'Turbulence', 0, 3, d(o, 'turb', 0)),
      p('turbScale', 'Turbulence scale', 0.2, 4, d(o, 'turbScale', 1), 0.05),
    ]);
  }
  if (engine === 'flow') {
    return g('Fluid', [
      p('push', 'Stir strength', 0, 4, d(o, 'push', 1)),
      p('swirl', 'Swirl', -2, 2, d(o, 'swirl', 0), 0.05, undefined, { hint: 'Adds spin to whatever the pointer pushes. Negative spins the other way.' }),
      p('advect', 'Self-advection', 0, 3, d(o, 'advect', 1), 0.05),
      p('viscosity', 'Viscosity', 0, 1, d(o, 'viscosity', 0.2)),
      p('decay', 'Velocity persistence', 0.9, 1, d(o, 'decay', 0.985), 0.001),
      p('dyeDecay', 'Dye persistence', 0.8, 1, d(o, 'dyeDecay', 0.97), 0.001),
    ]);
  }
  if (engine === 'wave') {
    return g('Water', [
      p('push', 'Push strength', 0, 4, d(o, 'push', 1)),
      p('waveSpeed', 'Wave speed', 0.05, 0.45, d(o, 'waveSpeed', 0.4), 0.01),
      p('damping', 'Damping', 0.9, 1, d(o, 'damping', 0.98), 0.001, undefined, { hint: 'Closer to 1 keeps the ripples travelling for longer.' }),
    ]);
  }
  return g('Growth', [
    p('seed', 'Seeding strength', 0, 4, d(o, 'seed', 1)),
    p('feed', 'Feed rate', 0.01, 0.08, d(o, 'feed', 0.055), 0.001),
    p('kill', 'Kill rate', 0.04, 0.075, d(o, 'kill', 0.062), 0.0005),
    p('diffB', 'Spread of the pattern', 0.2, 0.8, d(o, 'diffB', 0.5), 0.01),
    p('rate', 'Growth speed', 0.3, 1.4, d(o, 'rate', 1), 0.05),
  ]);
};

export const colourGroup = (o: Over = {}) => g('Colour', [
  opt('stepped', 'Palette', ['Smooth blend', 'Hard steps'], d(o, 'stepped', 0)),
  p('shift', 'Palette shift', -1, 1, d(o, 'shift', 0)),
  p('cycle', 'Palette cycling', -2, 2, d(o, 'cycle', 0), 0.05),
  p('bright', 'Brightness', 0.2, 3, d(o, 'bright', 1)),
]);

export const finishGroup = (o: Over = {}) => g('Finish', [
  p('glow', 'Highlight glow', 0, 2, d(o, 'glow', 0)),
  p('contrast', 'Contrast', 0.5, 2, d(o, 'contrast', 1)),
  p('saturation', 'Saturation', 0, 2, d(o, 'saturation', 1)),
  p('grain', 'Film grain', 0, 1, d(o, 'grain', 0)),
  p('vignette', 'Vignette', 0, 1, d(o, 'vignette', 0)),
]);

export const renderGroup = (o: Over = {}) => g('Render', [
  opt('mode', 'Meets the picture', ['Paint over picture', 'Add to picture', 'Tint the picture'], d(o, 'mode', 0), { hint: 'Tint needs a Base image pass before this one.' }),
  p('opacity', 'Pass opacity', 0, 1, d(o, 'opacity', 1)),
  p('split', 'Colour split on distortion', 0, 1, d(o, 'split', 0), 0.01, undefined, { hint: 'Fringes red and blue apart wherever the picture is bent.' }),
]);

/* ───────────── assembling a spec ───────────── */

export interface FieldDef {
  id: string; label: string; icon: string; blurb: string; family: string; engine: FieldEngine;
  /** look controls: the shared scale / gain / animation speed (with their defaults) plus this generator's own */
  look: { scale?: number; gain?: number; anim?: number; extra: TrailFxParamDef[] };
  ptr?: Over; mem?: Over; col?: Over; fin?: Over; ren?: Over;
  colors: string[];
  gen: string;
  preset: FieldPreset;
}

export function defineField(def: FieldDef): FieldSpec {
  const look = g('Look', [
    p('scale', 'Pattern scale', 0.2, 6, def.look.scale ?? 1),
    p('gain', 'Field gain', 0.2, 6, def.look.gain ?? 1.5, 0.05, undefined, { hint: 'How strongly what the pointer painted drives the look.' }),
    p('anim', 'Animation speed', 0, 4, def.look.anim ?? 1, 0.05),
    ...def.look.extra,
  ]);
  return {
    id: def.id, label: def.label, icon: def.icon, blurb: def.blurb, family: def.family, engine: def.engine,
    params: [...look, ...pointerGroup(def.ptr), ...memoryGroup(def.engine, def.mem), ...colourGroup(def.col), ...finishGroup(def.fin), ...renderGroup(def.ren)],
    colors: { label: 'Colours', defaults: def.colors, min: 2, max: 8 },
    gen: def.gen,
    preset: def.preset,
  };
}
