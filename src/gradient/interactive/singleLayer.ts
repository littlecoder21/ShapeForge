import { sortedStops, type GradientLayer, type GradientProject } from '../engine/model';
import { normalizeProcedural, PROC_MAX_POINTS, type ProceduralConfig } from '../../procedural/types';
import { gradientLayerToShader } from './adapter';

/* "Use as single layer"
 *
 * When the switch is on, visible shader layers keep their original CSS composition and one shared procedural overlay:
 *   · every layer contributes ONE colour stop to the combined palette (its average colour, in painting order bottom → top);
 *   · each colour is anchored to its source layer's geometry, so a radial glow stays local instead of becoming a random blob;
 *   · one procedural engine runs over those anchors, preferring a member with active motion so a static host does not stop
 *     the combined result;
 *   · pointer interaction stays enabled when any member accepts interaction;
 *   · only the host gets a shader canvas; all source layers retain their original CSS paint, order, opacity and blend.
 *
 * It is a pure transform of the project used by the preview: `resolveRenderProject(project)` returns a derived project and
 * never touches the original, so switching it off restores every layer exactly. Layers without a shader stay ordinary CSS
 * layers. Nothing here knows about React or WebGL. */

export type SingleLayerReason = '' | 'off' | 'shader-off' | 'css-backend' | 'needs-two-layers' | 'needs-procedural';

export interface SingleLayerAvailability {
  available: boolean;
  reason: SingleLayerReason;
  /** visible layers with the shader switched on */
  members: number;
  /** name of the layer whose procedural settings drive the merged layer */
  hostName: string;
}

export interface SingleLayerPlan {
  active: boolean;
  reason: SingleLayerReason;
  hostId: string;
  /** every layer that is merged (the host included) */
  memberIds: string[];
  /** one colour per layer, bottom layer first */
  colors: string[];
}

const INACTIVE: SingleLayerPlan = { active: false, reason: 'off', hostId: '', memberIds: [], colors: [] };

/* ───────────── colour ───────────── */

const HEX = /^#[0-9a-f]{6}$/i;
const toLinear = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toSrgb = (value: number) => { const c = Math.max(0, Math.min(1, value)); return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255); };
const parse = (hex: string): [number, number, number] => {
  const n = parseInt(HEX.test(hex) ? hex.slice(1) : '000000', 16);
  return [toLinear((n >> 16) & 255), toLinear((n >> 8) & 255), toLinear(n & 255)];
};
const format = (rgb: [number, number, number]) => `#${rgb.map(c => toSrgb(c).toString(16).padStart(2, '0')).join('')}`;

interface Sample { rgb: [number, number, number]; weight: number }

/** Alpha-weighted mean colour of a set of samples (linear light), or null when nothing is visible. */
function mean(samples: Sample[]): string | null {
  let total = 0;
  const sum: [number, number, number] = [0, 0, 0];
  for (const sample of samples) {
    if (!(sample.weight > 0)) continue;
    total += sample.weight;
    sum[0] += sample.rgb[0] * sample.weight;
    sum[1] += sample.rgb[1] * sample.weight;
    sum[2] += sample.rgb[2] * sample.weight;
  }
  if (total < 1e-4) return null;
  return format([sum[0] / total, sum[1] / total, sum[2] / total]);
}

/** The single colour a layer stands for: the average of its gradient, mesh points or solid colour, weighted by how much of it
 *  is visible. Returns null for a layer that paints nothing (every stop fully transparent). */
export function layerRepresentativeColor(layer: GradientLayer): string | null {
  if (layer.solidColor !== undefined && HEX.test(layer.solidColor)) return layer.solidColor.toLowerCase();
  if (layer.type === 'mesh' && layer.mesh.points.length) {
    return mean(layer.mesh.points.map(point => ({ rgb: parse(point.color), weight: Math.max(0, point.alpha) * Math.max(1, point.size) })));
  }
  const stops = sortedStops(layer.stops).filter(stop => HEX.test(stop.color));
  if (!stops.length) return null;
  const samples: Sample[] = [];
  const add = (color: string, alpha: number, width: number) => samples.push({ rgb: parse(color), weight: Math.max(0, alpha) * Math.max(0, width) });
  // the ramp before the first stop and after the last one holds those stops' colours
  add(stops[0].color, stops[0].alpha, stops[0].pos / 100);
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    const width = (b.pos - a.pos) / 100;
    add(a.color, a.alpha, width / 2);
    add(b.color, b.alpha, width / 2);
  }
  const last = stops[stops.length - 1];
  add(last.color, last.alpha, (100 - last.pos) / 100);
  // stops stacked on one position leave no width to weigh: fall back to a plain mean of the stops
  return mean(samples) ?? mean(stops.map(stop => ({ rgb: parse(stop.color), weight: Math.max(0, stop.alpha) })));
}

