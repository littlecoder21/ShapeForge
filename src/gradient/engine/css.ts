import { rgbaString } from './color';
import { EFFECTS, activeEffects } from './effects';
import { bleedOf, isIdentityTransform, linearLine, radii, rad, type Canvas } from './geom';
import { meshCoord, meshParts } from './mesh';
import { outputOf, sortedStops, type AnimTrack, type ColorStop, type GradientLayer, type GradientProject } from './model';
import { noiseDataUri } from './noise';
import { textureDataUri } from './textures';

/* ═══════════════════════════ CSS generation ═══════════════════════════
 * Three outputs, all produced from the structured project:
 *   flat    → one `background:` declaration (+ background-blend-mode). Portable, but cannot blur or transform layers.
 *   layered → HTML + CSS with one element per layer. Exact: opacity, blend, blur, transform, animation.
 *   vars    → CSS custom properties.
 */

const r2 = (v: number, d = 2) => { const k = 10 ** d; return String(Math.round(v * k) / k).replace(/^-0$/, '0'); };
export const pretty = (css: string) => css;

/** Naming strategy: `cls` = the per-layer class, `scope` = prefix for keyframes / custom properties / filter ids. */
export interface Names { cls(l: GradientLayer): string; scope: string }
export const ordinalNames = (project: GradientProject, prefix = 'layer', scope = 'gradient'): Names => {
  const visible = project.layers.filter(l => l.visible);
  return { cls: l => `${prefix}-${visible.length - visible.indexOf(l)}`, scope };   // bottom layer = 1
};
export const stableNames: Names = { cls: l => `g-${l.id}`, scope: 'gs' };
const cssIdentifier = (value: string, fallback: string) => {
  const clean = value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-') || fallback;
  return /^-?\d/.test(clean) ? `g-${clean}` : clean;
};

type Unit = '%' | 'px' | 'deg';
interface Ctx {
  canvas: Canvas; s: number; unit: Unit; alphaMul: number;
  posVar: Map<string, string>; colorVar: Map<string, string>; angleVar?: string;
  ptVar: Map<string, { x?: string; y?: string }>;
}

/** Stop position (0…100) → a CSS value for this layer, including repeat mapping and bleed compensation. */
function posCss(layer: GradientLayer, pos: number, ctx: Ctx): string {
  const { s } = ctx;
  if (layer.type === 'conic') {
    const deg = layer.repeating ? layer.repeat.offset + (pos / 100) * layer.repeat.size : (pos / 100) * 360;
    return `${r2(deg)}deg`;
  }
  if (!layer.repeating) {
    const v = layer.type === 'linear' && s !== 1 ? 50 + (pos - 50) / s : pos;
    return `${r2(v)}%`;
  }
  const { size, offset, unit } = layer.repeat;
  let v = offset + (pos / 100) * size;
  if (layer.type === 'linear' && s !== 1) {
    if (unit === '%') v = 50 + (v - 50) / s;
    else if (unit === 'px') v += (linearLine(layer.angle, ctx.canvas.w, ctx.canvas.h).L * (s - 1)) / 2;
  }
  return `${r2(v)}${unit === 'deg' ? 'deg' : unit}`;
}

export function stopTokens(layer: GradientLayer, ctx: Ctx): string[] {
  const st = sortedStops(layer.stops), out: string[] = [];
  const colorOf = (x: ColorStop) => ctx.colorVar.get(x.id) ?? rgbaString(x.color, x.alpha * ctx.alphaMul);
  const posOf = (x: ColorStop) => ctx.posVar.get(x.id) ?? posCss(layer, x.pos, ctx);
  st.forEach((x, i) => {
    const nx = st[i + 1];
    out.push(`${colorOf(x)} ${posOf(x)}`);
    if (!nx) return;
    if (x.hard) out.push(`${colorOf(x)} ${posOf(nx)}`);
    else if (x.mid !== undefined && Math.abs(x.mid - 50) > 0.5 && nx.pos - x.pos > 0.01 && !ctx.posVar.has(x.id) && !ctx.posVar.has(nx.id)) {
      out.push(posCss(layer, x.pos + ((nx.pos - x.pos) * x.mid) / 100, ctx));
    }
  });
  return out;
}

