import { AdaptiveResolution } from '../AdaptiveResolution';
import type { ShaderQuality } from '../../types';
import { PROC_MAX_STAGES, type ProceduralStage } from '../../../procedural/types';

/* Global GPU rendering budget.
 *
 * Before: every shader layer owned an AdaptiveResolution and divided its own resolution by sqrt(layerCount). N controllers
 * reacted to the same slow frame, each lowering its own layer, so the reductions multiplied; and a trivial two-colour layer got
 * exactly the same pixels as a heavy procedural one.
 *
 * Now: one budget for the whole composition.
 *   1. every layer states what it would like on its own (`desiredScale`) and how expensive a pixel of it is (`weight`);
 *   2. the allocator spends the same total GPU work the old per-layer rule did, but gives cheap layers more pixels and heavy
 *      layers fewer (scale ∝ weight^-0.25, so the change is gentle and a lone layer is never reduced);
 *   3. ONE AdaptiveResolution watches the real frame time and applies one global factor on top;
 *   4. results are quantised, so resolution cannot flicker from frame to frame.
 * Everything here is pure (no DOM, no GL) so it is unit-tested. */

/** Quality presets: the existing `settings.quality` levels, now defined in one place. */
export const QUALITY_PRESETS: Record<ShaderQuality, { resolution: number; octaves: number; warpDepth: number }> = {
  low: { resolution: 0.55, octaves: 3, warpDepth: 1 },
  medium: { resolution: 0.75, octaves: 4, warpDepth: 2 },
  high: { resolution: 1, octaves: 5, warpDepth: 2 },
  ultra: { resolution: 1.35, octaves: 6, warpDepth: 2 },
};

/** the most pixels one layer may render (device pixels) and the highest / lowest render scale */
export const MAX_RENDER_PIXELS = 1_200_000;
export const MAX_RENDER_SCALE = 1.25;
export const MIN_RENDER_SCALE = 0.35;
/** adaptive resolution never takes a layer below this absolute render scale (unless it already was) */
export const MIN_ADAPTIVE_RENDER_SCALE = 0.5;
/** resolution is quantised to 1/64 steps so tiny allocation changes never resize canvases */
export const SCALE_QUANTUM = 64;
const WEIGHT_EXPONENT = 0.25;
const MAX_WEIGHT = 6;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const quantize = (value: number) => Math.round(value * SCALE_QUANTUM) / SCALE_QUANTUM;

/** One layer's request. Sizes are CSS pixels, scales are device pixels per CSS pixel. */
export interface LayerLoad {
  id: number;
  cssWidth: number;
  cssHeight: number;
  /** device-pixel scale the layer would take on its own: dpr × quality preset × the user's resolution scale */
  requestedScale: number;
  /** GPU cost of one pixel of this layer relative to a plain gradient shader (1) */
  weight: number;
}

/** The scale a single layer would get alone: the old `baseResolutionScale()` before adaptive and caps. */
export function requestedScale(devicePixelRatio: number, quality: ShaderQuality, userScale: number): number {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  return clamp(dpr * QUALITY_PRESETS[quality].resolution * userScale, MIN_RENDER_SCALE, quality === 'ultra' ? 1.75 : 2);
}

/** What one layer is allowed at most, whatever the budget: scale ceiling and the per-layer pixel ceiling. */
export function layerCap(load: Pick<LayerLoad, 'cssWidth' | 'cssHeight' | 'requestedScale'>): number {
  const pixelScale = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, load.cssWidth * load.cssHeight));
  return clamp(Math.min(load.requestedScale, MAX_RENDER_SCALE, pixelScale), MIN_RENDER_SCALE, MAX_RENDER_SCALE);
}

/** Rough noise cost of a procedural layer; 1 = plain gradient. A cost model for budgeting, not a benchmark. */
const STAGE_COST: Record<string, number> = { fbm: 2, warp: 4, multiwarp: 6, turbulence: 2, curl: 4, flow: 2, polar: 0.2, radial: 0.2, wave: 0.2, rotate: 0.1, scale: 0.1 };
export function layerWeight(
  procedural: { enabled: boolean; distortion: Pick<ProceduralStage, 'type' | 'enabled' | 'octaves'>[]; points: { max: number } } | null | undefined,
  octaveCap = 6,
): number {
  if (!procedural || !procedural.enabled) return 1;
  let noise = 0;
  for (const stage of procedural.distortion.slice(0, PROC_MAX_STAGES)) {
    if (stage.type === 'none' || !stage.enabled) continue;
    noise += (STAGE_COST[stage.type] ?? 0) * Math.min(stage.octaves, octaveCap);
  }
  return clamp(1 + noise / 12 + Math.max(0, procedural.points.max - 8) * 0.03, 1, MAX_WEIGHT);
}

