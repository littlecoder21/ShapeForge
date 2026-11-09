import { PROC_MAX_POINTS, newProcedural, type ProceduralAnchor, type ProceduralConfig, type ProceduralMode } from './types';
import { meshCssOnlyNotes, meshToAnchors, type MeshLike } from './meshSource';

/* "Proceduralize": turn the gradient a layer already has into a procedural configuration.
 *
 * It is non-destructive by construction. The only thing written is a new `ProceduralConfig`; the layer's stops, mesh
 * points and geometry are never touched, so switching the engine off (or removing the config) restores the manual
 * gradient exactly. The input is the shape `gradientLayerToShader()` already returns, so nothing here reads the
 * project model directly.
 *
 * What survives the conversion, per source kind (all positions are canvas uv, y up; the adapter's are percent, y down):
 *   mesh     EVERY mesh point (up to 128) becomes an anchor with its position, colour, alpha, size, core and translate / scale
 *            transform, in the same stacking order. The config is linked to the layer (`mesh.source = 'layer'`), so editing
 *            the mesh keeps updating the procedural result, and it renders CSS-compatible: the stacked radial gradients of
 *            the CSS mesh in one shader pass. Switch to the unified field in the panel for a continuous blend.
 *   linear   colour centres placed along the gradient axis at the stop positions (colours and order preserved).
 *   radial   a centre for the first stop, then a ring of centres per later stop at that stop's radius.
 *   conic    centres around the origin at each stop's angle.
 *   curve / repeating / noise: treated as linear (or the fallback palette), because their geometry is CSS-backed.
 * `approximation` says in plain words what is (not) an exact match, for the panel. */

export interface ProceduralSource {
  palette: ReadonlyArray<{ color: string; position: number }>;
  geometry: { kind: string; angle: number; originX: number; originY: number; radiusX: number; radiusY: number };
  /** the legacy, capped list (8 points, no core / transform) */
  meshPoints: ReadonlyArray<{ color: string; x: number; y: number; size: number; alpha?: number }>;
  /** the layer's full live mesh (every point, with core and transform). When present the conversion links to it. */
  mesh?: MeshLike | null;
}

export interface ProceduralizeOptions {
  mode?: ProceduralMode;
  seed?: number;
}

export interface ProceduralizeResult {
  config: ProceduralConfig;
  /** what was approximated, for display */
  approximation: string;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const HEX = /^#[0-9a-f]{6}$/i;
const hexOr = (value: string, fallback: string) => HEX.test(value) ? value.toLowerCase() : fallback;

function sortedPalette(source: ProceduralSource): { color: string; position: number }[] {
  const list = source.palette.map(stop => ({ color: hexOr(stop.color, '#808080'), position: clamp(stop.position, 0, 1) }));
  return list.sort((a, b) => a.position - b.position);
}

function dedupeEnds(stops: { color: string; position: number }[]): { color: string; position: number }[] {
  // a closed conic (first colour repeated at 100%) would otherwise put two centres on the same spot
  if (stops.length > 2 && stops[0].color === stops[stops.length - 1].color && stops[stops.length - 1].position >= 0.99) return stops.slice(0, -1);
  return stops;
}

/** Evenly thins a list to at most `max` entries, keeping the first and last. */
function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, index) => items[Math.round(index * (items.length - 1) / (max - 1))]);
}

/** Every mesh point, nothing dropped. Prefers the full live mesh; falls back to the legacy capped list. */
function fromMesh(source: ProceduralSource): ProceduralAnchor[] {
  const mesh: MeshLike = source.mesh ?? {
    points: source.meshPoints.map(point => ({ x: point.x, y: point.y, color: point.color, alpha: point.alpha ?? 1, size: point.size })),
  };
  return meshToAnchors(mesh);
}

function fromLinear(stops: { color: string; position: number }[], angleDeg: number): ProceduralAnchor[] {
  const picked = thin(stops, 8);
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a), dy = Math.cos(a);
  const span = 0.86;
  const radius = clamp(span / Math.max(2, picked.length - 1) * 0.95, 0.16, 0.5);
  return picked.map(stop => ({
    x: 0.5 + dx * (stop.position - 0.5) * span,
    y: 0.5 + dy * (stop.position - 0.5) * span,
    color: stop.color,
    radius,
    weight: 1,
  }));
}

function fromRadial(stops: { color: string; position: number }[], cx: number, cy: number, reach: number): ProceduralAnchor[] {
  const picked = thin(stops, 6);
  const ringStops = picked.slice(1);
  const budget = PROC_MAX_POINTS - 1;
  const perRing = clamp(Math.floor(budget / Math.max(1, ringStops.length)), 1, 5);
  const radius = clamp(reach / Math.max(2, picked.length) * 1.1, 0.14, 0.5);
  const anchors: ProceduralAnchor[] = [{ x: cx, y: cy, color: picked[0].color, radius, weight: 1 }];
  ringStops.forEach((stop, ring) => {
    const distance = stop.position * reach;
    for (let i = 0; i < perRing && anchors.length < PROC_MAX_POINTS; i++) {
      const angle = (i / perRing) * Math.PI * 2 + ring * 0.6;
      anchors.push({ x: cx + Math.cos(angle) * distance, y: cy + Math.sin(angle) * distance, color: stop.color, radius, weight: 1 });
    }
  });
  return anchors;
}

