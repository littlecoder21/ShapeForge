import { interactiveExports } from '../../interactive/export';
import { buildTrailFxJson, buildTrailFxRuntime } from '../interactive/trailfx/exportStandalone';
import { layeredOutput, selectorFor } from './css';
import { backgroundHostCss, backgroundProject, sanitizeHostSelector } from './backgroundOutput';
import type { GradientProject } from './model';
import { outputOf } from './model';
import { stagedLayeredOutput, usesScaledStage } from './stageOutput';
import { ZipWriter } from '../export/zip';

export type WebsiteTag = 'section' | 'div' | 'article' | 'header' | 'main' | 'aside' | 'figure';
export type CodeExportMode = 'custom' | 'website' | 'background';

export interface CodeExportPackage {
  html: string;
  css: string;
  javascript: string;
  effectJson: string | null;
  allInOneHtml: string;
  files: Record<string, string>;
  websiteFileNames: WebsiteExportFileNames | null;
}

export interface WebsiteExportFileNames {
  html: string;
  css: string;
  javascript: string;
  effectJson: string;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inlineSafe = (value: string, tag: 'script' | 'style') => value.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

function resolveWebsiteFileName(value: string | undefined, fallback: string, extension: string): string {
  const safeValue = (value ?? '').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 120);
  const stem = safeValue.replace(/\.[^.]*$/, '').replace(/[. ]+$/g, '');
  const safeStem = stem && stem !== '..' ? stem : fallback.replace(/\.[^.]*$/, '');
  return `${safeStem}.${extension}`;
}

export function codeExportSlug(project: GradientProject): string {
  const configured = outputOf(project).downloadName.trim() || project.name || 'gradient';
  return configured.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'gradient';
}

function replaceRootTag(markup: string, tag: WebsiteTag): string {
  const opening = /<div\b[^>]*>/.exec(markup);
  if (!opening) throw new Error('The generated gradient markup has no root element.');
  const closing = /<\/div>\s*$/.exec(markup);
  if (!closing) throw new Error('The generated gradient markup has no closing root element.');
  return `${markup.slice(0, opening.index)}<${tag}${opening[0].slice(4)}${markup.slice(opening.index + opening[0].length, closing.index)}</${tag}>`;
}

function appendTrailFxCanvas(markup: string): string {
  const opening = /<(?:div|section|article|header|main|aside|figure)\b[^>]*>/.exec(markup);
  if (!opening) throw new Error('The generated gradient markup has no root element for Trail FX.');
  return `${markup.slice(0, opening.index + opening[0].length)}\n  <canvas data-shapeforge-trailfx aria-hidden="true"></canvas>${markup.slice(opening.index + opening[0].length)}`;
}

function makeStandaloneHtml(title: string, html: string, css: string, javascript: string): string {
  const script = javascript ? `\n<script>\n${inlineSafe(javascript, 'script')}\n</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
${inlineSafe(css, 'style')}
  </style>
</head>
<body>
${html}
${script}
</body>
</html>
`;
}

function makeLinkedHtml(title: string, html: string, hasScript: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
${html}
${hasScript ? '<script src="script.js" defer></script>' : ''}
</body>
</html>
`;
}

function makeReadme(mode: CodeExportMode, hasScript: boolean, includesTrailFx: boolean, websiteFileNames: WebsiteExportFileNames | null, exactStage: boolean): string {
  const stageNote = exactStage
    ? 'The gradient is built at its native canvas size inside a `data-sf-stage` element and scaled to the box exactly like the ShapeForge preview, so blur, grain and textures match at every width. Keep that element and the script together; without the script a CSS-only fallback computes the same scale in modern browsers.'
    : '';
  if (mode === 'website' && websiteFileNames) return `# ShapeForge website integration

These are fragments for an existing website, not a complete page.

1. Paste \`${websiteFileNames.html}\` where the gradient section should appear. It includes a link to \`${websiteFileNames.javascript}\` when this project needs JavaScript.
2. Append \`${websiteFileNames.css}\` to your site's stylesheet. The rules are scoped to the configured root selector.
3. ${hasScript ? `Keep the generated script link after the HTML fragment; it ${exactStage ? 'keeps the gradient scaled exactly like the preview' : 'initializes the included shader/interaction canvases'} and does not add another gradient element.` : 'This project does not need a JavaScript file.'}
4. \`${websiteFileNames.effectJson}\` is included only when Trail FX needs its settings and shader library; those data are also embedded in \`${websiteFileNames.javascript}\`. It is not fetched at runtime.

The root tag and class/ID/attribute selector can be changed in ShapeForge before exporting. Keep the root selector consistent between the HTML and CSS. ${includesTrailFx ? 'Trail FX is included and listens for pointer input over the configured gradient root.' : ''}
${stageNote ? `\n${stageNote}\n` : ''}${hasScript ? '\nThe JavaScript is dependency-free. WebGL effects require browser WebGL support.' : '\nThis project needs no JavaScript.'}
`;
  return `# ShapeForge custom export

- Open \`index.html\` for the standalone page using the separate CSS and JavaScript files.
- Open \`all-in-one.html\` for a single-file version with the CSS and runtime JavaScript (when needed) embedded.
- \`style.css\` and \`script.js\` are the corresponding separate assets. The script file is omitted when the project does not need JavaScript.
- \`effect.json\` is included only when Trail FX needs its settings and shader library; those data are also embedded in \`script.js\`.
- Use the **JSON** format in the Custom exporter for the editable ShapeForge project source.

${stageNote ? `${stageNote}\n\n` : ''}${includesTrailFx ? 'Trail FX is included with the full gradient project. Its pointer events are scoped to the exported gradient canvas.' : ''}
`;
}