export interface AllocationOptions {
  /** one global factor from the frame-time controller (0…1) */
  globalScale?: number;
}

/** The render scale of the layers as the old per-layer rule would have set them: sqrt(count) shared equally. */
function referenceScale(load: LayerLoad, count: number): number {
  const shared = clamp(load.requestedScale / Math.sqrt(count), MIN_RENDER_SCALE, 2);
  return layerCap({ ...load, requestedScale: shared });
}

/** Work = pixels × weight. Spends the old total, redistributed by weight; never exceeds a layer's own cap. */
export function allocateScales(loads: readonly LayerLoad[], options: AllocationOptions = {}): Map<number, number> {
  const result = new Map<number, number>();
  const count = loads.length;
  if (!count) return result;
  const caps = loads.map(layerCap);
  const area = loads.map(load => Math.max(1, load.cssWidth * load.cssHeight));
  const weights = loads.map(load => clamp(load.weight, 1, MAX_WEIGHT));
  const reference = loads.map(load => referenceScale(load, count));
  const target = loads.reduce((sum, _load, i) => sum + area[i] * reference[i] * reference[i] * weights[i], 0);

  const scaleAt = (k: number, i: number) => clamp(k * Math.pow(weights[i], -WEIGHT_EXPONENT), MIN_RENDER_SCALE, caps[i]);
  const workAt = (k: number) => loads.reduce((sum, _load, i) => { const s = scaleAt(k, i); return sum + area[i] * s * s * weights[i]; }, 0);

  let lo = 0;
  let hi = 4;
  if (workAt(hi) <= target) lo = hi; // the budget is larger than anything the layers can use: everything gets its cap
  else for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (workAt(mid) <= target) lo = mid; else hi = mid; }

  const factor = clamp(options.globalScale ?? 1, 0.05, 1);
  loads.forEach((load, i) => {
    const base = scaleAt(lo, i);
    // adaptive resolution lowers the layer further, but never below an absolute floor (unless the budget already did)
    const floor = Math.min(base, MIN_ADAPTIVE_RENDER_SCALE);
    result.set(load.id, quantize(Math.max(floor, base * factor)));
  });
  return result;
}

/** CSS size → render pixels for a layer at `scale` (bounded to what a context can hold). */
export function renderSize(cssWidth: number, cssHeight: number, scale: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.min(4096, Math.round(cssWidth * scale))),
    height: Math.max(1, Math.min(4096, Math.round(cssHeight * scale))),
  };
}

/** One frame-time controller for the whole composition, plus the allocator above. */
export class GlobalRenderBudget {
  readonly adaptive = new AdaptiveResolution();
  private lastFloor = 1;

  /** 1 = full budget */
  get globalScale() { return this.adaptive.scale; }
  /** 0 = full shader effort; each level drops one noise octave from every procedural stage */
  get effort() { return this.adaptive.effort; }

  allocate(loads: readonly LayerLoad[]): Map<number, number> {
    const result = allocateScales(loads, { globalScale: this.adaptive.scale });
    // the controller's floor is relative to the biggest layer so the absolute floor holds for every layer
    const biggest = Math.max(MIN_RENDER_SCALE, ...[...result.values()]);
    this.lastFloor = clamp(MIN_ADAPTIVE_RENDER_SCALE / biggest, 0.25, 1);
    this.adaptive.setMinScale(this.lastFloor);
    return result;
  }

  /** Feed one real frame's duration (seconds). Returns true when the shared scale or effort changed. */
  observeFrame(seconds: number): boolean {
    return this.adaptive.update(seconds) !== null;
  }

  reset() {
    this.adaptive.reset();
  }

  /** a label for the UI: '' when running at full quality */
  describe(): string {
    const { scale, effort } = this.adaptive;
    if (scale >= 1 && effort === 0) return '';
    const resolution = scale < 1 ? `Adaptive resolution reduced to ${Math.round(scale * 100)}%` : 'Adaptive quality active';
    return `${resolution}${effort > 0 ? ' with reduced shader effort' : ''} to maintain performance.`;
  }
}