function layerAverageAlpha(layer: GradientLayer): number {
  if (layer.solidColor !== undefined) return 1;
  if (layer.type === 'mesh' && layer.mesh.points.length) {
    const points = layer.mesh.points;
    const area = points.reduce((sum, point) => sum + Math.max(1, point.size), 0);
    return points.reduce((sum, point) => sum + Math.max(1, point.size) * Math.max(0, point.alpha), 0) / area;
  }
  const stops = sortedStops(layer.stops);
  if (!stops.length) return 1;
  let alpha = stops[0].alpha * Math.max(0, stops[0].pos) / 100;
  for (let i = 0; i < stops.length - 1; i += 1) {
    alpha += (stops[i].alpha + stops[i + 1].alpha) * Math.max(0, stops[i + 1].pos - stops[i].pos) / 200;
  }
  const last = stops[stops.length - 1];
  alpha += last.alpha * Math.max(0, 100 - last.pos) / 100;
  return Math.max(0, Math.min(1, alpha));
}

function layerAnchors(layer: GradientLayer, color: string, project: GradientProject, config: ProceduralConfig) {
  const { geometry, meshPoints } = gradientLayerToShader(layer, project);
  const opacity = Math.max(0.1, Math.min(3, (Number.isFinite(layer.opacity) ? layer.opacity : 1) * layerAverageAlpha(layer)));
  const radiusScale = Math.max(0.05, config.field.radius * 0.55);
  if (layer.type === 'mesh' && meshPoints.length) {
    return meshPoints.map(point => ({
      x: point.x / 100,
      y: 1 - point.y / 100,
      color,
      radius: Math.max(0.05, Math.min(1.5, point.size / 100 * 1.1 / radiusScale)),
      weight: Math.max(0.1, Math.min(3, point.alpha * opacity)),
    }));
  }
  if (layer.type === 'radial') {
    const aspect = project.canvas.w / Math.max(1, project.canvas.h);
    const reach = Math.max(geometry.radiusX * aspect, geometry.radiusY) / 100;
    return [{
      x: geometry.originX / 100,
      y: 1 - geometry.originY / 100,
      color,
      radius: Math.max(0.05, Math.min(1.5, reach / radiusScale)),
      weight: opacity,
    }];
  }
  if (layer.type === 'linear' || layer.type === 'curve') {
    const angle = geometry.angle * Math.PI / 180;
    const dx = Math.sin(angle) * 0.43;
    const dy = Math.cos(angle) * 0.43;
    return [
      { x: 0.5 - dx, y: 0.5 - dy, color, radius: 1.5, weight: opacity },
      { x: 0.5 + dx, y: 0.5 + dy, color, radius: 1.5, weight: opacity },
    ];
  }
  return [{ x: 0.5, y: 0.5, color, radius: 1.5, weight: opacity }];
}

/* ───────────── plan ───────────── */

const isMember = (layer: GradientLayer) => layer.visible && layer.shader?.enabled === true;

/** The layer whose procedural settings drive the merged layer: the top-most procedural one (index 0 is the top layer),
 *  preferring layers that are not text so a text mask is not taken over by accident. */
function pickHost(members: GradientLayer[]): GradientLayer | null {
  const procedural = members.filter(layer => layer.shader?.procedural?.enabled === true);
  return procedural.find(layer => !layer.text) ?? procedural[0] ?? null;
}

function hasProceduralMotion(layer: GradientLayer): boolean {
  const config = layer.shader?.procedural;
  if (!config?.enabled) return false;
  const normalized = normalizeProcedural(config);
  const motion = normalized.motion;
  return (motion.influence > 0 && motion.speed > 0 && (motion.mixed || motion.type !== 'static'))
    || normalized.color.cycleSpeed !== 0;
}

/** Whether the switch can be used on this project, and why not. Independent of the switch itself. */
export function singleLayerAvailability(project: GradientProject): SingleLayerAvailability {
  const members = project.layers.filter(isMember);
  const host = pickHost(members);
  const base = { members: members.length, hostName: host?.name ?? '' };
  if (!project.shader?.enabled) return { available: false, reason: 'shader-off', ...base };
  if (project.shader.renderBackend === 'css') return { available: false, reason: 'css-backend', ...base };
  if (members.length < 2) return { available: false, reason: 'needs-two-layers', ...base };
  if (!host) return { available: false, reason: 'needs-procedural', ...base };
  return { available: true, reason: '', ...base };
}

