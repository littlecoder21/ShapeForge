import { flatOutput, layeredOutput, needsLayered, selectorFor } from '../../gradient/engine/css';
import type { GradientProject } from '../../gradient/engine/model';
import { projectSvgParts } from '../../gradient/engine/svg';
import { fmt } from './geometry';
import type { Box } from './geometry';

/** A Gradient Studio project applied to a ShapeForge shape. The project stays fully editable. */
export interface ShapePaint { project: GradientProject; fill: boolean; stroke: boolean; css: boolean }

export const paintShowsFill = (p?: ShapePaint) => !!p && (p.fill || p.css);

/** SVG markup that paints the gradient inside the shape path `d` (frame-local coordinates). */
export function paintSvgParts(paint: ShapePaint, d: string, frame: Box, strokeWidth: number, uid = 'sfp', evenodd = false): { defs: string; body: string } {
  const parts = projectSvgParts(paint.project, uid);
  const sx = frame.w / paint.project.canvas.w, sy = frame.h / paint.project.canvas.h;
  const group = `<g transform="scale(${fmt(sx, 5)} ${fmt(sy, 5)})">${parts.body}</g>`;
  let defs = parts.defs, body = '';
  if (paintShowsFill(paint)) { defs += `<clipPath id="${uid}-clip"><path d="${d}"${evenodd ? ' clip-rule="evenodd"' : ''}/></clipPath>`; body += `<g clip-path="url(#${uid}-clip)">${group}</g>`; }
  if (paint.stroke) {
    const pad = strokeWidth * 2;
    defs += `<mask id="${uid}-mask" maskUnits="userSpaceOnUse" x="${fmt(-pad)}" y="${fmt(-pad)}" width="${fmt(frame.w + pad * 2)}" height="${fmt(frame.h + pad * 2)}"><path d="${d}" fill="none" stroke="#fff" stroke-width="${strokeWidth}"/></mask>`;
    body += `<g mask="url(#${uid}-mask)">${group}</g>`;
  }
  return { defs, body };
}

/** CSS for the HTML + CSS / React exports when the gradient is used as the element background. */
export function paintCss(paint: ShapePaint, ratio: string, clip: string) {
  const project = paint.project;
  if (!needsLayered(project)) {
    const flat = flatOutput(project);
    const body = flat.properties.split('\n').map(l => `  ${l}`).join('\n');
    return { html: '<div class="shape"></div>', css: `.shape {\n  width: 100%;\n  aspect-ratio: ${ratio};\n  ${clip}\n${body}\n}` };
  }
  const layered = layeredOutput(project), root = selectorFor(project);
  const inner = layered.html.split('\n').map(l => `  ${l}`).join('\n');
  return {
    html: `<div class="shape">\n${inner}\n</div>`,
    css: `.shape {\n  position: relative;\n  width: 100%;\n  aspect-ratio: ${ratio};\n  overflow: hidden;\n  ${clip}\n}\n\n.shape ${root.sel} {\n  width: 100%;\n  height: 100%;\n  min-height: 0;\n}\n\n${layered.css}`,
  };
}
