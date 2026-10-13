import { rgbaString } from './color';
import type { GradientParts } from './css';
import { uid, type GradientLayer, type GradientProject, type MeshData, type MeshPoint } from './model';
import { mulberry } from './rng';

/* ═══════════ Mesh gradients ═══════════
 * A mesh layer is a set of soft colour points. Each point renders as a radial gradient that fades to transparent;
 * overlapping points blend into a smooth, organic field. Points are plain data (x, y, colour, size), so they can be
 * dragged on the canvas, animated and exported as CSS / SVG / PNG like everything else.
 */

const r2 = (v: number, d = 2) => { const k = 10 ** d; return String(Math.round(v * k) / k).replace(/^-0$/, '0'); };

export const newMeshPoint = (x: number, y: number, color: string, alpha = 1, size = 48): MeshPoint => ({ id: uid('m'), x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, color, alpha, size });

export type MeshPattern = 'scatter' | 'grid' | 'diagonal' | 'ring' | 'corners';
export const MESH_PATTERNS: { id: MeshPattern; label: string }[] = [{ id: 'scatter', label: 'Scatter' }, { id: 'grid', label: 'Grid' }, { id: 'diagonal', label: 'Diagonal' }, { id: 'ring', label: 'Ring' }, { id: 'corners', label: 'Corners' }];

/** Lay out `count` points for a pattern. Deterministic for a given seed. */
export function meshLayout(count: number, pattern: MeshPattern, seed: number): { x: number; y: number }[] {
  const rnd = mulberry(seed * 131 + 7), out: { x: number; y: number }[] = [], j = (v: number, a: number) => v + (rnd() - 0.5) * a;
  if (pattern === 'grid') {
    const cols = Math.ceil(Math.sqrt(count * 1.4)), rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) out.push({ x: j(((i % cols) + 0.5) / cols * 100, 6), y: j((Math.floor(i / cols) + 0.5) / rows * 100, 6) });
  } else if (pattern === 'diagonal') {
    for (let i = 0; i < count; i++) { const t = count === 1 ? 0.5 : i / (count - 1); out.push({ x: j(10 + t * 80, 10), y: j(12 + t * 76, 22) }); }
  } else if (pattern === 'ring') {
    for (let i = 0; i < count; i++) { const a = (i / count) * Math.PI * 2 + rnd() * 0.4; out.push({ x: 50 + Math.cos(a) * 34 + (rnd() - .5) * 6, y: 50 + Math.sin(a) * 36 + (rnd() - .5) * 6 }); }
  } else if (pattern === 'corners') {
    const c = [[8, 10], [92, 12], [90, 90], [10, 88], [50, 48], [28, 46], [72, 52], [50, 14], [50, 86]];
    for (let i = 0; i < count; i++) { const [x, y] = c[i % c.length]; out.push({ x: j(x, 6), y: j(y, 6) }); }
  } else {
    const cols = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / cols);
    const cells = Array.from({ length: cols * rows }, (_, i) => i).sort(() => rnd() - 0.5).slice(0, count);
    cells.forEach(c => out.push({ x: j(((c % cols) + 0.5) / cols * 100, 100 / cols * 0.7), y: j((Math.floor(c / cols) + 0.5) / rows * 100, 100 / rows * 0.7) }));
  }
  return out.map(p => ({ x: Math.max(0, Math.min(100, p.x)), y: Math.max(0, Math.min(100, p.y)) }));
}

export function generateMesh(colors: string[], count: number, pattern: MeshPattern, seed: number, base = '', size = 48): MeshData {
  const rnd = mulberry(seed * 977 + 3), pts = meshLayout(count, pattern, seed);
  return { base, core: 40, seed, points: pts.map((p, i) => newMeshPoint(p.x, p.y, colors[i % colors.length], 1, size * (0.85 + rnd() * 0.35))) };
}

/** Radii of a point in % of the canvas — ry compensates the aspect ratio so points look round. */
export const pointRadii = (p: MeshPoint, canvas: GradientProject['canvas']) => ({ rx: p.size, ry: (p.size * canvas.w) / canvas.h });

export interface MeshCtx { alphaMul: number; flat: boolean; s: number; /** animated coordinates: point id → CSS var() for x / y */ vars?: Map<string, { x?: string; y?: string }> }

/** The % value a point coordinate takes inside a (possibly bled) layer box. */
export const meshCoord = (v: number, s: number) => (v + (100 * (s - 1)) / 2) / s;

/** One radial gradient per point (top-first), ready to be printed on one line or neatly over several. */
export function meshParts(layer: GradientLayer, project: GradientProject, o: MeshCtx): GradientParts[] {
  const space = layer.space !== 'srgb' ? `in ${layer.space} ` : '';
  const mid = 25 + layer.mesh.core * 0.5;
  return layer.mesh.points.map(p => {
    const { rx, ry } = pointRadii(p, project.canvas), v = o.vars?.get(p.id);
    const x = v?.x ?? `${r2(meshCoord(p.x, o.s))}%`, y = v?.y ?? `${r2(meshCoord(p.y, o.s))}%`;
    const stops = [`${rgbaString(p.color, p.alpha * o.alphaMul)} 0%`, ...(Math.abs(mid - 50) > 0.5 ? [`${r2(mid, 1)}%`] : []), `${rgbaString(p.color, 0)} 100%`];
    return { fn: 'radial-gradient', head: `${space}ellipse ${r2(rx / o.s)}% ${r2(ry / o.s)}% at ${x} ${y}`, stops };
  });
}
