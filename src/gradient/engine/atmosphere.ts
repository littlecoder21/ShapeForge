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
  fog?: number;            // 0–100
  vignette?: number;       // 0–100
  cloudDensity?: number;   // 0–100
  glowSoftness?: number;   // px
  rayCount?: number;
  rayIntensity?: number;  // 0–100
  sunDisc?: boolean;
  sunDiscSize?: number;    // % of canvas
  moon?: boolean;
  moonColor?: string;
  skyDistribution?: 'even' | 'upper' | 'horizon';
}

export const ATMOSPHERES: { id: string; name: string; opts: AtmosphereOptions }[] = [
  { id: 'sunrise', name: 'Sunrise', opts: { sky: ['#1b2a49', '#6b5b95', '#f08a5d', '#ffd3a5'], sunX: 50, sunY: 92, sunColor: '#fff1c9', sunSize: 46, glow: 85, haze: 55, hazeColor: '#ffd9b0', clouds: 3, rays: false, grain: true, seed: 3, fog: 8, sunDisc: true, sunDiscSize: 5 } },
  { id: 'golden', name: 'Golden hour', opts: { sky: ['#2d4a7a', '#d98c5f', '#ffd98a'], sunX: 72, sunY: 82, sunColor: '#fff4c2', sunSize: 40, glow: 95, haze: 50, hazeColor: '#ffe3a8', clouds: 2, rays: true, grain: true, seed: 8, fog: 5, rayCount: 18, sunDisc: true, sunDiscSize: 4 } },
  { id: 'blue', name: 'Blue hour', opts: { sky: ['#0b1d3a', '#27468a', '#8aa8d8'], sunX: 30, sunY: 105, sunColor: '#b9d0ff', sunSize: 40, glow: 45, haze: 60, hazeColor: '#c3d5f5', clouds: 2, rays: false, grain: true, seed: 2, fog: 10, skyDistribution: 'horizon' } },
  { id: 'twilight', name: 'Twilight', opts: { sky: ['#150d33', '#4b2a7a', '#c8587a', '#ffb38a'], sunX: 28, sunY: 102, sunColor: '#ffd2a0', sunSize: 36, glow: 70, haze: 55, hazeColor: '#ff9f8a', clouds: 3, rays: false, grain: true, seed: 5, fog: 5 } },
  { id: 'overcast', name: 'Overcast', opts: { sky: ['#7c8794', '#b1bac4', '#dde2e8'], sunX: 50, sunY: 25, sunColor: '#ffffff', sunSize: 35, glow: 35, haze: 40, hazeColor: '#eef1f4', clouds: 5, rays: false, grain: false, seed: 11, cloudDensity: 85, vignette: 8 } },
  { id: 'storm', name: 'Storm front', opts: { sky: ['#0d1117', '#2a3445', '#5d6b82', '#8a95a8'], sunX: 80, sunY: 88, sunColor: '#aab4c8', sunSize: 30, glow: 30, haze: 65, hazeColor: '#7a889e', clouds: 6, rays: false, grain: true, seed: 6, fog: 14, cloudDensity: 100, vignette: 28 } },
  { id: 'fog', name: 'Morning fog', opts: { sky: ['#c9d1d6', '#e6eaed', '#f7f8f9'], sunX: 60, sunY: 30, sunColor: '#ffffff', sunSize: 42, glow: 50, haze: 80, hazeColor: '#ffffff', clouds: 4, rays: false, grain: true, seed: 9, fog: 68, cloudDensity: 50 } },
  { id: 'night', name: 'Moonlit night', opts: { sky: ['#02030a', '#0a1230', '#1a2a5c'], sunX: 78, sunY: 18, sunColor: '#dbe8ff', moonColor: '#dbe8ff', sunSize: 16, glow: 60, haze: 35, hazeColor: '#2c3f7a', clouds: 2, rays: false, grain: true, seed: 4, moon: true, sunDisc: true, sunDiscSize: 3 } },
  { id: 'midday', name: 'Midday', opts: { sky: ['#1558a6', '#4f9ee8', '#bce4ff'], sunX: 50, sunY: 12, sunColor: '#fff8df', sunSize: 30, glow: 44, haze: 18, hazeColor: '#f2f7ff', clouds: 2, rays: false, grain: false, seed: 12, sunDisc: true, sunDiscSize: 3, skyDistribution: 'upper' } },
  { id: 'desert', name: 'Desert sunset', opts: { sky: ['#3c285a', '#b84e59', '#f29a5b', '#ffd48a'], sunX: 66, sunY: 76, sunColor: '#fff0bf', sunSize: 48, glow: 90, haze: 72, hazeColor: '#ffc578', clouds: 1, rays: true, grain: true, seed: 21, fog: 14, rayCount: 14, sunDisc: true, sunDiscSize: 6 } },
  { id: 'coastal', name: 'Coastal mist', opts: { sky: ['#334b68', '#7798ac', '#d4d9d1'], sunX: 42, sunY: 58, sunColor: '#fff4dc', sunSize: 34, glow: 53, haze: 64, hazeColor: '#d8e7e5', clouds: 3, rays: false, grain: true, seed: 22, fog: 40, cloudDensity: 38, skyDistribution: 'horizon' } },
  { id: 'dramatic', name: 'Dramatic storm', opts: { sky: ['#101722', '#27374b', '#697b91', '#d3a779'], sunX: 82, sunY: 72, sunColor: '#ffe2b5', sunSize: 42, glow: 58, haze: 70, hazeColor: '#d5b69c', clouds: 6, rays: true, grain: true, seed: 23, fog: 18, cloudDensity: 100, rayCount: 11, vignette: 34 } },
  { id: 'polar', name: 'Polar dusk', opts: { sky: ['#13253e', '#466a8b', '#bf8d9e', '#eed1bd'], sunX: 27, sunY: 98, sunColor: '#ffe4cf', sunSize: 35, glow: 52, haze: 55, hazeColor: '#d9c7d4', clouds: 2, rays: false, grain: true, seed: 24, fog: 22, sunDisc: true, sunDiscSize: 4 } },
  { id: 'dusty', name: 'Dusty sunlight', opts: { sky: ['#5c534b', '#a88a69', '#e4c092'], sunX: 70, sunY: 36, sunColor: '#fff1c7', sunSize: 44, glow: 72, haze: 50, hazeColor: '#dfbd89', clouds: 1, rays: true, grain: true, seed: 25, fog: 28, rayCount: 22, sunDisc: true, sunDiscSize: 4 } },
  { id: 'cinematic', name: 'Cinematic night', opts: { sky: ['#03040d', '#10182e', '#29354f'], sunX: 73, sunY: 24, sunColor: '#dce8ff', moonColor: '#dce8ff', sunSize: 22, glow: 43, haze: 30, hazeColor: '#63779a', clouds: 1, rays: false, grain: true, seed: 26, moon: true, sunDisc: true, sunDiscSize: 2.5, vignette: 35 } },
];
export const DEFAULT_ATMOSPHERE = ATMOSPHERES[1].opts;

