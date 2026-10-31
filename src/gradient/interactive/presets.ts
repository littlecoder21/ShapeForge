import type { InteractiveSettings } from './types';

export interface InteractivePreset {
  id: string;
  name: string;
  description: string;
  settings: Partial<InteractiveSettings>;
}

export const INTERACTIVE_PRESETS: InteractivePreset[] = [
  {
    id: 'soft-glow',
    name: 'Soft Mouse Glow',
    description: 'Gentle pointer light with a calm color field.',
    settings: { style: 'flow', speed: 0.18, distortion: 0.12, glow: 0.85, interactionStrength: 0.28 },
  },
  {
    id: 'liquid-mesh',
    name: 'Liquid Mesh',
    description: 'Slow, soft liquid movement with a little turbulence.',
    settings: { style: 'liquid', speed: 0.24, distortion: 0.42, distortionScale: 1.4, turbulence: 0.3 },
  },
  {
    id: 'aurora-motion',
    name: 'Aurora Motion',
    description: 'Flowing aurora bands with responsive wave distortion.',
    settings: { style: 'aurora', speed: 0.28, distortion: 0.33, glow: 0.55, interactionStrength: 0.35 },
  },
  {
    id: 'interactive-light',
    name: 'Interactive Light',
    description: 'Bright light follows the pointer without strong distortion.',
    settings: { style: 'flow', speed: 0.12, distortion: 0.08, glow: 1, interactionStrength: 0.22, pointerMode: 'attract' },
  },
  {
    id: 'magnetic-gradient',
    name: 'Magnetic Gradient',
    description: 'A stronger elastic swirl follows pointer movement.',
    settings: { style: 'liquid', speed: 0.2, distortion: 0.5, interactionStrength: 0.78, pointerMode: 'swirl' },
  },
  {
    id: 'liquid-ripple',
    name: 'Liquid Ripple',
    description: 'Soft expanding rings respond to clicks and touch.',
    settings: { style: 'liquid', speed: 0.2, distortion: 0.22, ripplesEnabled: true, rippleStrength: 0.9, rippleSpeed: 0.38 },
  },
  {
    id: 'holographic-flow',
    name: 'Holographic Flow',
    description: 'An elegant shifting iridescent color field.',
    settings: { style: 'holographic', speed: 0.3, distortion: 0.2, turbulence: 0.16, glow: 0.4 },
  },
  {
    id: 'ambient-drift',
    name: 'Ambient Color Drift',
    description: 'Subtle slow movement for ambient backgrounds.',
    settings: { style: 'flow', speed: 0.1, distortion: 0.16, turbulence: 0.12, interactionStrength: 0.2 },
  },
  {
    id: 'plasma-field',
    name: 'Plasma Field',
    description: 'Layered luminous waves with soft color turbulence.',
    settings: { style: 'plasma', speed: 0.22, distortion: 0.3, turbulence: 0.4, glow: 0.62 },
  },
  {
    id: 'silk-ribbons',
    name: 'Silk Ribbons',
    description: 'Smooth, flowing silk-like bands with restrained motion.',
    settings: { style: 'silk', speed: 0.18, distortion: 0.18, turbulence: 0.2, glow: 0.48 },
  },
  {
    id: 'deep-nebula',
    name: 'Deep Nebula',
    description: 'A deep-space color field with soft gas-like clouds.',
    settings: { style: 'nebula', speed: 0.16, distortion: 0.38, distortionScale: 1.15, turbulence: 0.48 },
  },
  {
    id: 'contour-waves',
    name: 'Contour Waves',
    description: 'Fine flowing contour lines colored by the current gradient.',
    settings: { style: 'contours', speed: 0.14, distortion: 0.12, distortionScale: 2.4, turbulence: 0.24 },
  },
  {
    id: 'soft-metaballs',
    name: 'Soft Metaballs',
    description: 'Soft moving color blobs that merge into organic forms.',
    settings: { style: 'metaballs', speed: 0.14, distortion: 0.16, interactionStrength: 0.36, glow: 0.68 },
  },
];