function makeCtx(layer: GradientLayer, project: GradientProject, o: { alphaMul?: number; flat?: boolean; cls?: string } = {}): Ctx {
  const bleed = o.flat ? 0 : bleedOf(layer, project.canvas);
  const posVar = new Map<string, string>(), colorVar = new Map<string, string>();
  let angleVar: string | undefined;
  const ptVar = new Map<string, { x?: string; y?: string }>();
  if (!o.flat && o.cls && layer.anim.enabled) {
    layer.anim.tracks.forEach(t => {
      if ((t.prop === 'meshX' || t.prop === 'meshY') && t.stopId) { const cur = ptVar.get(t.stopId) ?? {}; cur[t.prop === 'meshX' ? 'x' : 'y'] = `var(--${o.cls}-m${t.prop === 'meshX' ? 'x' : 'y'}-${t.stopId})`; ptVar.set(t.stopId, cur); }
      if (t.prop === 'angle') angleVar = `--${o.cls}-a`;
      if (t.prop === 'stopPos' && t.stopId) posVar.set(t.stopId, `var(--${o.cls}-p-${t.stopId})`);
      if (t.prop === 'stopColor' && t.stopId) colorVar.set(t.stopId, `var(--${o.cls}-c-${t.stopId})`);
    });
  }
  return { canvas: project.canvas, s: 1 + 2 * bleed, unit: layer.type === 'conic' ? 'deg' : layer.repeat.unit === 'px' && layer.repeating ? 'px' : '%', alphaMul: o.alphaMul ?? 1, posVar, colorVar, angleVar, ptVar };
}

export interface GradientParts { fn: string; head: string; stops: string[] }

/** The gradient split into its function name, head (angle / shape / position) and stops — so it can be printed neatly. */
export function gradientParts(layer: GradientLayer, project: GradientProject, o: { alphaMul?: number; flat?: boolean; cls?: string } = {}): GradientParts {
  const ctx = makeCtx(layer, project, o);
  const s = ctx.s, rep = layer.repeating ? 'repeating-' : '', space = layer.space !== 'srgb' ? `in ${layer.space} ` : '';
  const stops = stopTokens(layer, ctx);
  const cx = r2((layer.cx + 100 * (s - 1) / 2) / s), cy = r2((layer.cy + 100 * (s - 1) / 2) / s);
  const angle = ctx.angleVar ? `var(${ctx.angleVar})` : `${r2(layer.angle)}deg`;
  if (layer.type === 'linear') return { fn: `${rep}linear-gradient`, head: `${space}${angle}`, stops };
  if (layer.type === 'radial') {
    const rr = radii(layer, project.canvas);
    const size = layer.shape === 'circle' ? `circle ${r2(rr.rx)}px` : `ellipse ${r2(layer.rx / s)}% ${r2(layer.ry / s)}%`;
    return { fn: `${rep}radial-gradient`, head: `${space}${size} at ${cx}% ${cy}%`, stops };
  }
  return { fn: `${rep}conic-gradient`, head: `${space}from ${angle} at ${cx}% ${cy}%`, stops };
}

/** One-line form: `linear-gradient(135deg, #fff 0%, #000 100%)` (mesh → comma list of its points). */
export function gradientFn(layer: GradientLayer, project: GradientProject, o: { alphaMul?: number; flat?: boolean; cls?: string } = {}): string {
  return layerImages(layer, project, o).map(i => i.text).join(', ');
}

/** One CSS <image> of a layer. A mesh layer has one per point; grain is a single tiled data-URI. */
export interface ImageItem { text: string; parts?: GradientParts; label: string; size?: string }

