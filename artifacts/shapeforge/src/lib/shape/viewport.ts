import { H, W } from './constants';

/**
 * The viewport is the ONLY thing zoom and pan change.
 *   screen = canvas * zoom + (x, y)        (screen = CSS px inside the stage)
 * Geometry stays in the normalized 1000 × 600 space, so exports never depend on the view.
 */
export type Viewport = { x: number; y: number; zoom: number };
export type V2 = { x: number; y: number };

export const MIN_ZOOM = 0.1;   // 10 %
export const MAX_ZOOM = 16;    // 1600 %
export const ZOOM_STOPS = [0.1, 0.15, 0.25, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];

export const screenToCanvas = (v: Viewport, sx: number, sy: number): V2 => ({ x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom });
export const canvasToScreen = (v: Viewport, cx: number, cy: number): V2 => ({ x: cx * v.zoom + v.x, y: cy * v.zoom + v.y });
/** Screen pixels → canvas units at the current zoom. */
export const pxToUnits = (v: Viewport, px: number) => px / v.zoom;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export function fitZoom(sw: number, sh: number, aw = W, ah = H) {
  if (sw <= 0 || sh <= 0) return 1;
  const pad = Math.min(28, Math.max(10, sw * 0.04));
  return clampZoom(Math.min((sw - pad * 2) / aw, (sh - pad * 2) / ah));
}
export function fitViewport(sw: number, sh: number, aw = W, ah = H): Viewport {
  const zoom = fitZoom(sw, sh, aw, ah);
  return { zoom, x: (sw - aw * zoom) / 2, y: (sh - ah * zoom) / 2 };
}

/** Zoom keeping the canvas point under (sx, sy) fixed on screen. */
export function zoomAt(v: Viewport, sx: number, sy: number, nextZoom: number): Viewport {
  const zoom = clampZoom(nextZoom);
  const c = screenToCanvas(v, sx, sy);
  return { zoom, x: sx - c.x * zoom, y: sy - c.y * zoom };
}

/** Keep part of the artboard on screen so the canvas can never be lost. */
export function clampViewport(v: Viewport, sw: number, sh: number, aw = W, ah = H): Viewport {
  if (sw <= 0 || sh <= 0) return v;
  const zoom = clampZoom(v.zoom);
  const mx = Math.min(Math.max(48, Math.min(aw * zoom, sw) * 0.35), 220);
  const my = Math.min(Math.max(48, Math.min(ah * zoom, sh) * 0.35), 220);
  const x = Math.min(sw - mx, Math.max(mx - aw * zoom, v.x));
  const y = Math.min(sh - my, Math.max(my - ah * zoom, v.y));
  return { x, y, zoom };
}

export function nextStop(zoom: number, dir: 1 | -1) {
  if (dir > 0) return ZOOM_STOPS.find(s => s > zoom * 1.02) ?? MAX_ZOOM;
  for (let i = ZOOM_STOPS.length - 1; i >= 0; i--) if (ZOOM_STOPS[i] < zoom / 1.02) return ZOOM_STOPS[i];
  return MIN_ZOOM;
}

/** Pinch / two-finger pan: map the start midpoint to the current midpoint while scaling by the finger-distance ratio. */
export function pinchViewport(start: Viewport, startMid: V2, startDist: number, mid: V2, dist: number): Viewport {
  const zoom = clampZoom(start.zoom * (dist / Math.max(startDist, 1)));
  const anchor = screenToCanvas(start, startMid.x, startMid.y);
  return { zoom, x: mid.x - anchor.x * zoom, y: mid.y - anchor.y * zoom };
}