export function planSingleLayer(project: GradientProject): SingleLayerPlan {
  if (project.shader?.singleLayer !== true) return INACTIVE;
  const availability = singleLayerAvailability(project);
  if (!availability.available) return { ...INACTIVE, reason: availability.reason };
  const members = project.layers.filter(isMember);
  const host = pickHost(members) as GradientLayer;
  // painting order: the last array entry is the bottom layer, so reverse it: bottom layer = first colour stop
  const colors = [...members].reverse()
    .map(layer => layerRepresentativeColor(layer))
    .filter((color): color is string => color !== null);
  if (!colors.length) return { ...INACTIVE, reason: 'needs-two-layers' };
  return { active: true, reason: '', hostId: host.id, memberIds: members.map(layer => layer.id), colors };
}

/* ───────────── derived layers ───────────── */

/** The procedural config of the merged layer. Its source-layer anchors are added by buildHost(). */
export function mergedProcedural(config: ProceduralConfig, layerCount: number): ProceduralConfig {
  const wanted = Math.min(PROC_MAX_POINTS, Math.max(1, layerCount));
  return normalizeProcedural({
    ...config,
    enabled: true,
    anchors: [],
    origin: null,
    color: { ...config.color, source: 'custom' },
    points: { ...config.points, min: Math.max(config.points.min, wanted), max: Math.max(config.points.max, wanted) },
  });
}

function buildHost(host: GradientLayer, plan: SingleLayerPlan, project: GradientProject, members: GradientLayer[]): GradientLayer {
  const motionSource = members.find(hasProceduralMotion) ?? host;
  const merged = mergedProcedural(motionSource.shader?.procedural as ProceduralConfig, plan.colors.length);
  const groups = [...members].reverse()
    .map(layer => {
      const color = layerRepresentativeColor(layer);
      return color ? layerAnchors(layer, color, project, merged) : [];
    })
    .filter(anchors => anchors.length > 0);
  const anchors = groups.map(group => group[0]);
  for (let index = 1; anchors.length < PROC_MAX_POINTS; index += 1) {
    let added = false;
    for (const group of groups) {
      if (group[index]) {
        anchors.push(group[index]);
        added = true;
        if (anchors.length === PROC_MAX_POINTS) break;
      }
    }
    if (!added) break;
  }
  const procedural = normalizeProcedural({
    ...merged,
    mode: 'hybrid',
    mix: merged.mode === 'hybrid' ? merged.mix : 0.5,
    color: { ...merged.color, source: 'custom', colors: plan.colors },
    points: { ...merged.points, min: anchors.length, max: anchors.length, density: 1 },
    field: { ...merged.field, base: plan.colors[0] },
    anchors,
  });
  const interactionSource = members.find(layer => layer.shader?.interact !== false && (layer.shader?.reaction ?? 1) !== 0);
  return {
    ...host,
    shader: {
      ...host.shader,
      enabled: true,
      interact: interactionSource !== undefined,
      reaction: interactionSource?.shader?.reaction ?? 0,
      mixLayerId: '',
      procedural,
    },
  };
}

const hostCache = new Map<string, { source: GradientLayer; members: GradientLayer[]; canvasKey: string; layer: GradientLayer }>();
const projectCache = new WeakMap<GradientProject, GradientProject>();

/** The project the preview renders. Same object when the switch is off or unavailable; otherwise a derived project where the
 *  host gets the shared procedural field. Every member remains visible with the exact same CSS properties. */
export function resolveRenderProject(project: GradientProject): GradientProject {
  if (project.shader?.singleLayer !== true) return project;
  const cached = projectCache.get(project);
  if (cached) return cached;
  const plan = planSingleLayer(project);
  if (!plan.active) return project;
  const canvasKey = `${project.canvas.w}x${project.canvas.h}`;
  const memberIds = new Set(plan.memberIds);
  const memberLayers = project.layers.filter(layer => memberIds.has(layer.id));
  const layers = project.layers.map(layer => {
    if (layer.id !== plan.hostId) return layer;
    const hit = hostCache.get(layer.id);
    if (hit && hit.source === layer && hit.canvasKey === canvasKey
      && hit.members.length === memberLayers.length && hit.members.every((member, index) => member === memberLayers[index])) return hit.layer;
    const built = buildHost(layer, plan, project, memberLayers);
    hostCache.set(layer.id, { source: layer, members: memberLayers, canvasKey, layer: built });
    return built;
  });
  const resolved = { ...project, shader: { ...project.shader, renderBackend: 'overlay' as const }, layers };
  projectCache.set(project, resolved);
  return resolved;
}
