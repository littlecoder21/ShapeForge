import { newEffect } from './effects';
import { BLEND_MODES, newLayer, stop, type BlendMode, type GradientLayer, type TextureData } from './model';
import { mulberry } from './rng';

export type VisualBuilderId = 'fluid' | 'light' | 'ink' | 'halftone' | 'prism' | 'metallic' | 'glass' | 'holographic';
export type VisualValue = number | string | boolean | string[];
export type VisualConfig = Record<string, VisualValue>;
export interface VisualPreset { id: string; name: string; values: Partial<VisualConfig> }
export interface VisualControl { key: string; label: string; min: number; max: number; step?: number; unit?: string; options?: { id: string; label: string }[] }
export interface VisualBuilderDefinition {
  id: VisualBuilderId;
  name: string;
  description: string;
  presets: VisualPreset[];
  defaults: VisualConfig;
  controls: VisualControl[];
  build: (config: VisualConfig) => GradientLayer[];
}

const fluidPresets: VisualPreset[] = [
  { id: 'marble', name: 'Liquid Marble', values: { palette: ['#071b3b', '#10b9c8', '#a7f3e9'], flow: 58, turbulence: 72, viscosity: 38, swirl: 76, warp: 62, diffusion: 24 } },
  { id: 'chromatic', name: 'Chromatic Flow', values: { palette: ['#ff3cac', '#784ba0', '#2b86c5'], flow: 72, turbulence: 64, viscosity: 22, swirl: 68, warp: 80, diffusion: 18 } },
  { id: 'soft', name: 'Soft Fluid', values: { palette: ['#d7c8ff', '#9ce8e2', '#f9c6d2'], flow: 35, turbulence: 28, viscosity: 78, swirl: 28, warp: 30, diffusion: 75 } },
  { id: 'ocean', name: 'Deep Ocean', values: { palette: ['#031a35', '#075985', '#22d3ee'], flow: 65, turbulence: 52, viscosity: 62, swirl: 48, warp: 54, diffusion: 36 } },
  { id: 'molten', name: 'Molten Color', values: { palette: ['#40120b', '#e43d12', '#ffb000'], flow: 54, turbulence: 82, viscosity: 40, swirl: 60, warp: 84, diffusion: 18 } },
  { id: 'membrane', name: 'Organic Membrane', values: { palette: ['#102a43', '#3b82f6', '#b9fbc0'], flow: 45, turbulence: 42, viscosity: 72, swirl: 38, warp: 54, diffusion: 48 } },
];
const lightPresets: VisualPreset[] = [
  { id: 'rays', name: 'Aurora Rays', values: { palette: ['#27e6a2', '#22d3ee', '#9b8cff'], sourceCount: 3, radius: 52, intensity: 65, spread: 28, glow: 76, halo: 52 } },
  { id: 'cinema', name: 'Cinematic Beam', values: { palette: ['#ffd28a', '#fff4dc', '#e7a65c'], sourceCount: 1, radius: 32, intensity: 76, spread: 12, glow: 54, halo: 42 } },
  { id: 'spot', name: 'Soft Spotlight', values: { palette: ['#fff5dc', '#f9d89b', '#fffdf2'], sourceCount: 1, radius: 64, intensity: 52, spread: 44, glow: 70, halo: 65 } },
  { id: 'neon', name: 'Neon Glow', values: { palette: ['#ff2bd6', '#28eaff', '#824dff'], sourceCount: 3, radius: 32, intensity: 80, spread: 20, glow: 82, halo: 56 } },
  { id: 'haze', name: 'Atmospheric Haze', values: { palette: ['#5aa9ff', '#c4e3ff', '#7c8cff'], sourceCount: 2, radius: 72, intensity: 42, spread: 62, glow: 88, halo: 72 } },
  { id: 'leaks', name: 'Light Leaks', values: { palette: ['#ff5c35', '#ffcf70', '#f04996'], sourceCount: 4, radius: 48, intensity: 55, spread: 36, glow: 66, halo: 48 } },
];
const inkPresets: VisualPreset[] = [
  { id: 'black', name: 'Black Ink', values: { palette: ['#080b12', '#263244', '#e6edf5'], inkDensity: 90, smokeDensity: 12, turbulence: 58, curl: 72, diffusion: 16, edge: 88 } },
  { id: 'rainbow', name: 'Rainbow Pigment', values: { palette: ['#ff4d8d', '#7c5cff', '#2bd9d0'], inkDensity: 74, smokeDensity: 36, turbulence: 55, curl: 58, diffusion: 36, edge: 64 } },
  { id: 'blue', name: 'Blue Smoke', values: { palette: ['#071a35', '#1d4ed8', '#7dd3fc'], inkDensity: 28, smokeDensity: 82, turbulence: 48, curl: 62, diffusion: 76, edge: 32 } },
  { id: 'crimson', name: 'Crimson Vapor', values: { palette: ['#260a18', '#b4234d', '#ff8c69'], inkDensity: 50, smokeDensity: 70, turbulence: 68, curl: 70, diffusion: 58, edge: 46 } },
  { id: 'clouds', name: 'Liquid Clouds', values: { palette: ['#14213d', '#4361ee', '#fca311'], inkDensity: 42, smokeDensity: 76, turbulence: 82, curl: 84, diffusion: 70, edge: 38 } },
  { id: 'nebula', name: 'Abstract Nebula', values: { palette: ['#180b38', '#7b2ff7', '#f107a3'], inkDensity: 64, smokeDensity: 68, turbulence: 72, curl: 66, diffusion: 52, edge: 55 } },
];
const halftonePresets: VisualPreset[] = [
  { id: 'editorial', name: 'Editorial Print', values: { palette: ['#172554', '#e11d48', '#f8fafc'], spacing: 18, dotSize: 10, dotShape: 'dots-1', angle: 22, density: 68, contrast: 82, channelSeparation: 0 } },
  { id: 'cmyk', name: 'CMYK Pop', values: { palette: ['#00a8e8', '#ec008c', '#fff200'], spacing: 15, dotSize: 10, dotShape: 'dots-10', angle: 15, density: 82, contrast: 96, channelSeparation: 8 } },
  { id: 'mono', name: 'Monochrome Poster', values: { palette: ['#050505', '#555555', '#ffffff'], spacing: 12, dotSize: 9, dotShape: 'geometric-9', angle: 45, density: 74, contrast: 100, channelSeparation: 0 } },
  { id: 'vintage', name: 'Vintage Newspaper', values: { palette: ['#28231e', '#817765', '#e9dfc9'], spacing: 22, dotSize: 12, dotShape: 'dots-6', angle: 18, density: 54, contrast: 72, channelSeparation: 0 } },
  { id: 'gradient', name: 'Gradient Dots', values: { palette: ['#f72585', '#7209b7', '#4cc9f0'], spacing: 14, dotSize: 8, dotShape: 'dots-1', angle: 32, density: 88, contrast: 90, channelSeparation: 2 } },
  { id: 'technical', name: 'Technical Screen', values: { palette: ['#0f172a', '#0ea5e9', '#e0f2fe'], spacing: 9, dotSize: 4, dotShape: 'geometric-9', angle: 0, density: 92, contrast: 86, channelSeparation: 0 } },
];
const prismPresets: VisualPreset[] = [
  { id: 'crystal', name: 'Crystal Spectrum', values: { palette: ['#fb7185', '#fde68a', '#67e8f9'], dispersion: 68, refraction: 62, frequency: 34, prismAngle: 38, layers: 3, highlight: 68 } },
  { id: 'rainbow', name: 'Rainbow Refraction', values: { palette: ['#ff3c9e', '#ffd166', '#06d6a0', '#4cc9f0'], dispersion: 88, refraction: 52, frequency: 28, prismAngle: 18, layers: 4, highlight: 78 } },
  { id: 'wave', name: 'Optical Wave', values: { palette: ['#0ea5e9', '#a78bfa', '#f0abfc'], dispersion: 36, refraction: 86, frequency: 52, prismAngle: 72, layers: 3, highlight: 48 } },
  { id: 'glass', name: 'Chromatic Glass', values: { palette: ['#22d3ee', '#c4b5fd', '#fda4af'], dispersion: 72, refraction: 70, frequency: 22, prismAngle: 48, layers: 2, highlight: 58 } },
  { id: 'prismatic', name: 'Prismatic Light', values: { palette: ['#fef08a', '#f472b6', '#818cf8'], dispersion: 92, refraction: 38, frequency: 18, prismAngle: 12, layers: 4, highlight: 92 } },
  { id: 'edge', name: 'Spectral Edge', values: { palette: ['#09090b', '#26214f', '#ec4899'], dispersion: 56, refraction: 62, frequency: 42, prismAngle: 86, layers: 3, highlight: 74 } },
];
const metallicPresets: VisualPreset[] = [
  { id: 'chrome', name: 'Liquid Chrome', values: { palette: ['#101820', '#e8f1f8', '#657482'], roughness: 18, bandScale: 42, brushed: 18, scratches: 12, oxidation: 0 } },
  { id: 'silver', name: 'Brushed Silver', values: { palette: ['#202833', '#f1f5f9', '#9aa8b5'], roughness: 48, bandScale: 28, brushed: 82, scratches: 24, oxidation: 0 } },
  { id: 'gold', name: 'Champagne Gold', values: { palette: ['#594017', '#ffe5a3', '#ba8433'], roughness: 34, bandScale: 38, brushed: 36, scratches: 8, oxidation: 0 } },
  { id: 'rose', name: 'Rose Gold', values: { palette: ['#542b35', '#ffd0c5', '#b86f72'], roughness: 38, bandScale: 35, brushed: 32, scratches: 10, oxidation: 4 } },
  { id: 'titanium', name: 'Dark Titanium', values: { palette: ['#090d13', '#b4c2d0', '#39495a'], roughness: 62, bandScale: 26, brushed: 64, scratches: 28, oxidation: 6 } },
  { id: 'copper', name: 'Polished Copper', values: { palette: ['#4a2017', '#ffd0a1', '#a64b2a'], roughness: 30, bandScale: 40, brushed: 28, scratches: 14, oxidation: 12 } },
  { id: 'anodized', name: 'Anodized Rainbow', values: { palette: ['#00d4ff', '#ab47bc', '#ff7043'], roughness: 26, bandScale: 50, brushed: 42, scratches: 6, oxidation: 0 } },
];
const glassPresets: VisualPreset[] = [
  { id: 'clear', name: 'Clear Crystal', values: { palette: ['#b8ecff', '#ffffff', '#6bc4e8'], tintOpacity: 12, frost: 6, refraction: 28, edge: 78, droplets: 0 } },
  { id: 'frosted', name: 'Frosted Panel', values: { palette: ['#cbe8f2', '#ffffff', '#8db9ca'], tintOpacity: 35, frost: 88, refraction: 12, edge: 42, droplets: 0 } },
  { id: 'smoked', name: 'Smoked Glass', values: { palette: ['#101820', '#82909c', '#293642'], tintOpacity: 68, frost: 24, refraction: 18, edge: 58, droplets: 0 } },
  { id: 'arctic', name: 'Arctic Glass', values: { palette: ['#5bc0eb', '#effaff', '#b8ecff'], tintOpacity: 42, frost: 46, refraction: 36, edge: 88, droplets: 12 } },
  { id: 'liquid', name: 'Liquid Glass', values: { palette: ['#a5f3fc', '#ffffff', '#818cf8'], tintOpacity: 30, frost: 16, refraction: 72, edge: 76, droplets: 24 } },
  { id: 'champagne', name: 'Champagne Glass', values: { palette: ['#b67f45', '#fff0cf', '#e6cba0'], tintOpacity: 38, frost: 20, refraction: 22, edge: 68, droplets: 4 } },
];
const holoPresets: VisualPreset[] = [
  { id: 'foil', name: 'Holographic Foil', values: { palette: ['#ff4d9d', '#ffc857', '#4de2c5', '#7272ff'], frequency: 64, spread: 72, intensity: 78, grain: 18, distortion: 28, angle: 22 } },
  { id: 'pearl', name: 'Iridescent Pearl', values: { palette: ['#f9d9e8', '#d8f4f0', '#d8dcff'], frequency: 32, spread: 48, intensity: 48, grain: 8, distortion: 14, angle: 62 } },
  { id: 'film', name: 'Rainbow Film', values: { palette: ['#ff5f6d', '#ffc371', '#47cfb4', '#6858ff'], frequency: 82, spread: 86, intensity: 82, grain: 14, distortion: 24, angle: 8 } },
  { id: 'cyber', name: 'Cyber Spectrum', values: { palette: ['#ff00d4', '#00e5ff', '#8fff00'], frequency: 92, spread: 90, intensity: 94, grain: 32, distortion: 64, angle: 40 } },
  { id: 'opal', name: 'Opal Surface', values: { palette: ['#9cf6f6', '#f4b8e4', '#f9f7b5'], frequency: 44, spread: 55, intensity: 62, grain: 10, distortion: 26, angle: 78 } },
  { id: 'liquid', name: 'Liquid Hologram', values: { palette: ['#00c6ff', '#c471ed', '#f7797d'], frequency: 58, spread: 74, intensity: 76, grain: 20, distortion: 56, angle: 32 } },
];

