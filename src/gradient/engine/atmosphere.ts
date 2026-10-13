import { hslToHex } from './color';
import { newEffect } from './effects';
import { newLayer, stop, type GradientLayer } from './model';
import { mulberry } from './rng';

/* ═══════════ Atmosphere builder ═══════════
 * Like Aurora, this only *assembles ordinary layers*: a sky ramp, a sun glow, horizon haze, soft clouds, optional god-rays
 * and a grain overlay. Nothing is locked — every result is a normal, editable layer stack.
 */
export interface AtmosphereOptions {
  sky: string[];           // 2–4 colours, top → bottom
  sunX: number; sunY: number; sunColor: string; sunSize: number;   // % of canvas
  glow: number;            // 0–100
  haze: number; hazeColor: string;
  clouds: number;          // 0–6
  rays: boolean; grain: boolean; seed: number;
}

export const ATMOSPHERES: { id: string; name: string; opts: AtmosphereOptions }[] = [
  { id: 'sunrise', name: 'Sunrise', opts: { sky: ['#1b2a49', '#6b5b95', '#f08a5d', '#ffd3a5'], sunX: 50, sunY: 92, sunColor: '#fff1c9', sunSize: 46, glow: 85, haze: 55, hazeColor: '#ffd9b0', clouds: 3, rays: false, grain: true, seed: 3 } },
  { id: 'golden', name: 'Golden hour', opts: { sky: ['#2d4a7a', '#d98c5f', '#ffd98a'], sunX: 72, sunY: 82, sunColor: '#fff4c2', sunSize: 40, glow: 95, haze: 50, hazeColor: '#ffe3a8', clouds: 2, rays: true, grain: true, seed: 8 } },
  { id: 'blue', name: 'Blue hour', opts: { sky: ['#0b1d3a', '#27468a', '#8aa8d8'], sunX: 30, sunY: 105, sunColor: '#b9d0ff', sunSize: 40, glow: 45, haze: 60, hazeColor: '#c3d5f5', clouds: 2, rays: false, grain: true, seed: 2 } },
  { id: 'twilight', name: 'Twilight', opts: { sky: ['#150d33', '#4b2a7a', '#c8587a', '#ffb38a'], sunX: 28, sunY: 102, sunColor: '#ffd2a0', sunSize: 36, glow: 70, haze: 55, hazeColor: '#ff9f8a', clouds: 3, rays: false, grain: true, seed: 5 } },
  { id: 'overcast', name: 'Overcast', opts: { sky: ['#7c8794', '#b1bac4', '#dde2e8'], sunX: 50, sunY: 25, sunColor: '#ffffff', sunSize: 35, glow: 35, haze: 40, hazeColor: '#eef1f4', clouds: 5, rays: false, grain: false, seed: 11 } },
  { id: 'storm', name: 'Storm front', opts: { sky: ['#0d1117', '#2a3445', '#5d6b82', '#8a95a8'], sunX: 80, sunY: 88, sunColor: '#aab4c8', sunSize: 30, glow: 30, haze: 65, hazeColor: '#7a889e', clouds: 6, rays: false, grain: true, seed: 6 } },
  { id: 'fog', name: 'Morning fog', opts: { sky: ['#c9d1d6', '#e6eaed', '#f7f8f9'], sunX: 60, sunY: 30, sunColor: '#ffffff', sunSize: 42, glow: 50, haze: 80, hazeColor: '#ffffff', clouds: 4, rays: false, grain: true, seed: 9 } },
  { id: 'night', name: 'Moonlit night', opts: { sky: ['#02030a', '#0a1230', '#1a2a5c'], sunX: 78, sunY: 18, sunColor: '#dbe8ff', sunSize: 16, glow: 60, haze: 35, hazeColor: '#2c3f7a', clouds: 2, rays: false, grain: true, seed: 4 } },
];
export const DEFAULT_ATMOSPHERE = ATMOSPHERES[1].opts;

export function buildAtmosphere(o: AtmosphereOptions): GradientLayer[] {
  const rnd = mulberry(o.seed * 4421 + 9), layers: GradientLayer[] = [];
  if (o.grain) layers.push(newLayer('noise', { name: 'Film grain', blend: 'overlay', opacity: 0.32, noise: { frequency: 85, octaves: 3, seed: o.seed, mono: true, contrast: 125, tile: 220 } }));
  if (o.rays) layers.push(newLayer('conic', {
    name: 'Light rays', cx: o.sunX, cy: o.sunY, angle: 0, blend: 'screen', opacity: 0.45, repeating: true, repeat: { size: 14, unit: 'deg', offset: 0 },
    stops: [stop(o.sunColor, 0, 0.5, { hard: true }), stop(o.sunColor, 45, 0.5, { hard: true }), stop(o.sunColor, 45, 0), stop(o.sunColor, 100, 0)],
    effects: [newEffect('blur', { radius: 10 })],
    anim: { enabled: true, duration: 90, delay: 0, easing: 'linear', direction: 'normal', tracks: [{ id: 'rays-spin', prop: 'rotate', from: 0, to: 360 }] },
  }));
  for (let i = 0; i < o.clouds; i++) {
    const cx = 8 + (84 * (i + 0.5)) / Math.max(1, o.clouds) + (rnd() - 0.5) * 14, cy = 28 + rnd() * 34;
    layers.push(newLayer('radial', {
      name: `Cloud ${i + 1}`, cx, cy, rx: 22 + rnd() * 18, ry: 8 + rnd() * 7, opacity: 0.5 + rnd() * 0.35,
      stops: [stop(o.hazeColor, 0, 0.9), stop(o.hazeColor, 100, 0, { mid: 45 })], effects: [newEffect('blur', { radius: 32 + Math.round(rnd() * 26) })],
      anim: { enabled: true, duration: 40 + Math.round(rnd() * 30), delay: -Math.round(rnd() * 20), easing: 'ease-in-out', direction: 'alternate', tracks: [{ id: `cloud${i}`, prop: 'x', from: -6, to: 6 }] },
    }));
  }
  if (o.haze > 0) layers.push(newLayer('linear', { name: 'Horizon haze', angle: 180, opacity: 1, stops: [stop(o.hazeColor, 45, 0), stop(o.hazeColor, 100, (o.haze / 100) * 0.75)] }));
  if (o.glow > 0) layers.push(newLayer('radial', {
    name: 'Sun glow', cx: o.sunX, cy: o.sunY, rx: o.sunSize, ry: o.sunSize * 1.35, blend: 'screen', opacity: 1,
    stops: [stop(o.sunColor, 0, o.glow / 100), stop(o.sunColor, 28, (o.glow / 100) * 0.45), stop(o.sunColor, 100, 0)], effects: [newEffect('blur', { radius: 16 })],
  }));
  const n = o.sky.length;
  layers.push(newLayer('linear', { name: 'Sky', angle: 180, space: 'oklab', stops: o.sky.map((c, i) => stop(c, Math.round((i / Math.max(1, n - 1)) * 100))) }));
  layers.forEach(l => l.anim.tracks.forEach((t, i) => { t.id = `${l.id}-t${i}`; }));
  return layers;
}
export const skyFromHue = (h: number) => [hslToHex(h, 55, 14), hslToHex(h + 20, 55, 38), hslToHex(h + 40, 70, 74)];
