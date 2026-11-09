import {
  DEFAULT_PROCEDURAL_MESH, PROC_MAX_MESH_POINTS, type MeshComposite, type ProceduralAnchor, type ProceduralConfig, type ProceduralMeshConfig,
} from './types';

/* Mesh → procedural bridge.
 *
 * The mesh layer (GradientLayer.mesh) stays the single source of truth. Nothing here edits it: a procedural config only
 * carries `mesh.source = 'layer'`, and whenever the layer is drawn the live points are turned into anchors by
 * `meshToAnchors` / `resolveProceduralMesh`. The mapping keeps every property that affects how a point looks (position,
 * colour, alpha, size, core, translate / scale transform) and keeps the point order, so it can be reversed with
 * `anchorsToMeshPoints`. Rotation, skew and per-point effects (blur …) are CSS-only: they are listed by `meshCssOnlyNotes`.
 *
 * Coordinates: mesh points are percentages of the canvas, y DOWN. Anchors are canvas uv, y UP (what the shader samples). */

export interface MeshPointLike {
  id?: string;
  x: number;
  y: number;
  color: string;
  alpha: number;
  /** radius, % of the canvas width */
  size: number;
  core?: number;
  transform?: Partial<{ x: number; y: number; scale: number; rotate: number; skewX: number; skewY: number }>;
  effects?: ReadonlyArray<{ enabled?: boolean }>;
}
export interface MeshLike { points: readonly MeshPointLike[]; base?: string; core?: number }

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const r1 = (value: number) => Math.round(value * 10) / 10;

/** mesh.ts: the middle stop of a point, in percent. */
export const meshMidStop = (core: number): number => 25 + core * 0.5;

/** Exponent of the CSS colour hint written by meshParts(): 1 (no hint) within 0.5 % of the centre, else ln 0.5 / ln(mid).
 *  The hint position is printed with one decimal, so the same rounding is applied here. */
export function cssHintExponent(core: number): number {
  const mid = r1(meshMidStop(core));
  if (Math.abs(mid - 50) <= 0.5) return 1;
  return Math.log(0.5) / Math.log(mid / 100);
}

/** The point as it is drawn: translate and scale of its transform folded in (what the flat CSS output does). */
export function effectivePoint(point: MeshPointLike, meshCore = 40) {
  const t = point.transform ?? {};
  return {
    x: point.x + finite(t.x, 0),
    y: point.y + finite(t.y, 0),
    size: point.size * finite(t.scale, 1),
    alpha: clamp(finite(point.alpha, 1), 0, 1),
    core: clamp(finite(point.core, meshCore), 0, 100),
    color: HEX.test(point.color) ? point.color.toLowerCase() : '#ffffff',
  };
}

/** Every mesh point → one anchor, same order (index 0 = the TOP point, like the CSS stack). */
export function meshToAnchors(mesh: MeshLike, max = PROC_MAX_MESH_POINTS): ProceduralAnchor[] {
  const meshCore = finite(mesh.core, 40);
  return mesh.points.slice(0, max).map(point => {
    const p = effectivePoint(point, meshCore);
    return {
      x: clamp(p.x / 100, -0.5, 1.5),
      y: clamp(1 - p.y / 100, -0.5, 1.5),
      color: p.color,
      radius: clamp((p.size / 100) * 1.1, 0.08, 1.2),
      weight: clamp(p.alpha, 0, 3),
      alpha: p.alpha,
      core: p.core,
      size: clamp(p.size, 0.5, 200),
    };
  });
}

/** The reverse mapping (for tests and for "release the link"): anchors → mesh-style points, percent coordinates, y down. */
export function anchorsToMeshPoints(anchors: readonly ProceduralAnchor[]): Required<Pick<MeshPointLike, 'x' | 'y' | 'color' | 'alpha' | 'size' | 'core'>>[] {
  return anchors.map(anchor => ({
    x: r1(anchor.x * 100 * 100) / 100,
    y: r1((1 - anchor.y) * 100 * 100) / 100,
    color: anchor.color,
    alpha: anchor.alpha ?? clamp(anchor.weight, 0, 1),
    size: anchor.size ?? anchor.radius / 1.1 * 100,
    core: anchor.core ?? 40,
  }));
}

