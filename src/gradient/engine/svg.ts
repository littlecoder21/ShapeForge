import { rgbaCss, type RGBA } from './color';
import { EFFECTS, activeEffects, blurOf } from './effects';
import { bleedOf, layerMatrix, linearLine, normDeg, periodOf, offsetOf, radii, rad, isIdentityTransform } from './geom';
import { rampRange, rampStops, colorAtPos } from './ramp';
import { meshCoord as _mc, pointRadii } from './mesh';
import { noiseFilterMarkup } from './noise';
import { curveBands } from './curve';
import { layerMaskPath } from './layerMask';
import { textureOverlay as textureLayout } from './textures';
import type { GradientLayer, GradientProject } from './model';

/* ═══════════ SVG generation ═══════════
 * linear / radial → native <linearGradient> / <radialGradient> (spreadMethod="repeat" for repeating).
 * conic → exact wedge paths (SVG has no conic gradient).
 * Opacity, blend mode, blur and transform are real SVG attributes, so the file stands alone.
 */

const r2 = (v: number, d = 2) => { const k = 10 ** d; return String(Math.round(v * k) / k).replace(/^-0$/, '0'); };
const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const hexOf = (c: RGBA) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
const stopTag = (offset: number, c: RGBA) => `<stop offset="${r2(Math.min(1, Math.max(0, offset)), 4)}" stop-color="${hexOf(c)}"${c.a < 0.999 ? ` stop-opacity="${r2(c.a, 3)}"` : ''}/>`;

export interface SvgParts { defs: string; body: string }

function conicWedges(layer: GradientLayer, w: number, h: number, bx: number, by: number): string {
  const cx = (layer.cx / 100) * w, cy = (layer.cy / 100) * h;
  const R = Math.hypot(Math.max(cx, w - cx) + bx, Math.max(cy, h - cy) + by) * 1.05;
  const { lo, hi } = rampRange(layer), span = Math.max(1e-9, hi - lo);
  const rep = layer.repeating, per = rep ? (layer.repeat.unit === '%' ? layer.repeat.size * 3.6 : layer.repeat.size) : 360, off = rep ? (layer.repeat.unit === '%' ? layer.repeat.offset * 3.6 : layer.repeat.offset) : 0;
  const posAtDeg = (d: number) => { // degrees from `from` → stop position
    if (!rep) return (d / 360) * 100;
    const u = (((d - off) % per) + per) % per / per;     // 0…1 inside the period
    return lo + u * span;
  };
  const cuts = new Set<number>([0, 360]);
  const addCut = (d: number) => { if (d > 0 && d < 360) cuts.add(Math.round(d * 1000) / 1000); };
  layer.stops.forEach(s => {
    if (!rep) addCut((s.pos / 100) * 360);
    else for (let k = -1; k * per + off < 360 + per; k++) addCut(k * per + off + ((s.pos - lo) / span) * per + (lo / 100) * 0);
  });
  const sorted = [...cuts].sort((a, b) => a - b), segs: [number, number][] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1], n = Math.max(1, Math.ceil((b - a) / 3));
    for (let k = 0; k < n; k++) segs.push([a + ((b - a) * k) / n, a + ((b - a) * (k + 1)) / n]);
  }
  const from = layer.angle;
  const pt = (d: number) => { const a = rad(from + d - 90); return `${r2(cx + R * Math.cos(a))} ${r2(cy + R * Math.sin(a))}`; };
  const paths: string[] = [];
  let run: { a: number; b: number; col: string } | null = null;
  const flush = () => { if (run) { const large = run.b - run.a > 180 ? 1 : 0; paths.push(`<path d="M${r2(cx)} ${r2(cy)}L${pt(run.a)}A${r2(R)} ${r2(R)} 0 ${large} 1 ${pt(run.b)}Z" fill="${run.col}"/>`); run = null; } };
  segs.forEach(([a, b]) => {
    const mid = (a + b) / 2, c = colorAtPos(layer, posAtDeg(mid)), col = rgbaCss(c);
    if (run && run.col === col && run.b - run.a + (b - a) <= 180) run.b = b; else { flush(); run = { a, b, col }; }
  });
  flush();
  return paths.join('');
}

