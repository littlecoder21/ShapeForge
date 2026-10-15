import { hslToHex } from './color';
import { newEffect } from './effects';
import { newLayer, stop, type GradientLayer } from './model';
import { mulberry } from './rng';

/* ═══════════ Aurora builder ═══════════
 * Aurora is NOT a hard-coded look: this function only *assembles ordinary layers* (radial curtains, linear ribbons,
 * a horizon glow and a night-sky base) with blur, blend modes, drift animation and optional distortion.
 * Every layer it returns is a normal, fully editable gradient layer.
 */

export interface AuroraOptions {
  palette: string[];          // 2–4 colours
  sky: string;                // night-sky base colour
  curtains: number;           // 1–7 tall radial curtains
  ribbons: number;            // 0–3 diagonal linear ribbons
  glow: boolean;              // horizon glow
  stars: boolean;             // faint repeating star-dust layer
  intensity: number;          // 0–100
  blur: number;               // px
  movement: boolean;
  distortion: boolean;
  seed: number;
  strands?: boolean;
  strandDensity?: number;   // 0–100
  starDensity?: number;     // 0–100
  motionIntensity?: number; // 0–100
}

export const DEFAULT_AURORA: AuroraOptions = { palette: ['#34f5a1', '#22d3ee', '#a78bfa'], sky: '#050816', curtains: 4, ribbons: 1, glow: true, stars: false, intensity: 70, blur: 55, movement: true, distortion: false, seed: 5, strands: false, strandDensity: 42, starDensity: 38, motionIntensity: 55 };

export const AURORA_PRESETS: { id: string; name: string; options: AuroraOptions }[] = [
  { id: 'emerald', name: 'Emerald curtains', options: { ...DEFAULT_AURORA, palette: ['#45ff9a', '#14d98b', '#c1ffad'], curtains: 5, ribbons: 1, strands: true, seed: 31 } },
  { id: 'cyan-ice', name: 'Cyan ice', options: { ...DEFAULT_AURORA, palette: ['#73f7ff', '#40c9ff', '#bddbff'], sky: '#061326', ribbons: 2, strands: true, seed: 32 } },
  { id: 'violet', name: 'Violet aurora', options: { ...DEFAULT_AURORA, palette: ['#bf7bff', '#8367ff', '#f0a7ff'], sky: '#090719', ribbons: 2, strands: true, seed: 33 } },
  { id: 'magenta', name: 'Magenta ribbons', options: { ...DEFAULT_AURORA, palette: ['#ff55bb', '#d946ef', '#ff9ecf'], sky: '#100719', curtains: 3, ribbons: 3, strands: true, seed: 34 } },
  { id: 'multicolor', name: 'Multicolor aurora', options: { ...DEFAULT_AURORA, palette: ['#4cf59b', '#41d9ff', '#a67aff', '#ff74c8'], curtains: 6, ribbons: 2, strands: true, seed: 35 } },
  { id: 'minimal', name: 'Minimal aurora', options: { ...DEFAULT_AURORA, palette: ['#7dffcf', '#8bd8ff'], curtains: 2, ribbons: 0, glow: false, stars: false, intensity: 42, blur: 32, strands: false, motionIntensity: 22, seed: 36 } },
  { id: 'dense', name: 'Dense polar display', options: { ...DEFAULT_AURORA, curtains: 7, ribbons: 3, intensity: 92, blur: 42, strands: true, strandDensity: 88, stars: true, seed: 37 } },
  { id: 'cinematic', name: 'Slow cinematic aurora', options: { ...DEFAULT_AURORA, palette: ['#63eab4', '#54cfe5', '#9d84e8'], curtains: 3, ribbons: 1, intensity: 55, blur: 72, strands: true, motionIntensity: 24, seed: 38 } },
];

export const auroraPalette = (h1: number, h2: number, h3: number) => [hslToHex(h1, 88, 58), hslToHex(h2, 84, 60), hslToHex(h3, 80, 64)];
export const auroraSky = (h: number) => hslToHex(h, 60, 5);