function makeBackgroundReadme(names: WebsiteExportFileNames, rootSelector: string, hasScript: boolean, includesTrailFx: boolean, hostSelector: string): string {
  return `# ShapeForge section background

The gradient is a background layer for a section that already exists on your site (hero, main, footer, a card …).
It is not a section of its own and it never changes the section's layout.

## Install

1. Paste \`${names.html}\` as the **first child** of the section:

   \`\`\`html
   <section class="hero">
     <!-- the contents of ${names.html} -->
     …your content…
   </section>
   \`\`\`

2. Append \`${names.css}\` to your stylesheet (or link it).
3. ${hasScript ? `Keep the \`<script src="${names.javascript}" defer>\` line from the fragment (you can move it to the end of \`<body>\`). It ${includesTrailFx ? 'runs the Trail FX / interactive layers' : 'repaints the smooth mesh field at full quality'}; the picture is also baked in, so the page still shows the gradient without it.` : 'This gradient needs no JavaScript.'}

Open \`demo.html\` to see it working in a sample hero.

## Why it cannot break your layout

- The element is \`position: absolute; inset: 0\`: it is out of flow, so it takes no space and does not move, wrap or stretch your content, grid or flex rows.
- \`z-index: -1\` places it behind the section's content. The section only needs to be a positioned stacking context, which this rule gives it:
  \`:where(:has(> ${rootSelector})) { position: relative; isolation: isolate; }\`
  \`:where()\` has zero specificity, so a \`position\`, \`z-index\` or \`overflow\` your own CSS already sets on the section **wins**.
${hostSelector ? `- Your own selector \`${hostSelector}\` gets the same zero-specificity rule, for browsers without \`:has()\`.
` : `- Browsers without \`:has()\` (before 2023): give the section \`position: relative; isolation: isolate;\` yourself, or enter its selector in ShapeForge ("My section's selector") and export again.
`}- It is inert (\`pointer-events: none\`, \`aria-hidden\`), has no size of its own, clips to the section's \`border-radius\`, and covers the section's padding box (borders stay visible).
- The few layout-critical declarations are \`!important\`, so a site-wide rule such as \`section > div { max-width: 1100px; margin: auto }\` cannot pull the gradient out of place.
- All class names are namespaced (\`sf-bg\`, \`sf-layer-N\`), so they cannot collide with your own CSS.
- The gradient is built at its design width and scaled to the section with CSS container units, so blur, grain and patterns look the same in a 1440 px hero and on a phone. Its height follows the section.

## Things to know

- Inserting any element shifts sibling-based selectors by one: \`section > :first-child\` now matches the gradient, and \`* + *\` ("lobotomized owl") rules also match the first real child. Place the fragment elsewhere in the section if that matters; it works at any position because the stacking is done with z-index.
- The section's own background colour sits under the gradient and shows through wherever the gradient is transparent.
- Use one export per section. For several sections, export again with a different class name (Class, ID and size settings → Class name).
${includesTrailFx ? '- Trail FX listens to the page pointer and draws inside the gradient box, so it works even though your content sits on top.\n' : ''}`;
}

