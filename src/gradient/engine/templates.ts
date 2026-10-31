import { newEffect } from './effects';
import { generateMesh } from './mesh';
import { newLayer, stop, type GradientLayer, type GradientKind } from './model';
import { solidLayer } from './solidColors';

/** One-tap layer starters shown in the Layers panel. Every result is an ordinary editable layer. */
export interface LayerTemplate { id: string; label: string; make: () => GradientLayer }
export const LAYER_TEMPLATES: LayerTemplate[] = [
  { id: 'solid', label: 'Solid', make: () => solidLayer() },
  { id: 'linear', label: 'Linear', make: () => newLayer('linear') },
  { id: 'radial', label: 'Radial', make: () => newLayer('radial', { stops: [stop('#fbbf24', 0), stop('#f43f5e', 100)] }) },
  { id: 'conic', label: 'Conic', make: () => newLayer('conic', { stops: [stop('#22d3ee', 0), stop('#a78bfa', 50), stop('#22d3ee', 100)] }) },
  { id: 'curve', label: 'Curve', make: () => newLayer('curve', { name: 'Curve', stops: [stop('#f472b6', 0), stop('#fbbf24', 50), stop('#22d3ee', 100)] }) },
  { id: 'glow', label: 'Glow', make: () => newLayer('radial', { name: 'Glow', cx: 50, cy: 50, rx: 35, ry: 52, blend: 'screen', stops: [stop('#7dd3fc', 0, 0.9), stop('#7dd3fc', 100, 0, { mid: 45 })], effects: [newEffect('blur', { radius: 40 })] }) },
  { id: 'mesh', label: 'Mesh', make: () => newLayer('mesh', { name: 'Mesh', mesh: generateMesh(['#7c5cff', '#22d3ee', '#f472b6', '#fbbf24'], 4, 'scatter', 7, '#0b1020', 55) }) },
  { id: 'shader', label: 'Shader', make: () => newLayer('mesh', { name: 'Shader', mesh: generateMesh(['#7c5cff', '#22d3ee', '#f472b6', '#fbbf24'], 4, 'corners', 17, '#0b1020', 55), shader: { enabled: true, style: 'flow' } }) },
  { id: 'grain', label: 'Grain', make: () => newLayer('noise', { name: 'Grain', blend: 'overlay', opacity: 0.35 }) },
  { id: 'stripes', label: 'Stripes', make: () => newLayer('linear', { name: 'Stripes', repeating: true, angle: 45, repeat: { size: 40, unit: 'px', offset: 0 }, opacity: 0.5, stops: [stop('#ffffff', 0, 1, { hard: true }), stop('#ffffff', 50, 1, { hard: true }), stop('#ffffff', 50, 0), stop('#ffffff', 100, 0)] }) },
  { id: 'sheen', label: 'Sheen', make: () => newLayer('linear', { name: 'Sheen', angle: 125, blend: 'overlay', stops: [stop('#ffffff', 0, 0.55), stop('#ffffff', 40, 0.05), stop('#ffffff', 100, 0)] }) },
];
export const typeIcon: Record<GradientKind, string> = { linear: '↗', radial: '◉', conic: '◔', curve: '⌁', mesh: '▦', noise: '░' };
