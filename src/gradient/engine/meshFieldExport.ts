import { prepareMeshField, renderPreparedMeshField, type MeshFieldInput } from './meshField';
import type { GradientLayer, GradientProject } from './model';
import { pngDataUri } from './png';
import meshFieldRuntimeSource from './meshFieldRuntime.js?raw';

/* Export side of the smooth mesh field.
 *
 * Preview and PNG draw the field with the TypeScript renderer. CSS / HTML / SVG used to fall back to stacked radial gradients, which
 * is a different picture (and, for a user exporting a field mesh, looked like nothing but a palette). Exports now carry the field
 * itself in two layers that agree with the preview:
 *   1. a baked image of the field (data-URI PNG) as the layer's background: works in plain CSS, SVG, e-mail-style HTML, no script;
 *   2. a <canvas data-sf-mesh-field> plus a small script (meshFieldRuntime.js, the same maths) that repaints the field at preview
 *      quality and keeps the warp animation running. When the script paints, it hides the baked background.
 */

const PREVIEW_EDGE = 192;
const BAKE_EDGE = 160;

/** A layer drawn by the smooth field renderer (not text, field switched on). */
export const usesMeshField = (layer: GradientLayer): boolean => layer.type === 'mesh' && layer.mesh.field.enabled && !layer.text;

export function meshFieldInput(layer: GradientLayer): MeshFieldInput {
  return {
    seed: layer.mesh.seed,
    base: layer.mesh.base || undefined,
    core: layer.mesh.core,
    points: layer.mesh.points.map(point => ({
      x: point.x, y: point.y, color: point.color, alpha: point.alpha, size: point.size, core: point.core,
      strength: point.strength, aspect: point.aspect, angle: point.angle, transform: point.transform,
    })),
  };
}

const fit = (canvas: { w: number; h: number }, edge: number) => {
  const scale = Math.min(1, edge / Math.max(canvas.w, canvas.h, 1));
  return { width: Math.max(1, Math.round(canvas.w * scale)), height: Math.max(1, Math.round(canvas.h * scale)) };
};

/** What the page script needs to paint one field canvas, as a JSON string. */
export function meshFieldConfigJson(layer: GradientLayer, canvas: { w: number; h: number }): string {
  const { width, height } = fit(canvas, PREVIEW_EDGE);
  return JSON.stringify({ input: meshFieldInput(layer), settings: layer.mesh.field, aspect: canvas.w / Math.max(1, canvas.h), width, height });
}

export const attributeEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The canvas element a field layer carries in exported markup. Inert without the runtime script. */
export const meshFieldCanvasHtml = (layer: GradientLayer, canvas: { w: number; h: number }) =>
  `<canvas class="mesh-field" data-sf-mesh-field="${attributeEscape(meshFieldConfigJson(layer, canvas))}" aria-hidden="true"></canvas>`;

/** CSS that places that canvas over the layer. */
export const meshFieldCanvasCss = (selector: string) => `${selector} > canvas.mesh-field {\n  position: absolute;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n  display: block;\n  pointer-events: none;\n}`;

const bakeCache = new Map<string, string>();

/** The field at time 0 as a PNG data URI: what the layer shows before (or without) the script. */
export function meshFieldBakeUri(layer: GradientLayer, canvas: { w: number; h: number }): string {
  const key = JSON.stringify([meshFieldInput(layer), layer.mesh.field, canvas.w, canvas.h]);
  const cached = bakeCache.get(key);
  if (cached) return cached;
  const { width, height } = fit(canvas, BAKE_EDGE);
  const field = prepareMeshField(meshFieldInput(layer), layer.mesh.field, canvas.w / Math.max(1, canvas.h), 0);
  // film grain is a per-pixel texture; baked at this size and stretched it would turn into blotches, so only the live canvas has it
  field.settings = { ...field.settings, grain: 0 };
  const uri = pngDataUri(renderPreparedMeshField(field, width, height), width, height);
  if (bakeCache.size > 12) bakeCache.delete(bakeCache.keys().next().value as string);
  bakeCache.set(key, uri);
  return uri;
}

/** Declarations that paint the baked field as the layer background. */
export const meshFieldBackgroundDecls = (layer: GradientLayer, canvas: { w: number; h: number }): string[] => [
  `background-image: url("${meshFieldBakeUri(layer, canvas)}")`,
  'background-size: 100% 100%',
  'background-repeat: no-repeat',
];

/** The page script, as a self-running snippet. Empty when the project has no field layers. */
export function meshFieldScript(project: GradientProject): string {
  if (!project.layers.some(layer => layer.visible && usesMeshField(layer))) return '';
  const body = meshFieldRuntimeSource.replace(/^export \{[^}]*\};?\s*$/m, '');
  return `/* Smooth mesh field: paints the exported <canvas data-sf-mesh-field> elements */\n(function () {\n${body}\nfunction start() { mountMeshFields(document); }\nif (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();\n})();`;
}
