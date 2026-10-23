import { newProject, newSolidLayer, type GradientLayer, type GradientProject } from './model';

/* ═══════════════════════════ Solid colour layers ═══════════════════════════
 * A solid layer is an ordinary layer (opacity, blend mode, effects, texture, animation all work) whose paint is one colour.
 * It keeps two matching stops so image-only outputs stay compatible, and flat CSS export collapses a lone solid layer to
 * a plain `background-color`. These helpers are shared by the layer templates, the layer panel and the project menu.
 */

export interface SolidSwatch { id: string; label: string; color: string }

/** Quick-start colours offered in the Add-layer row, the project menu and the solid-layer editor. */
export const SOLID_SWATCHES: readonly SolidSwatch[] = [
  { id: 'white', label: 'White', color: '#ffffff' },
  { id: 'black', label: 'Black', color: '#000000' },
  { id: 'slate', label: 'Slate', color: '#0f172a' },
  { id: 'paper', label: 'Paper', color: '#f5f1e8' },
  { id: 'indigo', label: 'Indigo', color: '#4f46e5' },
  { id: 'rose', label: 'Rose', color: '#f43f5e' },
];

/** A new solid layer (default white). */
export function solidLayer(color = '#ffffff', name?: string): GradientLayer {
  const layer = newSolidLayer(color);
  if (name) layer.name = name;
  return layer;
}

/** Change a solid layer's colour, keeping the two stops in sync. Other layers are returned unchanged. */
export function setSolidColor(layer: GradientLayer, color: string): GradientLayer {
  if (layer.solidColor === undefined) return layer;
  return { ...layer, solidColor: color, stops: layer.stops.map((item, i) => ({ ...item, color, alpha: 1, pos: i === 0 ? 0 : 100 })) };
}

/** A fresh project that starts from one solid colour layer. */
export function newSolidProject(color = '#ffffff'): GradientProject {
  return newProject({ name: 'Solid color', layers: [newSolidLayer(color)] });
}