export function layerImages(layer: GradientLayer, project: GradientProject, o: { alphaMul?: number; flat?: boolean; cls?: string } = {}): ImageItem[] {
  const line = (g: GradientParts) => `${g.fn}(${[g.head, ...g.stops].join(', ')})`;
  if (layer.type === 'noise') return [{ text: noiseDataUri(layer.noise), label: 'Grain', size: `${Math.round(layer.noise.tile)}px ${Math.round(layer.noise.tile)}px` }];
  if (layer.type === 'mesh') {
    const ctx = makeCtx(layer, project, o);
    const items = meshParts(layer, project, { alphaMul: ctx.alphaMul, flat: !!o.flat, s: ctx.s, vars: ctx.ptVar }).map((g, i) => ({ text: line(g), parts: g, label: `Point ${i + 1}` }));
    if (o.flat && layer.mesh.base) items.push({ text: `linear-gradient(${layer.mesh.base}, ${layer.mesh.base})`, parts: { fn: 'linear-gradient', head: layer.mesh.base, stops: [layer.mesh.base] }, label: 'Base' });
    return items;
  }
  const g = gradientParts(layer, project, o);
  return [{ text: line(g), parts: g, label: layer.name }];
}

/** Readable multi-line form. Short gradients stay on one line; long ones put every stop on its own line. */
export function formatGradient(g: GradientParts, indent: string): string {
  const single = `${g.fn}(${[g.head, ...g.stops].join(', ')})`;
  if (single.length <= 76 && g.stops.length <= 3) return single;
  return `${g.fn}(${g.head},\n${g.stops.map(x => `${indent}  ${x}`).join(',\n')})`;
}

/* ───────────────────────── transform / filter strings ───────────────────────── */

function transformCss(layer: GradientLayer, s: number, over: Partial<Record<'x' | 'y' | 'scale' | 'rotate', number>> = {}) {
  const t = { ...layer.transform, ...over }, parts: string[] = [];
  if (t.x || t.y) parts.push(`translate(${r2(t.x / s)}%, ${r2(t.y / s)}%)`);
  if (t.rotate) parts.push(`rotate(${r2(t.rotate)}deg)`);
  if (t.skewX || t.skewY) parts.push(`skew(${r2(t.skewX)}deg, ${r2(t.skewY)}deg)`);
  if (t.scale !== 1) parts.push(`scale(${r2(t.scale, 3)})`);
  return parts.join(' ');
}
const originCss = (layer: GradientLayer, s: number) => {
  if (layer.type !== 'radial' && layer.type !== 'conic') return '';
  return `${r2((layer.cx + 100 * (s - 1) / 2) / s)}% ${r2((layer.cy + 100 * (s - 1) / 2) / s)}%`;
};
export function filterCss(layer: GradientLayer, key: string, extra = ''): string {
  const parts = activeEffects(layer.effects).map(e => EFFECTS[e.type].css(e.params, `fx-${key}-${e.id}`)).filter(Boolean);
  if (extra) parts.push(extra);
  return parts.join(' ');
}
/** SVG <filter> definitions required by url() effects (distortion). */
export function effectDefs(project: GradientProject, names: Names): string {
  const out: string[] = [];
  project.layers.filter(l => l.visible).forEach(l => activeEffects(l.effects).forEach(e => {
    const id = `fx-${names.scope}-${names.cls(l)}-${e.id}`;
    const filter = EFFECTS[e.type].css(e.params, id);
    const def = EFFECTS[e.type].defs?.(e.params, id, project.canvas)
      ?? (filter.startsWith('url(#') ? `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">${EFFECTS[e.type].svg(e.params)}</filter>` : '');
    if (def) out.push(def);
  }));
  return out.join('');
}

/* ───────────────────────── animation ───────────────────────── */