/** A small self-contained page that shows the fragment as the first child of a hero, so it can be checked in a browser. */
function makeBackgroundDemo(title: string, fragment: string, css: string, javascript: string): string {
  const demo = `body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; background: #0b0d12; }
.demo-hero { padding: clamp(72px, 12vw, 160px) 24px; min-height: 72vh; display: grid; align-content: center; justify-items: center; gap: 18px; text-align: center; border-radius: 0 0 36px 36px; }
.demo-hero h1 { margin: 0; font-size: clamp(2rem, 6vw, 4.5rem); line-height: 1.05; text-shadow: 0 2px 24px rgb(0 0 0 / 0.35); }
.demo-hero p { margin: 0; max-width: 46ch; font-size: 1.125rem; text-shadow: 0 1px 12px rgb(0 0 0 / 0.35); }
.demo-hero a { padding: 12px 22px; border-radius: 999px; background: #fff; color: #111; text-decoration: none; font-weight: 600; }
.demo-main { padding: 64px 24px; max-width: 720px; margin: 0 auto; line-height: 1.6; color: #c9ced8; }`;
  const script = javascript ? `\n<script>\n${inlineSafe(javascript, 'script')}\n</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · section background demo</title>
  <style>
${inlineSafe(demo, 'style')}

${inlineSafe(css, 'style')}
  </style>
</head>
<body>
<section class="demo-hero">
${fragment.split('\n').map(line => (line ? `  ${line}` : line)).join('\n')}
  <h1>Your hero, with a gradient behind it</h1>
  <p>The gradient is the first child of this section, absolutely positioned behind the content. The section keeps its own padding, size and layout.</p>
  <a href="#main">Call to action</a>
</section>
<main class="demo-main" id="main">
  <p>This is the page below the hero. Nothing here moved when the gradient was added.</p>
</main>${script}
</body>
</html>
`;
}