export function buildAtmosphere(o: AtmosphereOptions): GradientLayer[] {
  const rnd = mulberry(o.seed * 4421 + 9), layers: GradientLayer[] = [];
  const rayCount = Math.max(3, Math.min(48, Math.round(o.rayCount ?? 18)));
  if (o.grain) layers.push(newLayer('noise', { name: 'Film grain', blend: 'overlay', opacity: 0.32, noise: { frequency: 85, octaves: 3, seed: o.seed, mono: true, contrast: 125, tile: 220 } }));
  if ((o.vignette ?? 0) > 0) layers.push(newLayer('radial', {
    name: 'Atmospheric vignette', cx: 50, cy: 50, rx: 76, ry: 88, opacity: (o.vignette ?? 0) / 100, blend: 'multiply',
    stops: [stop('#101522', 42, 0), stop('#101522', 100, 0.72)],
  }));
  if (o.rays) layers.push(newLayer('conic', {
    name: 'Light rays', cx: o.sunX, cy: o.sunY, angle: 0, blend: 'screen', opacity: (o.rayIntensity ?? 45) / 100, repeating: true, repeat: { size: 360 / rayCount, unit: 'deg', offset: 0 },
    stops: [stop(o.sunColor, 0, 0.5, { hard: true }), stop(o.sunColor, 45, 0.5, { hard: true }), stop(o.sunColor, 45, 0), stop(o.sunColor, 100, 0)],
    effects: [newEffect('blur', { radius: 5 })],
    anim: { enabled: true, duration: 90, delay: 0, easing: 'linear', direction: 'normal', tracks: [{ id: 'rays-spin', prop: 'rotate', from: 0, to: 360 }] },
  }));
  for (let i = 0; i < o.clouds; i++) {
    const cx = 8 + (84 * (i + 0.5)) / Math.max(1, o.clouds) + (rnd() - 0.5) * 14, cy = 28 + rnd() * 34;
    layers.push(newLayer('radial', {
      name: `Cloud ${i + 1}`, cx, cy, rx: 22 + rnd() * 18, ry: 8 + rnd() * 7, opacity: (0.35 + rnd() * 0.3) * ((o.cloudDensity ?? 70) / 70),
      stops: [stop(o.hazeColor, 0, 0.9), stop(o.hazeColor, 100, 0, { mid: 45 })], effects: [newEffect('blur', { radius: 32 + Math.round(rnd() * 26) })],
      anim: { enabled: true, duration: 40 + Math.round(rnd() * 30), delay: -Math.round(rnd() * 20), easing: 'ease-in-out', direction: 'alternate', tracks: [{ id: `cloud${i}`, prop: 'x', from: -6, to: 6 }] },
    }));
  }
  if (o.haze > 0) layers.push(newLayer('linear', { name: 'Horizon haze', angle: 180, opacity: 1, stops: [stop(o.hazeColor, 45, 0), stop(o.hazeColor, 100, (o.haze / 100) * 0.75)] }));
  if ((o.fog ?? 0) > 0) layers.push(newLayer('linear', {
    name: 'Distance fog', angle: 180, opacity: 1, blend: 'screen',
    stops: [stop(o.hazeColor, 42, 0), stop(o.hazeColor, 100, (o.fog! / 100) * 0.42)],
  }));
  const lightColor = o.moon ? o.moonColor ?? o.sunColor : o.sunColor;
  if (o.glow > 0) layers.push(newLayer('radial', {
    name: o.moon ? 'Moon halo' : 'Sun glow', cx: o.sunX, cy: o.sunY, rx: o.sunSize, ry: o.sunSize * 1.35, blend: 'screen', opacity: 1,
    stops: [stop(lightColor, 0, o.glow / 100), stop(lightColor, 28, (o.glow / 100) * 0.45), stop(lightColor, 100, 0)], effects: [newEffect('blur', { radius: o.glowSoftness ?? 16 })],
  }));
  if (o.sunDisc) {
    const size = Math.max(0.5, Math.min(20, o.sunDiscSize ?? 4));
    layers.push(newLayer('radial', {
      name: o.moon ? 'Moon disc' : 'Sun disc', cx: o.sunX, cy: o.sunY, rx: size, ry: size * (o.moon ? 1 : 0.94), blend: 'screen',
      stops: [stop(lightColor, 0, 1), stop(lightColor, 86, 1), stop(lightColor, 100, 0)],
    }));
  }
  const sky = o.sky?.length ? o.sky : DEFAULT_ATMOSPHERE.sky;
  const n = sky.length;
  const distribution = o.skyDistribution ?? 'even';
  layers.push(newLayer('linear', { name: 'Sky', angle: 180, space: 'oklab', stops: sky.map((c, i) => {
    const t = i / Math.max(1, n - 1);
    const pos = distribution === 'upper' ? Math.pow(t, 1.35) : distribution === 'horizon' ? Math.sqrt(t) : t;
    return stop(c, Math.round(pos * 100));
  }) }));
  layers.forEach(l => l.anim.tracks.forEach((t, i) => { t.id = `${l.id}-t${i}`; }));
  return layers;
}
export const skyFromHue = (h: number) => [hslToHex(h, 55, 14), hslToHex(h + 20, 55, 38), hslToHex(h + 40, 70, 74)];