const ctrl = (key: string, label: string, min: number, max: number, unit = '%', step = 1): VisualControl => ({ key, label, min, max, unit, step });
const fluidControls = [ctrl('flowAngle', 'Flow direction', 0, 360, '°'), ctrl('flow', 'Flow intensity', 0, 100), ctrl('turbulence', 'Turbulence', 0, 100), ctrl('viscosity', 'Viscosity', 0, 100), ctrl('swirl', 'Swirl', 0, 100), ctrl('warp', 'Warp amplitude', 0, 100), ctrl('diffusion', 'Diffusion', 0, 100)];
const lightControls = [ctrl('sourceCount', 'Light sources', 1, 6, '', 1), ctrl('sourceX', 'Source position X', 0, 100), ctrl('sourceY', 'Source position Y', 0, 100), ctrl('radius', 'Source radius', 12, 100), ctrl('intensity', 'Intensity', 5, 100), ctrl('falloff', 'Light falloff', 0, 100), ctrl('coreBrightness', 'Core brightness', 0, 100), ctrl('beamLength', 'Beam length', 20, 100), ctrl('angle', 'Beam direction', 0, 360, '°'), ctrl('spread', 'Beam spread', 4, 80), ctrl('glow', 'Glow radius', 0, 100), ctrl('halo', 'Halo intensity', 0, 100)];
const inkControls = [ctrl('flowAngle', 'Flow direction', 0, 360, '°'), ctrl('inkDensity', 'Ink density', 0, 100), ctrl('smokeDensity', 'Smoke density', 0, 100), ctrl('turbulence', 'Turbulence', 0, 100), ctrl('curl', 'Curl', 0, 100), ctrl('diffusion', 'Diffusion', 0, 100), ctrl('edge', 'Edge definition', 0, 100), ctrl('layerCount', 'Plume groups', 1, 8, '', 1)];
const halftoneControls: VisualControl[] = [
  ctrl('spacing', 'Dot spacing', 6, 36, 'px'), ctrl('dotSize', 'Dot size', 1, 24, 'px'),
  { key: 'dotShape', label: 'Dot shape', min: 0, max: 0, options: [{ id: 'dots-1', label: 'Round' }, { id: 'dots-10', label: 'Diamond' }, { id: 'dots-6', label: 'Stipple' }, { id: 'geometric-9', label: 'Square' }] },
  ctrl('angle', 'Screen angle', 0, 90, '°'), ctrl('density', 'Dot density', 0, 100), ctrl('contrast', 'Contrast', 0, 100), ctrl('channelSeparation', 'Channel separation', 0, 16, 'px'),
];
const prismControls = [ctrl('dispersion', 'Dispersion', 0, 100), ctrl('refraction', 'Refraction', 0, 100), ctrl('frequency', 'Distortion scale', 4, 80), ctrl('prismAngle', 'Prism angle', 0, 90, '°'), ctrl('layers', 'Optical layers', 1, 6, '', 1), ctrl('highlight', 'Highlight intensity', 0, 100)];
const metalControls = [ctrl('angle', 'Brushed direction', 0, 360, '°'), ctrl('roughness', 'Surface roughness', 0, 100), ctrl('bandScale', 'Reflection band scale', 10, 90), ctrl('brushed', 'Brushed directionality', 0, 100), ctrl('scratches', 'Micro-scratches', 0, 100), ctrl('oxidation', 'Oxidation', 0, 100)];
const glassControls = [ctrl('angle', 'Highlight direction', 0, 360, '°'), ctrl('tintOpacity', 'Tint opacity', 0, 100), ctrl('frost', 'Frost amount', 0, 100), ctrl('refraction', 'Refraction', 0, 100), ctrl('edge', 'Edge highlight', 0, 100), ctrl('droplets', 'Condensation', 0, 100)];
const holoControls = [ctrl('frequency', 'Interference frequency', 8, 100), ctrl('spread', 'Rainbow spread', 0, 100), ctrl('intensity', 'Iridescence', 0, 100), ctrl('grain', 'Surface grain', 0, 100), ctrl('distortion', 'Surface distortion', 0, 100), ctrl('angle', 'Spectrum angle', 0, 360, '°')];