export function buildCodeExportPackage(project: GradientProject, options: {
  mode?: CodeExportMode;
  tag?: WebsiteTag;
  includeTrailFx?: boolean;
  websiteFileNames?: Partial<WebsiteExportFileNames>;
  /** Section background: the author's own selector for the section, e.g. `.hero` (optional, adds a zero-specificity host rule). */
  hostSelector?: string;
} = {}): CodeExportPackage {
  const mode = options.mode ?? 'custom';
  const background = mode === 'background';
  const websiteFileNames: WebsiteExportFileNames | null = mode === 'website' || background
    ? {
      html: resolveWebsiteFileName(options.websiteFileNames?.html, background ? 'gradient-background.html' : 'snippet.html', 'html'),
      css: resolveWebsiteFileName(options.websiteFileNames?.css, background ? 'gradient-background.css' : 'styles.css', 'css'),
      javascript: resolveWebsiteFileName(options.websiteFileNames?.javascript, background ? 'gradient-background.js' : 'script.js', 'js'),
      effectJson: resolveWebsiteFileName(options.websiteFileNames?.effectJson, 'effect.json', 'json'),
    }
    : null;
  // a section background gets namespaced class names, so nothing it adds can collide with the host site's own CSS
  const source = background ? backgroundProject(project) : project;
  const rootSelector = selectorFor(source).sel;
  const hostSelector = background ? sanitizeHostSelector(options.hostSelector) : '';
  const visibleShader = !!project.shader?.enabled && project.layers.some(layer => layer.visible && layer.shader?.enabled);
  const activeTrailFx = !!options.includeTrailFx && !!project.shader?.trailFx?.enabled;
  // a section background may be pasted into several sections, so its shader runtime serves every instance of the root
  const rootExpression = background
    ? `({ querySelectorAll: function (query) { var found = []; document.querySelectorAll(${JSON.stringify(rootSelector)}).forEach(function (root) { root.querySelectorAll(query).forEach(function (node) { found.push(node); }); }); return found; } })`
    : `document.querySelector(${JSON.stringify(rootSelector)})`;
  const interactive = visibleShader ? interactiveExports(source, rootExpression, { background }) : null;
  // The code export carries JavaScript anyway, so it is built like the studio preview: the layers live in a native-size
  // stage that is scaled to the box (blur, grain and textures included), which makes the export a carbon copy of the preview.
  // Shader-canvas projects keep their own runtime and layout.
  const staged = !interactive && (background || usesScaledStage(source)) ? stagedLayeredOutput(source, { background }) : null;
  const base = staged ?? layeredOutput(source, { background });
  let html = interactive?.markup ?? base.html;
  let css = interactive
    ? [
      base.css,
      `${rootSelector} canvas[data-shader-canvas] { display: block; }
${rootSelector} .gs-shader-export-layer::after { z-index: 2; }
${rootSelector} .gs-shader-export-layer.gs-webgl-ready { background-image: none !important; background-color: transparent !important; }
${rootSelector} .gs-shader-export-layer.gs-webgl-ready > [class^="mesh-point-"] { display: none !important; }`,
    ].join('\n\n')
    : base.css;

  if (background) {
    const comments = outputOf(source).comments;
    html = `<!-- ShapeForge section background: paste as the FIRST child of your section (hero, main, footer…). It is out of flow and sits behind the section's content. -->\n${html}`;
    css = [comments ? '/* ShapeForge section background: append these rules to your stylesheet. Keep the root selector in sync with the HTML fragment. */' : '', backgroundHostCss(rootSelector, hostSelector, comments), css].filter(Boolean).join('\n\n');
  } else if (mode === 'website') {
    html = replaceRootTag(html, options.tag ?? 'section');
    html = `<!-- ShapeForge: paste this fragment where the gradient section belongs. Keep the configured root selector. -->\n${html}`;
    css = `/* ShapeForge: append these scoped rules to your website stylesheet. Keep the root selector in sync with snippet.html. */\n${css}`;
  } else {
    css = `html, body { margin: 0; min-height: 100%; }
body { min-height: 100vh; }

${css}`;
  }

  if (activeTrailFx) {
    html = appendTrailFxCanvas(html);
    css += `\n\n${rootSelector} > [data-shapeforge-trailfx] {
  position: absolute;
  inset: 0;
  z-index: 3;
  width: 100%;
  height: 100%;
  pointer-events: none;
}`;
  }

  const javascript = [
    staged?.runtime,
    interactive?.runtime,
    // live repaint of smooth mesh fields when neither the stage nor the shader runtime already carries it
    !staged && !interactive && 'script' in base ? base.script : '',
    activeTrailFx && project.shader?.trailFx
      ? buildTrailFxRuntime(project.shader.trailFx, rootSelector, project.shader.touchEnabled)
      : '',
  ].filter(Boolean).join('\n\n');
  const effectJson = activeTrailFx && project.shader?.trailFx ? buildTrailFxJson(project.shader.trailFx) : null;
  const title = project.name || 'ShapeForge gradient';
  const allInOneHtml = makeStandaloneHtml(title, html, css, javascript);
  const exportedHtml = (mode === 'website' || background) && javascript && websiteFileNames
    ? `${html}\n<script src="${escapeHtml(websiteFileNames.javascript)}" defer></script>`
    : html;
  const files: Record<string, string> = background && websiteFileNames
    ? {
      [websiteFileNames.html]: exportedHtml,
      [websiteFileNames.css]: css,
      ...(javascript ? { [websiteFileNames.javascript]: javascript } : {}),
      ...(effectJson ? { [websiteFileNames.effectJson]: effectJson } : {}),
      'demo.html': makeBackgroundDemo(title, html, css, javascript),
      'README.md': makeBackgroundReadme(websiteFileNames, rootSelector, !!javascript, activeTrailFx, hostSelector),
    }
    : mode === 'website'
    && websiteFileNames
    ? {
      [websiteFileNames.html]: exportedHtml,
      [websiteFileNames.css]: css,
      ...(javascript ? { [websiteFileNames.javascript]: javascript } : {}),
      ...(effectJson ? { [websiteFileNames.effectJson]: effectJson } : {}),
      'README.md': makeReadme(mode, !!javascript, activeTrailFx, websiteFileNames, !!staged),
    }
    : {
      'index.html': makeLinkedHtml(title, html, !!javascript),
      'all-in-one.html': allInOneHtml,
      'style.css': css,
      ...(javascript ? { 'script.js': javascript } : {}),
      ...(effectJson ? { 'effect.json': effectJson } : {}),
      'README.md': makeReadme(mode, !!javascript, activeTrailFx, null, !!staged),
    };

  return { html: exportedHtml, css, javascript, effectJson, allInOneHtml, files, websiteFileNames };
}

export async function codeExportZip(slug: string, files: Record<string, string>): Promise<Blob> {
  const zip = new ZipWriter();
  for (const [name, content] of Object.entries(files)) {
    await zip.add(`${slug}/${name}`, new Blob([content], { type: 'text/plain;charset=utf-8' }));
  }
  return zip.finish();
}
