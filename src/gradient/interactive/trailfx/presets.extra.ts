/* Trail FX v2 looks: particles, ribbons and combinations. Data only (model.ts turns each row into a full stack), so the numbers
 * below are overrides on the pass defaults. Option values are indexes into the lists in model.ts:
 *   shape  0 Circle 1 Ring 2 Square 3 Diamond 4 Triangle 5 Star 6 Spark 7 Cross 8 Hexagon 9 Heart 10 Crescent 11 Mixed 12 Glyph
 *   dir    0 Any 1 Up 2 Down 3 Left 4 Right 5 Along motion 6 Against 7 Sideways      orient 0 Random 1 Upright 2 Face motion
 *   colorBy (particles) 0 Random 1 Life 2 Speed 3 Direction 4 Position 5 Time          force 0 None 1 Attract 2 Repel 3 Swirl 4 Orbit
 *   mode   0 Paint 1 Add 2 Reveal 3 Lens                                                blend 0 Normal 1 Add
 *   ribbon style 0 Smooth 1 Neon 2 Dashed 3 Beads 4 Lightning                           ribbon colorBy 0 Length 1 Time 2 Speed 3 Solid */

export interface TrailFxExtraPresetRow {
  id: string; label: string; group: string; description: string;
  opacity?: number; blend?: string; palette?: string[];
  passes: { kind: string; p?: Record<string, number>; colors?: string[]; text?: string }[];
}

const em = (p: Record<string, number>, colors: string[], text?: string) => ({ kind: 'emitter', p, colors, ...(text ? { text } : {}) });
const rb = (p: Record<string, number>, colors: string[]) => ({ kind: 'ribbon', p, colors });

