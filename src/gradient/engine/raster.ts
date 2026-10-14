import { hexToRgb as hexRgb, rgbaCss, type RGBA } from './color';
import { EFFECTS, activeEffects, blurOf } from './effects';
import { bleedOf, layerMatrix, linearLine, offsetOf, periodOf, radii, rad } from './geom';
import { rampRange, rampStops } from './ramp';
import { pointRadii } from './mesh';
import { noiseCanvas } from './noise';
import type { BlendMode, GradientLayer, GradientProject } from './model';
import { projectSvg } from './svg';

/* ═══════════ PNG / canvas renderer ═══════════
 * Draws the same geometry as the CSS output with the 2D canvas API. Each layer is rendered to its own
 * canvas so opacity, blend mode and blur apply to the layer as a whole (like the DOM preview).
 */

const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge',
  'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue',
  saturation: 'saturation', color: 'color', luminosity: 'luminosity', 'plus-lighter': 'lighter',
};

const MAX_REPEAT_STOPS = 6000;
function addStops(g: CanvasGradient, stops: { offset: number; color: RGBA }[], from = 0, to = 1, reps = 1) {
  if (stops.length * reps > MAX_REPEAT_STOPS) reps = Math.max(1, Math.floor(MAX_REPEAT_STOPS / stops.length));
  for (let k = 0; k < reps; k++) for (const s of stops) g.addColorStop(Math.min(1, Math.max(0, from + ((k + s.offset) / reps) * (to - from))), rgbaCss(s.color));
}