export function layerSvg(layer: GradientLayer, project: GradientProject, id: string): SvgParts {
  const { w, h } = project.canvas, bleed = bleedOf(layer, project.canvas), bx = bleed * w, by = bleed * h;
  const defs: string[] = [];
  let fill = '';
  let inner = '';
  const isStop = layer.type === 'linear' || layer.type === 'radial' || layer.type === 'conic' || layer.type === 'curve';
  const stops = () => (isStop ? rampStops(layer).map(s => stopTag(s.offset, s.color)).join('') : '');
  const { lo } = isStop ? rampRange(layer) : { lo: 0 };

  if (layer.solidColor !== undefined) {
    inner = `<rect x="${r2(-bx)}" y="${r2(-by)}" width="${r2(w + 2 * bx)}" height="${r2(h + 2 * by)}" fill="${layer.solidColor}"/>`;
  } else if (layer.type === 'mesh') {
    const tag = (c: string, a: number, off: number) => `<stop offset="${r2(off, 4)}" stop-color="${c}"${a < 0.999 ? ` stop-opacity="${r2(a, 3)}"` : ''}/>`;
    const sq: string[] = [];
    layer.mesh.points.forEach((p, i) => {
      const mid = 25 + (p.core ?? layer.mesh.core) * 0.5;
      const rr = pointRadii(p, project.canvas), cx = (p.x / 100) * w, cy = (p.y / 100) * h;
      defs.push(`<radialGradient id="${id}-p${i}" gradientUnits="userSpaceOnUse" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2((rr.rx / 100) * w)}" gradientTransform="translate(${r2(cx)} ${r2(cy)}) scale(1 ${r2(rr.ry / 100 * h / ((rr.rx / 100) * w), 4)}) translate(${r2(-cx)} ${r2(-cy)})">${tag(p.color, p.alpha, 0)}${Math.abs(mid - 50) > 0.5 ? tag(p.color, p.alpha * (1 - mid / 100) * 0.9 + 0.0, mid / 100) : ''}${tag(p.color, 0, 1)}</radialGradient>`);
      sq.push(`<rect x="${r2(-bx)}" y="${r2(-by)}" width="${r2(w + 2 * bx)}" height="${r2(h + 2 * by)}" fill="url(#${id}-p${i})"/>`);
    });
    inner = `${layer.mesh.base ? `<rect x="${r2(-bx)}" y="${r2(-by)}" width="${r2(w + 2 * bx)}" height="${r2(h + 2 * by)}" fill="${layer.mesh.base}"/>` : ''}${sq.reverse().join('')}`;
  } else if (layer.type === 'noise') {
    defs.push(noiseFilterMarkup(layer.noise, `${id}-n`));
    inner = `<rect x="${r2(-bx)}" y="${r2(-by)}" width="${r2(w + 2 * bx)}" height="${r2(h + 2 * by)}" filter="url(#${id}-n)"/>`;
  } else if (layer.type === 'linear') {
    const ln = linearLine(layer.angle, w, h);
    let x1 = ln.x1, y1 = ln.y1, x2 = ln.x2, y2 = ln.y2, spread = '';
    if (layer.repeating) {
      const per = periodOf(layer, project.canvas) * ((rampRange(layer).hi - lo) / 100), start = offsetOf(layer, project.canvas) + (lo / 100) * periodOf(layer, project.canvas);
      x1 = ln.x1 + ln.dx * start; y1 = ln.y1 + ln.dy * start; x2 = x1 + ln.dx * per; y2 = y1 + ln.dy * per; spread = ' spreadMethod="repeat"';
    } else {
      const full = ln.L, start = (lo / 100) * full, end = (rampRange(layer).hi / 100) * full;
      x1 = ln.x1 + ln.dx * start; y1 = ln.y1 + ln.dy * start; x2 = ln.x1 + ln.dx * end; y2 = ln.y1 + ln.dy * end;
    }
    defs.push(`<linearGradient id="${id}-g" gradientUnits="userSpaceOnUse" x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}"${spread}>${stops()}</linearGradient>`);
    fill = `url(#${id}-g)`;
  } else if (layer.type === 'radial') {
    const rr = radii(layer, project.canvas), cx = (layer.cx / 100) * w, cy = (layer.cy / 100) * h;
    const { hi } = rampRange(layer);
    let r0 = 0, r1 = rr.rx * (hi / 100), spread = '';
    if (layer.repeating) {
      const perPx = periodOf(layer, project.canvas), offPx = offsetOf(layer, project.canvas);
      r0 = offPx + (lo / 100) * perPx; r1 = r0 + perPx * ((hi - lo) / 100); spread = ' spreadMethod="repeat"';
    } else r0 = rr.rx * (lo / 100);
    const scaleY = rr.rx > 0 ? rr.ry / rr.rx : 1;
    // fr = inner radius (supported by all current browsers)
    defs.push(`<radialGradient id="${id}-g" gradientUnits="userSpaceOnUse" cx="${r2(cx)}" cy="${r2(cy)}" fx="${r2(cx)}" fy="${r2(cy)}" r="${r2(Math.max(0.01, r1))}"${r0 > 0 ? ` fr="${r2(r0)}"` : ''} gradientTransform="translate(${r2(cx)} ${r2(cy)}) scale(1 ${r2(scaleY, 4)}) translate(${r2(-cx)} ${r2(-cy)})"${spread}>${stops()}</radialGradient>`);
    fill = `url(#${id}-g)`;
  } else if (layer.type === 'curve') {
    inner = curveBands(layer.curve, project.canvas).map(band => `<path d="${band.d}" fill="${rgbaCss(colorAtPos(layer, band.progress * 100))}"/>`).join('');
  } else {
    defs.push(`<clipPath id="${id}-c"><rect x="${r2(-bx)}" y="${r2(-by)}" width="${r2(w + 2 * bx)}" height="${r2(h + 2 * by)}"/></clipPath>`);
    inner = `<g clip-path="url(#${id}-c)">${conicWedges(layer, w, h, bx, by)}</g>`;
  }

  // filters
  const fx = activeEffects(layer.effects), prim = fx.map(e => EFFECTS[e.type].svg(e.params)).join('');
  let filterAttr = '';
  if (prim) {
    defs.push(`<filter id="${id}-f" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">${prim}</filter>`);
    filterAttr = ` filter="url(#${id}-f)"`;
  }
  const m = layerMatrix(layer, project.canvas);
  const tf = isIdentityTransform(layer) ? '' : ` transform="matrix(${m.map(v => r2(v, 5)).join(' ')})"`;
  let clipAttr = '';
  if (layer.mask.enabled) {
    defs.push(`<clipPath id="${id}-mask" clipPathUnits="userSpaceOnUse"><path d="${layerMaskPath(layer.mask, project.canvas)}"/></clipPath>`);
    clipAttr = ` clip-path="url(#${id}-mask)"`;
  }
  const style = layer.blend !== 'normal' ? ` style="mix-blend-mode:${layer.blend}"` : '';
  const op = layer.opacity < 1 ? ` opacity="${r2(layer.opacity, 3)}"` : '';
  const content = inner || `<rect x="${r2(-bx)}" y="${r2(-by)}" width="${r2(w + 2 * bx)}" height="${r2(h + 2 * by)}" fill="${fill}"/>`;
  let textureOverlay = '';
  if (layer.texture.enabled) {
    // same helper the live preview and the CSS export use: the tile is axis-aligned at full strength, the overlay applies
    // the opacity once, and a rotated texture rotates the whole repeating pattern (seamless at any angle)
    const ov = textureLayout(layer.texture), size = ov.size;
    const layerW = w + 2 * bx, layerH = h + 2 * by;
    const rotate = ov.rotation ? ` patternTransform="translate(${r2(w / 2)} ${r2(h / 2)}) rotate(${r2(ov.rotation)}) translate(${r2(-1.5 * layerW)} ${r2(-1.5 * layerH)})"` : '';
    defs.push(`<pattern id="${id}-texture" patternUnits="userSpaceOnUse" x="${ov.offsetX}" y="${ov.offsetY}" width="${r2(size)}" height="${r2(size)}"${rotate}><image href="${ov.href}" xlink:href="${ov.href}" width="${r2(size)}" height="${r2(size)}"/></pattern>`);
    textureOverlay = `<rect x="${r2(-bx)}" y="${r2(-by)}" width="${r2(w + 2 * bx)}" height="${r2(h + 2 * by)}" fill="url(#${id}-texture)" opacity="${r2(ov.opacity, 3)}" style="mix-blend-mode:${ov.blend}"/>`;
  }
  return { defs: defs.join(''), body: `<g${tf}${op}${style}${filterAttr}${clipAttr}>${content}${textureOverlay}</g>` };
}

