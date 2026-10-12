import { analyseOutput, animationOnly, flatOutput, layerCss, layeredOutput, ordinalNames, selectorFor, variablesOutput } from './css';
import { outputOf, type GradientProject } from './model';
import { projectSvg } from './svg';

/** Everything the Output panel shows, generated from the project in one place. */
export function svgSizeAttrs(project: GradientProject): string {
  const o = outputOf(project);
  if (!o.includeSize) return '';
  const px = o.width.unit === 'px' && o.height.unit === 'px';
  if (px) return `width="${Math.round(o.width.value)}" height="${Math.round(o.height.value)}"`;
  return o.width.unit === 'auto' ? '' : `width="${o.width.unit === '%' ? '100%' : `${o.width.value}${o.width.unit}`}"`;
}

export function buildOutputs(project: GradientProject) {
  const flat = flatOutput(project), layered = layeredOutput(project);
  return {
    flat, layered,
    analysis: analyseOutput(project),
    vars: variablesOutput(project),
    keyframes: animationOnly(project),
    svg: projectSvg(project, { size: svgSizeAttrs(project) }),
    json: JSON.stringify(project, null, 2),
  };
}
export type Outputs = ReturnType<typeof buildOutputs>;

/** Live CSS of every layer, exactly as it appears in the HTML + CSS export (same selector, same class names). */
export function layerCssBlocks(project: GradientProject) {
  const o = outputOf(project), root = selectorFor(project), prefix = o.layerPrefix.trim().replace(/[^a-zA-Z0-9_-]/g, '-') || 'layer';
  const names = ordinalNames(project, prefix, root.scope);
  return project.layers.filter(l => l.visible).map(l => ({ id: l.id, name: l.name, cls: names.cls(l), css: layerCss(l, project, { rootSel: root.sel, names, pretty: true, comments: o.comments }) }));
}
