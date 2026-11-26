import {
  cloneMotion, defaultMotion, MOTION_LIMITS, newFlowSource, newModulator, newPath, normalizeMotion, parseMotion, serializeMotion,
  type FlowSource, type InteractionProfile, type MotionConfig,
} from './types';

/* Presets are written as small edits of the defaults and always pass through normalizeMotion, so a preset can never produce an
 * invalid config. Flow presets REPLACE the sources (they are scenes); motion profiles change only the character (physics, speed,
 * organic drift, turbulence, time) and keep the sources; interaction presets change only the pointer response. */

export interface Preset<T = MotionConfig> { id: string; label: string; description: string; apply: (base: MotionConfig) => T }

const make = (base: MotionConfig, edit: (draft: MotionConfig) => void): MotionConfig => {
  const draft = cloneMotion(base);
  edit(draft);
  return normalizeMotion(draft) ?? base;
};
const src = (type: FlowSource['type'], patch: Partial<FlowSource>, taken: string[]) => {
  const source = newFlowSource(type, patch, taken);
  taken.push(source.id);
  return source;
};

/* ───────────── flow presets (scenes) ───────────── */

export const FLOW_PRESETS: Preset[] = [
  { id: 'soft-drift', label: 'Soft drift', description: 'One slow, gently bending current across the whole canvas.', apply: base => make(base, d => {
    d.enabled = true; d.sources = [newFlowSource('directional', { strength: 0.35, params: [0.25, 0.25, 0.2, 0] })];
  }) },
  { id: 'silk-river', label: 'Silk river', description: 'A long curved stream with a faint turbulence on top.', apply: base => make(base, d => {
    const t: string[] = [];
    d.enabled = true; d.sources = [src('curved', { angle: 15, strength: 0.5, params: [1.6, 0.12, 0.3, 0.2] }, t), src('noise', { strength: 0.18, scale: 1.8, blend: 'add' }, t)];
    d.turbulence = { ...d.turbulence, enabled: true, kind: 'directional', strength: 0.1 };
  }) },
  { id: 'whirlpool', label: 'Whirlpool', description: 'A single central vortex that pulls the colour into a spin.', apply: base => make(base, d => {
    d.enabled = true; d.sources = [newFlowSource('vortex', { strength: 0.85, radius: 0.7, params: [0.2, -0.15, 0.4, 1] })];
  }) },
  { id: 'galaxy-spiral', label: 'Galaxy spiral', description: 'Spiral arms that slowly breathe outward.', apply: base => make(base, d => {
    d.enabled = true; d.sources = [newFlowSource('spiral', { strength: 0.7, radius: 0.95, params: [0.65, 0.06, 0.4, 1] })];
    d.composition = { ...d.composition, cycle: 12 };
  }) },
  { id: 'breathing-pulse', label: 'Breathing pulse', description: 'Radial flow that swells and relaxes like a breath.', apply: base => make(base, d => {
    d.enabled = true; d.sources = [newFlowSource('radial', { strength: 0.6, radius: 0.9, params: [0.15, 0.9, 0.08, 1] })];
  }) },
  { id: 'ocean-waves', label: 'Ocean waves', description: 'Travelling swells with a secondary ripple.', apply: base => make(base, d => {
    d.enabled = true; d.sources = [newFlowSource('wave', { angle: 20, strength: 0.5, params: [2.4, 5, 0.35, 0.2] })];
  }) },
  { id: 'smoke', label: 'Smoke', description: 'Soft vector noise with domain warp, like drifting smoke.', apply: base => make(base, d => {
    d.enabled = true; d.sources = [newFlowSource('noise', { strength: 0.5, scale: 1.4, params: [4, 0.5, 0.6, 0] })];
    d.organic = { ...d.organic, enabled: true, intensity: 0.3 };
  }) },
  { id: 'liquid-curl', label: 'Liquid curl', description: 'Divergence-free curl noise: swirling, never bunching up.', apply: base => make(base, d => {
    d.enabled = true; d.sources = [newFlowSource('curl', { strength: 0.75, scale: 1.1, params: [3, 0.55, 0.25, 0] })];
  }) },
  { id: 'magnet-field', label: 'Magnet field', description: 'Two poles that pull and orbit the colour.', apply: base => make(base, d => {
    const t: string[] = [];
    d.enabled = true; d.sources = [src('magnetic', { x: 0.3, y: 0.55, strength: 0.7, params: [0.4, 1, 0.14, 1.5] }, t), src('magnetic', { x: 0.7, y: 0.45, strength: 0.7, params: [0.4, -1, 0.14, 1.5] }, t)];
  }) },
  { id: 'orbit-path', label: 'Orbit path', description: 'Colour is carried along a closed loop.', apply: base => make(base, d => {
    const path = newPath({ name: 'Loop', closed: true, kind: 'catmull', points: [
      { x: 0.2, y: 0.5, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 0.5, y: 0.78, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 0.8, y: 0.5, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 0.5, y: 0.22, ix: 0, iy: 0, ox: 0, oy: 0 },
    ] });
    d.enabled = true; d.paths = [path]; d.sources = [newFlowSource('path', { strength: 0.75, radius: 0.5, params: [0, 0.5, 1, 0] })];
  }) },
  { id: 'cross-currents', label: 'Cross currents', description: 'Two opposing currents that meet and shear.', apply: base => make(base, d => {
    const t: string[] = [];
    d.enabled = true; d.sources = [src('directional', { angle: 20, strength: 0.4, params: [0.3, 0.1, 0, 0] }, t), src('directional', { angle: 200, strength: 0.4, x: 0.5, radius: 0.8, global: false, blend: 'screen', params: [-0.3, 0.1, 0, 0] }, t)];
  }) },
  { id: 'twin-vortices', label: 'Twin vortices', description: 'Two counter-rotating vortices.', apply: base => make(base, d => {
    const t: string[] = [];
    d.enabled = true; d.sources = [src('vortex', { x: 0.32, y: 0.5, strength: 0.8, radius: 0.55 }, t), src('vortex', { x: 0.68, y: 0.5, strength: 0.8, radius: 0.55, params: [0.18, 0, 0, -1] }, t)];
  }) },
  { id: 'aurora', label: 'Aurora', description: 'Slow waves lifted by a curl layer.', apply: base => make(base, d => {
    const t: string[] = [];
    d.enabled = true; d.sources = [src('wave', { angle: 90, strength: 0.35, params: [1.6, 0, 0.3, 0.3] }, t), src('curl', { strength: 0.35, scale: 1.6 }, t)];
    d.organic = { ...d.organic, enabled: true, intensity: 0.35, speed: 0.3 };
  }) },
  { id: 'storm', label: 'Storm', description: 'Curl noise, a vortex core and fractal turbulence.', apply: base => make(base, d => {
    const t: string[] = [];
    d.enabled = true; d.sources = [src('curl', { strength: 0.85, scale: 0.9 }, t), src('vortex', { strength: 0.9, radius: 0.6 }, t)];
    d.turbulence = { ...d.turbulence, enabled: true, kind: 'warped', strength: 0.3, speed: 1 };
    d.global = { ...d.global, speed: 1.4 };
  }) },
];