const propSyntax = (layer: GradientLayer, t: AnimTrack) => t.prop === 'angle' ? '<angle>' : t.prop === 'stopColor' ? '<color>' : layer.type === 'conic' ? '<angle>' : layer.repeating && layer.repeat.unit === 'px' ? '<length>' : '<percentage>';

export function animationCss(layer: GradientLayer, project: GradientProject, cls: string): { props: string; keyframes: string; shorthand: string } | null {
  const a = layer.anim;
  if (!a.enabled || !a.tracks.length) return null;
  const T = a.tracks;
  const val = (t: AnimTrack, which: 'from' | 'to') => t[which];
  const tf = (which: 'from' | 'to') => {
    const over: Partial<Record<'x' | 'y' | 'scale' | 'rotate', number>> = {};
    T.forEach(t => { if (t.prop === 'x' || t.prop === 'y' || t.prop === 'scale' || t.prop === 'rotate') over[t.prop] = Number(val(t, which)); });
    return transformCss(layer, 1 + 2 * bleedOf(layer, project.canvas), over);
  };
  const decl = (which: 'from' | 'to') => {
    const lines: string[] = [];
    if (T.some(t => ['x', 'y', 'scale', 'rotate'].includes(t.prop))) lines.push(`transform: ${tf(which) || 'none'}`);
    const op = T.find(t => t.prop === 'opacity'); if (op) lines.push(`opacity: ${r2(Number(val(op, which)), 3)}`);
    const hue = T.find(t => t.prop === 'hue'); if (hue) lines.push(`filter: ${filterCss(layer, cls, `hue-rotate(${r2(Number(val(hue, which)))}deg)`)}`);
    const an = T.find(t => t.prop === 'angle'); if (an) lines.push(`--${cls}-a: ${r2(Number(val(an, which)))}deg`);
    const ctx = makeCtx(layer, project, { cls });
    T.filter(t => t.prop === 'meshX' || t.prop === 'meshY').forEach(t => lines.push(`--${cls}-m${t.prop === 'meshX' ? 'x' : 'y'}-${t.stopId}: ${r2(meshCoord(Number(val(t, which)), ctx.s))}%`));
    T.filter(t => t.prop === 'stopPos' && t.stopId).forEach(t => lines.push(`--${cls}-p-${t.stopId}: ${posCss(layer, Number(val(t, which)), ctx)}`));
    T.filter(t => t.prop === 'stopColor' && t.stopId).forEach(t => lines.push(`--${cls}-c-${t.stopId}: ${String(val(t, which))}`));
    return lines;
  };
  const props: string[] = [];
  const ctx = makeCtx(layer, project, { cls });
  T.forEach(t => {
    if (t.prop === 'angle') props.push(`@property --${cls}-a {\n  syntax: '<angle>';\n  inherits: false;\n  initial-value: ${r2(layer.angle)}deg;\n}`);
    if ((t.prop === 'meshX' || t.prop === 'meshY') && t.stopId) { const p = layer.mesh.points.find(x => x.id === t.stopId); if (p) props.push(`@property --${cls}-m${t.prop === 'meshX' ? 'x' : 'y'}-${t.stopId} {\n  syntax: '<percentage>';\n  inherits: false;\n  initial-value: ${r2(meshCoord(t.prop === 'meshX' ? p.x : p.y, ctx.s))}%;\n}`); }
    if (t.prop === 'stopPos' && t.stopId) { const s = layer.stops.find(x => x.id === t.stopId); if (s) props.push(`@property --${cls}-p-${t.stopId} {\n  syntax: '${propSyntax(layer, t)}';\n  inherits: false;\n  initial-value: ${posCss(layer, s.pos, ctx)};\n}`); }
    if (t.prop === 'stopColor' && t.stopId) { const s = layer.stops.find(x => x.id === t.stopId); if (s) props.push(`@property --${cls}-c-${t.stopId} {\n  syntax: '<color>';\n  inherits: false;\n  initial-value: ${rgbaString(s.color, s.alpha)};\n}`); }
  });
  const block = (w: 'from' | 'to') => `  ${w} {\n${decl(w).map(d => `    ${d};`).join('\n')}\n  }`;
  return {
    props: props.join('\n'),
    keyframes: `@keyframes ${cls}-kf {\n${block('from')}\n${block('to')}\n}`,
    shorthand: `${cls}-kf ${r2(a.duration)}s ${a.easing} ${r2(a.delay)}s ${a.iterations ?? 'infinite'} ${a.direction}`,
  };
}

