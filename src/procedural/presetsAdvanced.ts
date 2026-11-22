import type { ProceduralPreset } from './presets';
import type { DistortionType } from './types';

/* Advanced presets (10). Every one is an ordinary partial config (same shape and rules as presets.ts): it only sets options the engine
 * supports — interpolation methods, shaped reach, OKLCH, extra fields, distortion targets, the lighting stage, the new motions and
 * pointer reactions — and nothing in them is a special case in the shader. They load through applyPreset(), so locks are respected. */

const stage = (type: DistortionType, extra: Record<string, unknown> = {}) => ({ type, ...extra });
const none = () => stage('none');

export const ADVANCED_PROCEDURAL_PRESETS: readonly ProceduralPreset[] = [
  {
    id: 'silk-aurora', name: 'Silk Aurora', description: 'Tall green–violet curtains: stretched reach, OKLCH colour and a soft inner glow.',
    config: {
      points: { min: 6, max: 8, distribution: 'grid', spacing: 0.45, radius: 0.34 },
      field: { method: 'gaussian', radius: 1.15, falloff: 0.4, overlap: 0.8 },
      influence: { shape: 'ellipse', rotation: 90, anisotropy: 2.6, inner: 0.1 },
      motion: { type: 'sine', speed: 0.35, amplitude: 0.12, smoothness: 0.9 },
      distortion: [stage('wave', { frequency: 2.2, intensity: 0.45, speed: 0.3, direction: 90 }), stage('warp', { intensity: 0.2, speed: 0.15 }), none()],
      color: { source: 'custom', colors: ['#020b1c', '#0b3d5c', '#2ee6a6', '#7b61ff', '#c7f9cc'], interpolation: 'oklch', hueDirection: 'shorter', saturation: 1.1 },
      material: { enabled: true, glow: 0.3, innerGlow: 0.35, radius: 0.5 },
    },
  },
  {
    id: 'liquid-atmosphere', name: 'Liquid Atmosphere', description: 'Smooth natural-neighbour blues with a warm glow floating through them.',
    config: {
      points: { min: 6, max: 8, distribution: 'organic', radius: 0.46, spread: 1 },
      field: { method: 'natural-neighbor', radius: 1.1, softness: 0.6, overlap: 0.7 },
      motion: { type: 'float', speed: 0.4, amplitude: 0.1, smoothness: 0.85, randomness: 0.5 },
      distortion: [stage('warp', { target: 'field', intensity: 0.22, scale: 1.1, speed: 0.15 }), none(), none()],
      color: { source: 'custom', colors: ['#071a3a', '#1b4f9c', '#4aa3e8', '#bfe3ff', '#8fb7ff'], interpolation: 'oklab', chromaPreserve: 0.5 },
      fields: [{ kernel: 'soft', blend: 'screen', opacity: 0.55, strength: 0.8, count: 2, pointRadius: 0.28, colors: ['#ffb27a'], spread: 0.7 }],
      material: { enabled: true, glow: 0.25, scatter: 0.3, ambient: 0.6 },
    },
  },
  {
    id: 'organic-bloom', name: 'Organic Bloom', description: 'Petal-shaped colour that blooms, with elastic motion and a soft highlight bloom.',
    config: {
      points: { min: 6, max: 9, distribution: 'organic', radius: 0.4, variance: 0.5 },
      field: { method: 'gaussian', radius: 1.1, falloff: 0.35 },
      influence: { shape: 'ellipse', rotation: 30, anisotropy: 1.7, inner: 0.15, core: 0.3 },
      motion: { type: 'elastic', speed: 0.5, amplitude: 0.12, groups: 3, smoothness: 0.7 },
      distortion: [stage('warp', { intensity: 0.2, scale: 1.2, speed: 0.2 }), none(), none()],
      color: { source: 'custom', colors: ['#2a0a33', '#9d1f6f', '#ff5d8f', '#ffb199', '#ffe3a3'], interpolation: 'oklch', hueDirection: 'shorter' },
      material: { enabled: true, bloom: 0.6, bloomThreshold: 0.55, glow: 0.2, innerGlow: 0.3, radius: 0.45 },
    },
  },
  {
    id: 'deep-nebula', name: 'Deep Nebula', description: 'An exact RBF base, hot magenta clouds screened over it and dark dust multiplied in.',
    config: {
      points: { min: 5, max: 6, distribution: 'cluster', radius: 0.42, spread: 1 },
      field: { method: 'rbf-multiquadric', radius: 1.2, falloff: 0.4, softness: 0.55 },
      motion: { type: 'drift', speed: 0.3, amplitude: 0.1, smoothness: 0.8 },
      distortion: [stage('turbulence', { target: 'field', scale: 1.8, intensity: 0.5, turbulence: 0.7, octaves: 4, speed: 0.2 }), stage('fbm', { target: 'color', scale: 1.4, intensity: 0.35, speed: 0.12 }), none()],
      color: { source: 'custom', colors: ['#03000a', '#1a0b4d', '#4b2fa0', '#12a4c9', '#0b1c4a'], interpolation: 'oklab', contrast: 1.15 },
      fields: [
        { kernel: 'gaussian', blend: 'screen', opacity: 0.7, strength: 1.1, count: 3, pointRadius: 0.26, colors: ['#ff4fd8', '#7c4dff'], spread: 0.9 },
        { kernel: 'soft', blend: 'multiply', opacity: 0.5, count: 2, pointRadius: 0.5, colors: ['#05010f'], spread: 0.8 },
      ],
    },
  },
  {
    id: 'crystal-flow', name: 'Crystal Flow', description: 'Faceted ice: a power diagram with hexagonal reach, lit edges and a specular sheen.',
    config: {
      points: { min: 7, max: 9, distribution: 'organic', spacing: 0.5, radius: 0.36 },
      field: { method: 'power-diagram', radius: 1, softness: 0.35, overlap: 0.6 },
      influence: { shape: 'polygon', sides: 6, rounding: 0.15, rotation: 15 },
      motion: { type: 'sine', speed: 0.35, amplitude: 0.09, smoothness: 0.85 },
      distortion: [stage('wave', { frequency: 2.4, intensity: 0.25, speed: 0.25, direction: 40 }), none(), none()],
      color: { source: 'custom', colors: ['#06202e', '#0f6d8c', '#5ad1e6', '#d8f7ff', '#8a7dff'], interpolation: 'oklab', chromaPreserve: 0.4, contrast: 1.1 },
      material: { enabled: true, edgeGlow: 0.4, light: 0.5, lightAngle: 130, specular: 0.45, shininess: 44, depth: 1.3, ambient: 0.42, radius: 0.35 },
    },
  },
  {
    id: 'soft-glass', name: 'Soft Glass', description: 'A calm thin-plate surface lit like frosted glass: gentle light, highlight and shadow.',
    config: {
      points: { min: 5, max: 7, distribution: 'organic', radius: 0.5, spread: 1 },
      field: { method: 'thin-plate', radius: 1.2, softness: 0.55 },
      motion: { type: 'float', speed: 0.3, amplitude: 0.08, smoothness: 0.9 },
      distortion: [stage('warp', { intensity: 0.12, scale: 0.9, speed: 0.1 }), none(), none()],
      color: { source: 'custom', colors: ['#cfdcff', '#9fb5f0', '#eeb3d8', '#b3e6d2', '#f2dca0'], interpolation: 'oklab', saturation: 1.05 },
      material: { enabled: true, light: 0.7, lightAngle: 140, lightElevation: 0.55, specular: 0.55, shininess: 50, shadow: 0.3, depth: 1.2, ambient: 0.4, scatter: 0.15, radius: 0.5 },
    },
  },
  {
    id: 'fluid-color-field', name: 'Fluid Color Field', description: 'Metaball colour whose centres themselves are pushed around by curl noise.',
    config: {
      points: { min: 5, max: 7, distribution: 'organic', radius: 0.42 },
      field: { method: 'smin', softness: 0.72, radius: 1.05 },
      motion: { type: 'circle', speed: 0.45, amplitude: 0.09, smoothness: 0.9 },
      distortion: [stage('curl', { target: 'points', scale: 1.3, intensity: 0.3, octaves: 2, speed: 0.25 }), stage('warp', { intensity: 0.2, speed: 0.15 }), none()],
      color: { source: 'custom', colors: ['#00c2ff', '#7a5cff', '#ff4fa3', '#ffb800'], interpolation: 'oklch', hueDirection: 'increasing', saturation: 1.1 },
    },
  },
  {
    id: 'dream-gradient', name: 'Dream Gradient', description: 'Smooth Voronoi pastels that take the long way round the hue wheel, with a soft white veil.',
    config: {
      points: { min: 6, max: 8, distribution: 'organic', radius: 0.45 },
      field: { method: 'smooth-voronoi', radius: 1.1, softness: 0.7, overlap: 0.75 },
      motion: { type: 'spring', speed: 0.5, amplitude: 0.1, damping: 0.7, groups: 2, smoothness: 0.8 },
      distortion: [stage('warp', { intensity: 0.15, scale: 1, speed: 0.12 }), none(), none()],
      color: { source: 'custom', colors: ['#ffc2e8', '#cbb2ff', '#a9d8ff', '#b6f5dc', '#ffdcae'], interpolation: 'oklch', hueDirection: 'longer', saturation: 1.05 },
      fields: [{ kernel: 'soft', blend: 'soft-light', opacity: 0.5, count: 2, pointRadius: 0.3, colors: ['#ffffff'], spread: 0.8 }],
      material: { enabled: true, glow: 0.12, scatter: 0.25 },
    },
  },
  {
    id: 'magnetic-color-field', name: 'Magnetic Color Field', description: 'Colour that leans toward a drifting magnet and clings to the pointer, lingering as you let go.',
    config: {
      points: { min: 6, max: 8, distribution: 'circular', radius: 0.4 },
      field: { method: 'custom-weighted', radius: 1.1, falloff: 0.45, custom: { gaussian: 0.5, compact: 0.2, inverse: 0.3 } },
      motion: { type: 'magnetic', speed: 0.6, amplitude: 0.12, smoothness: 0.8 },
      distortion: [stage('warp', { intensity: 0.18, speed: 0.15 }), none(), none()],
      interaction: {
        force: 'magnetic', radius: 0.45, strength: 1, falloff: 'soft', response: 6, pressure: 1, velocity: 0.8, persistence: 0.5,
        affect: { position: 1, radius: 0.5, strength: 0.3, saturation: 0.4, hue: 0.1, speed: 0.3 },
      },
      color: { source: 'custom', colors: ['#0b1020', '#3a2dff', '#00e0ff', '#ff2d95', '#ffd36b'], interpolation: 'oklab', chromaPreserve: 0.4 },
    },
  },
  {
    id: 'atmospheric-light', name: 'Atmospheric Light', description: 'A broad blue sky, a small orange glow, a soft white highlight and a dark surround — four fields in one pass.',
    config: {
      points: { min: 4, max: 5, distribution: 'organic', radius: 0.5, spread: 1 },
      field: { method: 'gaussian', radius: 1.3, falloff: 0.3, softness: 0.8 },
      motion: { type: 'float', speed: 0.25, amplitude: 0.07, smoothness: 0.9 },
      distortion: [stage('warp', { target: 'field', intensity: 0.12, speed: 0.1 }), none(), none()],
      color: { source: 'custom', colors: ['#0a1a3c', '#1e4b8f', '#5e9be0', '#cfe6ff'], interpolation: 'oklab', chromaPreserve: 0.3 },
      fields: [
        { kernel: 'soft', blend: 'screen', opacity: 0.85, strength: 1.2, radius: 0.6, count: 1, pointRadius: 0.18, colors: ['#ff9a4a'], spread: 0.6 },
        { kernel: 'gaussian', blend: 'soft-light', opacity: 0.7, falloff: 0.7, count: 1, pointRadius: 0.12, colors: ['#ffffff'], spread: 0.6 },
        { kernel: 'soft', blend: 'multiply', opacity: 0.45, count: 3, pointRadius: 0.5, colors: ['#0a1230'], spread: 1 },
      ],
      material: { enabled: true, glow: 0.3, bloom: 0.4, scatter: 0.5, ambient: 0.5 },
    },
  },
];