function fillLayer(ctx: CanvasRenderingContext2D, layer: GradientLayer, project: GradientProject): boolean {
  const { w, h } = project.canvas, bleed = bleedOf(layer, project.canvas), bx = bleed * w, by = bleed * h;
  ctx.save();
  ctx.beginPath(); ctx.rect(-bx, -by, w + 2 * bx, h + 2 * by); ctx.clip();
  if (layer.type === 'mesh') {
    if (layer.mesh.base) { ctx.fillStyle = layer.mesh.base; ctx.fillRect(-bx, -by, w + 2 * bx, h + 2 * by); }
    [...layer.mesh.points].reverse().forEach(p => {
      const rr = pointRadii(p, project.canvas), cx = (p.x / 100) * w, cy = (p.y / 100) * h, rx = (rr.rx / 100) * w, ry = (rr.ry / 100) * h;
      const mid = 25 + (p.core ?? layer.mesh.core) * 0.5;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, rgbaCss({ ...hexRgb(p.color), a: p.alpha })); g.addColorStop(mid / 100, rgbaCss({ ...hexRgb(p.color), a: p.alpha * (1 - mid / 100) })); g.addColorStop(1, rgbaCss({ ...hexRgb(p.color), a: 0 }));
      ctx.fillStyle = g; ctx.fillRect(-rx * 3, -rx * 3, rx * 6, rx * 6); ctx.restore();
    });
    ctx.restore(); return true;
  }
  if (layer.type === 'noise') {
    const tile = noiseCanvas(layer.noise), pat = ctx.createPattern(tile, 'repeat');
    if (pat) { ctx.fillStyle = pat; ctx.fillRect(-bx, -by, w + 2 * bx, h + 2 * by); }
    ctx.restore(); return true;
  }
  const stops = rampStops(layer), { lo, hi } = rampRange(layer);

  if (layer.type === 'linear') {
    const ln = linearLine(layer.angle, w, h);
    let sx: number, sy: number, ex: number, ey: number, reps = 1;
    if (layer.repeating) {
      const full = periodOf(layer, project.canvas), per = full * ((hi - lo) / 100) || 1, start = offsetOf(layer, project.canvas) + (lo / 100) * full;
      const kmin = Math.floor((0 - start) / per) - 1, kmax = Math.ceil((ln.L - start) / per) + 1;
      reps = Math.min(600, Math.max(1, kmax - kmin)); const s0 = start + kmin * per;
      sx = ln.x1 + ln.dx * s0; sy = ln.y1 + ln.dy * s0; ex = ln.x1 + ln.dx * (s0 + reps * per); ey = ln.y1 + ln.dy * (s0 + reps * per);
    } else {
      sx = ln.x1 + ln.dx * (lo / 100) * ln.L; sy = ln.y1 + ln.dy * (lo / 100) * ln.L; ex = ln.x1 + ln.dx * (hi / 100) * ln.L; ey = ln.y1 + ln.dy * (hi / 100) * ln.L;
    }
    if (Math.hypot(ex - sx, ey - sy) < 1e-6) { ex += 1e-3; }
    const g = ctx.createLinearGradient(sx, sy, ex, ey);
    if (!layer.repeating) { addStops(g, [{ offset: 0, color: stops[0].color }, ...stops, { offset: 1, color: stops[stops.length - 1].color }].map(s => s)); }
    else addStops(g, stops, 0, 1, reps);
    ctx.fillStyle = g; ctx.fillRect(-bx, -by, w + 2 * bx, h + 2 * by);
  } else if (layer.type === 'radial') {
    const rr = radii(layer, project.canvas), cx = (layer.cx / 100) * w, cy = (layer.cy / 100) * h;
    const sy = rr.rx > 0 ? rr.ry / rr.rx : 1, maxR = Math.hypot(w + 2 * bx, (h + 2 * by) / Math.max(sy, 0.01)) * 1.2;
    let r0 = rr.rx * (lo / 100), r1 = rr.rx * (hi / 100), reps = 1;
    if (layer.repeating) {
      const full = periodOf(layer, project.canvas), per = full * ((hi - lo) / 100) || 1, start = offsetOf(layer, project.canvas) + (lo / 100) * full;
      reps = Math.min(600, Math.max(1, Math.ceil((maxR - Math.max(0, start)) / per) + 1)); r0 = Math.max(0, start); r1 = r0 + reps * per;
    }
    ctx.translate(cx, cy); ctx.scale(1, sy || 1);
    const g = ctx.createRadialGradient(0, 0, Math.max(0, r0), 0, 0, Math.max(r0 + 1e-3, r1));
    if (!layer.repeating) addStops(g, [{ offset: 0, color: stops[0].color }, ...stops, { offset: 1, color: stops[stops.length - 1].color }]);
    else addStops(g, stops, 0, 1, reps);
    ctx.fillStyle = g; ctx.fillRect(-maxR * 2, -maxR * 2, maxR * 4, maxR * 4);
  } else {
    if (typeof ctx.createConicGradient !== 'function') { ctx.restore(); return false; }
    const cx = (layer.cx / 100) * w, cy = (layer.cy / 100) * h;
    const g = ctx.createConicGradient(rad(layer.angle - 90), cx, cy);
    if (!layer.repeating) {
      const s0 = stops[0], sN = stops[stops.length - 1];
      const mapped = stops.map(s => ({ offset: (lo + s.offset * (hi - lo)) / 100, color: s.color }));
      addStops(g, [{ offset: 0, color: s0.color }, ...mapped, { offset: 1, color: sN.color }]);
    } else {
      const per = (periodOf(layer, project.canvas) * (hi - lo)) / 100 || 1, start = offsetOf(layer, project.canvas) + (lo / 100) * periodOf(layer, project.canvas);
      const reps = Math.min(720, Math.max(1, Math.ceil(360 / per) + 2)), k0 = Math.floor(-start / per) - 1;
      const first = stops[0].color;
      g.addColorStop(0, rgbaCss(first));
      for (let k = 0; k < reps; k++) for (const s of stops) {
        const deg = start + (k0 + k) * per + s.offset * per, off = deg / 360;
        if (off >= 0 && off <= 1) g.addColorStop(off, rgbaCss(s.color));
      }
      g.addColorStop(1, rgbaCss(stops[stops.length - 1].color));
    }
    ctx.fillStyle = g; ctx.fillRect(-bx, -by, w + 2 * bx, h + 2 * by);
  }
  ctx.restore();
  return true;
}

const supportsFilter = (ctx: CanvasRenderingContext2D) => 'filter' in ctx;

