import type { FieldSpace } from './colorScience';
import { FIELD_SPACES } from './colorScience';

/* Settings for the smooth mesh colour field. Stored on `MeshData.field` (optional, so older projects load unchanged).
 *
 * The field is a normalised radial-basis blend: every pixel mixes the colours of all points by a kernel weight, so the colour at
 * (x, y) depends on BOTH coordinates of every point. Moving a point horizontally or vertically reshapes the whole field; there are
 * no stacked circles, stripes or hard blob boundaries. */

export const MESH_FIELD_METHODS = ['gaussian', 'idw', 'imq', 'wendland', 'cells'] as const;
export type MeshFieldMethod = (typeof MESH_FIELD_METHODS)[number];
export const MESH_FIELD_METHOD_INFO: Record<MeshFieldMethod, { label: string; hint: string }> = {
  gaussian: { label: 'Smooth blend', hint: 'Silky Gaussian blend. The best all-round look.' },
  idw: { label: 'Inverse distance', hint: 'Each colour pulls hardest near its point. Crisper colour centres.' },
  imq: { label: 'Long tail', hint: 'Very wide, airy blending (inverse multiquadric).' },
  wendland: { label: 'Local', hint: 'Each point only affects its neighbourhood (compact kernel).' },
  cells: { label: 'Soft cells', hint: 'Voronoi-like regions with soft borders. Abstract, graphic.' },
};
export const MESH_EDGES = ['extend', 'fade', 'wrap'] as const;
export type MeshEdge = (typeof MESH_EDGES)[number];
export const MESH_EDGE_INFO: Record<MeshEdge, { label: string; hint: string }> = {
  extend: { label: 'Fill', hint: 'Colours extend to every edge.' },
  fade: { label: 'Fade to base', hint: 'Colours fade out into the base colour away from the points.' },
  wrap: { label: 'Seamless', hint: 'The field tiles with no visible seam, for repeating backgrounds.' },
};

export interface MeshFieldSettings {
  enabled: boolean;
  method: MeshFieldMethod;
  space: FieldSpace;
  /** global reach multiplier of every point, 0.3…3 */
  spread: number;
  /** 0 = very soft … 1 = crisp, kernel dependent */
  sharpness: number;
  edge: MeshEdge;
  /** organic domain warp strength 0…1 and its scale */
  warp: number;
  warpScale: number;
  /** warp animation speed, 0…1 (0 = still) */
  flow: number;
  /** fine grain / dither 0…1 */
  grain: number;
  saturation: number;
  contrast: number;
}

export const DEFAULT_MESH_FIELD: Readonly<MeshFieldSettings> = Object.freeze({
  enabled: false, method: 'gaussian', space: 'oklab', spread: 1, sharpness: 0.42, edge: 'extend',
  warp: 0, warpScale: 2, flow: 0.25, grain: 0, saturation: 1, contrast: 1,
});

const num = (v: unknown, lo: number, hi: number, fb: number) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb; };
const pick = <T extends string>(v: unknown, list: readonly T[], fb: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : fb);

export function normalizeMeshField(raw: unknown, base: Readonly<MeshFieldSettings> = DEFAULT_MESH_FIELD): MeshFieldSettings {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    enabled: r.enabled === undefined ? base.enabled : r.enabled === true,
    method: pick(r.method, MESH_FIELD_METHODS, base.method),
    space: pick(r.space, FIELD_SPACES, base.space),
    spread: num(r.spread, 0.3, 3, base.spread),
    sharpness: num(r.sharpness, 0, 1, base.sharpness),
    edge: pick(r.edge, MESH_EDGES, base.edge),
    warp: num(r.warp, 0, 1, base.warp),
    warpScale: num(r.warpScale, 0.5, 8, base.warpScale),
    flow: num(r.flow, 0, 1, base.flow),
    grain: num(r.grain, 0, 1, base.grain),
    saturation: num(r.saturation, 0, 2, base.saturation),
    contrast: num(r.contrast, 0.5, 1.8, base.contrast),
  };
}