/* ───────────── motion profiles (character) ───────────── */

type Character = (d: MotionConfig) => void;
const character = (id: string, label: string, description: string, edit: Character): Preset => ({
  id, label, description, apply: base => make(base, d => { edit(d); d.profile = id; }),
});
const phys = (d: MotionConfig, patch: Partial<MotionConfig['physics']>) => { d.physics = { ...d.physics, ...patch }; };

export const MOTION_PROFILES: Preset[] = [
  character('calm', 'Calm', 'Slow and quiet. Almost no overshoot.', d => {
    d.global = { ...d.global, speed: 0.45, intensity: 0.8 }; phys(d, { model: 'smooth', damping: 2, friction: 1, inertia: 0.1 }); d.organic = { ...d.organic, enabled: true, intensity: 0.2, speed: 0.25 }; d.turbulence = { ...d.turbulence, enabled: false };
  }),
  character('smooth', 'Smooth', 'Even, eased motion with no surprises.', d => {
    d.global = { ...d.global, speed: 0.8, intensity: 1 }; phys(d, { model: 'ease-in-out', damping: 1.4, inertia: 0.15 }); d.organic = { ...d.organic, enabled: false }; d.turbulence = { ...d.turbulence, enabled: false };
  }),
  character('floating', 'Floating', 'Weightless drifting with long coasting.', d => {
    d.global = { ...d.global, speed: 0.55 }; phys(d, { model: 'inertial', mass: 2, damping: 0.5, drag: 0.1, inertia: 0.6, persistence: 2.2 }); d.organic = { ...d.organic, enabled: true, intensity: 0.35, drift: 0.6 };
  }),
  character('liquid', 'Liquid', 'Thick and syrupy; follows the pointer with lag.', d => {
    d.global = { ...d.global, speed: 0.7 }; phys(d, { model: 'viscous', damping: 2.2, friction: 1.4, drag: 1.2, inertia: 0.35 }); d.turbulence = { ...d.turbulence, enabled: true, kind: 'fractal', strength: 0.12 };
  }),
  character('fluid', 'Fluid', 'The default character: flowing and responsive.', d => {
    d.global = { ...d.global, speed: 1, intensity: 1 }; phys(d, { model: 'fluid', damping: 1, friction: 0.4, drag: 0.2, inertia: 0.2 }); d.organic = { ...d.organic, enabled: true, intensity: 0.25 };
  }),
  character('cinematic', 'Cinematic', 'Slow, heavy camera-like movement with a long ease.', d => {
    d.global = { ...d.global, speed: 0.4, intensity: 1 }; phys(d, { model: 'ease-in-out', mass: 3, damping: 1.8, inertia: 0.5, persistence: 2 }); d.composition = { ...d.composition, cycle: 16 }; d.organic = { ...d.organic, enabled: false };
  }),
  character('energetic', 'Energetic', 'Fast and lively with strong accelerations.', d => {
    d.global = { ...d.global, speed: 1.8, intensity: 1.2 }; phys(d, { model: 'spring', stiffness: 2.4, damping: 0.8, inertia: 0.1 }); d.turbulence = { ...d.turbulence, enabled: true, kind: 'animated', strength: 0.2, speed: 1.6 };
  }),
  character('elastic', 'Elastic', 'Springy overshoot that settles.', d => {
    d.global = { ...d.global, speed: 1.1 }; phys(d, { model: 'elastic', stiffness: 2, damping: 0.35, elasticity: 0.8, inertia: 0.3 });
  }),
  character('magnetic', 'Magnetic', 'Snaps toward targets and holds.', d => {
    d.global = { ...d.global, speed: 1 }; phys(d, { model: 'spring', stiffness: 3.2, damping: 1.6, drag: 0.5, inertia: 0.05 });
  }),
  character('heavy', 'Heavy', 'Massive and slow to start or stop.', d => {
    d.global = { ...d.global, speed: 0.6 }; phys(d, { model: 'momentum', mass: 5, damping: 1.2, inertia: 0.8, resistance: 1.2, persistence: 3 });
  }),
  character('organic', 'Organic', 'Alive: irregular, never exactly repeating.', d => {
    d.global = { ...d.global, speed: 0.8 }; phys(d, { model: 'fluid', damping: 0.9 }); d.organic = { ...d.organic, enabled: true, intensity: 0.6, variation: 0.8, randomness: 0.6, spatial: 0.8 };
  }),
  character('turbulent', 'Turbulent', 'Chaotic, multi-scale swirling.', d => {
    d.global = { ...d.global, speed: 1.4, intensity: 1.1 }; phys(d, { model: 'damped', damping: 0.7 }); d.turbulence = { ...d.turbulence, enabled: true, kind: 'warped', strength: 0.45, detail: 4, warp: 0.7, speed: 1.2 };
  }),
  character('cosmic', 'Cosmic', 'Slow, vast and layered.', d => {
    d.global = { ...d.global, speed: 0.35, intensity: 1 }; phys(d, { model: 'inertial', mass: 4, damping: 0.4, drag: 0.05, inertia: 0.7, persistence: 3 }); d.composition = { ...d.composition, cycle: 24 };
    d.organic = { ...d.organic, enabled: true, intensity: 0.4, scale: 0.6, speed: 0.15 }; d.turbulence = { ...d.turbulence, enabled: true, kind: 'multiscale', strength: 0.15, speed: 0.3 };
  }),
];