export interface RenderResult { canvas: HTMLCanvasElement; notes: string[] }

export function renderProject(project: GradientProject, scale = 1): RenderResult {
  const { w, h } = project.canvas, notes: string[] = [];
  const out = document.createElement('canvas'); out.width = Math.round(w * scale); out.height = Math.round(h * scale);
  const ctx = out.getContext('2d')!;
  if (project.background) { ctx.fillStyle = project.background; ctx.fillRect(0, 0, out.width, out.height); }
  const vis = project.layers.filter(l => l.visible).reverse();
  for (const layer of vis) {
    const off = document.createElement('canvas'); off.width = out.width; off.height = out.height;
    const lc = off.getContext('2d')!;
    lc.scale(scale, scale);
    const m = layerMatrix(layer, project.canvas); lc.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (!fillLayer(lc, layer, project)) { notes.push(`“${layer.name}”: conic gradients need a newer browser for PNG export`); continue; }
    const fx = activeEffects(layer.effects);
    const rasterSkipped = fx.filter(e => EFFECTS[e.type].rasterUnsupported);
    if (rasterSkipped.length) notes.push(`“${layer.name}”: ${rasterSkipped.map(e => EFFECTS[e.type].label).join(', ')} ${rasterSkipped.length === 1 ? 'is' : 'are'} not included in PNG; SVG/CSS keeps the effect`);
    const fstr = fx.map(e => EFFECTS[e.type].canvas(e.params)).filter(Boolean).join(' ');
    ctx.save();
    ctx.globalAlpha = layer.opacity; ctx.globalCompositeOperation = COMPOSITE[layer.blend];
    if (fstr && supportsFilter(ctx)) { ctx.filter = fstr; ctx.drawImage(off, 0, 0); ctx.filter = 'none'; }
    else if (fstr) {
      // browsers without ctx.filter: approximate gaussian blur by down/up-sampling
      const px = blurOf(layer.effects) / 2.5 * scale;
      if (px > 0.5) {
        const f = Math.max(1, Math.min(32, px / 3)), sm = document.createElement('canvas');
        sm.width = Math.max(1, Math.round(out.width / f)); sm.height = Math.max(1, Math.round(out.height / f));
        const sc = sm.getContext('2d')!; sc.imageSmoothingQuality = 'high'; sc.drawImage(off, 0, 0, sm.width, sm.height);
        ctx.imageSmoothingQuality = 'high'; ctx.drawImage(sm, 0, 0, out.width, out.height);
      } else ctx.drawImage(off, 0, 0);
      notes.push('Colour filters are skipped on this browser');
    } else ctx.drawImage(off, 0, 0);
    ctx.restore();
  }
  return { canvas: out, notes: [...new Set(notes)] };
}

async function renderFilteredSvg(project: GradientProject, scale: number): Promise<HTMLCanvasElement> {
  const { w, h } = project.canvas, image = new Image(), url = URL.createObjectURL(new Blob([projectSvg(project)], { type: 'image/svg+xml' }));
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a 2D canvas context');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPng(project: GradientProject, scale = 1): Promise<{ blob: Blob; notes: string[] }> {
  const needsSvgFilters = project.layers.some(layer => layer.visible && (
    layer.texture.enabled || activeEffects(layer.effects).some(effect => EFFECTS[effect.type].rasterUnsupported)
  ));
  let rendered: RenderResult;
  if (needsSvgFilters) {
    try {
      rendered = { canvas: await renderFilteredSvg(project, scale), notes: [] };
    } catch (error) {
      rendered = renderProject(project, scale);
      const reason = error instanceof Error ? error.message : 'unknown SVG rendering error';
      rendered.notes.push(`Some effects or textures could not be rasterized (${reason}); see SVG output for the full effect`);
    }
  } else {
    rendered = renderProject(project, scale);
  }
  return new Promise((resolve, reject) => rendered.canvas.toBlob(blob => (blob ? resolve({ blob, notes: rendered.notes }) : reject(new Error('PNG export failed'))), 'image/png'));
}
