import { interactiveExports } from '../../interactive/export';
import { buildTrailFxJson, buildTrailFxRuntime } from '../interactive/trailfx/exportStandalone';
import { layeredOutput, selectorFor } from './css';
import type { GradientProject } from './model';
import { outputOf } from './model';
import { ZipWriter } from '../export/zip';

export type WebsiteTag = 'section' | 'div' | 'article' | 'header' | 'main' | 'aside' | 'figure';
export type CodeExportMode = 'custom' | 'website';

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

function makeReadme(mode: CodeExportMode, hasScript: boolean, includesTrailFx: boolean, websiteFileNames: WebsiteExportFileNames | null): string {
  if (mode === 'website' && websiteFileNames) return `# ShapeForge website integration

These are fragments for an existing website, not a complete page.

1. Paste \`${websiteFileNames.html}\` where the gradient section should appear. It includes a link to \`${websiteFileNames.javascript}\` when this project needs JavaScript.
2. Append \`${websiteFileNames.css}\` to your site's stylesheet. The rules are scoped to the configured root selector.
3. ${hasScript ? `Keep the generated script link after the HTML fragment; it initializes the included shader/interaction canvases and does not add another gradient element.` : 'This project does not need a JavaScript file.'}
4. \`${websiteFileNames.effectJson}\` is included only when Trail FX needs its settings and shader library; those data are also embedded in \`${websiteFileNames.javascript}\`. It is not fetched at runtime.

The root tag and class/ID/attribute selector can be changed in ShapeForge before exporting. Keep the root selector consistent between the HTML and CSS. ${includesTrailFx ? 'Trail FX is included and listens for pointer input over the configured gradient root.' : ''}
${hasScript ? '\nThe JavaScript is dependency-free. WebGL effects require browser WebGL support.' : '\nThis project needs no JavaScript.'}
`;
  return `# ShapeForge custom export

- Open \`index.html\` for the standalone page using the separate CSS and JavaScript files.
- Open \`all-in-one.html\` for a single-file version with the CSS and runtime JavaScript (when needed) embedded.
- \`style.css\` and \`script.js\` are the corresponding separate assets. The script file is omitted when the project does not need JavaScript.
- \`effect.json\` is included only when Trail FX needs its settings and shader library; those data are also embedded in \`script.js\`.
- Use the **JSON** format in the Custom exporter for the editable ShapeForge project source.

${includesTrailFx ? 'Trail FX is included with the full gradient project. Its pointer events are scoped to the exported gradient canvas.' : ''}
`;
}

export function buildCodeExportPackage(project: GradientProject, options: {
  mode?: CodeExportMode;
  tag?: WebsiteTag;
  includeTrailFx?: boolean;
  websiteFileNames?: Partial<WebsiteExportFileNames>;
} = {}): CodeExportPackage {
  const mode = options.mode ?? 'custom';
  const websiteFileNames: WebsiteExportFileNames | null = mode === 'website'
    ? {
      html: resolveWebsiteFileName(options.websiteFileNames?.html, 'snippet.html', 'html'),
      css: resolveWebsiteFileName(options.websiteFileNames?.css, 'styles.css', 'css'),
      javascript: resolveWebsiteFileName(options.websiteFileNames?.javascript, 'script.js', 'js'),
      effectJson: resolveWebsiteFileName(options.websiteFileNames?.effectJson, 'effect.json', 'json'),
    }
    : null;
  const rootSelector = selectorFor(project).sel;
  const visibleShader = !!project.shader?.enabled && project.layers.some(layer => layer.visible && layer.shader?.enabled);
  const activeTrailFx = !!options.includeTrailFx && !!project.shader?.trailFx?.enabled;
  const interactive = visibleShader ? interactiveExports(project, `document.querySelector(${JSON.stringify(rootSelector)})`) : null;
  const base = layeredOutput(project);
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

  if (mode === 'website') {
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
    interactive?.runtime,
    activeTrailFx && project.shader?.trailFx
      ? buildTrailFxRuntime(project.shader.trailFx, rootSelector, project.shader.touchEnabled)
      : '',
  ].filter(Boolean).join('\n\n');
  const effectJson = activeTrailFx && project.shader?.trailFx ? buildTrailFxJson(project.shader.trailFx) : null;
  const title = project.name || 'ShapeForge gradient';
  const allInOneHtml = makeStandaloneHtml(title, html, css, javascript);
  const exportedHtml = mode === 'website' && javascript && websiteFileNames
    ? `${html}\n<script src="${escapeHtml(websiteFileNames.javascript)}" defer></script>`
    : html;
  const files: Record<string, string> = mode === 'website'
    && websiteFileNames
    ? {
      [websiteFileNames.html]: exportedHtml,
      [websiteFileNames.css]: css,
      ...(javascript ? { [websiteFileNames.javascript]: javascript } : {}),
      ...(effectJson ? { [websiteFileNames.effectJson]: effectJson } : {}),
      'README.md': makeReadme(mode, !!javascript, activeTrailFx, websiteFileNames),
    }
    : {
      'index.html': makeLinkedHtml(title, html, !!javascript),
      'all-in-one.html': allInOneHtml,
      'style.css': css,
      ...(javascript ? { 'script.js': javascript } : {}),
      ...(effectJson ? { 'effect.json': effectJson } : {}),
      'README.md': makeReadme(mode, !!javascript, activeTrailFx, null),
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