/* ───────────── interaction presets ───────────── */

type InteractionPatch = Partial<MotionConfig['interaction']>;
const INTERACTION_PATCH: Record<InteractionProfile, InteractionPatch> = {
  gentle: { response: 'stir', radius: 0.28, strength: 0.4, inertia: 0.5, smoothing: 0.6, drag: 1.4, persistence: 1.6, maxDisplacement: 0.18 },
  fluid: { response: 'stir', radius: 0.3, strength: 0.6, inertia: 0.4, smoothing: 0.4, drag: 1, persistence: 1.2, maxDisplacement: 0.25 },
  magnetic: { response: 'attract', radius: 0.4, strength: 0.7, inertia: 0.15, smoothing: 0.25, drag: 0.6, persistence: 0.8, maxDisplacement: 0.3, falloff: 'gauss' },
  vortex: { response: 'vortex', radius: 0.34, strength: 0.75, inertia: 0.35, smoothing: 0.35, drag: 0.8, persistence: 1.4, maxDisplacement: 0.3 },
  elastic: { response: 'warp', radius: 0.36, strength: 0.6, inertia: 0.2, smoothing: 0.2, drag: 0.4, persistence: 0.6, maxDisplacement: 0.35, frequency: 4 },
  repulsive: { response: 'repel', radius: 0.32, strength: 0.7, inertia: 0.25, smoothing: 0.3, drag: 0.8, persistence: 1, maxDisplacement: 0.3, falloff: 'smooth' },
  heavy: { response: 'displacement', radius: 0.36, strength: 0.65, inertia: 0.8, smoothing: 0.7, drag: 2.4, persistence: 2.4, maxDisplacement: 0.3 },
  liquid: { response: 'wake', radius: 0.4, strength: 0.7, inertia: 0.5, smoothing: 0.5, drag: 1.6, persistence: 1.8, maxDisplacement: 0.3, trail: true },
  energetic: { response: 'ripple', radius: 0.4, strength: 0.9, inertia: 0.1, smoothing: 0.15, drag: 0.3, persistence: 0.7, maxDisplacement: 0.4, frequency: 5, clickImpulse: true },
  custom: {},
};

