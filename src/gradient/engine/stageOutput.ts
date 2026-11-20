import { effectDefs, layerCss, ordinalNames, selectorFor, sizeDecls, type LayeredOptions } from './css';
import { outputOf, type GradientProject } from './model';

/* ═══════════════════════════ Scaled-stage output ═══════════════════════════
 * The studio preview draws the gradient at its native canvas size (e.g. 1200 × 800 px) and scales that whole picture with
 * one CSS transform. Blur radii, grain tiles, texture sizes, SVG-filter distortion and text sizes are all authored in
 * canvas pixels, so they only look right when scaled together with the picture.
 *
 * The plain layered export puts the layers straight into a responsive box, so those pixel values stay the same while the
 * box gets smaller or larger — on a phone a 44px blur is suddenly a huge part of the picture. This module exports the same
 * layers inside a native-size "stage" that is scaled to the box exactly like the preview does it, so the result is a
 * carbon copy at every width:
 *
 *   <div class="gradient-canvas">            ← the box you size (responsive, hero, card…)
 *     <div data-sf-stage>                    ← native canvas size, scaled by --sf-k (box width ÷ canvas width)
 *       <i class="layer layer-1"></i> …
 *
 * A tiny dependency-free script keeps --sf-k exact. Without JavaScript a CSS-only fallback computes the same number in
 * browsers that support container units and tan(atan2()). */

const cssIdentifier = (value: string, fallback: string) => {
  const clean = value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-') || fallback;
  return /^-?\d/.test(clean) ? `g-${clean}` : clean;
};
const htmlEscape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const STAGE_ATTRIBUTE = 'data-sf-stage';

/** The scaled stage reproduces the studio preview. It is skipped only when the preview itself is showing the literal output
 *  size ("preview at output size"), because then the preview is not scaled either. */
export function usesScaledStage(project: GradientProject): boolean {
  const output = outputOf(project);
  const literalOutputPreview = output.previewOutputSize && output.includeSize && !output.responsive
    && ['px', '%'].includes(output.width.unit) && ['px', '%'].includes(output.height.unit);
  return !literalOutputPreview;
}

/** Keeps `--sf-k` (box width ÷ canvas width) and `--sf-h` (stage height in canvas pixels) in sync with the box. */
export function buildStageRuntime(rootSelector: string, canvasWidth: number): string {
  return `/* ShapeForge: scales the gradient stage to its box so the export matches the studio preview at any size. */
(function () {
  var SELECTOR = ${JSON.stringify(rootSelector)};
  var CANVAS_WIDTH = ${Math.round(canvasWidth)};

  function fit(root, width, height) {
    if (!(width > 0) || !(height > 0)) return;
    var k = width / CANVAS_WIDTH;
    root.style.setProperty('--sf-k', String(k));
    root.style.setProperty('--sf-h', (height / k) + 'px');
  }

  function init(root) {
    if (root.__sfStage) return;
    root.__sfStage = true;
    fit(root, root.clientWidth, root.clientHeight);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function (entries) {
        var box = entries[0].contentRect;
        fit(root, box.width, box.height);
      }).observe(root);
    } else {
      window.addEventListener('resize', function () { fit(root, root.clientWidth, root.clientHeight); });
    }
  }

  function start() {
    var roots = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < roots.length; i++) init(roots[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();`;
}

/** Same layers, names and per-layer CSS as `layeredOutput`, wrapped in the scaled stage. */
export function stagedLayeredOutput(project: GradientProject) {
  const out = outputOf(project), root = selectorFor(project), prefix = cssIdentifier(out.layerPrefix.trim(), 'layer');
  const names = ordinalNames(project, prefix, root.scope);
  const options: LayeredOptions = { rootSel: root.sel, names, pretty: true, comments: out.comments };
  const visible = project.layers.filter(l => l.visible);
  const { w, h } = project.canvas;
  const defs = effectDefs(project, names);
  const anyAnim = visible.some(l => l.anim.enabled && l.anim.tracks.length);
  const stage = `${root.sel} > [${STAGE_ATTRIBUTE}]`;

  const rows = [...visible].reverse().map(l => `    <i class="${prefix} ${names.cls(l)}">${l.text ? `<span class="g-text">${htmlEscape(l.text.content)}</span>` : l.type === 'mesh' ? [...l.mesh.points].map((point, index) => ({ point, index })).reverse().map(({ index }) => `<i class="mesh-point-${index}"></i>`).join('') : ''}</i>`);
  const html = `<div ${root.attr} aria-hidden="true">\n  <div ${STAGE_ATTRIBUTE}>\n${rows.join('\n')}${defs ? `\n    <svg width="0" height="0" style="position:absolute"><defs>${defs}</defs></svg>` : ''}\n  </div>\n</div>`;

  const comment = (text: string) => (out.comments ? `/* ${text} */\n` : '');
  const percentHeightHost = out.includeSize && !out.responsive && out.height.unit === '%' ? 'html, body { height: 100%; margin: 0; }' : '';
  const rootDecls = [
    'position: relative', 'isolation: isolate', 'overflow: hidden',
    ...sizeDecls(project),
    ...(out.responsive ? [`aspect-ratio: ${w} / ${h}`] : []),
    'container-type: inline-size',
  ];
  const rootRules = `${comment('Container')}${root.sel} {\n${rootDecls.map(x => `  ${x};`).join('\n')}\n}`;
  const fallbackRules = `${comment('Without JavaScript the same scale is computed in CSS (the script only makes it exact)')}@supports (transform: scale(tan(atan2(100cqw, ${w}px)))) {\n  ${root.sel} { --sf-k: tan(atan2(100cqw, ${w}px)); }\n}`;
  const stageRules = `${comment(`Stage: built at the native ${w} × ${h} canvas size and scaled as one piece, exactly like the studio preview`)}${stage} {\n${[
    'position: absolute', 'top: 0', 'left: 0',
    `width: ${w}px`, `height: var(--sf-h, ${h}px)`,
    'overflow: hidden', 'isolation: isolate',
    'transform-origin: 0 0', 'transform: scale(var(--sf-k, 1))',
    ...(project.background ? [`background-color: ${project.background}`] : []),
  ].map(x => `  ${x};`).join('\n')}\n}\n\n${root.sel} > :where([${STAGE_ATTRIBUTE}]) > .${prefix} {\n  position: absolute;\n  inset: 0;\n  pointer-events: none;\n}`;

  const css = [
    percentHeightHost,
    rootRules,
    fallbackRules,
    stageRules,
    ...[...visible].reverse().map(l => layerCss(l, project, options)),
    ...(anyAnim ? [`${comment('Respect reduced-motion preferences')}@media (prefers-reduced-motion: reduce) {\n  ${root.sel} .${prefix} { animation: none; }\n}`] : []),
  ].filter(Boolean).join('\n\n');

  return {
    html, css,
    runtime: buildStageRuntime(root.sel, w),
    all: `${html}\n\n<style>\n${css.split('\n').map(x => (x ? `  ${x}` : x)).join('\n')}\n</style>\n\n<script>\n${buildStageRuntime(root.sel, w)}\n</script>`,
  };
}
