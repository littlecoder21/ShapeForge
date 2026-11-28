import { outputOf, type GradientProject } from './model';

/* ═══════════════════════════ Section-background output ═══════════════════════════
 * A gradient that lives INSIDE an existing section (hero, main, footer …) instead of being a section of its own.
 * The exported element is meant to be pasted as the first child of that section:
 *
 *   <section class="hero">
 *     <div class="sf-bg" data-sf-bg aria-hidden="true"> … </div>   ← the gradient
 *     …your content…
 *   </section>
 *
 * What makes that safe for the page it lands in:
 *   • It is `position: absolute; inset: 0` — out of flow, so it can never change the section's size, spacing, grid or flex layout.
 *   • `z-index: -1` inside a stacking context that the section creates (`isolation: isolate`), so it sits above the section's own
 *     background but below every piece of content — without giving that content a z-index or a position.
 *   • The section rule is wrapped in `:where()` (specificity 0): if the section already has `position`, `z-index`, `overflow` …
 *     of its own, those win and nothing is overridden. It only fills the gaps (a static section becomes `position: relative`).
 *   • The element is inert: `pointer-events: none`, `aria-hidden`, no size of its own, and it takes the section's border-radius.
 *   • Its few layout-critical declarations are `!important`, so site-wide rules such as `section > div { max-width: 1100px;
 *     margin: auto }` or `.hero > * { position: relative }` cannot pull it out of place.
 *   • Every class is namespaced (`sf-bg`, `sf-layer-N`) so it cannot collide with the host site's own `.layer` / `.gradient-canvas`.
 */

export const BG_ATTRIBUTE = 'data-sf-bg';
export const DEFAULT_BG_SELECTOR = 'sf-bg';
export const DEFAULT_BG_LAYER_PREFIX = 'sf-layer';

/** The project with neutral default names swapped for namespaced ones (names the user typed themselves are kept). */
export function backgroundProject(project: GradientProject): GradientProject {
  const output = outputOf(project), selector = output.selector.trim(), prefix = output.layerPrefix.trim();
  return {
    ...project,
    output: {
      ...(project.output ?? {}),
      selector: !selector || selector === 'gradient-canvas' ? DEFAULT_BG_SELECTOR : output.selector,
      layerPrefix: !prefix || prefix === 'layer' ? DEFAULT_BG_LAYER_PREFIX : output.layerPrefix,
    },
  };
}

/** A selector the user typed for their own section. Only plain selector syntax is accepted; anything that could close the rule is refused. */
export function sanitizeHostSelector(value: string | undefined): string {
  const text = (value ?? '').trim();
  if (!text || text.length > 200) return '';
  if (/[{};@\\<]|\/\*|\*\//.test(text) || /[\n\r\f]/.test(text)) return '';
  if (!/^[\w\s.#:[\]="'>+~*,()^$|-]+$/.test(text)) return '';
  return text;
}

const lines = (decls: string[]) => decls.map(declaration => `  ${declaration};`).join('\n');

/** Rules for the section the gradient sits in. Zero specificity on purpose: anything the site already declares wins. */
export function backgroundHostCss(rootSel: string, hostSelector: string | undefined, comments: boolean): string {
  const host = sanitizeHostSelector(hostSelector);
  const note = comments
    ? '/* The section only has to be a positioned stacking context. :where() keeps these rules at zero specificity, so a position,\n   z-index or overflow your own CSS already sets on the section always wins. */\n'
    : '';
  const rule = (selector: string) => `${selector} {\n${lines(['position: relative', 'isolation: isolate'])}\n}`;
  return `${note}${[rule(`:where(:has(> ${rootSel}))`), ...(host ? [rule(`:where(${host})`)] : [])].join('\n')}`;
}

export interface BackgroundCssOptions { comments: boolean; staged: boolean; prefix: string }

/** The gradient's own box: out of flow, filling the section's padding box, behind its content. */
export function backgroundRootCss(project: GradientProject, rootSel: string, o: BackgroundCssOptions): string {
  const decls = [
    'position: absolute !important', 'inset: 0 !important', 'z-index: -1 !important', 'display: block !important',
    'box-sizing: border-box',
    'width: auto !important', 'height: auto !important', 'min-width: 0 !important', 'min-height: 0 !important', 'max-width: none !important', 'max-height: none !important',
    'margin: 0 !important', 'padding: 0 !important', 'border: 0 !important',
    'overflow: hidden', 'border-radius: inherit', 'isolation: isolate', 'pointer-events: none !important',
    ...(o.staged ? ['container-type: size'] : []),
    ...(project.background && !o.staged ? [`background-color: ${project.background}`] : []),
  ];
  const comment = (text: string) => (o.comments ? `/* ${text} */\n` : '');
  const root = `${comment('Section background: out of flow, fills the section, sits behind its content')}${rootSel} {\n${lines(decls)}\n}`;
  if (o.staged) return root;
  return `${root}\n\n${rootSel} > .${o.prefix} {\n${lines(['position: absolute', 'inset: 0', 'pointer-events: none'])}\n}`;
}

/** The scaled stage inside the background box. The box's size comes from the section, so the scale is computed in CSS from the box
 *  itself (container units); browsers that cannot do that fall back to the plain, unscaled fill. */
export function backgroundStageCss(project: GradientProject, rootSel: string, stageAttr: string, o: BackgroundCssOptions): string {
  const { w } = project.canvas;
  const scale = `scale(tan(atan2(100cqw, ${w}px)))`;
  const stage = `${rootSel} > [${stageAttr}]`;
  const comment = (text: string) => (o.comments ? `/* ${text} */\n` : '');
  const plain = ['position: absolute', 'top: 0', 'left: 0', 'width: 100%', 'height: 100%', 'overflow: hidden', 'isolation: isolate', ...(project.background ? [`background-color: ${project.background}`] : [])];
  return [
    `${comment(`Stage: the layers are built at the native ${w} px canvas width and scaled to the section, like the studio preview`)}${stage} {\n${lines(plain)}\n}`,
    `${comment('Where CSS can compute the scale (container units + tan(atan2())), the stage is scaled to the section; its height follows the section')}@supports (transform: ${scale}) {\n  ${rootSel} { --sf-k: tan(atan2(100cqw, ${w}px)); }\n  ${stage} {\n${lines(['width: ' + w + 'px', 'height: calc(100cqh / var(--sf-k))', 'transform-origin: 0 0', 'transform: scale(var(--sf-k))']).replace(/^/gm, '  ')}\n  }\n}`,
    `${rootSel} > :where([${stageAttr}]) > .${o.prefix} {\n${lines(['position: absolute', 'inset: 0', 'pointer-events: none'])}\n}`,
  ].join('\n\n');
}