export const INTERACTION_PRESETS: Preset[] = (Object.keys(INTERACTION_PATCH) as InteractionProfile[]).map(id => ({
  id, label: id[0]!.toUpperCase() + id.slice(1), description: id === 'custom' ? 'Your own values; nothing is changed.' : `${INTERACTION_PATCH[id].response ?? 'stir'} response tuned for a ${id} feel.`,
  apply: base => make(base, d => { d.interaction = { ...d.interaction, ...INTERACTION_PATCH[id], profile: id, enabled: true }; }),
}));

/** Turn off the engine's parts one by one for a clean slate that keeps nothing but the structure. */
export const resetMotion = (): MotionConfig => defaultMotion();

/** A starter that makes the engine visibly do something the moment it is switched on. */
export const starterMotion = (base: MotionConfig): MotionConfig => FLOW_PRESETS[0]!.apply({ ...base, enabled: true });

/* ───────────── user profiles (kept in this browser; exportable) ───────────── */

export interface UserProfile { id: string; name: string; config: MotionConfig }
const STORE_KEY = 'shapeforge.motion.profiles.v1';

const readStore = (): UserProfile[] => {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const out: UserProfile[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const { id, name, config } = entry as { id?: unknown; name?: unknown; config?: unknown };
      const normalized = normalizeMotion(config);
      if (typeof id === 'string' && typeof name === 'string' && normalized) out.push({ id, name: name.slice(0, 60), config: normalized });
    }
    return out.slice(0, MOTION_LIMITS.userProfiles);
  } catch { return []; }
};
const writeStore = (list: UserProfile[]) => {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MOTION_LIMITS.userProfiles))); } catch { /* storage blocked: profiles just aren't kept */ }
  return list;
};
const freshId = (list: UserProfile[]) => { let n = list.length + 1; while (list.some(p => p.id === `user-${n}`)) n++; return `user-${n}`; };

export const loadUserProfiles = readStore;
export function saveUserProfile(name: string, config: MotionConfig): UserProfile[] {
  const list = readStore();
  const clean = name.trim().slice(0, 60) || 'My profile';
  const stored = { ...cloneMotion(config), profile: clean };
  const existing = list.findIndex(p => p.name === clean);
  if (existing >= 0) list[existing] = { ...list[existing]!, config: stored };
  else if (list.length < MOTION_LIMITS.userProfiles) list.push({ id: freshId(list), name: clean, config: stored });
  return writeStore(list);
}
export const duplicateUserProfile = (id: string) => {
  const list = readStore(); const found = list.find(p => p.id === id);
  if (found && list.length < MOTION_LIMITS.userProfiles) list.push({ id: freshId(list), name: `${found.name} copy`.slice(0, 60), config: cloneMotion(found.config) });
  return writeStore(list);
};
export const renameUserProfile = (id: string, name: string) => writeStore(readStore().map(p => p.id === id ? { ...p, name: name.trim().slice(0, 60) || p.name } : p));
export const deleteUserProfile = (id: string) => writeStore(readStore().filter(p => p.id !== id));
export const exportUserProfile = (profile: UserProfile) => serializeMotion(profile.config);
/** Import one profile from JSON text. Never throws: returns the reason when the text is not a motion config. */
export function importUserProfile(text: string, name = 'Imported'): { ok: true; profiles: UserProfile[]; warnings: string[] } | { ok: false; error: string } {
  const parsed = parseMotion(text);
  if (!parsed.ok) return parsed;
  return { ok: true, profiles: saveUserProfile(name, parsed.config), warnings: parsed.warnings };
}

export { newModulator };
