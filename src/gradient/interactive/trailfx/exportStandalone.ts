import runtimeSource from './runtime.js?raw';
import { TRAILFX_SOURCES } from './shaders.generated';
import { TRAILFX_FORMAT_VERSION, normalizeTrailFx, type TrailFxConfig } from './model';

/* Standalone export: four plain files (HTML, CSS, JS, JSON) that run the effect on any page with no dependencies.
 * effect.json holds the pass stack AND the shader library, so the effect can be edited by hand or re-imported into ShapeForge. */

export interface TrailFxFiles { 'index.html': string; 'style.css': string; 'script.js': string; 'effect.json': string }
export const TRAILFX_FORMAT = 'shapeforge-trailfx';

export function buildTrailFxJson(config: TrailFxConfig): string {
  return JSON.stringify({ format: TRAILFX_FORMAT, version: TRAILFX_FORMAT_VERSION, config: { ...config, enabled: true }, library: TRAILFX_SOURCES }, null, 1);
}

/** Accepts an exported effect.json (version 1 or 2), a bare config, or a ShapeForge config copied from the panel. */
export function parseTrailFxJson(text: string): TrailFxConfig | null {
  const value = JSON.parse(text) as { format?: unknown; config?: unknown };
  return normalizeTrailFx(value && value.format === TRAILFX_FORMAT ? value.config : value);
}

export function buildTrailFxFiles(config: TrailFxConfig, options: { title?: string; background?: string } = {}): TrailFxFiles {
  const title = (options.title || config.name || 'Trail FX').replace(/[<>&]/g, '');
  const background = options.background || '#0b1220';
  const runtime = runtimeSource.replace(/^export\s+/gm, '');
  return {
    'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <canvas id="trailfx" aria-hidden="true"></canvas>
  <main class="hero"><h1>${title}</h1><p>Move your cursor, or drag a finger, across the screen.</p></main>
  <script src="script.js"></script>
</body>
</html>
`,
    'style.css': `html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; touch-action: none; background: ${background}; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
#trailfx { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: ${config.opacity}; mix-blend-mode: ${config.blend}; }
.hero { position: fixed; inset: 0; display: grid; place-content: center; gap: 1rem; padding: 2rem; text-align: center; pointer-events: none; }
.hero h1 { margin: 0; font-size: clamp(2.4rem, 9vw, 7rem); font-weight: 500; letter-spacing: -0.04em; text-shadow: 0 0 70px #ffffff73; }
.hero p { margin: 0 auto; max-width: 34ch; color: rgba(255, 255, 255, 0.7); }
.notice { position: fixed; left: 50%; bottom: 1.25rem; transform: translateX(-50%); margin: 0; padding: 0.6rem 1rem; border-radius: 999px; background: rgba(0, 0, 0, 0.55); font-size: 0.8rem; }
`,
    'script.js': `${runtime}
(async () => {
  const canvas = document.getElementById('trailfx');
  let data;
  try { data = await (await fetch('effect.json')).json(); }
  catch (error) {
    canvas.style.display = 'none';
    const note = document.createElement('p');
    note.className = 'notice';
    note.textContent = 'Open this page through a local server so effect.json can load.';
    document.body.appendChild(note);
    return;
  }
  const fx = createTrailFx(canvas, { sources: data.library, config: data.config, onError: (message) => { console.warn(message); canvas.style.display = 'none'; } });
  if (!fx) return;
  const forward = (kind) => (event) => fx.handle(kind, event);
  window.addEventListener('pointermove', forward('move'), { passive: true });
  window.addEventListener('pointerdown', forward('down'), { passive: true });
  window.addEventListener('pointerup', forward('up'));
  window.addEventListener('pointercancel', forward('cancel'));
  document.documentElement.addEventListener('pointerleave', forward('leave'));
  new ResizeObserver(() => fx.resize()).observe(canvas);
})();
`,
    'effect.json': buildTrailFxJson(config),
  };
}