const palette = (c: VisualConfig) => {
  const p = c.palette;
  return Array.isArray(p) && p.length ? p.filter(x => typeof x === 'string') : ['#ff4d9d', '#5c7cfa', '#22d3ee'];
};
const num = (c: VisualConfig, key: string, fallback: number) => {
  const value = c[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const col = (colors: string[], index: number) => colors[((index % colors.length) + colors.length) % colors.length];
const opacity = (v: number) => Math.max(0, Math.min(1, v));
const linear = (name: string, colors: string[], angle: number, blend: BlendMode = 'normal', alpha = 1) =>
  newLayer('linear', { name, angle, space: 'oklab', blend, opacity: alpha, stops: colors.map((c, i) => stop(c, i * (100 / Math.max(1, colors.length - 1)))) });
const radial = (name: string, color: string, cx: number, cy: number, rx: number, ry: number, alpha: number, blend: BlendMode = 'screen', blur = 0) => {
  const l = newLayer('radial', { name, cx, cy, rx, ry, blend, opacity: opacity(alpha), stops: [stop(color, 0, 0.82), stop(color, 38, 0.42), stop(color, 100, 0)] });
  if (blur > 0) l.effects.push(newEffect('blur', { radius: blur }));
  return l;
};
const warped = (layer: GradientLayer, amount: number, freq: number, seed: number) => {
  if (amount > 0) layer.effects.push(newEffect('distort', { scale: amount, freq: Math.max(1, freq), seed: (Math.abs(seed) % 99) + 1 }));
  return layer;
};
const animated = (layer: GradientLayer, duration: number, angle = false) => {
  layer.anim = {
    ...layer.anim, enabled: true, duration: Math.max(4, duration), easing: 'ease-in-out', direction: 'alternate',
    tracks: [{ id: `${layer.id}-anim-0`, prop: angle ? 'angle' : 'rotate', from: angle ? layer.angle - 8 : -7, to: angle ? layer.angle + 8 : 7 }],
  };
  return layer;
};
const base = (name: string, c: VisualConfig, _colors: string[]) => {
  const background = typeof c.background === 'string' ? c.background : '#080b18';
  return linear(`${name} · base`, [background, background], 135, 'normal', 1);
};
const layerTexture = (layer: GradientLayer, pattern: string, color: string, scale: number, density: number, angle: number, blend: BlendMode = 'soft-light') => {
  layer.texture = { ...layer.texture, enabled: true, pattern, color, scale: Math.max(4, scale), density: opacity(density / 100) * 100, angle, opacity: 65, blend } satisfies TextureData;
  return layer;
};
const withShared = (id: VisualBuilderId, name: string, description: string, presets: VisualPreset[], defaults: VisualConfig, controls: VisualControl[], build: VisualBuilderDefinition['build']): VisualBuilderDefinition =>
  ({ id, name, description, presets, defaults, controls, build });

function buildFluid(c: VisualConfig) {
  const colors = palette(c), rnd = mulberry(num(c, 'seed', 7) * 241 + 3), flow = num(c, 'flow', 58), turbulence = num(c, 'turbulence', 55);
  const swirl = num(c, 'swirl', 50), visc = num(c, 'viscosity', 40), warp = num(c, 'warp', 60), diffusion = num(c, 'diffusion', 36);
  const layers: GradientLayer[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + rnd() * 0.8, r = 12 + rnd() * 28;
    const l = radial(`Flow eddy ${i + 1}`, col(colors, i), 50 + Math.cos(angle) * r, 50 + Math.sin(angle) * r * 0.76, 25 + rnd() * 24, 28 + rnd() * 34, 0.22 + flow / 150, 'screen', Math.round(diffusion / 12));
    l.transform.rotate = num(c, 'flowAngle', 28);
    warped(l, warp * 0.68 + turbulence * 0.34, 5 + turbulence / 9, num(c, 'seed', 1) + i);
    if (i < 2) animated(l, 32 + i * 9);
    layers.push(l);
  }
  const vortex = newLayer('conic', { name: 'Vortex flow', cx: 50 + (rnd() - .5) * 38, cy: 48 + (rnd() - .5) * 34, angle: rnd() * 360, repeating: true, repeat: { size: 92 - swirl * .48, unit: 'deg', offset: rnd() * 24 }, blend: 'soft-light', opacity: 0.14 + swirl / 330, stops: [stop(col(colors, 1), 0, 0), stop(col(colors, 0), 45, 0.5), stop(col(colors, 2), 54, 0.42), stop(col(colors, 1), 100, 0)] });
  warped(vortex, turbulence * 0.55, 9, num(c, 'seed', 1));
  layers.push(animated(vortex, Math.max(8, 56 - flow * 0.35), true));
  layers.push(radial('Viscous membrane', col(colors, 2), 50, 52, 72 + visc * 0.12, 60 + visc * 0.16, 0.12 + visc / 420, 'overlay', Math.round(diffusion / 7)));
  layers.push(base('Fluid field', c, colors));
  return layers;
}

function buildLight(c: VisualConfig) {
  const colors = palette(c), rnd = mulberry(num(c, 'seed', 9) * 317 + 5), count = Math.max(1, Math.min(6, Math.round(num(c, 'sourceCount', 2))));
  const intensity = num(c, 'intensity', 65), radius = num(c, 'radius', 48), spread = num(c, 'spread', 32), glow = num(c, 'glow', 65);
  const layers: GradientLayer[] = [];
  const beams = newLayer('conic', { name: 'Volumetric beam fan', cx: 50, cy: 48, angle: num(c, 'angle', 24), repeating: true, repeat: { size: 32 + spread * 0.42, unit: 'deg', offset: 0 }, blend: 'screen', opacity: intensity / 180, stops: [stop(col(colors, 0), 0, 0.25), stop(col(colors, 1), 48, 0.74, { hard: true }), stop(col(colors, 1), 52, 0.04), stop(col(colors, 2), 100, 0)] });
  layers.push(animated(beams, 34));
  for (let i = 0; i < count; i++) {
    const x = Math.max(0, Math.min(100, num(c, 'sourceX', 50) + (rnd() - .5) * 28)), y = Math.max(0, Math.min(100, num(c, 'sourceY', 42) + (rnd() - .5) * 22)), color = col(colors, i);
    const source = radial(`Light source ${i + 1}`, color, x, y, radius * (0.58 + rnd() * 0.5), radius * (0.7 + rnd() * 0.65), intensity / 92, 'screen', Math.round(glow / 7));
    const falloff = num(c, 'falloff', 50);
    source.stops = [stop(color, 0, 0.5 + num(c, 'coreBrightness', 70) / 200), stop(color, Math.max(8, 60 - falloff * 0.38), 0.62), stop(color, 100, 0)];
    layers.push(source);
    layers.push(radial(`Halo ${i + 1}`, color, x, y, radius * (1.1 + glow / 45), radius * (1.2 + glow / 36), num(c, 'halo', 56) / 250, 'screen', Math.round(glow / 4)));
    const beam = linear(`Light streak ${i + 1}`, [color, color, col(colors, i + 1)], num(c, 'angle', 24) + (rnd() - .5) * spread, 'screen', 0.12 + intensity / 280);
    beam.stops = [stop(color, 0, 0), stop(color, 42, 0), stop(color, 50, 0.7), stop(color, 58, 0), stop(color, 100, 0)];
    beam.transform = { ...beam.transform, x: (x - 50) * 0.12, y: (y - 50) * 0.1, rotate: (rnd() - .5) * spread, scale: 0.6 + num(c, 'beamLength', 70) / 100 };
    layers.push(animated(beam, 22 + i * 5));
  }
  layers.push(base('Illumination field', c, colors));
  return layers;
}

function buildInk(c: VisualConfig) {
  const colors = palette(c), rnd = mulberry(num(c, 'seed', 13) * 419 + 11), ink = num(c, 'inkDensity', 70), smoke = num(c, 'smokeDensity', 55), turbulence = num(c, 'turbulence', 60), curl = num(c, 'curl', 55), diffusion = num(c, 'diffusion', 45), edge = num(c, 'edge', 55);
  const layers: GradientLayer[] = [];
  const layerCount = Math.max(1, Math.min(8, Math.round(num(c, 'layerCount', 3))));
  const radians = num(c, 'flowAngle', 28) * Math.PI / 180;
  for (let i = 0; i < layerCount; i++) {
    const color = col(colors, i), cx = 22 + i * 27 + (rnd() - .5) * 16, cy = 40 + rnd() * 40;
    const directionalX = Math.cos(radians) * (i - (layerCount - 1) / 2) * 4;
    const directionalY = Math.sin(radians) * (i - (layerCount - 1) / 2) * 4;
    const deposit = radial(`Pigment bloom ${i + 1}`, color, cx + directionalX, cy + directionalY, 15 + ink * 0.24, 18 + ink * 0.27, 0.18 + ink / 125, 'multiply', Math.round((100 - edge) / 12));
    warped(deposit, turbulence * 0.75 + curl * 0.36, 6 + curl / 8, num(c, 'seed', 1) + i);
    layers.push(deposit);
    const plume = radial(`Smoke plume ${i + 1}`, col(colors, i + 1), cx + directionalX * 1.5 + (rnd() - .5) * 20, 20 + rnd() * 32 + directionalY, 24 + smoke * 0.28, 36 + smoke * 0.33, 0.1 + smoke / 180, 'screen', Math.round(diffusion / 5));
    warped(plume, turbulence * 0.45 + smoke * 0.22, 4 + turbulence / 12, num(c, 'seed', 1) + i + 9);
    layers.push(animated(plume, 42 + i * 13));
  }
  const tendrils = newLayer('conic', { name: 'Pigment tendrils', cx: 50, cy: 54, angle: num(c, 'flowAngle', 28), repeating: true, repeat: { size: 38 + curl * 0.42, unit: 'deg', offset: rnd() * 40 }, blend: 'multiply', opacity: 0.13 + ink / 340, stops: [stop(col(colors, 0), 0, 0), stop(col(colors, 1), 48, 0.65, { hard: true }), stop(col(colors, 2), 54, 0.2), stop(col(colors, 0), 100, 0)] });
  warped(tendrils, turbulence * 0.5 + curl * 0.3, 7 + curl / 10, num(c, 'seed', 1));
  layers.push(tendrils);
  layers.push(base('Ink & smoke · ground', c, colors));
  return layers;
}

function buildHalftone(c: VisualConfig) {
  const colors = palette(c), spacing = num(c, 'spacing', 16), dot = num(c, 'dotSize', 9), angle = num(c, 'angle', 22), density = num(c, 'density', 70), separation = num(c, 'channelSeparation', 0);
  const layers: GradientLayer[] = [];
  const count = separation > 0 ? 3 : 1;
  for (let i = 0; i < count; i++) {
    const ink = col(colors, i), l = linear(separation ? `Halftone channel ${['Cyan', 'Magenta', 'Yellow'][i]}` : 'Halftone screen', [ink, col(colors, (i + 1) % colors.length)], angle + i * (separation ? 30 : 0), separation ? 'multiply' : 'normal', 0.25 + density / 115);
    l.stops = [stop(ink, 0, 0), stop(ink, 100, 0)];
    const shape = typeof c.dotShape === 'string' && ['dots-1', 'dots-10', 'dots-6', 'geometric-9'].includes(c.dotShape) ? c.dotShape : 'dots-1';
    l.texture = { ...l.texture, enabled: true, pattern: shape, scale: Math.max(6, spacing * (1 + i * 0.025)), density: Math.max(1, Math.min(100, density)), opacity: Math.max(20, Math.min(100, dot * 7)), angle: angle + i * (separation ? 30 : 0), seed: num(c, 'seed', 1) + i, color: ink, blend: 'multiply' };
    l.effects.push(newEffect('contrast', { amount: 60 + num(c, 'contrast', 82) * 1.4 }));
    if (separation) l.transform = { ...l.transform, x: i === 1 ? separation : -separation * 0.5, y: i === 2 ? separation * 0.7 : 0 };
    layers.push(l);
  }
  layers.push(base('Print · paper', c, colors));
  return layers;
}

function buildPrism(c: VisualConfig) {
  const colors = palette(c), rnd = mulberry(num(c, 'seed', 17) * 523 + 7), amount = num(c, 'dispersion', 68), refraction = num(c, 'refraction', 55), freq = num(c, 'frequency', 32), count = Math.max(1, Math.min(6, Math.round(num(c, 'layers', 3))));
  const layers: GradientLayer[] = [];
  for (let i = 0; i < count; i++) {
    const color = col(colors, i), cx = 12 + rnd() * 76, cy = 20 + rnd() * 58;
    const split = radial(`Spectral refraction ${i + 1}`, color, cx, cy, 24 + rnd() * 36, 30 + rnd() * 40, 0.18 + amount / 170, i % 2 ? 'screen' : 'plus-lighter', Math.round((100 - refraction) / 16));
    warped(split, refraction * 0.45 + amount * 0.4, freq * 0.55, num(c, 'seed', 1) + i);
    split.transform.rotate = num(c, 'prismAngle', 38) + (rnd() - .5) * 30;
    layers.push(split);
  }
  const spectrum = linear('Dispersed spectrum', colors, num(c, 'prismAngle', 38), 'screen', 0.2 + num(c, 'highlight', 68) / 170);
  spectrum.stops = colors.map((color, i) => stop(color, i * (100 / Math.max(1, colors.length - 1)), 0.62));
  spectrum.effects.push(newEffect('distort', { scale: refraction * 0.42, freq: Math.max(2, freq / 3), seed: (Math.abs(num(c, 'seed', 1)) % 99) + 1 }));
  layers.push(animated(spectrum, 26, true));
  layers.push(base('Prismatic field', c, colors));
  return layers;
}

function buildMetallic(c: VisualConfig) {
  const colors = palette(c), angle = num(c, 'angle', 90), band = num(c, 'bandScale', 42), rough = num(c, 'roughness', 32), brushed = num(c, 'brushed', 46), scratches = num(c, 'scratches', 12), oxidation = num(c, 'oxidation', 0);
  const bands = [col(colors, 0), col(colors, 1), col(colors, 2), col(colors, 1), col(colors, 0)];
  const main = linear('Metal · reflective bands', bands, angle, 'normal', 1);
  const width = Math.max(3, Math.min(22, 3 + band / 7));
  main.stops = [stop(bands[0], 0), stop(bands[1], 28), stop(bands[2], 48 - width), stop('#ffffff', 50, 0.7), stop(bands[2], 52 + width), stop(bands[1], 74), stop(bands[0], 100)];
  const layers: GradientLayer[] = [];
  const sheen = linear('Metal · polished sheen', ['#ffffff', col(colors, 1), '#ffffff'], angle + 90, 'screen', 0.12 + (100 - rough) / 180);
  sheen.stops = [stop('#ffffff', 0, 0), stop('#ffffff', 42, 0), stop('#ffffff', 50, 0.7), stop('#ffffff', 58, 0), stop('#ffffff', 100, 0)];
  layers.push(animated(sheen, 18));
  const grain = linear('Directional metal grain', [col(colors, 0), col(colors, 1)], angle, 'soft-light', 0.12 + brushed / 400);
  layerTexture(grain, 'lines-1', '#ffffff', Math.max(5, 18 - brushed / 8), 28 + brushed * 0.55, angle);
  layers.push(grain);
  if (scratches > 0) {
    const scratch = linear('Micro-scratches', ['#ffffff', '#1a1a1a'], angle, 'overlay', scratches / 300);
    layerTexture(scratch, 'lines-6', '#ffffff', Math.max(5, 30 - scratches / 5), scratches, angle);
    layers.push(scratch);
  }
  if (oxidation > 0) layers.push(radial('Patina / oxidation', '#18a68b', 30, 62, 40, 28, oxidation / 130, 'soft-light', 10));
  layers.push(main);
  return layers;
}

function buildGlass(c: VisualConfig) {
  const colors = palette(c), tint = num(c, 'tintOpacity', 32), frost = num(c, 'frost', 28), refraction = num(c, 'refraction', 28), edge = num(c, 'edge', 68), droplets = num(c, 'droplets', 0);
  const surface = linear('Glass · tinted surface', [col(colors, 0), col(colors, 1), col(colors, 2)], num(c, 'angle', 135), 'screen', 0.16 + tint / 140);
  layerTexture(surface, 'grain-1', '#ffffff', 24, 8, num(c, 'angle', 135), 'soft-light');
  const frostLayer = radial('Glass · frosted diffusion', col(colors, 1), 50, 50, 100, 100, frost / 260, 'soft-light', Math.round(frost / 14));
  warped(frostLayer, refraction * 0.32, 14, num(c, 'seed', 1));
  const layers: GradientLayer[] = [surface, frostLayer];
  const edgeLight = newLayer('radial', { name: 'Glass · edge reflection', cx: 50, cy: 45, rx: 94, ry: 100, blend: 'screen', opacity: edge / 120, stops: [stop('#ffffff', 0, 0), stop('#ffffff', 83, 0), stop(col(colors, 1), 94, 0.5), stop('#ffffff', 100, 0.82)] });
  layers.push(edgeLight);
  const reflection = linear('Glass · specular sweep', ['#ffffff', '#ffffff', col(colors, 1), '#ffffff'], num(c, 'angle', 135), 'screen', 0.18 + edge / 260);
  reflection.stops = [stop('#ffffff', 0, 0), stop('#ffffff', 36, 0), stop('#ffffff', 48, 0.68), stop('#ffffff', 53, 0.16), stop('#ffffff', 62, 0), stop('#ffffff', 100, 0)];
  layers.push(animated(reflection, 20, true));
  if (droplets > 0) {
    const texture = linear('Glass · condensation', ['#ffffff', col(colors, 1)], 0, 'screen', droplets / 300);
    layerTexture(texture, 'dots-6', '#e9faff', Math.max(7, 34 - droplets / 4), droplets, 0);
    layers.push(texture);
  }
  layers.push(base('Glass · background', c, colors));
  return layers;
}

function buildHolographic(c: VisualConfig) {
  const colors = palette(c), rnd = mulberry(num(c, 'seed', 19) * 631 + 17), frequency = num(c, 'frequency', 64), spread = num(c, 'spread', 72), intensity = num(c, 'intensity', 78), grain = num(c, 'grain', 18), distortion = num(c, 'distortion', 28), angle = num(c, 'angle', 22);
  const spectral = linear('Holographic spectrum', colors, angle, 'screen', 0.28 + intensity / 125);
  spectral.repeating = true; spectral.repeat = { size: Math.max(10, 110 - spread * 0.82), unit: '%', offset: rnd() * 12 };
  spectral.stops = colors.map((color, i) => stop(color, i * (100 / Math.max(1, colors.length - 1)), 0.76));
  warped(spectral, distortion * 0.72, Math.max(2, frequency / 7), num(c, 'seed', 1));
  const lines = linear('Diffraction lines', [col(colors, 0), col(colors, 2), col(colors, 1)], angle + 90, 'overlay', 0.12 + frequency / 430);
  layerTexture(lines, 'lines-2', '#ffffff', Math.max(5, 22 - frequency / 8), 18 + frequency * 0.55, angle + 90);
  const shine = linear('Iridescent highlight sweep', ['#ffffff', col(colors, 1), '#ffffff'], angle + 28, 'plus-lighter', 0.12 + intensity / 300);
  shine.stops = [stop('#ffffff', 0, 0), stop('#ffffff', 42, 0), stop('#ffffff', 50, 0.78), stop('#ffffff', 58, 0), stop('#ffffff', 100, 0)];
  const layers = [spectral, lines, animated(shine, 18)];
  if (grain > 0) {
    const surface = linear('Hologram · foil grain', colors, angle, 'soft-light', grain / 320);
    layerTexture(surface, 'grain-1', '#ffffff', Math.max(6, 32 - grain / 4), grain, angle);
    layers.push(surface);
  }
  layers.push(base('Hologram · substrate', c, colors));
  return layers;
}

const defaultBase = (paletteColors: string[], background: string, entries: Record<string, number | string>): VisualConfig => ({
  seed: 7, palette: paletteColors, background, angle: 28, speed: 48, animate: true, layerOpacity: 100, blendMode: 'auto', transparent: false, ...entries,
});
const defs: VisualBuilderDefinition[] = [
  withShared('fluid', 'Fluid', 'Procedural flow fields and warped liquid-color membranes. This is a stylized approximation, not a physical fluid simulation.', fluidPresets, defaultBase(['#ff3cac', '#784ba0', '#2b86c5'], '#07111f', { flowAngle: 28, flow: 58, turbulence: 60, viscosity: 42, swirl: 54, warp: 58, diffusion: 36 }), fluidControls, buildFluid),
  withShared('light', 'Light', 'Editable radial emitters, beam fans, halos, and directional streaks.', lightPresets, defaultBase(['#38bdf8', '#fef3c7', '#c084fc'], '#080b18', { sourceX: 50, sourceY: 42, sourceCount: 2, radius: 48, intensity: 65, falloff: 50, beamLength: 70, coreBrightness: 70, spread: 32, glow: 65, halo: 56 }), lightControls, buildLight),
  withShared('ink', 'Ink & Smoke', 'Layered pigment deposits and turbulent smoke plumes with distinct sharp and diffused forms.', inkPresets, defaultBase(['#102a43', '#4361ee', '#f72585'], '#f2f4f8', { flowAngle: 28, inkDensity: 70, smokeDensity: 55, turbulence: 60, curl: 55, diffusion: 45, edge: 55, layerCount: 3 }), inkControls, buildInk),
  withShared('halftone', 'Halftone', 'Repeatable print-screen textures built on the shared SVG texture renderer; separated screen angles can create moiré.', halftonePresets, defaultBase(['#172554', '#e11d48', '#f8fafc'], '#f5f2e9', { spacing: 16, dotSize: 9, dotShape: 'dots-1', angle: 22, density: 70, contrast: 82, channelSeparation: 0 }), halftoneControls, buildHalftone),
  withShared('prism', 'Prism & Refraction', 'Procedural spectral splitting with SVG turbulence displacement; not a physically accurate optical simulation.', prismPresets, defaultBase(['#fb7185', '#fde68a', '#67e8f9'], '#090b20', { dispersion: 68, refraction: 55, frequency: 32, prismAngle: 38, layers: 3, highlight: 68 }), prismControls, buildPrism),
  withShared('metallic', 'Metallic', '2D reflective banding and directional surface texture for polished, brushed, or patinated metal looks.', metallicPresets, defaultBase(['#111827', '#e5edf3', '#617080'], '#131a22', { roughness: 32, bandScale: 42, brushed: 46, scratches: 12, oxidation: 0 }), metalControls, buildMetallic),
  withShared('glass', 'Glass', 'Tinted, frosted, and highlighted glass-like overlays. The preview includes a configurable background; no true optical depth is implied.', glassPresets, defaultBase(['#b8ecff', '#ffffff', '#6bc4e8'], '#24364b', { tintOpacity: 32, frost: 28, refraction: 28, edge: 68, droplets: 0 }), glassControls, buildGlass),
  withShared('holographic', 'Holographic', 'Procedural iridescent spectrum, diffraction lines, and foil grain; not a thin-film physics simulation.', holoPresets, defaultBase(['#ff4d9d', '#ffc857', '#4de2c5', '#7272ff'], '#171329', { frequency: 64, spread: 72, intensity: 78, grain: 18, distortion: 28 }), holoControls, buildHolographic),
];

export const VISUAL_BUILDERS = defs;
export const visualBuilder = (id: VisualBuilderId) => defs.find(builder => builder.id === id)!;
export function mergeVisualConfig(baseConfig: VisualConfig, patch: Partial<VisualConfig>): VisualConfig {
  const merged = { ...baseConfig };
  Object.entries(patch).forEach(([key, value]) => { if (value !== undefined) merged[key] = value; });
  return merged;
}
export const visualConfig = (id: VisualBuilderId, preset?: VisualPreset): VisualConfig => mergeVisualConfig(visualBuilder(id).defaults, preset?.values ?? {});
export const buildVisual = (id: VisualBuilderId, config: VisualConfig) => {
  const generated = visualBuilder(id).build(config);
  return generated.map((layer, index) => {
    layer.anim.duration = Math.max(6, 56 - Math.max(0, Math.min(100, num(config, 'speed', 48))) * 0.44);
    layer.anim.enabled = config.animate !== false && layer.anim.tracks.length > 0;
    layer.opacity = opacity(layer.opacity * Math.max(0, Math.min(100, num(config, 'layerOpacity', 100))) / 100);
    const selectedBlend = BLEND_MODES.find(mode => mode === config.blendMode);
    if (index < generated.length - 1 && selectedBlend) layer.blend = selectedBlend;
    if (config.transparent === true && index === generated.length - 1) layer.stops = layer.stops.map(colorStop => ({ ...colorStop, alpha: 0 }));
    if (layer.texture.enabled) layer.texture.seed = Math.round(num(config, 'seed', 7)) + index;
    layer.noise.seed = Math.round(num(config, 'seed', 7)) + index;
    layer.anim.tracks.forEach((track, i) => { track.id = `${layer.id}-track-${index}-${i}`; });
    return layer;
  });
};
export const visualSeed = (config: VisualConfig) => num(config, 'seed', 7);
export const updateVisualColor = (config: VisualConfig, index: number, color: string): VisualConfig => {
  const colors = palette(config);
  return { ...config, palette: colors.map((current, i) => i === index ? color : current) };
};
