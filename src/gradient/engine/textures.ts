import type { TextureData } from './model';
import { CONTROLS, DISTRIBUTION_OPTIONS, FALLOFF_TARGET_OPTIONS, normalizeTexture, type TextureControl, type TextureKind } from './textureControls';
import { createCtx, f2, renderLayers } from './textureMotifs';
import { DEFAULT_PATTERN, LEGACY_TEXTURE_IDS, TEXTURES, findTexture, resolveTextureId, type TextureFamily, type TexturePreset } from './texturePresets';
import { presetInfo, recipeLayers } from './textureRecipes';

export { DEFAULT_PATTERN, LEGACY_TEXTURE_IDS, TEXTURES, findTexture, resolveTextureId };
export type { TextureFamily, TexturePreset };

/* ═══════════════════════════ Texture engine (public API) ═══════════════════════════
 *  textureTileSvg(texture, opacity?, options?)  → one seamless 64×64 SVG tile
 *  textureDataUri(...)                          → the same as a CSS `url("data:…")`
 *  textureOverlay(texture)                      → everything a layered renderer needs (tile, size, offset, opacity, rotation)
 *  textureControlsFor(texture)                  → the controls that apply to the selected preset (drives the panel)
 *
 * Opacity: `opacity` defaults to the texture's own opacity slider (`texture.opacity`). Callers that apply the layer
 * opacity themselves (overlay element / SVG <image>) pass an explicit 100, so it is never applied twice.
 */

export interface TextureRenderOptions {
  /**
   * 'tile' (default) bakes `texture.angle` into the tile — what the flat, single-background CSS output needs.
   * 'none' leaves the tile axis-aligned: the consumer rotates the repeating layer instead (CSS transform / SVG
   * patternTransform), which is the only way to rotate a repeating texture by any angle without creating seams.
   */
  rotation?: 'tile' | 'none';
}

const CACHE_MAX = 64;
const CACHE = new Map<string, string>();
/** Fields that never change the tile itself (they are applied by the consumer). Everything else is part of the cache key. */
const NOT_IN_TILE = new Set(['enabled', 'scale', 'offsetX', 'offsetY', 'blend']);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function cacheKey(P: TextureData, opacity: number, rotation: number): string {
  const record = P as unknown as Record<string, unknown>;
  return JSON.stringify([Object.keys(record).sort().filter(k => !NOT_IN_TILE.has(k)).map(k => record[k]), opacity, rotation]);
}

function buildTile(P: TextureData, opacity: number, rotation: number): string {
  const preset = findTexture(P.pattern) ?? findTexture(DEFAULT_PATTERN)!;
  const ctx = createCtx(P);
  renderLayers(ctx, recipeLayers(preset, P.density));

  const contrast = clamp(P.contrast, 0, 300) / 100, soft = clamp(P.softness, 0, 20);
  const appearance = contrast !== 1 || soft > 0
    ? `<filter id="appearance" x="-20%" y="-20%" width="140%" height="140%">${soft > 0 ? `<feGaussianBlur stdDeviation="${f2(soft)}"/>` : ''}${contrast !== 1 ? `<feComponentTransfer><feFuncR type="linear" slope="${f2(contrast)}" intercept="${f2((1 - contrast) / 2)}"/><feFuncG type="linear" slope="${f2(contrast)}" intercept="${f2((1 - contrast) / 2)}"/><feFuncB type="linear" slope="${f2(contrast)}" intercept="${f2((1 - contrast) / 2)}"/></feComponentTransfer>` : ''}</filter>`
    : '';
  const background = P.backgroundEnabled ? `<rect x="-14" y="-14" width="92" height="92" fill="${P.backgroundColor}" fill-opacity="${f2(clamp(P.backgroundOpacity, 0, 100) / 100)}"/>` : '';
  const turn = rotation ? ` transform="rotate(${f2(rotation)} 32 32)"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs>${ctx.defs.join('')}${appearance}</defs><g opacity="${f2(opacity / 100)}"${appearance ? ' filter="url(#appearance)"' : ''}>${background}<g${turn}>${ctx.out.join('')}</g></g></svg>`;
}

export function textureTileSvg(texture: TextureData, opacity?: number, options: TextureRenderOptions = {}): string {
  const P = normalizeTexture(texture);
  const op = clamp(opacity ?? P.opacity, 0, 100);
  const rotation = options.rotation === 'none' ? 0 : ((P.angle % 360) + 360) % 360;
  const key = cacheKey(P, op, rotation);
  const hit = CACHE.get(key);
  if (hit !== undefined) { CACHE.delete(key); CACHE.set(key, hit); return hit; }
  const svg = buildTile(P, op, rotation < 0.01 || rotation > 359.99 ? 0 : rotation);
  CACHE.set(key, svg);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value as string);
  return svg;
}