export const TRAILFX_EXTRA_PRESET_ROWS: TrailFxExtraPresetRow[] = [
  /* ───────── particles ───────── */
  { id: 'spark-trail', label: 'Spark trail', group: 'Particles', opacity: 1, description: 'Hot sparks thrown off the pointer that arc down under gravity.',
    passes: [em({ shape: 6, size: 9, sizeVar: 0.6, sizeEnd: 0, soft: 0.5, spin: 90, onMove: 30, scatter: 6, speed: 170, speedVar: 0.7, gravity: 420, drag: 1.4, inherit: 0.3, life: 1, lifeVar: 0.5, fadeOut: 0.7, colorBy: 1, bright: 1.4, core: 0.5, blend: 1 }, ['#fff4c2', '#ffb347', '#ff5e3a', '#b8184a'])] },
  { id: 'confetti-burst', label: 'Confetti burst', group: 'Particles', opacity: 1, description: 'Click or tap to pop a burst of tumbling confetti. Hold to keep it coming.',
    passes: [em({ shape: 11, size: 8, sizeVar: 0.5, sizeEnd: 1, soft: 0, spin: 420, spinVar: 1, onMove: 5, onHold: 24, onClick: 90, dir: 1, cone: 150, speed: 650, speedVar: 0.6, gravity: 900, drag: 1.6, inherit: 0.2, life: 2.6, lifeVar: 0.3, fadeOut: 0.25, colorBy: 0, maxCount: 1400 }, ['#ff4d6d', '#ffd23f', '#3bceac', '#4cc9f0', '#b388ff'])] },
  { id: 'fireflies', label: 'Fireflies', group: 'Particles', opacity: 1, description: 'Glowing motes that wander on their own and drift toward the pointer.',
    passes: [em({ shape: 0, size: 6, sizeVar: 0.5, sizeEnd: 1, soft: 1, onMove: 0, ambient: 14, speed: 18, speedVar: 0.8, drag: 1, turbulence: 190, turbScale: 0.6, inherit: 0, life: 6, lifeVar: 0.5, fadeIn: 0.3, fadeOut: 0.5, force: 1, forceStrength: 150, forceRadius: 280, colorBy: 0, bright: 1.3, core: 0.6, blend: 1, maxCount: 400, edges: 1 }, ['#fff6a8', '#c8ff5a', '#7dffb2'])] },
  { id: 'bubbles', label: 'Bubbles', group: 'Particles', opacity: 1, description: 'Soap-bubble rings rise from below and scatter away from the pointer.',
    passes: [em({ shape: 1, size: 15, sizeVar: 0.8, sizeEnd: 1.3, soft: 0.2, onMove: 6, ambient: 9, area: 2, speed: 40, gravity: -90, drag: 1, turbulence: 160, inherit: 0.1, life: 5, lifeVar: 0.4, fadeIn: 0.1, fadeOut: 0.35, force: 2, forceStrength: 500, forceRadius: 150, colorBy: 4, orient: 1, maxCount: 300 }, ['#9be7ff', '#c7f0ff', '#ffffff', '#a58bff'])] },
  { id: 'snowfall', label: 'Snowfall', group: 'Particles', opacity: 1, description: 'Ambient snow from the top edge that the pointer blows aside.',
    passes: [em({ shape: 0, size: 4, sizeVar: 0.8, sizeEnd: 1, soft: 0.6, onMove: 0, ambient: 45, area: 1, speed: 20, gravity: 55, wind: 14, drag: 1.1, turbulence: 90, inherit: 0, life: 14, lifeVar: 0.3, fadeIn: 0.05, fadeOut: 0.1, force: 2, forceStrength: 420, forceRadius: 130, colorBy: 0, edges: 3, maxCount: 800 }, ['#ffffff', '#d8ecff', '#bfe0ff'])] },
  { id: 'ink-bloom', label: 'Ink bloom', group: 'Particles', opacity: 1, description: 'Soft ink blots that bleed into each other and slowly rise.',
    passes: [em({ shape: 0, size: 22, sizeVar: 0.5, sizeEnd: 1.5, soft: 0.85, onMove: 14, speed: 20, drag: 3, inherit: 0.1, life: 1.8, fadeIn: 0.1, fadeOut: 0.7, persistence: 0.9, spread: 0.5, driftY: -25, colorBy: 5, bright: 1.1, maxCount: 500 }, ['#1b1464', '#7b2ff7', '#f107a3', '#00d2ff'])] },
  { id: 'code-rain', label: 'Code rain', group: 'Particles', opacity: 1, description: 'Falling characters that part around the pointer. Change the characters in the pass.',
    passes: [em({ shape: 12, size: 11, sizeVar: 0.3, sizeEnd: 1, soft: 0.1, orient: 1, onMove: 0, ambient: 40, area: 1, speed: 120, speedVar: 0.4, gravity: 380, drag: 0.2, inherit: 0, life: 3.5, fadeOut: 0.5, force: 2, forceStrength: 500, forceRadius: 140, colorBy: 1, glyphTint: 1, maxCount: 900 }, ['#caffd8', '#34e07a', '#0b8f3d'], '01<>/+=')] },
  { id: 'shockwave', label: 'Shockwave', group: 'Particles', opacity: 1, description: 'Click or tap for an expanding ring; moving leaves small ripples.',
    passes: [em({ shape: 1, size: 20, sizeVar: 0, sizeEnd: 4, soft: 0.25, onMove: 1.5, onClick: 1, speed: 0, inherit: 0, life: 1.1, lifeVar: 0, fadeIn: 0, fadeOut: 1, colorBy: 1, blend: 1, bright: 1.2, scatter: 0 }, ['#ffffff', '#7dd3fc', '#a78bfa'])] },
  { id: 'neon-chain', label: 'Neon chain', group: 'Particles', opacity: 1, description: 'A string of glowing beads that follows the pointer and bunches up when you stop.',
    passes: [em({ shape: 0, size: 11, sizeEnd: 0.15, soft: 0.8, onMove: 0, follow: 26, followGap: 26, colorBy: 1, blend: 1, bright: 1.3, core: 0.6, fadeOut: 0.4 }, ['#00e5ff', '#7c4dff', '#ff2bd6'])] },
  { id: 'star-dust', label: 'Star dust', group: 'Particles', opacity: 1, description: 'Twinkling five-point stars shaken loose by the pointer.',
    passes: [em({ shape: 5, size: 8, sizeVar: 0.7, sizeEnd: 0, soft: 0.15, onMove: 14, speed: 70, gravity: 120, drag: 1.2, spin: 120, life: 1.6, fadeOut: 0.6, colorBy: 1, blend: 1, core: 0.3 }, ['#fff7cc', '#ffd54a', '#ffb300', '#ff7a00'])] },
  { id: 'floating-hearts', label: 'Floating hearts', group: 'Particles', opacity: 1, description: 'Hearts that float upward from the pointer; a click sends a flurry.',
    passes: [em({ shape: 9, size: 12, sizeVar: 0.5, sizeEnd: 0.6, soft: 0.1, orient: 1, spin: 30, spinVar: 1, onMove: 8, onClick: 24, ambient: 6, area: 2, dir: 1, cone: 70, speed: 90, gravity: -50, drag: 1, turbulence: 120, life: 3.5, fadeOut: 0.5, colorBy: 0, maxCount: 600 }, ['#ff6b9a', '#ff9ec2', '#ff3d6e', '#ffd1e3'])] },
  { id: 'swirl-dust', label: 'Swirl dust', group: 'Particles', opacity: 1, description: 'Light-painting dust that spins around the pointer and leaves streaks.',
    passes: [em({ shape: 0, size: 3, sizeVar: 0.5, sizeEnd: 1, soft: 0.4, onMove: 0, ambient: 50, speed: 20, drag: 1.5, turbulence: 40, inherit: 0, life: 8, lifeVar: 0.5, fadeIn: 0.2, fadeOut: 0.3, force: 3, forceStrength: 900, forceRadius: 300, colorBy: 0, blend: 1, persistence: 0.82, maxCount: 900 }, ['#fef3c7', '#f9a8d4', '#a5b4fc'])] },
  { id: 'orbit-swarm', label: 'Orbit swarm', group: 'Particles', opacity: 1, description: 'A swarm that circles the pointer instead of chasing it.',
    passes: [em({ shape: 3, size: 5, sizeVar: 0.5, sizeEnd: 1, soft: 0.3, orient: 2, stretch: 2, onMove: 0, ambient: 34, area: 5, speed: 60, drag: 0.8, inherit: 0, life: 6, fadeIn: 0.2, fadeOut: 0.3, force: 4, forceStrength: 1400, forceRadius: 360, colorBy: 2, blend: 1, maxCount: 600 }, ['#38bdf8', '#a78bfa', '#f472b6', '#ffffff'])] },

  /* ───────── ribbons ───────── */
  { id: 'neon-comet', label: 'Neon comet', group: 'Ribbons', opacity: 1, description: 'A glowing tail that tapers behind the pointer and retracts when you stop.',
    passes: [rb({ style: 1, width: 18, taper: 1, length: 0.7, soft: 0.5, glow: 0.6, core: 0.8, smooth: 0.3, fade: 0.8, blend: 1 }, ['#00e5ff', '#7c4dff', '#ff2bd6'])] },
  { id: 'lightning-thread', label: 'Lightning thread', group: 'Ribbons', opacity: 1, description: 'A crackling, jittering bolt that trails the pointer.',
    passes: [rb({ style: 4, width: 4, taper: 0.6, length: 0.25, soft: 0.3, glow: 0.8, core: 0.9, jitter: 18, smooth: 0.2, fade: 0.5, blend: 1 }, ['#e0f2ff', '#60a5fa', '#a78bfa'])] },
  { id: 'dna-helix', label: 'DNA helix', group: 'Ribbons', opacity: 1, description: 'Three strands that weave around each other along the path.',
    passes: [rb({ style: 0, width: 6, taper: 0.9, length: 0.9, soft: 0.6, glow: 0.3, core: 0, copies: 3, copySpread: 22, wiggle: 14, wiggleFreq: 2.4, wiggleSpeed: 3, smooth: 0.3, fade: 0.7, blend: 1 }, ['#ff5ca8', '#ffd166', '#06d6a0'])] },
  { id: 'laser-dash', label: 'Laser dash', group: 'Ribbons', opacity: 1, description: 'A dashed laser line whose dashes race toward the tail.',
    passes: [rb({ style: 2, width: 7, taper: 0.3, length: 0.9, soft: 0.3, glow: 0.5, core: 0.6, dash: 22, dashGap: 12, dashSpeed: 160, smooth: 0.25, fade: 0.5, blend: 1 }, ['#ff2d55', '#ff9500'])] },
  { id: 'bead-string', label: 'Bead string', group: 'Ribbons', opacity: 1, description: 'Round beads strung along the path, coloured along their length.',
    passes: [rb({ style: 3, width: 16, taper: 0.5, length: 1.2, soft: 0.2, glow: 0.2, core: 0.2, dash: 14, dashGap: 8, dashSpeed: 0, smooth: 0.3, fade: 0.5, blend: 0 }, ['#ff4d6d', '#ffd23f', '#3bceac', '#4cc9f0', '#b388ff'])] },
  { id: 'marker', label: 'Marker (hold to draw)', group: 'Ribbons', opacity: 1, description: 'Press and drag to draw a stroke that lingers for a few seconds, then fades.',
    passes: [rb({ style: 0, width: 10, taper: 0.2, length: 3, soft: 0.15, glow: 0, core: 0, smooth: 0.55, fade: 0.1, draw: 1, blend: 0 }, ['#ffffff', '#ffd166'])] },
  { id: 'flame-tail', label: 'Flame tail', group: 'Ribbons', opacity: 1, description: 'A flickering flame that smoulders upward after the pointer.',
    passes: [rb({ style: 0, width: 28, taper: 1, length: 0.5, soft: 0.8, glow: 0.7, core: 0.3, wiggle: 10, wiggleFreq: 2, wiggleSpeed: 4, smooth: 0.3, fade: 0.6, persistence: 0.86, spread: 0.4, driftY: -90, blend: 1 }, ['#fff3b0', '#ffb000', '#ff3d00', '#7a0000'])] },

  /* ───────── combinations ───────── */
  { id: 'chrome-your-colours', label: 'Chrome, your colours', group: 'Combos', description: 'The Chrome trail passed through a colour map. Open the Colours section to choose the colours.',
    passes: [{ kind: 'base', p: { style: 1 } }, { kind: 'reveal' }, { kind: 'blur' }, { kind: 'diffuse' }, { kind: 'liquify' }, { kind: 'gradmap', colors: ['#0b0420', '#5b21b6', '#ec4899', '#fde68a'], p: { amount: 1 } }, { kind: 'rays' }] },
  { id: 'prism-sparks', label: 'Prism + sparks', group: 'Combos', description: 'Spectrum liquid trail with sparks thrown off on top.',
    passes: [{ kind: 'base', p: { style: 2 } }, { kind: 'reveal', p: { displace: 0.6 } }, { kind: 'liquify', p: { mix: 0.3 } },
      em({ shape: 6, size: 8, sizeEnd: 0, soft: 0.4, onMove: 20, speed: 140, gravity: 300, life: 0.9, colorBy: 1, blend: 1, core: 0.5 }, ['#ffffff', '#fde68a', '#fb7185'])] },
  { id: 'ripple-pond', label: 'Ripple pond', group: 'Combos', opacity: 1, description: 'An aurora surface that rings lens and bend when you click or move.',
    passes: [{ kind: 'base', p: { style: 5 } },
      em({ shape: 1, size: 18, sizeEnd: 4.5, soft: 0.5, onMove: 2, onClick: 1, speed: 0, inherit: 0, life: 1.6, lifeVar: 0, fadeIn: 0, fadeOut: 1, scatter: 0, mode: 3, lens: 1, colorBy: 1 }, ['#ffffff', '#a5f3fc'])] },
  { id: 'paint-reveal', label: 'Paint to reveal', group: 'Combos', opacity: 1, description: 'Vivid gradient hidden under a dark veil: paint with the pointer to reveal it.',
    passes: [{ kind: 'base', p: { style: 9, pattern: 0, angle: 35 }, colors: ['#ff3d81', '#ff9a3c', '#ffe14d', '#37e6b0', '#3b82f6', '#8b5cf6'] },
      em({ shape: 0, size: 70, sizeVar: 0.3, sizeEnd: 0.8, soft: 0.9, onMove: 40, speed: 10, drag: 3, inherit: 0, life: 1.6, fadeIn: 0.05, fadeOut: 0.7, persistence: 0.9, spread: 0.3, mode: 2, maxCount: 600 }, ['#ffffff', '#ffffff'])] },
];