export function projectSvgParts(project: GradientProject, prefix = 'g'): SvgParts {
  const vis = project.layers.filter(l => l.visible);
  const parts = [...vis].reverse().map((l, i) => layerSvg(l, project, `${prefix}${i + 1}`));
  const bg = project.background ? `<rect width="${project.canvas.w}" height="${project.canvas.h}" fill="${project.background}"/>` : '';
  return { defs: parts.map(p => p.defs).join(''), body: bg + parts.map(p => p.body).join('') };
}

const indent = (s: string) => s.replace(/></g, '>\n  <');
export function projectSvg(project: GradientProject, opts: { pretty?: boolean; size?: string } = {}): string {
  const { w, h } = project.canvas, parts = projectSvgParts(project);
  const size = opts.size ?? `width="${w}" height="${h}"`;
  const body = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}"${size ? ` ${size}` : ''} style="isolation:isolate">\n  <defs>${parts.defs}</defs>\n  ${parts.body}\n</svg>`;
  return opts.pretty === false ? body : body.replace(/<defs>([\s\S]*?)<\/defs>/, (_, d) => `<defs>\n  ${indent(d)}\n  </defs>`).replace(/\n {2}(<rect width|<g)/, '\n  $1').replace(/(<g[^>]*>)(<rect|<g clip)/g, '$1\n    $2').replace(/<\/g><g/g, '</g>\n  <g');
}

/** True when the whole project is one plain linear/radial layer, so a native SVG paint server is enough. */
export function isNativePaint(project: GradientProject) {
  const vis = project.layers.filter(l => l.visible);
  if (vis.length !== 1 || project.background) return false;
  const l = vis[0];
  return (l.type === 'linear' || l.type === 'radial') && l.blend === 'normal' && l.opacity === 1 && !l.texture.enabled && isIdentityTransform(l) && !activeEffects(l.effects).length && blurOf(l.effects) === 0;
}

export const angleNorm = normDeg;
export const _meshCoord = _mc;