/** What the shader cannot reproduce from a mesh (it stays in the CSS renderer and in the data). */
export function meshCssOnlyNotes(mesh: MeshLike): string[] {
  let rotated = 0, effects = 0;
  for (const point of mesh.points) {
    const t = point.transform ?? {};
    if (finite(t.rotate, 0) || finite(t.skewX, 0) || finite(t.skewY, 0)) rotated += 1;
    if ((point.effects ?? []).some(effect => effect.enabled !== false)) effects += 1;
  }
  const notes: string[] = [];
  if (rotated) notes.push(`${rotated} point${rotated === 1 ? ' has' : 's have'} a rotate / skew transform, which only the CSS mesh draws.`);
  if (effects) notes.push(`${effects} point${effects === 1 ? ' has' : 's have'} point effects (blur …), which only the CSS mesh draws.`);
  return notes;
}

/** Returns the config the renderer should draw: when it is linked to the layer's mesh, the anchors and the mesh settings come
 *  from the live mesh (the stored config is not touched); otherwise the config is returned as it is. */
export function resolveProceduralMesh(config: ProceduralConfig | null | undefined, mesh: MeshLike | null | undefined): ProceduralConfig | null {
  if (!config) return null;
  if (config.mesh.source !== 'layer' || !mesh) return config;
  const settings: ProceduralMeshConfig = {
    ...config.mesh,
    base: HEX.test(mesh.base ?? '') ? (mesh.base as string).toLowerCase() : '',
    core: clamp(finite(mesh.core, DEFAULT_PROCEDURAL_MESH.core), 0, 100),
  };
  return { ...config, mesh: settings, anchors: meshToAnchors(mesh) };
}

/* ─────────────── reference evaluation (tests, and the harness that compares the shader with the browser's CSS) ─────────────── */

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(HEX.test(hex) ? hex.slice(1) : '000000', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** CPU twin of procSampleCss for one pixel. `u`, `v` are canvas uv (v up). Returns straight RGBA 0…1. */
export function cssMeshPixel(
  anchors: readonly ProceduralAnchor[],
  options: { base?: string; opacity?: number; aspect: number; composite?: MeshComposite; core?: number },
  u: number,
  v: number,
): [number, number, number, number] {
  const composite = options.composite ?? 'background';
  const opacity = clamp(options.opacity ?? 1, 0, 1);
  const baseRgb = HEX.test(options.base ?? '') ? hexRgb(options.base as string) : [0, 0, 0];
  const baseA = HEX.test(options.base ?? '') ? opacity : 0;
  let acc = [baseRgb[0] * baseA, baseRgb[1] * baseA, baseRgb[2] * baseA];
  let accA = baseA;
  for (let i = anchors.length - 1; i >= 0; i--) { // last point = bottom of the stack
    const anchor = anchors[i];
    const rgb = hexRgb(anchor.color);
    const alpha = clamp(anchor.alpha ?? clamp(anchor.weight, 0, 1), 0, 1) * opacity;
    const radius = Math.max(((anchor.size ?? anchor.radius / 1.1 * 100) / 100) * options.aspect, 1e-4);
    const dx = (u - anchor.x) * options.aspect, dy = v - anchor.y;
    let s: number;
    if (composite === 'layered') {
      const inside = Math.abs(dx) <= radius && Math.abs(dy) <= radius ? 1 : 0;
      s = alpha * Math.max(1 - Math.hypot(dx, dy) / (radius * Math.SQRT2), 0) * inside;
      const back = accA > 1e-5 ? acc.map(c => c / accA) : [0, 0, 0];
      const screened = back.map((b, k) => b + rgb[k] - b * rgb[k]);
      acc = acc.map((c, k) => s * (1 - accA) * rgb[k] + s * accA * screened[k] + (1 - s) * c);
      accA = s + accA * (1 - s);
    } else {
      const t = Math.hypot(dx, dy) / radius;
      const k = cssHintExponent(anchor.core ?? options.core ?? 40);
      s = t < 1 ? alpha * (1 - Math.pow(Math.max(t, 1e-6), k)) : 0;
      acc = acc.map((c, j) => rgb[j] * s + c * (1 - s));
      accA = s + accA * (1 - s);
    }
  }
  return accA > 1e-5 ? [acc[0] / accA, acc[1] / accA, acc[2] / accA, accA] : [0, 0, 0, 0];
}