export function buildAurora(o: AuroraOptions): GradientLayer[] {
  const rnd = mulberry(o.seed * 7919 + 13), I = o.intensity / 100;
  const motion = (o.motionIntensity ?? 55) / 100;
  const pal = o.palette.length ? o.palette : DEFAULT_AURORA.palette;
  const col = (i: number) => pal[i % pal.length];
  const layers: GradientLayer[] = [];

  if (o.stars) {
    const density = Math.max(0, Math.min(100, o.starDensity ?? 38));
    layers.push(newLayer('noise', { name: 'Star dust', blend: 'screen', opacity: density / 190, noise: { frequency: 90 + density * 3.7, octaves: 1, seed: o.seed % 90 + 1, mono: true, contrast: 280 + density * 2.5, tile: 300 } }));
  }
  if (o.glow) {
    layers.push(newLayer('radial', {
      name: 'Horizon glow', cx: 50 + (rnd() - .5) * 30, cy: 108, rx: 85, ry: 42, blend: 'screen', opacity: 0.35 + 0.5 * I,
      stops: [stop(col(0), 0, 0.85), stop(col(1), 45, 0.28), stop(col(1), 100, 0)],
      effects: [newEffect('blur', { radius: Math.round(o.blur * 0.6) })],
    }));
  }
  for (let i = 0; i < o.ribbons; i++) {
    const c = col(i + 1), tilt = 98 + rnd() * 24;
    layers.push(newLayer('linear', {
      name: `Ribbon ${i + 1}`, angle: tilt, blend: 'plus-lighter', opacity: 0.18 + 0.4 * I,
      stops: [stop(c, 0, 0), stop(c, 38 + rnd() * 6, 0.0), stop(c, 52, 0.95), stop(col(i + 2), 62 + rnd() * 6, 0.35), stop(c, 80, 0)],
      transform: { x: (rnd() - .5) * 16, y: (rnd() - .5) * 20, scale: 1.25, rotate: (rnd() - .5) * 26, skewX: 0, skewY: 0 },
      effects: [newEffect('blur', { radius: Math.round(o.blur * 0.7) }), ...(o.distortion ? [newEffect('distort', { scale: 55, freq: 7, seed: Math.round(rnd() * 90) + 1 })] : [])],
      anim: o.movement ? { enabled: true, duration: 16 + i * 5, delay: -i * 4, easing: 'ease-in-out', direction: 'alternate', tracks: [{ id: `t${i}a`, prop: 'rotate', from: -8 * motion, to: 10 * motion }, { id: `t${i}b`, prop: 'x', from: -6 * motion, to: 8 * motion }] } : undefined,
    }));
  }
  if (o.strands) {
    const density = Math.max(0, Math.min(100, o.strandDensity ?? 42));
    const count = Math.round((density / 100) * 32);
    for (let i = 0; i < count; i++) {
      const c = col(Math.floor(rnd() * pal.length)), cx = 4 + rnd() * 92, cy = 42 + rnd() * 18;
      const rx = 0.35 + rnd() * 0.8, ry = 18 + rnd() * 24, brightness = (0.22 + rnd() * 0.36) * I;
      layers.push(newLayer('radial', {
        name: `Aurora filament ${i + 1}`, cx, cy, rx, ry, blend: 'screen', opacity: 0.55 + rnd() * 0.4,
        stops: [stop(c, 0, brightness * 0.18), stop(c, 38, brightness * 0.78), stop(c, 68, brightness), stop(c, 100, 0)],
        effects: [newEffect('blur', { radius: Math.round(rnd() * 2) })],
        anim: o.movement ? {
          enabled: true, duration: 12 + Math.round(rnd() * 20), delay: -Math.round(rnd() * 24),
          easing: 'ease-in-out', direction: 'alternate',
          tracks: [{ id: `f${i}x`, prop: 'x', from: -2 * motion, to: 2 * motion }, { id: `f${i}o`, prop: 'opacity', from: 0.45, to: 0.8 }],
        } : undefined,
      }));
    }
  }
  for (let i = 0; i < o.curtains; i++) {
    const k = o.curtains, c = col(i), cx = 100 * ((i + 0.5) / k) + (rnd() - 0.5) * 12, cy = 62 + rnd() * 22;
    const alpha = 0.45 + 0.5 * I;
    layers.push(newLayer('radial', {
      name: `Curtain ${i + 1}`, cx, cy, rx: 20 + rnd() * 16 + 10 / k * 3, ry: 52 + rnd() * 26, blend: 'screen', opacity: 0.6 + 0.35 * rnd(),
      stops: [stop(c, 0, alpha), stop(c, 55, alpha * 0.32, { mid: 55 }), stop(c, 100, 0)],
      transform: { x: 0, y: 0, scale: 1.1 + rnd() * 0.5, rotate: (rnd() - 0.5) * 36, skewX: (rnd() - .5) * 14, skewY: 0 },
      effects: [newEffect('blur', { radius: Math.round(o.blur * (0.8 + rnd() * 0.5)) }), ...(o.distortion ? [newEffect('distort', { scale: 40 + Math.round(rnd() * 50), freq: 6 + Math.round(rnd() * 6), seed: Math.round(rnd() * 90) + 1 })] : [])],
      anim: o.movement ? { enabled: true, duration: 14 + Math.round(rnd() * 14), delay: -Math.round(rnd() * 10), easing: 'ease-in-out', direction: 'alternate', tracks: [{ id: `c${i}x`, prop: 'x', from: (-7 - rnd() * 4) * motion, to: (7 + rnd() * 4) * motion }, { id: `c${i}r`, prop: 'rotate', from: (rnd() - 0.5) * 30 * motion, to: (rnd() - 0.5) * 30 * motion }, { id: `c${i}o`, prop: 'opacity', from: 0.45 + rnd() * 0.2, to: 0.75 + rnd() * 0.2 }] } : undefined,
    }));
  }
  layers.push(newLayer('linear', { name: 'Night sky', angle: 180, space: 'oklab', stops: [stop(o.sky, 0), stop(o.sky, 55), stop(col(0), 100, 0.18)] }));
  // a deterministic id for each animation track
  layers.forEach(l => l.anim.tracks.forEach((t, i) => { t.id = `${l.id}-t${i}`; }));
  return layers;
}
