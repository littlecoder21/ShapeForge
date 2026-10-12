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
}

export const DEFAULT_AURORA: AuroraOptions = { palette: ['#34f5a1', '#22d3ee', '#a78bfa'], sky: '#050816', curtains: 4, ribbons: 1, glow: true, stars: false, intensity: 70, blur: 55, movement: true, distortion: false, seed: 5 };

export const auroraPalette = (h1: number, h2: number, h3: number) => [hslToHex(h1, 88, 58), hslToHex(h2, 84, 60), hslToHex(h3, 80, 64)];
export const auroraSky = (h: number) => hslToHex(h, 60, 5);

export function buildAurora(o: AuroraOptions): GradientLayer[] {
  const rnd = mulberry(o.seed * 7919 + 13), I = o.intensity / 100;
  const pal = o.palette.length ? o.palette : DEFAULT_AURORA.palette;
  const col = (i: number) => pal[i % pal.length];
  const layers: GradientLayer[] = [];

  if (o.stars) {
    layers.push(newLayer('noise', { name: 'Star dust', blend: 'screen', opacity: 0.2, noise: { frequency: 260, octaves: 1, seed: o.seed % 90 + 1, mono: true, contrast: 420, tile: 300 } }));
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
      anim: o.movement ? { enabled: true, duration: 16 + i * 5, delay: -i * 4, easing: 'ease-in-out', direction: 'alternate', tracks: [{ id: `t${i}a`, prop: 'rotate', from: -8, to: 10 }, { id: `t${i}b`, prop: 'x', from: -6, to: 8 }] } : undefined,
    }));
  }
  for (let i = 0; i < o.curtains; i++) {
    const k = o.curtains, c = col(i), cx = 100 * ((i + 0.5) / k) + (rnd() - 0.5) * 12, cy = 62 + rnd() * 22;
    const alpha = 0.45 + 0.5 * I;
    layers.push(newLayer('radial', {
      name: `Curtain ${i + 1}`, cx, cy, rx: 20 + rnd() * 16 + 10 / k * 3, ry: 52 + rnd() * 26, blend: 'screen', opacity: 0.6 + 0.35 * rnd(),
      stops: [stop(c, 0, alpha), stop(c, 55, alpha * 0.32, { mid: 55 }), stop(c, 100, 0)],
      transform: { x: 0, y: 0, scale: 1.1 + rnd() * 0.5, rotate: (rnd() - 0.5) * 36, skewX: (rnd() - .5) * 14, skewY: 0 },
      effects: [newEffect('blur', { radius: Math.round(o.blur * (0.8 + rnd() * 0.5)) }), ...(o.distortion ? [newEffect('distort', { scale: 40 + Math.round(rnd() * 50), freq: 6 + Math.round(rnd() * 6), seed: Math.round(rnd() * 90) + 1 })] : [])],
      anim: o.movement ? { enabled: true, duration: 14 + Math.round(rnd() * 14), delay: -Math.round(rnd() * 10), easing: 'ease-in-out', direction: 'alternate', tracks: [{ id: `c${i}x`, prop: 'x', from: -7 - rnd() * 4, to: 7 + rnd() * 4 }, { id: `c${i}r`, prop: 'rotate', from: (rnd() - 0.5) * 30, to: (rnd() - 0.5) * 30 }, { id: `c${i}o`, prop: 'opacity', from: 0.45 + rnd() * 0.2, to: 0.75 + rnd() * 0.2 }] } : undefined,
    }));
  }
  layers.push(newLayer('linear', { name: 'Night sky', angle: 180, space: 'oklab', stops: [stop(o.sky, 0), stop(o.sky, 55), stop(col(0), 100, 0.18)] }));
  // a deterministic id for each animation track
  layers.forEach(l => l.anim.tracks.forEach((t, i) => { t.id = `${l.id}-t${i}`; }));
  return layers;
}