/* ───────────────────────── layered output ───────────────────────── */

export interface LayeredOptions {
  /** CSS selector of the root element, e.g. `.gradient-canvas`, `#hero`, `[data-gradient="hero"]` */
  rootSel: string;
  names: Names;
  /** print neatly (multi-line stops, comments). The live preview uses compact output. */
  pretty?: boolean; comments?: boolean;
}
const keyOf = (o: LayeredOptions, l: GradientLayer) => `${o.names.scope}-${o.names.cls(l)}`;

/** CSS rules for one layer (without the shared root rules). */
export function layerCss(layer: GradientLayer, project: GradientProject, o: LayeredOptions): string {
  const cls = o.names.cls(layer), key = keyOf(o, layer), bleed = bleedOf(layer, project.canvas), s = 1 + 2 * bleed;
  const anim = animationCss(layer, project, key);
  const decls: string[] = [];
  if (bleed > 0) decls.push(`inset: -${r2(bleed * 100, 1)}%`);
  const items = layerImages(layer, project, { cls: key });
  if (layer.type === 'mesh' && layer.mesh.base) decls.push(`background-color: ${layer.mesh.base}`);
  decls.push('contain: layout');
  if (layer.solidColor !== undefined) decls.push(`background-color: ${layer.solidColor}`);
  else if (o.pretty) decls.push(`background-image:\n${items.map((it, i) => `${o.comments && items.length > 1 ? `    /* ${i + 1} · ${it.label} */\n` : ''}    ${it.parts ? formatGradient(it.parts, '    ') : it.text}`).join(',\n')}`);
  else decls.push(`background-image: ${items.map(i => i.text).join(', ')}`);
  if (items[0]?.size) decls.push(`background-size: ${items[0].size}`);
  if (layer.opacity < 1) decls.push(`opacity: ${r2(layer.opacity, 3)}`);
  if (layer.blend !== 'normal') decls.push(`mix-blend-mode: ${layer.blend}`);
  const f = filterCss(layer, key); if (f) decls.push(`filter: ${f}`);
  const tf = transformCss(layer, s); if (tf) { const org = originCss(layer, s); if (org) decls.push(`transform-origin: ${org}`); decls.push(`transform: ${tf}`); }
  else if (anim && originCss(layer, s)) decls.push(`transform-origin: ${originCss(layer, s)}`);
  if (anim) {
    decls.push(`animation: ${anim.shorthand}`);
    if (layer.anim.tracks.some(t => t.prop === 'x' || t.prop === 'y' || t.prop === 'scale' || t.prop === 'rotate' || t.prop === 'opacity')) decls.push('will-change: transform, opacity');
  }
  const head = o.pretty && o.comments ? `/* ${cls.replace(/^.*-(\d+)$/, '$1')} · ${layer.name}${bleed > 0 ? ' (blurred layers extend past the edge so the blur stays full)' : ''} */\n` : '';
  let css = `${head}${o.rootSel} .${cls} {\n${decls.map(d => `  ${d};`).join('\n')}\n}`;
  if (layer.texture.enabled) {
    const texture = layer.texture;
    const tile = Math.max(1, texture.scale), offsetX = Math.round(texture.seed * 13 + texture.offsetX) % Math.round(tile), offsetY = Math.round(texture.seed * 7 + texture.offsetY) % Math.round(tile);
    css += `\n\n${o.rootSel} .${cls}::after {\n  content: "";\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n      background-image: ${textureDataUri(texture)};\n  background-size: ${r2(texture.scale)}px ${r2(texture.scale)}px;\n  background-position: ${offsetX}px ${offsetY}px;\n  opacity: ${r2(texture.opacity / 100, 3)};\n  mix-blend-mode: ${texture.blend};\n}`;
  }
  if (anim) css = `${anim.props ? `${anim.props}\n\n` : ''}${css}\n\n${anim.keyframes}`;
  return css;
}

