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

export const newMeshPoint = (x: number, y: number, color: string, alpha = 1, size = 48): MeshPoint => ({ id: uid('m'), x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, color, alpha, size, locked: false });

export type MeshPattern = 'scatter' | 'grid' | 'diagonal' | 'ring' | 'corners' | 'spiral' | 'radial' | 'mirrored' | 'clustered' | 'wave' | 'edge' | 'center' | 'organic';
export const MESH_PATTERNS: { id: MeshPattern; label: string }[] = [
  { id: 'scatter', label: 'Scatter' }, { id: 'grid', label: 'Grid' }, { id: 'diagonal', label: 'Diagonal' },
  { id: 'ring', label: 'Ring' }, { id: 'corners', label: 'Corners' }, { id: 'spiral', label: 'Spiral' },
  { id: 'radial', label: 'Radial' }, { id: 'mirrored', label: 'Mirrored' }, { id: 'clustered', label: 'Clustered' },
  { id: 'wave', label: 'Wave' }, { id: 'edge', label: 'Edge' }, { id: 'center', label: 'Center' },
  { id: 'organic', label: 'Organic' },
];

/** Lay out `count` points for a pattern. Deterministic for a given seed. */
export function meshLayout(count: number, pattern: MeshPattern, seed: number): { x: number; y: number }[] {
  const n = Math.max(0, Math.min(128, Math.floor(Number.isFinite(count) ? count : 0)));
  const rnd = mulberry(seed * 131 + 7), out: { x: number; y: number }[] = [], j = (v: number, a: number) => v + (rnd() - 0.5) * a;
  const push = (x: number, y: number) => out.push({ x, y });
  if (!n) return out;
  if (pattern === 'grid' || pattern === 'organic') {
    const cols = Math.ceil(Math.sqrt(n * 1.4)), rows = Math.ceil(n / cols);
    const cells = Array.from({ length: cols * rows }, (_, i) => i);
    if (pattern === 'organic') {
      for (let i = cells.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [cells[i], cells[k]] = [cells[k], cells[i]]; }
    }
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      push(j(((c % cols) + 0.5) / cols * 100, pattern === 'organic' ? 100 / cols * 0.7 : 6), j((Math.floor(c / cols) + 0.5) / rows * 100, pattern === 'organic' ? 100 / rows * 0.7 : 6));
    }
  } else if (pattern === 'diagonal') {
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); push(j(10 + t * 80, 10), j(12 + t * 76, 22)); }
  } else if (pattern === 'ring') {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd() * 0.4; push(50 + Math.cos(a) * 34 + (rnd() - .5) * 6, 50 + Math.sin(a) * 36 + (rnd() - .5) * 6); }
  } else if (pattern === 'corners') {
    const c = [[8, 10], [92, 12], [90, 90], [10, 88], [50, 48], [28, 46], [72, 52], [50, 14], [50, 86]];
    for (let i = 0; i < n; i++) { const [x, y] = c[i % c.length]; push(j(x, 6), j(y, 6)); }
  } else if (pattern === 'spiral') {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, a = t * Math.PI * 5 + rnd() * 0.18, r = 5 + t * 39;
      push(50 + Math.cos(a) * r + j(0, 4), 50 + Math.sin(a) * r * 0.82 + j(0, 4));
    }
  } else if (pattern === 'radial') {
    const rings = Math.max(1, Math.ceil(Math.sqrt(n / 2)));
    for (let i = 0; i < n; i++) {
      const ring = Math.floor(i / Math.max(1, Math.ceil(n / rings))), t = (ring + 0.7) / rings;
      const a = i * 2.399963229728653 + (rnd() - 0.5) * 0.18, r = 6 + t * 39;
      push(50 + Math.cos(a) * r + j(0, 3), 50 + Math.sin(a) * r * 0.82 + j(0, 3));
    }
  } else if (pattern === 'mirrored') {
    for (let i = 0; i < n; i += 2) {
      const x = 8 + rnd() * 34, y = 8 + rnd() * 84;
      push(x, y);
      if (i + 1 < n) push(100 - x, y);
      else if (n % 2 === 1) out[i] = { x: 50, y };
    }
  } else if (pattern === 'clustered') {
    const centers = Array.from({ length: Math.min(4, Math.max(2, Math.ceil(n / 3))) }, () => ({ x: 14 + rnd() * 72, y: 14 + rnd() * 72 }));
    for (let i = 0; i < n; i++) {
      const c = centers[i % centers.length], a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 15;
      push(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    }
  } else if (pattern === 'wave') {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      push(j(8 + t * 84, 8), 50 + Math.sin(t * Math.PI * 2) * 28 + j(0, 12));
    }
  } else if (pattern === 'edge') {
    for (let i = 0; i < n; i++) {
      const edge = Math.floor(rnd() * 4), d = rnd() * 20, t = rnd() * 100;
      push(edge === 0 ? d : edge === 1 ? 100 - d : t, edge === 2 ? d : edge === 3 ? 100 - d : t);
    }
  } else if (pattern === 'center') {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 34;
      push(50 + Math.cos(a) * r, 50 + Math.sin(a) * r * 0.8);
    }
  } else {
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const cells = Array.from({ length: cols * rows }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [cells[i], cells[k]] = [cells[k], cells[i]]; }
    cells.slice(0, n).forEach(c => push(j(((c % cols) + 0.5) / cols * 100, 100 / cols * 0.7), j((Math.floor(c / cols) + 0.5) / rows * 100, 100 / rows * 0.7)));
  }
  return out.map(p => ({ x: Math.max(0, Math.min(100, p.x)), y: Math.max(0, Math.min(100, p.y)) }));
}

