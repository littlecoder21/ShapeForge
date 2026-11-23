import { EFFECTS, activeEffects } from '../engine/effects';
import type { GradientProject } from '../engine/model';
import { renderProject, type RenderResult } from '../engine/raster';
import { projectSvg } from '../engine/svg';

/* The still-image renderer used for projects that do not move: the same decisions `exportPng` makes (canvas 2D drawing when it is
 * exact, an SVG with filters when text, textures or SVG-only effects are involved), but it hands back the canvas so the Image and
 * Video panels can resize, fit, fill and encode it in any format. */

async function renderFilteredSvg(project: GradientProject, scale: number): Promise<HTMLCanvasElement> {
  const { w, h } = project.canvas;
  const image = new Image();
  const url = URL.createObjectURL(new Blob([projectSvg(project)], { type: 'image/svg+xml' }));
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a 2D canvas context');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function needsSvgFilters(project: GradientProject): boolean {
  return project.layers.some(layer => layer.visible && (
    layer.text !== undefined || layer.texture.enabled || activeEffects(layer.effects).some(effect => EFFECTS[effect.type].rasterUnsupported)
    || (layer.type === 'mesh' && layer.mesh.points.some(point => activeEffects(point.effects ?? []).some(effect => EFFECTS[effect.type].rasterUnsupported)))
  ));
}

/** Renders the project's still image at `scale` × its canvas size. */
export async function rasterizeProject(project: GradientProject, scale: number): Promise<RenderResult> {
  if (!needsSvgFilters(project)) return renderProject(project, scale);
  try {
    return {
      canvas: await renderFilteredSvg(project, scale),
      notes: project.layers
        .filter(layer => layer.visible && layer.type === 'mesh' && layer.mesh.field.enabled)
        .map(layer => `“${layer.name}”: image export used the SVG fallback, so the smooth mesh field is shown as its CSS-compatible mesh`),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown SVG rendering error';
    if (project.layers.some(layer => layer.visible && layer.text)) throw new Error(`Text layer rendering failed: ${reason}`);
    const rendered = renderProject(project, scale);
    rendered.notes.push(`Some effects or textures could not be rasterized (${reason}); see SVG output for the full effect`);
    return rendered;
  }
}