/** Declarations that size the root element, from the user's output settings. */
export function sizeDecls(project: GradientProject): string[] {
  const out = outputOf(project), d: string[] = [];
  if (!out.includeSize) return d;
  const val = (v: number, u: string) => (u === 'auto' ? 'auto' : `${r2(v)}${u}`);
  d.push(`width: ${val(out.width.value, out.width.unit)}`);
  if (out.height.unit !== 'auto') d.push(`${out.height.prop}: ${val(out.height.value, out.height.unit)}`);
  return d;
}

export const rootCss = (project: GradientProject, o: LayeredOptions) => {
  const decls = ['position: relative', 'isolation: isolate', 'overflow: hidden', ...sizeDecls(project), ...(project.background ? [`background-color: ${project.background}`] : [])];
  const prefix = cssIdentifier(outputOf(project).layerPrefix, 'layer');
  return `${o.pretty && o.comments ? '/* Container */\n' : ''}${o.rootSel} {\n${decls.map(x => `  ${x};`).join('\n')}\n}\n\n${o.rootSel} > .${prefix} {\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n}`;
};

/** Root selector + opening tag attributes for the user's naming choice. */
export function selectorFor(project: GradientProject) {
  const o = outputOf(project), name = o.selector.trim() || 'gradient-canvas', val = o.attrValue.trim();
  const clean = cssIdentifier(name, 'gradient-canvas');
  if (o.selectorType === 'id') return { sel: `#${clean}`, attr: `id="${clean}"`, scope: clean };
  if (o.selectorType === 'attribute') {
    const attribute = name.replace(/[^a-zA-Z0-9_.:-]/g, '-').replace(/-+/g, '-') || 'data-gradient';
    const attrName = /^[a-zA-Z_]/.test(attribute) ? attribute : `data-${attribute}`;
    const cssValue = val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]/g, ' ');
    const htmlValue = val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return { sel: `[${attrName}="${cssValue}"]`, attr: `${attrName}="${htmlValue}"`, scope: cssIdentifier(`${attrName}-${val}`, 'gradient') };
  }
  return { sel: `.${clean}`, attr: `class="${clean}"`, scope: clean };
}

export function layeredOutput(project: GradientProject) {
  const out = outputOf(project), root = selectorFor(project), prefix = cssIdentifier(out.layerPrefix.trim(), 'layer');
  const names = ordinalNames(project, prefix, root.scope), o: LayeredOptions = { rootSel: root.sel, names, pretty: true, comments: out.comments };
  const visible = project.layers.filter(l => l.visible);
  const defs = effectDefs(project, names);
  const anyAnim = visible.some(l => l.anim.enabled && l.anim.tracks.length);
  const rows = [...visible].reverse().map(l => `  <i class="${prefix} ${names.cls(l)}"></i>`);
  const html = `<div ${root.attr} aria-hidden="true">\n${rows.join('\n')}${defs ? `\n  <svg width="0" height="0" style="position:absolute"><defs>${defs}</defs></svg>` : ''}\n</div>`;
  const css = [rootCss(project, o), ...[...visible].reverse().map(l => layerCss(l, project, o)), ...(anyAnim ? [`${out.comments ? '/* Respect reduced-motion preferences */\n' : ''}@media (prefers-reduced-motion: reduce) {\n  ${root.sel} .${prefix} { animation: none; }\n}`] : [])].join('\n\n');
  return { html, css, all: `${html}\n\n<style>\n${css.split('\n').map(x => (x ? `  ${x}` : x)).join('\n')}\n</style>` };
}