export const textureDataUri = (texture: TextureData, opacity?: number, options?: TextureRenderOptions) =>
  `url("data:image/svg+xml,${encodeURIComponent(textureTileSvg(texture, opacity, options))}")`;

export interface TextureOverlay {
  /** `data:image/svg+xml,…` of the axis-aligned tile at full strength (opacity is applied by the overlay itself). */
  href: string;
  /** The same tile as a CSS `url("data:…")`. */
  dataUri: string;
  /** Edge length of the repeating tile in px. */
  size: number;
  offsetX: number;
  offsetY: number;
  /** 0…1, applied once by the overlay element. */
  opacity: number;
  blend: string;
  /** Degrees (0 when the texture is not rotated). The overlay is rotated as a whole so the repeat stays seamless. */
  rotation: number;
}

/** Single source of truth for how a texture is laid over a layer (live preview, CSS export and SVG export all use it). */
export function textureOverlay(texture: TextureData): TextureOverlay {
  const P = normalizeTexture(texture);
  const size = Math.max(1, P.scale), mod = Math.max(1, Math.round(size));
  const rotation = ((P.angle % 360) + 360) % 360;
  const href = `data:image/svg+xml,${encodeURIComponent(textureTileSvg(P, 100, { rotation: 'none' }))}`;
  return {
    href,
    dataUri: `url("${href}")`,
    size,
    offsetX: Math.round(P.seed * 13 + P.offsetX) % mod,
    offsetY: Math.round(P.seed * 7 + P.offsetY) % mod,
    opacity: clamp(P.opacity, 0, 100) / 100,
    blend: P.blend,
    rotation: rotation < 0.01 || rotation > 359.99 ? 0 : rotation,
  };
}

/* ───────────── which controls apply ───────────── */

export interface ResolvedControl {
  control: TextureControl;
  label: string;
  options?: { id: string; label: string }[];
}

export interface TextureSupport {
  kind: TextureKind;
  controls: ResolvedControl[];
  /** Human-readable reasons for the groups that are not offered for this texture. */
  notes: string[];
}

const KIND_NOTES: Partial<Record<TextureKind, string>> = {
  noise: 'Noise fields are already procedural, so distribution, spacing and distortion are not offered — use Grain size, Fine / coarse detail and Threshold.',
};

export function textureSupport(texture: TextureData): TextureSupport {
  const P = normalizeTexture(texture);
  const preset = findTexture(P.pattern) ?? findTexture(DEFAULT_PATTERN)!;
  const info = presetInfo(preset), caps = new Set(info.caps);
  const dist = P.distribution !== 'auto' && info.dists.includes(P.distribution) ? P.distribution : info.defaultDist;
  const lattice = dist === 'grid' || dist === 'staggered';
  const shape = P.shape === 'auto' ? info.defaultShape : P.shape;
  const controls: ResolvedControl[] = [];
  for (const control of CONTROLS) {
    if (!caps.has(control.needs)) continue;
    if (control.when && !control.when(P)) continue;
    // rules that depend on the current settings, so a control is never shown when it could not change anything
    if (control.id === 'phase' && info.dists.length && !lattice) continue;
    if (control.id === 'angleVariation' && info.kind === 'scatter' && (shape === 'circle' || shape === 'ring') && Math.abs(P.aspectRatio - 100) < 1) continue;
    if (control.id === 'symmetry' && !(info.kind === 'scatter' && (shape === 'polygon' || shape === 'star'))) continue;
    if (control.id === 'cornerRadius' && info.kind === 'scatter' && shape !== 'square') continue;
    let options = control.options;
    if (control.id === 'distribution') options = DISTRIBUTION_OPTIONS.filter(o => o.id === 'auto' || info.dists.includes(o.id as never));
    if (control.id === 'falloffTarget') options = FALLOFF_TARGET_OPTIONS.filter(o => info.falloffTargets.includes(o.id));
    controls.push({ control, label: control.labels?.[info.kind] ?? control.familyLabels?.[preset.family] ?? control.label, options });
  }
  const notes: string[] = [];
  if (KIND_NOTES[info.kind]) notes.push(KIND_NOTES[info.kind]!);
  if (!caps.has('warp')) notes.push('Distortion is not offered for this texture.');
  if (!caps.has('dist')) notes.push('This texture is a fixed pattern, so there is no distribution mode — use Spacing and Phase.');
  return { kind: info.kind, controls, notes };
}

export const textureControlsFor = (texture: TextureData): ResolvedControl[] => textureSupport(texture).controls;
