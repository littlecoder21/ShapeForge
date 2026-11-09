import { PROCEDURAL_PRESETS, type ProceduralPreset } from './presets';
import type { DistortionType } from './types';

/* Additional procedural presets (17). They use exactly the same shape and rules as the built-in ones in presets.ts: a partial config
 * on top of DEFAULT_PROCEDURAL, applied with applyPreset() (locks respected). Use ALL_PROCEDURAL_PRESETS wherever the preset list is shown. */

const stage = (type: DistortionType, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const none = () => stage('none');

export const MORE_PROCEDURAL_PRESETS: readonly ProceduralPreset[] = [
  {
    id: 'lava-lamp', name: 'Lava Lamp', description: 'Warm wax blobs that melt into each other and rise slowly.',
    config: {
      points: { min: 5, max: 7, distribution: 'organic', radius: 0.4, variance: 0.5 },
      field: { method: 'smin', softness: 0.78, radius: 1.05 },
      motion: { type: 'circle', speed: 0.4, amplitude: 0.11, smoothness: 0.92, randomness: 0.6 },
      distortion: [stage('curl', { scale: 1.1, intensity: 0.45, speed: 0.25 }), none(), none()],
      color: { source: 'custom', colors: ['#2a0a18', '#e63946', '#ff8c42', '#ffd166', '#7b1e3a'], interpolation: 'oklab', saturation: 1.1, contrast: 1.1 },
    },
  },
  {
    id: 'northern-lights', name: 'Northern Lights', description: 'Tall green and violet curtains swaying against a night sky.',
    config: {
      points: { min: 6, max: 8, distribution: 'grid', spacing: 0.45, radius: 0.36 },
      field: { method: 'gaussian', falloff: 0.4, radius: 1.15, softness: 0.7 },
      motion: { type: 'sine', speed: 0.4, amplitude: 0.13, smoothness: 0.9 },
      distortion: [stage('wave', { frequency: 2.4, intensity: 0.6, speed: 0.35, direction: 90 }), stage('multiwarp', { scale: 1, intensity: 0.35, speed: 0.2 }), none()],
      color: { source: 'custom', colors: ['#020b1c', '#0b3d5c', '#2ee6a6', '#7b61ff', '#c7f9cc'], interpolation: 'oklab', saturation: 1.15 },
    },
  },
  {
    id: 'holo-foil', name: 'Holo Foil', description: 'Iridescent foil whose colours slowly cycle through the spectrum.',
    config: {
      points: { min: 6, max: 9, distribution: 'organic', spacing: 0.4 },
      field: { method: 'soft', radius: 1, softness: 0.55, overlap: 0.85 },
      motion: { type: 'flow', speed: 0.6, amplitude: 0.12, smoothness: 0.8 },
      distortion: [stage('wave', { frequency: 3.4, intensity: 0.4, speed: 0.5, direction: 25 }), stage('warp', { intensity: 0.25 }), none()],
      color: { source: 'custom', colors: ['#ff9ff3', '#feca57', '#48dbfb', '#a29bfe', '#55efc4'], interpolation: 'oklab', cycleSpeed: 0.35, saturation: 1.1, exposure: 0.1 },
    },
  },
  {
    id: 'deep-sea', name: 'Deep Sea', description: 'Black-blue water with drifting bioluminescent glows.',
    config: {
      points: { min: 6, max: 8, distribution: 'cluster', radius: 0.34, spread: 1 },
      field: { method: 'gaussian', falloff: 0.55, radius: 0.95, overlap: 0.55 },
      motion: { type: 'wander', speed: 0.4, amplitude: 0.13, smoothness: 0.85 },
      distortion: [stage('curl', { scale: 1.3, intensity: 0.5, speed: 0.3 }), none(), none()],
      color: { source: 'custom', colors: ['#00060f', '#03254c', '#0a6f8f', '#19e6d3', '#7df9ff'], interpolation: 'oklab', exposure: -0.12, contrast: 1.15 },
    },
  },
  {
    id: 'peach-sorbet', name: 'Peach Sorbet', description: 'Creamy peach, coral and apricot, soft as a milkshake.',
    config: {
      points: { min: 5, max: 7, distribution: 'organic', variance: 0.4, radius: 0.46 },
      field: { method: 'soft', radius: 1.3, softness: 0.85 },
      motion: { type: 'noise', speed: 0.3, amplitude: 0.09, smoothness: 0.92 },
      distortion: [stage('warp', { intensity: 0.18, scale: 1, speed: 0.18 }), none(), none()],
      color: { source: 'custom', colors: ['#fff1e6', '#ffd6a5', '#ffadad', '#ffc6ff', '#fdffb6'], interpolation: 'oklab', saturation: 0.95, exposure: 0.08 },
    },
  },
  {
    id: 'cosmic-dust', name: 'Cosmic Dust', description: 'Clumped violet and teal clouds with fine grainy turbulence.',
    config: {
      points: { min: 8, max: 11, distribution: 'cluster', radius: 0.3, variance: 0.55 },
      field: { method: 'gaussian', falloff: 0.6, radius: 0.85, overlap: 0.5 },
      motion: { type: 'noise', speed: 0.35, amplitude: 0.1, smoothness: 0.8, randomness: 0.7 },
      distortion: [stage('turbulence', { scale: 2.4, intensity: 0.55, turbulence: 0.8, octaves: 5, speed: 0.25 }), stage('fbm', { scale: 1.2, intensity: 0.3 }), none()],
      color: { source: 'custom', colors: ['#06010f', '#2e1065', '#7c3aed', '#14b8a6', '#fdf4ff'], interpolation: 'oklab', contrast: 1.2 },
    },
  },
  {
    id: 'chrome-liquid', name: 'Chrome Liquid', description: 'Mirror-bright metal pouring over itself in silver and steel blue.',
    config: {
      points: { min: 5, max: 7, distribution: 'organic', radius: 0.4 },
      field: { method: 'smin', softness: 0.55, radius: 1 },
      motion: { type: 'figure8', speed: 0.5, amplitude: 0.1, smoothness: 0.9 },
      distortion: [stage('wave', { frequency: 2.8, intensity: 0.6, speed: 0.4, direction: 60 }), stage('curl', { intensity: 0.3, scale: 1.3 }), none()],
      color: { source: 'custom', colors: ['#0b0d12', '#6b7a90', '#f5f7fa', '#9fb4cf', '#232a35'], interpolation: 'linear', contrast: 1.3, saturation: 0.7 },
    },
  },
  {
    id: 'golden-hour', name: 'Golden Hour', description: 'Low sun: honey, rose and dusty violet sliding past each other.',
    config: {
      points: { min: 5, max: 7, distribution: 'organic' },
      field: { method: 'soft', radius: 1.25, softness: 0.7 },
      motion: { type: 'drift', speed: 0.4, amplitude: 0.1, smoothness: 0.9 },
      distortion: [stage('flow', { scale: 1.2, intensity: 0.5, direction: -15, speed: 0.4 }), none(), none()],
      color: { source: 'custom', colors: ['#3b1f4a', '#c2577e', '#ff9a5a', '#ffd27d', '#fff3d6'], interpolation: 'oklab', temperature: 0.25, saturation: 1.05 },
    },
  },
  {
    id: 'mint-chip', name: 'Mint Chip', description: 'Fresh mint and cream with an easy, rolling sway.',
    config: {
      points: { min: 5, max: 7, distribution: 'grid', spacing: 0.4, radius: 0.44 },
      field: { method: 'gaussian', falloff: 0.3, radius: 1.2, softness: 0.8 },
      motion: { type: 'sine', speed: 0.5, amplitude: 0.1, smoothness: 0.9 },
      distortion: [stage('wave', { frequency: 2, intensity: 0.35, speed: 0.4, direction: 30 }), none(), none()],
      color: { source: 'custom', colors: ['#f2fff8', '#b8f2d9', '#5ed6b0', '#2b8a73', '#f7ede2'], interpolation: 'oklab', saturation: 0.95 },
    },
  },
  {
    id: 'vaporwave', name: 'Vaporwave', description: 'Hot pink, cyan and purple in a slow polar spin.',
    config: {
      points: { min: 6, max: 8, distribution: 'circular', radius: 0.38 },
      field: { method: 'radial', exponent: 1.8, radius: 1 },
      motion: { type: 'orbit', speed: 0.55, amplitude: 0.09 },
      distortion: [stage('polar', { intensity: 0.45, frequency: 2.5, speed: 0.3 }), stage('warp', { intensity: 0.2 }), none()],
      color: { source: 'custom', colors: ['#ff71ce', '#01cdfe', '#b967ff', '#05ffa1', '#fffb96'], interpolation: 'oklab', saturation: 1.2, contrast: 1.1 },
    },
  },
  {
    id: 'ember-glow', name: 'Ember Glow', description: 'Coals breathing in the dark: red cores, orange edges, black smoke.',
    config: {
      points: { min: 6, max: 9, distribution: 'random', spacing: 0.45 },
      field: { method: 'idw', exponent: 3, radius: 0.95 },
      motion: { type: 'noise', speed: 0.55, amplitude: 0.11, smoothness: 0.7 },
      distortion: [stage('turbulence', { scale: 1.8, intensity: 0.55, turbulence: 0.65, octaves: 4, speed: 0.45 }), none(), none()],
      color: { source: 'custom', colors: ['#050303', '#4a0d0d', '#c1272d', '#ff6a1a', '#ffc15e'], interpolation: 'linear', contrast: 1.25, temperature: 0.3 },
    },
  },
  {
    id: 'lilac-haze', name: 'Lilac Haze', description: 'Barely-there lavender light that hardly seems to move.',
    config: {
      points: { min: 4, max: 6, distribution: 'organic', radius: 0.5 },
      field: { method: 'smooth', radius: 1.3, falloff: 0.3, softness: 0.85 },
      motion: { type: 'drift', speed: 0.2, amplitude: 0.07, smoothness: 0.97 },
      distortion: [stage('warp', { intensity: 0.15, scale: 0.9, speed: 0.12 }), none(), none()],
      color: { source: 'custom', colors: ['#f5eeff', '#d9c8ff', '#b79cf5', '#f3c9ea', '#ece6ff'], interpolation: 'oklab', saturation: 0.9, exposure: 0.1 },
    },
  },
  {
    id: 'tidal-pool', name: 'Tidal Pool', description: 'Sunlit turquoise over pale sand, rippling outward.',
    config: {
      points: { min: 6, max: 8, distribution: 'organic', radius: 0.36 },
      field: { method: 'radial', exponent: 1.7, radius: 1, overlap: 0.6 },
      motion: { type: 'circle', speed: 0.5, amplitude: 0.07, randomness: 0.6 },
      distortion: [stage('radial', { frequency: 3, intensity: 0.4, speed: 0.5 }), stage('wave', { frequency: 2.6, intensity: 0.25, direction: 70 }), none()],
      color: { source: 'custom', colors: ['#0a9396', '#94d2bd', '#e9d8a6', '#fefae0', '#005f73'], interpolation: 'oklab' },
    },
  },
  {
    id: 'inkwell', name: 'Inkwell', description: 'Monochrome ink clouds blooming and bleeding in water.',
    config: {
      points: { min: 5, max: 7, distribution: 'cluster', radius: 0.4 },
      field: { method: 'smin', softness: 0.6, radius: 1 },
      motion: { type: 'wander', speed: 0.35, amplitude: 0.12, smoothness: 0.9 },
      distortion: [stage('curl', { scale: 1.4, intensity: 0.55, speed: 0.25 }), stage('fbm', { intensity: 0.25, scale: 1.8 }), none()],
      color: { source: 'custom', colors: ['#050505', '#2a2a2e', '#6e6e76', '#d9d9de', '#f7f7f8'], interpolation: 'linear', saturation: 0.2, contrast: 1.2 },
    },
  },
  {
    id: 'citrus-splash', name: 'Citrus Splash', description: 'Lime, lemon and tangerine tumbling in lively loops.',
    config: {
      points: { min: 6, max: 9, distribution: 'random', spacing: 0.4, radius: 0.34 },
      field: { method: 'soft', radius: 1, softness: 0.55, overlap: 0.8 },
      motion: { type: 'figure8', speed: 0.9, amplitude: 0.13, smoothness: 0.75, randomness: 0.6 },
      distortion: [stage('wave', { frequency: 3, intensity: 0.3, speed: 0.55 }), none(), none()],
      color: { source: 'custom', colors: ['#d9ed92', '#fcdc4d', '#ff9f1c', '#ff595e', '#52b788'], interpolation: 'oklab', saturation: 1.2, contrast: 1.05 },
    },
  },
  {
    id: 'midnight-city', name: 'Midnight City', description: 'Navy skyline with warm window lights that flicker and wander.',
    config: {
      points: { min: 8, max: 11, distribution: 'grid', spacing: 0.3, radius: 0.24, variance: 0.55 },
      field: { method: 'gaussian', falloff: 0.65, radius: 0.85, overlap: 0.45 },
      motion: { type: 'wander', speed: 0.45, amplitude: 0.06, randomness: 0.8, smoothness: 0.7 },
      distortion: [stage('fbm', { scale: 2, intensity: 0.25, speed: 0.3 }), none(), none()],
      color: { source: 'custom', colors: ['#050816', '#10204a', '#2a4a8a', '#ff9e4a', '#ffd9a0'], interpolation: 'oklab', contrast: 1.15 },
    },
  },
  {
    id: 'pointer-bloom', name: 'Pointer Bloom', description: 'Soft colour that follows the pointer and blooms where you touch.',
    config: {
      points: { min: 5, max: 6, distribution: 'circular', radius: 0.38 },
      field: { method: 'gaussian', falloff: 0.4, radius: 1.1, softness: 0.7 },
      motion: { type: 'follow', speed: 0.8, amplitude: 0.1, smoothness: 0.6 },
      distortion: [stage('warp', { intensity: 0.25, scale: 1.1, speed: 0.25 }), none(), none()],
      interaction: { force: 'attract', radius: 0.4, strength: 0.8, falloff: 'soft', response: 5 },
      color: { source: 'custom', colors: ['#12062b', '#6d28d9', '#ec4899', '#38bdf8', '#fde68a'], interpolation: 'oklab', saturation: 1.1 },
    },
  },
];

/** Built-in presets followed by the additional ones. Ids are unique across both lists. */
export const ALL_PROCEDURAL_PRESETS: readonly ProceduralPreset[] = [...PROCEDURAL_PRESETS, ...MORE_PROCEDURAL_PRESETS];