/* ───────────────────────── flat output ───────────────────────── */

/** Fold transforms into the gradient where CSS can express them; report what cannot be expressed. */
function flatten(layer: GradientLayer, warnings: string[]): GradientLayer {
  const l: GradientLayer = JSON.parse(JSON.stringify(layer)), t = l.transform;
  const name = `“${l.name}”`;
  if (activeEffects(l.effects).length) warnings.push(`${name}: effects (blur/filters) need layered output`);
  if (l.texture.enabled) warnings.push(`${name}: texture overlay needs layered output`);
  if (l.anim.enabled && l.anim.tracks.length) warnings.push(`${name}: animation needs layered output`);
  if (t.skewX || t.skewY) warnings.push(`${name}: skew needs layered output`);
  if (l.type === 'noise') { if (t.rotate || t.x || t.y || t.scale !== 1) warnings.push(`${name}: transforming grain needs layered output`); l.transform = { x: 0, y: 0, scale: 1, rotate: 0, skewX: 0, skewY: 0 }; return l; }
  if (l.type === 'mesh') {
    if (t.rotate) warnings.push(`${name}: rotating a mesh needs layered output`);
    l.mesh.points.forEach(p => { p.x = 50 + (p.x - 50) * t.scale + t.x; p.y = 50 + (p.y - 50) * t.scale + t.y; p.size *= t.scale; });
    l.transform = { x: 0, y: 0, scale: 1, rotate: 0, skewX: 0, skewY: 0 };
    return l;
  }
  if (t.rotate) {
    if (l.type === 'linear' || l.type === 'conic') l.angle += t.rotate;
    else if (l.shape === 'ellipse') warnings.push(`${name}: rotating an ellipse needs layered output`);
  }
  if (t.x || t.y) {
    if (l.type === 'linear') warnings.push(`${name}: moving a linear gradient needs layered output`);
    else { l.cx += t.x; l.cy += t.y; }
  }
  if (t.scale !== 1) {
    if (l.type === 'radial') { l.rx *= t.scale; l.ry *= t.scale; }
    else if (l.type === 'linear') l.stops.forEach(s => { s.pos = 50 + (s.pos - 50) * t.scale; });
    if (l.repeating && l.type !== 'radial') l.repeat.size *= t.scale;
  }
  l.transform = { x: 0, y: 0, scale: 1, rotate: 0, skewX: 0, skewY: 0 };
  return l;
}

export function flatOutput(project: GradientProject) {
  const warnings: string[] = [];
  const vis = project.layers.filter(l => l.visible).map(l => ({ src: l, flat: flatten(l, warnings) }));
  const solidBase = vis.length === 1 && vis[0].src.solidColor !== undefined
    && vis[0].src.opacity === 1 && vis[0].src.blend === 'normal'
    && !vis[0].src.texture.enabled && !activeEffects(vis[0].src.effects).length
    && !(vis[0].src.anim.enabled && vis[0].src.anim.tracks.length) && isIdentityTransform(vis[0].src)
    ? vis[0].src.solidColor
    : undefined;
  type Row = { item: ImageItem; blend: string; layer: string };
  const rows: Row[] = [];
  if (solidBase === undefined) vis.forEach(({ src, flat }) => layerImages(flat, project, { alphaMul: src.opacity, flat: true }).forEach(item => rows.push({ item, blend: src.blend, layer: src.name })));
  const out = outputOf(project), anyBlend = rows.some(r => r.blend !== 'normal'), anySize = rows.some(r => r.item.size);
  const fns = rows.map(r => r.item.text);
  const backgroundColor = solidBase ?? project.background;
  const imageBlock = () => `background-image:\n${rows.map((r, i) => `${out.comments && rows.length > 1 ? `  /* ${i + 1} · ${r.layer}${r.item.label !== r.layer && !r.item.label.startsWith(r.layer) ? ` — ${r.item.label.toLowerCase()}` : ''} */\n` : ''}  ${r.item.parts ? formatGradient(r.item.parts, '  ') : r.item.text}`).join(',\n')};`;
  /** The important properties only: background-color / background-image (+ blend / size when used). */
  const properties = (indent = '') => [
    ...(backgroundColor ? [`background-color: ${backgroundColor};`] : []),
    ...(rows.length ? [imageBlock()] : []),
    ...(anySize ? [`background-size: ${rows.map(r => r.item.size ?? 'auto').join(', ')};`] : []),
    ...(anyBlend ? [`background-blend-mode: ${[...rows.map(r => r.blend)].join(', ')};`] : []),
  ].join('\n').split('\n').map(l => (l ? `${indent}${l}` : l)).join('\n') || `${indent}background: transparent;`;
  const sel = selectorFor(project).sel;
  const full = `${sel} {\n${[...sizeDecls(project).map(d => `  ${d};`), properties('  ')].join('\n')}\n}`;
  return { css: properties(), full, properties: properties(), value: fns.join(', '), fns, blends: rows.map(r => r.blend), backgroundColor, warnings, needsLayers: warnings.length > 0 };
}