export function generateMesh(colors: string[], count: number, pattern: MeshPattern, seed: number, base = '', size = 48): MeshData {
  const palette = colors.length ? colors : ['#7c5cff', '#22d3ee'];
  const rnd = mulberry(seed * 977 + 3), pts = meshLayout(count, pattern, seed);
  return { base, core: 40, seed, points: pts.map((p, i) => newMeshPoint(p.x, p.y, palette[i % palette.length], 1, size * (0.85 + rnd() * 0.35))) };
}

/** Radii of a point in % of the canvas — ry compensates the aspect ratio so points look round. */
export const pointRadii = (p: MeshPoint, canvas: GradientProject['canvas']) => ({ rx: p.size, ry: (p.size * canvas.w) / canvas.h });

export interface MeshCtx { alphaMul: number; flat: boolean; s: number; /** animated coordinates: point id → CSS var() for x / y */ vars?: Map<string, { x?: string; y?: string }> }

/** The % value a point coordinate takes inside a (possibly bled) layer box. */
export const meshCoord = (v: number, s: number) => (v + (100 * (s - 1)) / 2) / s;

/** One radial gradient per point (top-first), ready to be printed on one line or neatly over several. */
export function meshParts(layer: GradientLayer, project: GradientProject, o: MeshCtx): GradientParts[] {
  const space = layer.space !== 'srgb' ? `in ${layer.space} ` : '';
  return layer.mesh.points.map(p => {
    const { rx, ry } = pointRadii(p, project.canvas), v = o.vars?.get(p.id);
    const x = v?.x ?? `${r2(meshCoord(p.x, o.s))}%`, y = v?.y ?? `${r2(meshCoord(p.y, o.s))}%`;
    const mid = 25 + (p.core ?? layer.mesh.core) * 0.5;
    const stops = [`${rgbaString(p.color, p.alpha * o.alphaMul)} 0%`, ...(Math.abs(mid - 50) > 0.5 ? [`${r2(mid, 1)}%`] : []), `${rgbaString(p.color, 0)} 100%`];
    return { fn: 'radial-gradient', head: `${space}ellipse ${r2(rx / o.s)}% ${r2(ry / o.s)}% at ${x} ${y}`, stops };
  });
}