function fromConic(stops: { color: string; position: number }[], cx: number, cy: number, angleDeg: number): ProceduralAnchor[] {
  const picked = thin(dedupeEnds(stops), 10);
  const reach = 0.3;
  return picked.map(stop => {
    const theta = ((angleDeg + stop.position * 360) * Math.PI) / 180;
    return { x: cx + Math.sin(theta) * reach, y: cy + Math.cos(theta) * reach, color: stop.color, radius: 0.3, weight: 1 };
  });
}

export function proceduralizeSource(source: ProceduralSource, options: ProceduralizeOptions = {}): ProceduralizeResult {
  const mode = options.mode ?? 'full';
  const geometry = source.geometry;
  const stops = sortedPalette(source);
  const cx = clamp(geometry.originX / 100, 0, 1);
  const cy = clamp(1 - geometry.originY / 100, 0, 1);
  let anchors: ProceduralAnchor[] = [];
  let approximation: string;
  let from = geometry.kind;
  let method: ProceduralConfig['field']['method'] = 'soft';
  let falloff = 0.4;
  let isMesh = false;
  let linked = false;

  if (geometry.kind === 'mesh' && (source.mesh?.points.length || source.meshPoints.length)) {
    anchors = fromMesh(source);
    isMesh = true;
    linked = !!source.mesh;
    method = 'gaussian';
    falloff = 0.2;
    const notes = source.mesh ? meshCssOnlyNotes(source.mesh) : [];
    approximation = `All ${anchors.length} mesh points are kept (position, colour, alpha, size, core, stacking order)`
      + `${linked ? ' and stay linked to the layer\'s mesh' : ''}. Rendered CSS-compatible: the same stacked radial gradients as the CSS mesh, in one shader pass.`
      + `${notes.length ? ` ${notes.join(' ')}` : ''}`;
  } else if (stops.length >= 2 && geometry.kind === 'radial') {
    const reach = clamp(Math.max(geometry.radiusX, geometry.radiusY) / 100, 0.2, 0.7);
    anchors = fromRadial(stops, cx, cy, reach);
    approximation = 'The radial gradient became a centre plus rings of colour centres at each stop\'s radius. Colours and order are kept; the CSS interpolation is approximated by soft blending.';
  } else if (stops.length >= 2 && geometry.kind === 'conic') {
    anchors = fromConic(stops, cx, cy, geometry.angle);
    approximation = 'The conic gradient became colour centres around its origin at each stop\'s angle. Colours and order are kept; the CSS interpolation is approximated by soft blending.';
  } else if (stops.length >= 2) {
    anchors = fromLinear(stops, geometry.angle);
    const kindNote = geometry.kind === 'linear' ? 'The linear gradient' : `This ${geometry.kind} gradient (its geometry is CSS-backed)`;
    approximation = `${kindNote} became colour centres along the gradient axis at each stop's position. Colours and order are kept; the CSS interpolation is approximated by soft blending.`;
    from = geometry.kind === 'linear' ? 'linear' : geometry.kind;
  } else {
    approximation = 'This layer has no colour stops to convert, so the engine starts from its default generated palette.';
  }

  const count = anchors.length;
  const config = newProcedural({
    enabled: true,
    mode,
    seed: options.seed ?? 1337,
    mix: mode === 'hybrid' ? 0.85 : 1,
    points: count ? { min: Math.min(count, PROC_MAX_POINTS), max: Math.min(count, PROC_MAX_POINTS), density: 1, spread: 1, radius: 0.35, variance: 0.1, spacing: 0 } : {},
    field: { method, falloff, radius: 1, softness: 0.55, overlap: 0.8 },
    color: { source: 'layer', interpolation: 'oklab', variance: 0 },
    // a converted mesh starts still, so the result is the CSS mesh itself; motion is one switch away (or a preset)
    motion: isMesh
      ? { type: 'static', amplitude: 0.05, speed: 0.5, smoothness: 0.7, randomness: 0.35 }
      : { type: 'drift', amplitude: 0.05, speed: 0.5, smoothness: 0.7, randomness: 0.35 },
    mesh: isMesh
      ? { source: linked ? 'layer' : 'snapshot', render: 'css-compatible', composite: 'background', base: source.mesh?.base ?? '', core: source.mesh?.core ?? 40, opacity: 1 }
      : {},
    anchors,
    origin: { from, note: approximation },
  });
  return { config, approximation };
}

/** Quick check used by the panel: does this layer have anything meaningful to convert? */
export function canProceduralize(source: ProceduralSource): boolean {
  return source.palette.length >= 2 || source.meshPoints.length > 0 || (source.mesh?.points.length ?? 0) > 0;
}