/** Plain-language notes shown above the code. */
export function analyseOutput(project: GradientProject) {
  const f = flatOutput(project);
  return { warnings: f.warnings, needsLayers: f.needsLayers };
}

/** Inline-style version of the flat output (used for lightweight thumbnails). */
export function flatStyle(project: GradientProject) {
  const f = flatOutput(project);
  return { backgroundImage: f.fns.join(', ') || undefined, backgroundColor: f.backgroundColor || undefined, backgroundBlendMode: f.blends.some(b => b !== 'normal') ? f.blends.join(', ') : undefined };
}

/** Which output reproduces the preview exactly? */
export const needsLayered = (project: GradientProject) => flatOutput(project).needsLayers;

/* ───────────────────────── variables ───────────────────────── */

export function variablesOutput(project: GradientProject, prefix = 'gradient') {
  const flat = flatOutput(project);
  const sel = selectorFor(project).sel;
  const lines = flat.fns.map((f, i) => `  --${prefix}-layer-${flat.fns.length - i}: ${f};`).reverse();
  const refs = flat.fns.map((_, i) => `var(--${prefix}-layer-${flat.fns.length - i})`);
  const base = flat.backgroundColor ? `  --${prefix}-base: ${flat.backgroundColor};\n` : '';
  const all = [...refs, ...(flat.backgroundColor ? [`var(--${prefix}-base)`] : [])];
  const blendLine = flat.blends.some(b => b !== 'normal') ? `  background-blend-mode: ${flat.blends.join(', ')};\n` : '';
  return `:root {\n  /* One variable per layer */\n${lines.join('\n')}\n${base}\n  /* All layers together */\n  --${prefix}-primary: ${all.join(',\n    ')};\n}\n\n/* Usage */\n${sel} {\n  background: var(--${prefix}-primary);\n${blendLine}}`;
}

export function animationOnly(project: GradientProject) {
  const o = outputOf(project), root = selectorFor(project), names = ordinalNames(project, cssIdentifier(o.layerPrefix, 'layer'), root.scope), out: string[] = [];
  project.layers.filter(l => l.visible).reverse().forEach(l => { const key = `${names.scope}-${names.cls(l)}`, a = animationCss(l, project, key); if (a) out.push([o.comments ? `/* ${l.name} */` : '', a.props, a.keyframes, `${root.sel} .${names.cls(l)} {\n  animation: ${a.shorthand};\n}`].filter(Boolean).join('\n\n')); });
  return out.join('\n\n') || '/* No animation tracks yet — enable Animation on a layer and add a track. */';
}

export const degToRad = rad;