/** Optional per-point field properties, stored on `MeshPoint`. */
export interface MeshPointField {
  /** influence multiplier 0…2 (1 = default) */
  strength?: number;
  /** stretch of the influence ellipse 0.25…4 (1 = round) */
  aspect?: number;
  /** orientation of the ellipse, degrees */
  angle?: number;
}
export function normalizePointField(p: MeshPointField | undefined): MeshPointField {
  const out: MeshPointField = {};
  if (p?.strength !== undefined) out.strength = num(p.strength, 0, 2, 1);
  if (p?.aspect !== undefined) out.aspect = num(p.aspect, 0.25, 4, 1);
  if (p?.angle !== undefined) out.angle = num(p.angle, -180, 180, 0);
  return out;
}

/** Composition styles: deliberate combinations of kernel, reach, edge, warp and grading (deterministic, no randomness). */
export interface MeshStyle { id: string; label: string; note: string; field: Partial<MeshFieldSettings>; pointSize: number; layout: string; count: number }
export const MESH_STYLES: readonly MeshStyle[] = [
  { id: 'minimal', label: 'Minimal', note: 'Two or three large, calm colour fields.', pointSize: 70, layout: 'diagonal', count: 3, field: { method: 'gaussian', spread: 1.5, sharpness: 0.2, warp: 0, grain: 0, saturation: 0.9, contrast: 0.95 } },
  { id: 'soft', label: 'Soft', note: 'Pastel, weightless blending.', pointSize: 60, layout: 'organic', count: 5, field: { method: 'imq', spread: 1.3, sharpness: 0.3, warp: 0.1, grain: 0.05, saturation: 0.85, contrast: 0.9 } },
  { id: 'vibrant', label: 'Vibrant', note: 'Saturated, punchy colour centres.', pointSize: 46, layout: 'scatter', count: 6, field: { method: 'gaussian', spread: 1, sharpness: 0.55, warp: 0.15, saturation: 1.25, contrast: 1.1 } },
  { id: 'cinematic', label: 'Cinematic', note: 'Dark ground, light pooling in a few places.', pointSize: 42, layout: 'clustered', count: 5, field: { method: 'gaussian', edge: 'fade', spread: 1.15, sharpness: 0.5, warp: 0.2, grain: 0.18, saturation: 1.1, contrast: 1.25 } },
  { id: 'atmospheric', label: 'Atmospheric', note: 'Hazy sky gradients with a slow drift.', pointSize: 62, layout: 'wave', count: 5, field: { method: 'idw', spread: 1.4, sharpness: 0.25, warp: 0.35, warpScale: 1.4, flow: 0.2, grain: 0.1, saturation: 0.95 } },
  { id: 'organic', label: 'Organic', note: 'Warped, liquid colour movement.', pointSize: 52, layout: 'organic', count: 7, field: { method: 'gaussian', spread: 1.1, sharpness: 0.4, warp: 0.6, warpScale: 2.2, flow: 0.3, saturation: 1.1 } },
  { id: 'abstract', label: 'Abstract', note: 'Soft-edged cells, graphic and modern.', pointSize: 40, layout: 'grid', count: 8, field: { method: 'cells', spread: 1, sharpness: 0.65, warp: 0.25, saturation: 1.15, contrast: 1.1 } },
  { id: 'contrast', label: 'High contrast', note: 'Strong separation between colours.', pointSize: 38, layout: 'corners', count: 5, field: { method: 'idw', spread: 0.9, sharpness: 0.75, warp: 0, saturation: 1.3, contrast: 1.4 } },
  { id: 'ambient', label: 'Ambient', note: 'Dim, wide glows for UI backgrounds.', pointSize: 64, layout: 'edge', count: 4, field: { method: 'gaussian', edge: 'fade', spread: 1.3, sharpness: 0.3, warp: 0.15, grain: 0.12, saturation: 0.9, contrast: 1.05 } },
  { id: 'luxury', label: 'Luxury', note: 'Deep tones with fine grain and slow warp.', pointSize: 48, layout: 'diagonal', count: 5, field: { method: 'wendland', spread: 1.2, sharpness: 0.35, warp: 0.3, flow: 0.12, grain: 0.22, saturation: 0.95, contrast: 1.2 } },
  { id: 'experimental', label: 'Experimental', note: 'Hue-rotating OKLCH blend with heavy warp.', pointSize: 44, layout: 'spiral', count: 9, field: { method: 'cells', space: 'oklch', spread: 1, sharpness: 0.5, warp: 0.8, warpScale: 3.2, flow: 0.5, saturation: 1.2, contrast: 1.15 } },
];
export const meshStyle = (id: string) => MESH_STYLES.find(style => style.id === id) ?? MESH_STYLES[0];
