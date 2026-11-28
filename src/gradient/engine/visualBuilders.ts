import { newEffect } from './effects';
import { BLEND_MODES, DEFAULT_MESH, DEFAULT_TEXTURE, newLayer, stop, type BlendMode, type ColorStop, type GradientLayer, type TextureData } from './model';
import { newMeshPoint } from './mesh';
import { TEXTURES, reliefGeometry } from './textures';
import { mulberry } from './rng';
import { bandStops, clamp, darken, glow, lighten, mixHex, pick, pickFalloff, softenStops, spectrumStops, streamline } from './sceneMath';

export type VisualBuilderId = 'fluid' | 'light' | 'ink' | 'halftone' | 'prism' | 'metallic' | 'glass' | 'holographic' | 'relief';
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
  { id: 'editorial', name: 'Editorial Print', values: { palette: ['#172554', '#e11d48', '#f8fafc'], spacing: 18, dotSize: 10, dotShape: 'dots-1', angle: 22, density: 68, contrast: 82, channelSeparation: 0, tone: 25 } },
  { id: 'cmyk', name: 'CMYK Pop', values: { palette: ['#00a8e8', '#ec008c', '#fff200'], spacing: 15, dotSize: 10, dotShape: 'dots-10', angle: 15, density: 82, contrast: 96, channelSeparation: 8 } },
  { id: 'mono', name: 'Monochrome Poster', values: { palette: ['#050505', '#555555', '#ffffff'], spacing: 12, dotSize: 9, dotShape: 'geometric-9', angle: 45, density: 74, contrast: 100, channelSeparation: 0 } },
  { id: 'vintage', name: 'Vintage Newspaper', values: { palette: ['#28231e', '#817765', '#e9dfc9'], spacing: 22, dotSize: 12, dotShape: 'dots-6', angle: 18, density: 54, contrast: 72, channelSeparation: 0 } },
  { id: 'gradient', name: 'Gradient Dots', values: { palette: ['#f72585', '#7209b7', '#4cc9f0'], spacing: 14, dotSize: 8, dotShape: 'dots-1', angle: 32, density: 88, contrast: 90, channelSeparation: 2, tone: 60, softness: 10 } },
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
  { id: 'polished', name: 'Polished Silver', values: { palette: ['#1a2230', '#ffffff', '#8794a3'], roughness: 10, bandScale: 36, brushed: 4, scratches: 2, oxidation: 0, reflections: 5 } },
  { id: 'dark', name: 'Dark Metal', values: { palette: ['#05070a', '#7e8b99', '#222a33'], roughness: 42, bandScale: 30, brushed: 40, scratches: 20, oxidation: 0, reflections: 3 } },
  { id: 'liquid', name: 'Liquid Metal', values: { palette: ['#0b1017', '#f2f7fb', '#5f6f80'], roughness: 6, bandScale: 55, brushed: 0, scratches: 0, oxidation: 0, reflections: 3, finish: 'radial' } },
  { id: 'anodized', name: 'Anodized Rainbow', values: { palette: ['#00d4ff', '#ab47bc', '#ff7043'], roughness: 26, bandScale: 50, brushed: 42, scratches: 6, oxidation: 0 } },
];
const glassPresets: VisualPreset[] = [
  { id: 'clear', name: 'Clear Crystal', values: { palette: ['#b8ecff', '#ffffff', '#6bc4e8'], tintOpacity: 12, frost: 6, refraction: 28, edge: 78, droplets: 0 } },
  { id: 'frosted', name: 'Frosted Panel', values: { palette: ['#cbe8f2', '#ffffff', '#8db9ca'], tintOpacity: 35, frost: 88, refraction: 12, edge: 42, droplets: 0 } },
  { id: 'smoked', name: 'Smoked Glass', values: { palette: ['#101820', '#82909c', '#293642'], tintOpacity: 68, frost: 24, refraction: 18, edge: 58, droplets: 0 } },
  { id: 'arctic', name: 'Arctic Glass', values: { palette: ['#5bc0eb', '#effaff', '#b8ecff'], tintOpacity: 42, frost: 46, refraction: 36, edge: 88, droplets: 12 } },
  { id: 'liquid', name: 'Liquid Glass', values: { palette: ['#a5f3fc', '#ffffff', '#818cf8'], tintOpacity: 30, frost: 16, refraction: 72, edge: 76, droplets: 24 } },
  { id: 'translucent', name: 'Soft Translucent', values: { palette: ['#d9f0ff', '#ffffff', '#a9d6ee'], tintOpacity: 18, frost: 54, refraction: 10, edge: 50, droplets: 0, thickness: 14, reflection: 40 } },
  { id: 'colored', name: 'Colored Glass', values: { palette: ['#ff7ab6', '#ffe4f1', '#9b5de5'], tintOpacity: 58, frost: 22, refraction: 30, edge: 70, droplets: 0, thickness: 8, reflection: 60 } },
  { id: 'crystal', name: 'Crystal', values: { palette: ['#c7f0ff', '#ffffff', '#9ad4f5'], tintOpacity: 10, frost: 0, refraction: 40, edge: 95, droplets: 0, thickness: 6, reflection: 80 } },
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
const reliefPresets: VisualPreset[] = [
  { id: 'roofing', name: 'Painted roofing sheet', values: { palette: ['#f78009', '#db1523', '#1fe088', '#088be2'], pattern: 'relief-painted-roofing', ridgeWidth: 79, ridgeCount: 0, angle: 0, depth: 55, occlusion: 0, light: -35, gloss: 40, softness: 50, strength: 100, shadowTint: 0, colorSize: 100, split: 50, tilt: -13, leftChange: 33, rightChange: 68, sheen: 0, grain: 0 } },
  { id: 'trapezoid', name: 'Trapezoid tin roof', values: { palette: ['#ffb347', '#ff5e62', '#8e54e9', '#2b2d8f'], pattern: 'relief-trapezoid-roofing', ridgeWidth: 90, ridgeCount: 0, angle: 0, depth: 70, occlusion: 40, light: -45, gloss: 55, strength: 100, shadowTint: 40, colorSize: 100, sheen: 20, grain: 10 } },
  { id: 'diagonal', name: 'Diagonal corrugation', values: { palette: ['#fde047', '#fb7185', '#6366f1', '#0ea5e9'], pattern: 'relief-corrugated-sheet', ridgeWidth: 60, ridgeCount: 0, angle: 32, depth: 65, occlusion: 40, light: -30, gloss: 60, strength: 100, shadowTint: 35, colorSize: 100, sheen: 0, grain: 6 } },
  { id: 'fluted', name: 'Fluted glass', values: { palette: ['#d9f99d', '#5eead4', '#38bdf8', '#818cf8'], pattern: 'relief-fluted-glass', ridgeWidth: 26, ridgeCount: 0, angle: 0, depth: 70, occlusion: 35, light: 20, gloss: 120, strength: 90, shadowTint: 45, colorSize: 100, sheen: 35, grain: 0 } },
  { id: 'ribs', name: 'Dark metal ribs', values: { palette: ['#1e293b', '#1d4ed8', '#be185d', '#f97316'], pattern: 'relief-round-ribs', ridgeWidth: 54, ridgeCount: 0, angle: 0, depth: 80, occlusion: 50, light: -50, gloss: 100, strength: 100, shadowTint: 20, colorSize: 100, sheen: 25, grain: 12 } },
  { id: 'pleats', name: 'Silk pleats', values: { palette: ['#fbcfe8', '#fde68a', '#a5f3fc', '#c4b5fd'], pattern: 'relief-pleated-fold', ridgeWidth: 48, ridgeCount: 0, angle: 0, depth: 60, occlusion: 40, light: -40, gloss: 90, strength: 85, shadowTint: 55, colorSize: 100, sheen: 30, grain: 0 } },
  { id: 'sawtooth', name: 'Sawtooth panel', values: { palette: ['#f97316', '#facc15', '#22c55e', '#06b6d4'], pattern: 'relief-sawtooth-ridges', ridgeWidth: 56, ridgeCount: 0, angle: 0, depth: 70, occlusion: 40, light: -40, gloss: 70, strength: 100, shadowTint: 40, colorSize: 100, sheen: 0, grain: 8 } },
  { id: 'dunes', name: 'Wide dunes', values: { palette: ['#fbbf24', '#f97316', '#be123c', '#4c1d95'], pattern: 'relief-wide-swell', ridgeWidth: 260, ridgeCount: 0, angle: 0, depth: 60, occlusion: 35, light: -35, gloss: 60, strength: 95, shadowTint: 50, colorSize: 100, sheen: 15, grain: 6 } },
  { id: 'pillows', name: 'Pillow quilt', values: { palette: ['#fda4af', '#fcd34d', '#a78bfa', '#38bdf8'], pattern: 'relief-pillow-bumps', ridgeWidth: 70, ridgeCount: 0, angle: 0, depth: 100, occlusion: 90, light: -35, gloss: 110, strength: 90, shadowTint: 50, colorSize: 100, sheen: 0, grain: 0 } },
  { id: 'hobnail', name: 'Hobnail glass', values: { palette: ['#a5f3fc', '#e9d5ff', '#fbcfe8', '#bbf7d0'], pattern: 'relief-hobnail', ridgeWidth: 40, ridgeCount: 0, angle: 0, depth: 95, occlusion: 80, light: -30, gloss: 180, strength: 90, shadowTint: 60, colorSize: 100, sheen: 20, grain: 0 } },
];
const reliefPatternOptions = TEXTURES.filter(t => t.family === 'relief').map(t => ({ id: t.id, label: t.label }));
const reliefControls: VisualControl[] = [
  { key: 'pattern', label: 'Surface pattern', min: 0, max: 0, options: reliefPatternOptions },
  ctrl('ridgeWidth', 'Ridge width', 12, 300, 'px'), ctrl('ridgeCount', 'Ridges per tile (0 = pattern default)', 0, 12, '', 1), ctrl('angle', 'Ridge direction', 0, 360, '°'),
  ctrl('depth', 'Relief depth', 0, 200), ctrl('occlusion', 'Valley shadow', 0, 200), ctrl('light', 'Light direction', -90, 90, '°'), ctrl('gloss', 'Gloss', 0, 300), ctrl('softness', 'Edge softness', 0, 100),
  ctrl('strength', 'Relief strength', 0, 100), ctrl('shadowTint', 'Shadow tint', 0, 100), ctrl('colorSize', 'Colour blend width', 30, 160), ctrl('split', 'Colour split position', 10, 90), ctrl('tilt', 'Colour split tilt', -60, 60), ctrl('leftChange', 'Left colour change height', 10, 90), ctrl('rightChange', 'Right colour change height', 10, 90), ctrl('sheen', 'Sheen', 0, 100), ctrl('grain', 'Paint grain', 0, 100),
];

const fluidControls = [ctrl('flowAngle', 'Flow direction', 0, 360, '°'), ctrl('flow', 'Flow intensity', 0, 100), ctrl('turbulence', 'Turbulence', 0, 100), ctrl('viscosity', 'Viscosity', 0, 100), ctrl('swirl', 'Swirl', 0, 100), ctrl('warp', 'Warp amplitude', 0, 100), ctrl('diffusion', 'Diffusion', 0, 100), ctrl('scale', 'Flow scale', 10, 100), ctrl('eddies', 'Eddies', 2, 8, '', 1)];
const lightControls = [ctrl('sourceCount', 'Light sources', 1, 6, '', 1), ctrl('sourceX', 'Source position X', 0, 100), ctrl('sourceY', 'Source position Y', 0, 100), ctrl('radius', 'Source radius', 12, 100), ctrl('intensity', 'Intensity', 5, 100), ctrl('falloff', 'Light falloff', 0, 100), ctrl('coreBrightness', 'Core brightness', 0, 100), ctrl('beamLength', 'Beam length', 20, 100), ctrl('angle', 'Beam direction', 0, 360, '°'), ctrl('spread', 'Beam spread', 4, 80), ctrl('glow', 'Glow radius', 0, 100), ctrl('halo', 'Halo intensity', 0, 100), { key: 'falloffType', label: 'Falloff model', min: 0, max: 0, options: [{ id: 'inverse-square', label: 'Inverse square' }, { id: 'gaussian', label: 'Gaussian' }, { id: 'exponential', label: 'Exponential' }, { id: 'smooth', label: 'Smooth' }] }];
const inkControls = [ctrl('flowAngle', 'Flow direction', 0, 360, '°'), ctrl('inkDensity', 'Ink density', 0, 100), ctrl('smokeDensity', 'Smoke density', 0, 100), ctrl('turbulence', 'Turbulence', 0, 100), ctrl('curl', 'Curl', 0, 100), ctrl('diffusion', 'Diffusion', 0, 100), ctrl('edge', 'Edge definition', 0, 100), ctrl('layerCount', 'Plume groups', 1, 8, '', 1)];
const halftoneControls: VisualControl[] = [
  ctrl('spacing', 'Dot spacing', 6, 36, 'px'), ctrl('dotSize', 'Dot size', 1, 24, 'px'),
  { key: 'dotShape', label: 'Dot shape', min: 0, max: 0, options: [{ id: 'dots-1', label: 'Round' }, { id: 'dots-10', label: 'Diamond' }, { id: 'dots-6', label: 'Stipple' }, { id: 'geometric-9', label: 'Square' }] },
  ctrl('angle', 'Screen angle', 0, 90, '°'), ctrl('density', 'Dot density', 0, 100), ctrl('contrast', 'Contrast', 0, 100), ctrl('channelSeparation', 'Channel separation', 0, 16, 'px'),
  ctrl('tone', 'Gradient tone', 0, 100), ctrl('softness', 'Dot softness', 0, 100),
  { key: 'antiMoire', label: 'Moiré control', min: 0, max: 0, options: [{ id: 'on', label: 'Standard screen angles' }, { id: 'off', label: 'Allow moiré' }] },
];
const prismControls = [ctrl('dispersion', 'Dispersion', 0, 100), ctrl('refraction', 'Refraction', 0, 100), ctrl('frequency', 'Distortion scale', 4, 80), ctrl('prismAngle', 'Prism angle', 0, 90, '°'), ctrl('layers', 'Optical layers', 1, 6, '', 1), ctrl('highlight', 'Highlight intensity', 0, 100)];
const metalControls = [ctrl('angle', 'Brushed direction', 0, 360, '°'), ctrl('roughness', 'Surface roughness', 0, 100), ctrl('bandScale', 'Reflection band scale', 10, 90), ctrl('brushed', 'Brushed directionality', 0, 100), ctrl('scratches', 'Micro-scratches', 0, 100), ctrl('oxidation', 'Oxidation', 0, 100), ctrl('reflections', 'Reflections', 2, 8, '', 1), { key: 'finish', label: 'Reflection model', min: 0, max: 0, options: [{ id: 'linear', label: 'Linear bands' }, { id: 'radial', label: 'Liquid (radial)' }, { id: 'anisotropic', label: 'Anisotropic (conic)' }] }];
const glassControls = [ctrl('angle', 'Highlight direction', 0, 360, '°'), ctrl('tintOpacity', 'Tint opacity', 0, 100), ctrl('frost', 'Frost amount', 0, 100), ctrl('refraction', 'Refraction', 0, 100), ctrl('edge', 'Edge highlight', 0, 100), ctrl('droplets', 'Condensation', 0, 100), ctrl('thickness', 'Glass thickness', 2, 30), ctrl('reflection', 'Specular reflection', 0, 100)];
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

/** Rotation of the main flow, in radians, shared by the fluid-like builders. */
const radians = (degrees: number) => (degrees * Math.PI) / 180;

function buildFluid(c: VisualConfig) {
  const colors = palette(c), seed = Math.round(num(c, 'seed', 7)), rnd = mulberry(seed * 241 + 3);
  const flow = num(c, 'flow', 58), turbulence = num(c, 'turbulence', 55), swirl = num(c, 'swirl', 50), visc = num(c, 'viscosity', 40), warp = num(c, 'warp', 60), diffusion = num(c, 'diffusion', 36);
  const scale = num(c, 'scale', 50), drift = num(c, 'flowAngle', 28), count = clamp(Math.round(num(c, 'eddies', 5)), 2, 8), heading = radians(drift);
  const layers: GradientLayer[] = [];
  // Eddies are strung along two streamlines of a curl-noise field and each one is stretched and turned to face the local flow,
  // so the result reads as moving liquid rather than blobs on a ring.
  const lines = 2, perLine = Math.ceil(count / lines);
  let placed = 0;
  for (let line = 0; line < lines && placed < count; line++) {
    const path = streamline(seed * 7 + line * 31 + 5, 50 - Math.cos(heading) * 30 + (rnd() - 0.5) * 20 + (line ? 12 : -12), 50 - Math.sin(heading) * 26 + (rnd() - 0.5) * 20 + (line ? 8 : -8), perLine,
      { step: 19 + flow * 0.2, scale: 0.8 + scale / 36, drift, turbulence: turbulence / 100 });
    for (const point of path) {
      if (placed >= count) break;
      const eddy = glow({
        name: `Flow eddy ${placed + 1}`, color: col(colors, placed), cx: clamp(point.x, -5, 105), cy: clamp(point.y, -5, 105),
        rx: (26 + rnd() * 16) * (1 + point.speed * 0.8) * (0.9 + flow / 200), ry: (15 + rnd() * 10) * (0.85 + diffusion / 160),
        rotate: point.angle, alpha: Math.min(1, (0.24 + flow / 170) * 1.12), blur: Math.round(diffusion / 10), falloff: 'gaussian', tight: 28 + turbulence * 0.3,
      });
      warped(eddy, warp * 0.5 + turbulence * 0.24, 4 + turbulence / 10, seed + placed);
      if (placed < 2) animated(eddy, 32 + placed * 9);
      layers.push(eddy);
      placed++;
    }
  }
  const vortex = newLayer('conic', {
    name: 'Vortex flow', cx: 50 + (rnd() - 0.5) * 38, cy: 48 + (rnd() - 0.5) * 34, angle: rnd() * 360, repeating: true, space: 'oklch',
    repeat: { size: 92 - swirl * 0.48, unit: 'deg', offset: rnd() * 24 }, blend: 'soft-light', opacity: 0.14 + swirl / 330, shaping: { seam: 25 },
    stops: softenStops([stop(col(colors, 1), 0, 0), stop(col(colors, 0), 45, 0.5), stop(col(colors, 2), 54, 0.42), stop(col(colors, 1), 100, 0)]),
  });
  warped(vortex, turbulence * 0.55, 9, seed);
  layers.push(animated(vortex, Math.max(8, 56 - flow * 0.35), true));
  layers.push(glow({ name: 'Viscous membrane', color: col(colors, 2), cx: 50, cy: 52, rx: 72 + visc * 0.12, ry: 60 + visc * 0.16, alpha: 0.12 + visc / 420, blend: 'overlay', blur: Math.round(diffusion / 7), falloff: 'smooth', tight: 20 }));
  layers.push(base('Fluid field', c, colors));
  return layers;
}

function buildLight(c: VisualConfig) {
  const colors = palette(c), seed = Math.round(num(c, 'seed', 9)), rnd = mulberry(seed * 317 + 5), count = clamp(Math.round(num(c, 'sourceCount', 2)), 1, 6);
  const intensity = num(c, 'intensity', 65), radius = num(c, 'radius', 48), spread = num(c, 'spread', 32), bloom = num(c, 'glow', 65), halo = num(c, 'halo', 56);
  const coreBrightness = num(c, 'coreBrightness', 70), beamLength = num(c, 'beamLength', 70), angle = num(c, 'angle', 24);
  const kind = pickFalloff(c.falloffType, 'inverse-square'), tight = 6 + num(c, 'falloff', 50) * 0.5;
  const originX = num(c, 'sourceX', 50), originY = num(c, 'sourceY', 42);
  const layers: GradientLayer[] = [];
  // Soft volumetric shafts: smooth lobes (no hard ray edges) fanning out of the main source.
  const shafts = newLayer('conic', {
    name: 'Volumetric shafts', cx: originX, cy: originY, angle, repeating: true, space: 'oklab', repeat: { size: 32 + spread * 0.42, unit: 'deg', offset: 0 },
    blend: 'screen', opacity: intensity / 330,
    stops: softenStops([stop(col(colors, 0), 0, 0), stop(col(colors, 0), 36, 0), stop(col(colors, 1), 50, 0.7), stop(col(colors, 2), 64, 0), stop(col(colors, 2), 100, 0)]),
    effects: [newEffect('blur', { radius: 4 })],
  });
  layers.push(animated(shafts, 34));
  for (let i = 0; i < count; i++) {
    const x = i === 0 ? originX : clamp(originX + (rnd() - 0.5) * 34, 0, 100), y = i === 0 ? originY : clamp(originY + (rnd() - 0.5) * 26, 0, 100), color = col(colors, i);
    layers.push(glow({ name: `Light source ${i + 1}`, color, cx: x, cy: y, rx: radius * (1 + rnd() * 0.5), ry: radius * (1.15 + rnd() * 0.55), alpha: Math.min(1, intensity / 92), core: 0.55 + coreBrightness / 220, blur: Math.round(bloom / 9), falloff: kind, tight }));
    layers.push(glow({ name: `Core ${i + 1}`, color: lighten(color, 0.55), cx: x, cy: y, rx: radius * (0.12 + coreBrightness / 420), ry: radius * (0.14 + coreBrightness / 380), alpha: Math.min(1, 0.35 + coreBrightness / 170), blend: 'plus-lighter', falloff: 'gaussian', tight: 40 }));
    layers.push(glow({ name: `Halo ${i + 1}`, color, cx: x, cy: y, rx: radius * (1.1 + bloom / 45), ry: radius * (1.2 + bloom / 36), alpha: halo / 230, blur: Math.round(bloom / 4), falloff: 'gaussian', tight: 22 }));
    // each beam is anchored to its source and fades along its length, instead of a band that crosses the whole canvas
    const direction = angle + (rnd() - 0.5) * spread * 0.8, length = 16 + beamLength * 0.6, rad = radians(direction);
    layers.push(animated(glow({
      name: `Light beam ${i + 1}`, color: lighten(color, 0.25), cx: x + Math.cos(rad) * length * 0.42, cy: y + Math.sin(rad) * length * 0.42, rx: length, ry: 3 + spread * 0.17,
      rotate: direction, alpha: 0.18 + intensity / 260, blur: 3, falloff: 'exponential', tight: 55,
    }), 22 + i * 5));
  }
  layers.push(base('Illumination field', c, colors));
  return layers;
}

function buildInk(c: VisualConfig) {
  const colors = palette(c), seed = Math.round(num(c, 'seed', 13)), rnd = mulberry(seed * 419 + 11), ink = num(c, 'inkDensity', 70), smoke = num(c, 'smokeDensity', 55), turbulence = num(c, 'turbulence', 60), curl = num(c, 'curl', 55), diffusion = num(c, 'diffusion', 45), edge = num(c, 'edge', 55);
  const groups = clamp(Math.round(num(c, 'layerCount', 3)), 1, 8), drift = num(c, 'flowAngle', 28), heading = radians(drift);
  const layers: GradientLayer[] = [];
  for (let g = 0; g < groups; g++) {
    const startX = 18 + ((g + 0.5) / groups) * 64 + (rnd() - 0.5) * 14 - Math.cos(heading) * 12, startY = 34 + rnd() * 34 - Math.sin(heading) * 10;
    // every plume group follows its own streamline: pigment is deposited at the head and spreads and thins downstream
    const path = streamline(seed * 13 + g * 17 + 3, startX, startY, 4, { step: 9 + diffusion * 0.12, scale: 1 + curl / 28, drift, turbulence: (turbulence * 0.55 + curl * 0.45) / 100 });
    const head = path[0], tail = path[2], end = path[3], color = col(colors, g), next = col(colors, g + 1);
    // edge definition = how far the pigment stays flat before it fades, plus a little blur when the edge is soft
    const deposit = glow({
      name: `Pigment bloom ${g + 1}`, color, cx: head.x, cy: head.y, rx: (13 + ink * 0.2) * (1 + head.speed * 0.35), ry: (16 + ink * 0.22) * (1 - head.speed * 0.1),
      rotate: head.angle, alpha: Math.min(1, 0.2 + ink / 120), blend: 'multiply', blur: Math.round((100 - edge) / 14), plateau: 28 + edge * 0.62,
    });
    warped(deposit, turbulence * 0.75 + curl * 0.36, 6 + curl / 8, seed + g);
    layers.push(deposit);
    const plume = glow({
      name: `Smoke plume ${g + 1}`, color: next, cx: tail.x, cy: tail.y, rx: (22 + smoke * 0.28) * (1 + tail.speed * 0.7), ry: 13 + smoke * 0.16,
      rotate: tail.angle, alpha: Math.min(1, 0.12 + smoke / 190), blur: Math.round(diffusion / 5), falloff: 'gaussian', tight: 30 + (100 - diffusion) * 0.2,
    });
    warped(plume, turbulence * 0.45 + smoke * 0.22, 4 + turbulence / 12, seed + g + 9);
    layers.push(animated(plume, 42 + g * 13));
    if (g < Math.min(groups, groups <= 5 ? 5 : 3)) {
      layers.push(glow({
        name: `Smoke wisp ${g + 1}`, color: lighten(next, 0.2), cx: end.x, cy: end.y, rx: 12 + rnd() * 10 + turbulence / 10, ry: 1.8 + rnd() * 1.6,
        rotate: end.angle + (rnd() - 0.5) * 40, alpha: Math.min(1, 0.16 + smoke / 300), blur: 1 + Math.round(diffusion / 40), falloff: 'exponential', tight: 60,
      }));
    }
  }
  const tendrils = newLayer('conic', {
    name: 'Pigment tendrils', cx: 50, cy: 54, angle: drift, repeating: true, space: 'oklab', repeat: { size: 38 + curl * 0.42, unit: 'deg', offset: rnd() * 40 }, blend: 'multiply', opacity: 0.13 + ink / 340,
    stops: softenStops([stop(col(colors, 0), 0, 0), stop(col(colors, 1), 44, 0.65), stop(col(colors, 2), 56, 0.2), stop(col(colors, 0), 100, 0)]),
    effects: [newEffect('blur', { radius: 2 + Math.round((100 - edge) / 20) })],
  });
  warped(tendrils, turbulence * 0.5 + curl * 0.3, 7 + curl / 10, seed);
  layers.push(tendrils);
  layers.push(base('Ink & smoke · ground', c, colors));
  return layers;
}

function buildHalftone(c: VisualConfig) {
  const colors = palette(c), seed = Math.round(num(c, 'seed', 7)), spacing = Math.round(num(c, 'spacing', 16)), dot = num(c, 'dotSize', 9), angle = num(c, 'angle', 22), density = num(c, 'density', 70), separation = num(c, 'channelSeparation', 0);
  const tone = num(c, 'tone', 0), softness = num(c, 'softness', 0), contrast = num(c, 'contrast', 82), aligned = c.antiMoire !== 'off';
  const shape = pick(c.dotShape, ['dots-1', 'dots-10', 'dots-6', 'geometric-9'] as const, 'dots-1');
  const layers: GradientLayer[] = [];
  const screens = separation > 0 ? 3 : 1;
  // Anti-moiré on: the standard print screen angles (15° / 75° / 0°, relative to the chosen angle) at one common pitch, which makes the
  // familiar rosette. Off: a slightly different pitch per channel and 30° steps, which deliberately beats into moiré.
  const offsets = aligned ? [0, 60, -15] : [0, 30, 60];
  for (let i = 0; i < screens; i++) {
    const ink = col(colors, i), screenAngle = angle + (separation ? offsets[i] : 0), pitch = Math.max(6, aligned ? spacing : spacing * (1 + i * 0.025));
    const l = linear(separation ? `Halftone screen ${i + 1}` : 'Halftone screen', [ink, col(colors, (i + 1) % colors.length)], screenAngle, separation ? 'multiply' : 'normal', 0.25 + density / 115);
    l.stops = [stop(ink, 0, 0), stop(ink, 100, 0)];
    l.texture = { ...l.texture, enabled: true, pattern: shape, scale: pitch, density: Math.max(1, Math.min(100, density)), opacity: Math.max(20, Math.min(100, dot * 7)), angle: screenAngle, seed: seed + i, color: ink, blend: 'multiply' };
    l.effects.push(newEffect('contrast', { amount: 60 + contrast * 1.4 }));
    if (softness > 0) l.effects.push(newEffect('blur', { radius: Math.round((softness / 28) * 10) / 10 }));
    // the control is in px at a typical 1200 px canvas; transforms are a % of the canvas, and a small scale keeps the shifted screen covering the edges
    if (separation) l.transform = { ...l.transform, x: (i === 1 ? separation : -separation * 0.5) * 0.08, y: (i === 2 ? separation * 0.7 : 0) * 0.08, scale: 1.03 };
    layers.push(l);
  }
  // gradient-to-pattern: a tone ramp under the dots, so a smooth gradient reads through the screen as a halftone
  if (tone > 0) layers.push(linear('Halftone tone', colors, angle + 90, 'normal', clamp(tone / 125, 0, 0.8)));
  layers.push(base('Print · paper', c, colors));
  return layers;
}

function buildPrism(c: VisualConfig) {
  const colors = palette(c), seed = Math.round(num(c, 'seed', 17)), rnd = mulberry(seed * 523 + 7), amount = num(c, 'dispersion', 68), refraction = num(c, 'refraction', 55), freq = num(c, 'frequency', 32), count = clamp(Math.round(num(c, 'layers', 3)), 1, 6);
  const angle = num(c, 'prismAngle', 38), highlight = num(c, 'highlight', 68), axis = radians(angle);
  const layers: GradientLayer[] = [];
  // the prism itself: a faint wedge of glass with a thin bright line on each face
  const edgeLight = linear('Prism · edge light', ['#ffffff', '#ffffff'], angle + 90, 'plus-lighter', 0.22 + highlight / 170);
  edgeLight.stops = [stop('#ffffff', 0, 0), stop('#ffffff', 27.2, 0, { ease: 'smootherstep' }), stop('#ffffff', 28, 0.9, { ease: 'smootherstep' }), stop('#ffffff', 29, 0), stop('#ffffff', 55, 0, { ease: 'smootherstep' }), stop('#ffffff', 56, 0.55, { ease: 'smootherstep' }), stop('#ffffff', 57.4, 0), stop('#ffffff', 100, 0)];
  layers.push(edgeLight);
  const body = linear('Prism · glass body', [lighten(col(colors, 2), 0.6), lighten(col(colors, 0), 0.6)], angle + 90, 'screen', 0.1 + refraction / 500);
  body.stops = [stop('#ffffff', 0, 0), ...bandStops(lighten(col(colors, 2), 0.6), 42, 15, 0.5).slice(1)];
  layers.push(body);
  // dispersion splits each refraction into offset colour channels, like chromatic aberration
  for (let i = 0; i < count; i++) {
    const cx = 14 + ((i + 0.5) / count) * 72 + (rnd() - 0.5) * 12, cy = 24 + rnd() * 50, rx = 20 + rnd() * 26, ry = 24 + rnd() * 30;
    const offset = amount * 0.1, mode: BlendMode = i % 2 ? 'screen' : 'plus-lighter', alpha = Math.min(1, 0.16 + amount / 200);
    const main = glow({ name: `Spectral refraction ${i + 1}`, color: col(colors, i), cx, cy, rx, ry, alpha, blend: mode, blur: Math.round((100 - refraction) / 16), rotate: angle + (rnd() - 0.5) * 30, falloff: 'gaussian', tight: 35 });
    warped(main, refraction * 0.38 + amount * 0.3, freq * 0.55, seed + i);
    layers.push(main);
    if (amount > 12) layers.push(glow({
      name: `Chromatic offset ${i + 1}`, color: col(colors, i + 1), cx: cx + Math.cos(axis) * offset, cy: cy + Math.sin(axis) * offset, rx: rx * 0.92, ry: ry * 0.92,
      alpha: alpha * 0.7, blend: 'screen', blur: Math.round((100 - refraction) / 16), rotate: angle, falloff: 'gaussian', tight: 35,
    }));
  }
  // the dispersed spectrum: a controlled band of palette colours in a hue-aware space, fading out at both ends
  const spectrum = linear('Dispersed spectrum', colors, angle, 'screen', 0.3 + highlight / 170);
  spectrum.space = 'oklch';
  spectrum.stops = spectrumStops(colors, 66, 8 + amount * 0.28, 0.72);
  spectrum.effects.push(newEffect('distort', { scale: refraction * 0.36, freq: Math.max(2, freq / 3), seed: (Math.abs(seed) % 99) + 1 }));
  layers.push(animated(spectrum, 26, true));
  layers.push(base('Prismatic field', c, colors));
  return layers;
}

/** The reflection environment of a metal surface: soft bright strips (a window, a horizon) between darker tones. Roughness widens the
 *  transitions, which is what separates polished chrome from brushed metal. */
function metalEnvironment(colors: string[], count: number, band: number, rough: number, rnd: () => number): ColorStop[] {
  const dark = col(colors, 0), light = col(colors, 1), mid = col(colors, 2), share = 100 / count;
  const soft = Math.min(1.2 + rough * 0.2, share * 0.14), halfBase = 2.5 + band / 9;
  const stops: ColorStop[] = [];
  let cursor = 0;
  // stops stay strictly ordered (never two stops at one position), otherwise two different tones would meet in a hard step
  const add = (color: string, position: number) => { cursor = clamp(Math.max(position, stops.length ? cursor + 0.4 : 0), 0, 100); stops.push(stop(color, cursor, 1, { ease: 'smootherstep' })); };
  add(dark, 0);
  for (let k = 0; k < count; k++) {
    const half = Math.min(halfBase * (0.75 + rnd() * 0.6) * (k % 2 ? 0.7 : 1), share * 0.22), jittered = ((k + 0.5) / count) * 100 + (rnd() - 0.5) * 0.24 * share;
    // keep every reflection fully inside the ramp: a strip that starts before 0% or ends after 100% would collapse its soft transition into a hard edge
    const centre = clamp(jittered, half + soft + 1, 100 - half - soft - 1);
    const tone = k % 2 ? mid : dark, lit = k % 2 ? light : lighten(light, 0.55 * (1 - rough / 140));
    add(tone, centre - half - soft); add(lit, centre - half * 0.35); add(lit, centre + half * 0.35); add(tone, centre + half + soft);
  }
  add(dark, 100);
  return stops;
}

function buildMetallic(c: VisualConfig) {
  const colors = palette(c), seed = Math.round(num(c, 'seed', 7)), rnd = mulberry(seed * 977 + 23), angle = num(c, 'angle', 90), band = num(c, 'bandScale', 42), rough = num(c, 'roughness', 32), brushed = num(c, 'brushed', 46), scratches = num(c, 'scratches', 12), oxidation = num(c, 'oxidation', 0);
  const reflections = clamp(Math.round(num(c, 'reflections', 4)), 2, 8), finish = pick(c.finish, ['linear', 'radial', 'anisotropic'] as const, 'linear');
  const stops = metalEnvironment(colors, reflections, band, rough, rnd);
  // liquid metal starts from a hot highlight instead of a dark pupil, so the rings read as flowing reflections, not a target
  if (finish === 'radial') stops[0] = { ...stops[0], color: lighten(col(colors, 1), 0.4) };
  const main = finish === 'radial' ? newLayer('radial', { name: 'Metal · reflective bands', cx: 36, cy: 34, rx: 95, ry: 95, space: 'oklab', stops })
    : finish === 'anisotropic' ? newLayer('conic', { name: 'Metal · anisotropic highlights', cx: 50, cy: 50, angle, space: 'oklab', stops })
      : newLayer('linear', { name: 'Metal · reflective bands', angle, space: 'oklab', stops });
  const layers: GradientLayer[] = [];
  const sheen = linear('Metal · polished sheen', ['#ffffff', col(colors, 1), '#ffffff'], angle + 90, 'screen', 0.12 + (100 - rough) / 180);
  sheen.stops = bandStops('#ffffff', 50, 9 + rough * 0.1, 0.7);
  layers.push(animated(sheen, 18));
  const grain = linear('Directional metal grain', [col(colors, 0), col(colors, 1)], angle, 'soft-light', 0.12 + brushed / 400);
  layerTexture(grain, 'lines-1', '#ffffff', Math.max(5, 18 - brushed / 8), 28 + brushed * 0.55, angle);
  layers.push(grain);
  if (scratches > 0) {
    const scratch = linear('Micro-scratches', ['#ffffff', '#1a1a1a'], angle, 'overlay', scratches / 300);
    layerTexture(scratch, 'lines-6', '#ffffff', Math.max(5, 30 - scratches / 5), scratches, angle);
    layers.push(scratch);
  }
  if (oxidation > 0) layers.push(glow({ name: 'Patina / oxidation', color: '#18a68b', cx: 30, cy: 62, rx: 40, ry: 28, alpha: oxidation / 130, blend: 'soft-light', blur: 10, falloff: 'smooth', tight: 20 }));
  if (finish === 'radial') {
    // a gentle domain warp turns the rings into flowing, uneven reflections; a ground layer keeps the edges solid
    warped(main, 46 + (100 - rough) * 0.2, 1.8, seed);
    layers.push(main);
    layers.push(base('Metal · ground', { background: darken(col(colors, 0), 0.2) } as VisualConfig, colors));
  } else layers.push(main);
  return layers;
}

function buildGlass(c: VisualConfig) {
  const colors = palette(c), seed = Math.round(num(c, 'seed', 7)), tint = num(c, 'tintOpacity', 32), frost = num(c, 'frost', 28), refraction = num(c, 'refraction', 28), edge = num(c, 'edge', 68), droplets = num(c, 'droplets', 0);
  const angle = num(c, 'angle', 135), thickness = clamp(num(c, 'thickness', 9), 2, 30), reflection = num(c, 'reflection', 55);
  const accent = col(colors, 1), rim = mixHex('#ffffff', accent, 0.22), shade = darken(col(colors, 0), 0.5);
  const surface = linear('Glass · tinted surface', [col(colors, 0), col(colors, 1), col(colors, 2)], angle, 'screen', 0.16 + tint / 140);
  layerTexture(surface, 'grain-1', '#ffffff', 24, 8, angle, 'soft-light');
  const frostLayer = glow({ name: 'Glass · frosted diffusion', color: accent, cx: 50, cy: 50, rx: 100, ry: 100, alpha: frost / 260, blend: 'soft-light', blur: Math.round(frost / 14), falloff: 'smooth', tight: 10 });
  warped(frostLayer, refraction * 0.32, 14, seed);
  const layers: GradientLayer[] = [surface, frostLayer];
  // Bevel: a thin lit rim on the edges that face the light and a faint tinted shade on the far edges, with real thickness,
  // instead of one white ring around the whole panel.
  [0, 90, 180, 270].forEach(normal => {
    const facing = Math.cos(radians(normal - (angle + 180)));
    if (Math.abs(facing) < 0.05) return;
    const lit = facing > 0, strength = Math.abs(facing), color = lit ? rim : shade;
    const bevel = linear(`Glass · ${lit ? 'lit' : 'shaded'} edge ${['top', 'right', 'bottom', 'left'][normal / 90]}`, [color, color], (normal + 180) % 360, lit ? 'screen' : 'multiply',
      lit ? clamp((strength * edge) / 105, 0, 1) : clamp(strength * (0.22 + tint / 260), 0, 0.6));
    bevel.stops = [stop(color, 0, 1, { ease: 'cubic-out' }), stop(color, thickness, 0)];
    layers.push(bevel);
  });
  if (reflection > 0) {
    const sweep = linear('Glass · specular sweep', [rim, rim], angle, 'screen', 0.14 + reflection / 240);
    sweep.stops = [stop(rim, 0, 0), stop(rim, 30, 0, { ease: 'smootherstep' }), stop(rim, 41, 0.5, { ease: 'smootherstep' }), stop(rim, 52, 0), stop(rim, 56, 0, { ease: 'smootherstep' }), stop(rim, 60, 0.7, { ease: 'smootherstep' }), stop(rim, 64, 0), stop(rim, 100, 0)];
    layers.push(animated(sweep, 20, true));
  }
  if (droplets > 0) {
    const texture = linear('Glass · condensation', ['#ffffff', accent], 0, 'screen', droplets / 300);
    layerTexture(texture, 'dots-6', '#e9faff', Math.max(7, 34 - droplets / 4), droplets, 0);
    layers.push(texture);
  }
  layers.push(base('Glass · background', c, colors));
  return layers;
}

function buildHolographic(c: VisualConfig) {
  const colors = palette(c), seed = Math.round(num(c, 'seed', 19)), rnd = mulberry(seed * 631 + 17), frequency = num(c, 'frequency', 64), spread = num(c, 'spread', 72), intensity = num(c, 'intensity', 78), grain = num(c, 'grain', 18), distortion = num(c, 'distortion', 28), angle = num(c, 'angle', 22);
  // A hue-aware space plus smootherstep transitions keep the spectrum clean (no muddy greys between colours), and the ramp closes on its
  // first colour so every repeat joins the next with no seam.
  const spectral = linear('Holographic spectrum', colors, angle, 'screen', 0.28 + intensity / 125);
  spectral.space = 'oklch'; spectral.repeating = true; spectral.repeat = { size: Math.max(10, 110 - spread * 0.82), unit: '%', offset: rnd() * 12 };
  spectral.stops = softenStops([...colors, colors[0]].map((color, i) => stop(color, i * (100 / colors.length), 0.76)));
  warped(spectral, distortion * 0.72, Math.max(2, frequency / 7), seed);
  const lines = linear('Diffraction lines', [col(colors, 0), col(colors, 2), col(colors, 1)], angle + 90, 'overlay', 0.12 + frequency / 430);
  layerTexture(lines, 'lines-2', '#ffffff', Math.max(5, 22 - frequency / 8), 18 + frequency * 0.55, angle + 90);
  const shine = linear('Iridescent highlight sweep', ['#ffffff', col(colors, 1), '#ffffff'], angle + 28, 'plus-lighter', 0.12 + intensity / 300);
  shine.stops = bandStops('#ffffff', 50, 9, 0.78);
  const layers = [spectral, lines, animated(shine, 18)];
  if (grain > 0) {
    const surface = linear('Hologram · foil grain', colors, angle, 'soft-light', grain / 320);
    layerTexture(surface, 'grain-1', '#ffffff', Math.max(6, 32 - grain / 4), grain, angle);
    layers.push(surface);
  }
  layers.push(base('Hologram · substrate', c, colors));
  return layers;
}

/* Paint model of the relief builder (fitted to a photo of a painted corrugated roof; see the roofing preset). */
const RELIEF_WIPE = 0.539, RELIEF_GAMMA = 1.138;
const RELIEF_ROWS = [0, 0.2, 0.4, 0.6, 0.8, 1];
const RELIEF_LEFT = [0, 0.129, 0.651, 0.941, 1, 1], RELIEF_RIGHT = [0, 0.023, 0.092, 0.296, 0.813, 1];
const rampAt = (knots: number[], y: number) => {
  const v = clamp(y, 0, 1) * (RELIEF_ROWS.length - 1), i = Math.min(RELIEF_ROWS.length - 2, Math.floor(v));
  return knots[i] + (knots[i + 1] - knots[i]) * (v - i);
};
const smooth01 = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

interface ReliefPaint { wipe: number; split: number; tilt: number; left: number; right: number }
/** Mesh points (as fractions of the layer) that sample the paint model: columns follow the colour wipe so a narrow wipe stays crisp. */
function reliefPaintPoints([tl, bl, tr, br]: string[], m: ReliefPaint) {
  const points: ReturnType<typeof newMeshPoint>[] = [];
  for (const y of RELIEF_ROWS) {
    const centre = m.split + m.tilt * (y - 0.5), a = centre - m.wipe / 2, b = centre + m.wipe / 2;
    const raw = [0, a, a + m.wipe / 4, centre, b - m.wipe / 4, b, 1].map(v => clamp(v, 0, 1));
    const xs = raw.filter((v, i) => i === 0 || v - raw[i - 1] > 0.02);
    if (xs[xs.length - 1] < 1) xs.push(1);
    for (const x of xs) {
      const leftColor = mixHex(tl, bl, rampAt(RELIEF_LEFT, y - (m.left - 0.33)), 'srgb'), rightColor = mixHex(tr, br, rampAt(RELIEF_RIGHT, y - (m.right - 0.68)), 'srgb');
      points.push(newMeshPoint(x * 100, y * 100, mixHex(leftColor, rightColor, Math.pow(smooth01((x - a) / m.wipe), RELIEF_GAMMA), 'srgb'), 1, 40));
    }
  }
  return points;
}

/**
 * Painted relief sheet: a four-corner colour field (the paint), a lit relief pattern over it (the metal) and optional sheen / grain.
 * The relief is an ordinary texture layer, so every slider here is also available on the layer itself afterwards.
 * Colours are the four corners in this order: top-left, bottom-left, top-right, bottom-right.
 */
function buildRelief(c: VisualConfig) {
  const colors = palette(c), seed = Math.round(num(c, 'seed', 7));
  const [tl, bl, tr, br] = [col(colors, 0), col(colors, 1), col(colors, 2), col(colors, 3)];
  const known = typeof c.pattern === 'string' && reliefPatternOptions.some(option => option.id === c.pattern);
  const pattern = known ? String(c.pattern) : 'relief-corrugated-sheet';
  const ridgeCount = clamp(Math.round(num(c, 'ridgeCount', 0)), 0, 12);
  const geometry = reliefGeometry({ ...DEFAULT_TEXTURE, pattern, ridgeCount })!;
  const width = clamp(num(c, 'ridgeWidth', 75), 6, 400), direction = num(c, 'angle', 0);
  const average = mixHex(mixHex(tl, bl, 0.5), mixHex(tr, br, 0.5), 0.5);
  const shadow = mixHex('#000000', darken(average, 0.55), clamp(num(c, 'shadowTint', 25), 0, 100) / 100);
  const strength = clamp(num(c, 'strength', 100), 0, 100), sheen = clamp(num(c, 'sheen', 0), 0, 100), grain = clamp(num(c, 'grain', 0), 0, 100);

  const relief = newLayer('linear', { name: `Relief · ${reliefPatternOptions.find(option => option.id === pattern)?.label ?? 'ridges'}`, stops: [stop('#ffffff', 0, 0), stop('#ffffff', 100, 0)] });
  relief.texture = {
    ...DEFAULT_TEXTURE, enabled: true, pattern, scale: Math.max(4, Math.round(width * geometry.count)), angle: ((direction % 360) + 360) % 360,
    opacity: strength, blend: 'normal', color: '#ffffff', shadowColor: shadow, seed: 17, ridgeCount,
    reliefDepth: clamp(num(c, 'depth', 100), 0, 200), reliefOcclusion: clamp(num(c, 'occlusion', 100), 0, 200), reliefLight: clamp(num(c, 'light', -35), -90, 90),
    reliefGloss: clamp(num(c, 'gloss', 100), 0, 300), reliefSoft: clamp(num(c, 'softness', 50), 0, 100),
  } satisfies TextureData;

  // the paint: a smooth colour FIELD (a true weighted blend, not stacked blobs), so the four corner colours stay vivid and the middle
  // blends the way real paint does. Each side is a vertical ramp (top → bottom) and a soft wipe moves from the left colours to the right
  // ones. The ramp shapes, wipe width and tilt were fitted to a photo of a painted roof, then exposed as sliders.
  const wipe = RELIEF_WIPE * clamp(num(c, 'colorSize', 100), 30, 160) / 100;
  const paint = newLayer('mesh', {
    name: 'Relief · paint', space: 'srgb',
    mesh: {
      ...DEFAULT_MESH, base: average, core: 40, seed,
      field: { ...DEFAULT_MESH.field, enabled: true, method: 'gaussian', space: 'srgb', spread: clamp(0.3 + wipe * 0.5, 0.4, 0.75), sharpness: 0.6, edge: 'extend', warp: 0, grain: 0, saturation: 1, contrast: 1 },
      points: reliefPaintPoints([tl, bl, tr, br], {
        wipe, split: clamp(num(c, 'split', 50), 10, 90) / 100, tilt: clamp(num(c, 'tilt', -13), -60, 60) / 100,
        left: clamp(num(c, 'leftChange', 33), 10, 90) / 100, right: clamp(num(c, 'rightChange', 68), 10, 90) / 100,
      }),
    },
  });

  const layers: GradientLayer[] = [];
  if (sheen > 0) {
    const sweep = linear('Relief · sheen', ['#ffffff', '#ffffff'], direction + 100, 'soft-light', 1);
    sweep.stops = bandStops('#ffffff', 58, 36, 0.25 + sheen / 140);
    layers.push(sweep);
  }
  if (grain > 0) {
    const speckle = linear('Relief · paint grain', ['#ffffff', '#ffffff'], 135, 'soft-light', grain / 260);
    layerTexture(speckle, 'grain-film-grain', '#ffffff', Math.max(8, 40 - grain / 4), 30 + grain * 0.4, 0);
    layers.push(speckle);
  }
  layers.push(relief, paint, base('Relief · substrate', c, colors));
  return layers;
}

const defaultBase = (paletteColors: string[], background: string, entries: Record<string, number | string | boolean>): VisualConfig => ({
  seed: 7, palette: paletteColors, background, angle: 28, speed: 48, animate: true, layerOpacity: 100, blendMode: 'auto', transparent: false, ...entries,
});
const defs: VisualBuilderDefinition[] = [
  withShared('fluid', 'Fluid', 'Procedural flow fields and warped liquid-color membranes. This is a stylized approximation, not a physical fluid simulation.', fluidPresets, defaultBase(['#ff3cac', '#784ba0', '#2b86c5'], '#07111f', { flowAngle: 28, flow: 58, turbulence: 60, viscosity: 42, swirl: 54, warp: 58, diffusion: 36, scale: 50, eddies: 5 }), fluidControls, buildFluid),
  withShared('light', 'Light', 'Editable radial emitters, beam fans, halos, and directional streaks.', lightPresets, defaultBase(['#38bdf8', '#fef3c7', '#c084fc'], '#080b18', { sourceX: 50, sourceY: 42, sourceCount: 2, radius: 48, intensity: 65, falloff: 50, beamLength: 70, coreBrightness: 70, spread: 32, glow: 65, halo: 56, falloffType: 'inverse-square' }), lightControls, buildLight),
  withShared('ink', 'Ink & Smoke', 'Layered pigment deposits and turbulent smoke plumes with distinct sharp and diffused forms.', inkPresets, defaultBase(['#102a43', '#4361ee', '#f72585'], '#f2f4f8', { flowAngle: 28, inkDensity: 70, smokeDensity: 55, turbulence: 60, curl: 55, diffusion: 45, edge: 55, layerCount: 3 }), inkControls, buildInk),
  withShared('halftone', 'Halftone', 'Repeatable print-screen textures built on the shared SVG texture renderer; separated screen angles can create moiré.', halftonePresets, defaultBase(['#172554', '#e11d48', '#f8fafc'], '#f5f2e9', { spacing: 16, dotSize: 9, dotShape: 'dots-1', angle: 22, density: 70, contrast: 82, channelSeparation: 0, tone: 0, softness: 0, antiMoire: 'on' }), halftoneControls, buildHalftone),
  withShared('prism', 'Prism & Refraction', 'Procedural spectral splitting with SVG turbulence displacement; not a physically accurate optical simulation.', prismPresets, defaultBase(['#fb7185', '#fde68a', '#67e8f9'], '#090b20', { dispersion: 68, refraction: 55, frequency: 32, prismAngle: 38, layers: 3, highlight: 68 }), prismControls, buildPrism),
  withShared('metallic', 'Metallic', '2D reflective banding and directional surface texture for polished, brushed, or patinated metal looks.', metallicPresets, defaultBase(['#111827', '#e5edf3', '#617080'], '#131a22', { roughness: 32, bandScale: 42, brushed: 46, scratches: 12, oxidation: 0, reflections: 4, finish: 'linear' }), metalControls, buildMetallic),
  withShared('glass', 'Glass', 'Tinted, frosted, and highlighted glass-like overlays. The preview includes a configurable background; no true optical depth is implied.', glassPresets, defaultBase(['#b8ecff', '#ffffff', '#6bc4e8'], '#24364b', { tintOpacity: 32, frost: 28, refraction: 28, edge: 68, droplets: 0, thickness: 9, reflection: 55 }), glassControls, buildGlass),
  withShared('holographic', 'Holographic', 'Procedural iridescent spectrum, diffraction lines, and foil grain; not a thin-film physics simulation.', holoPresets, defaultBase(['#ff4d9d', '#ffc857', '#4de2c5', '#7272ff'], '#171329', { frequency: 64, spread: 72, intensity: 78, grain: 18, distortion: 28 }), holoControls, buildHolographic),
  withShared('relief', 'Relief surface', 'Painted corrugated sheets, ribs, pleats and bumps: a four-corner colour field lit as a real surface, with deep valleys and soft highlights. Colours are the four corners (top-left, bottom-left, top-right, bottom-right).', reliefPresets, defaultBase(['#f78009', '#db1523', '#1fe088', '#088be2'], '#10131c', { pattern: 'relief-painted-roofing', ridgeWidth: 79, ridgeCount: 0, angle: 0, depth: 55, occlusion: 0, light: -35, gloss: 40, softness: 50, strength: 100, shadowTint: 0, colorSize: 100, split: 50, tilt: -13, leftChange: 33, rightChange: 68, sheen: 0, grain: 0, animate: false }), reliefControls, buildRelief),
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
