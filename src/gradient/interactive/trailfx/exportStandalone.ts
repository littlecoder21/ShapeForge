import runtimeSource from './runtime.js?raw';
import { TRAILFX_SOURCES } from './shaders.generated';
import { TRAILFX_FORMAT_VERSION, normalizeTrailFx, type TrailFxConfig } from './model';

/* Standalone export: four plain files (HTML, CSS, JS, JSON) that run the effect on any page with no dependencies.
 * effect.json holds the pass stack AND the shader library, so the effect can be edited by hand or re-imported into ShapeForge. */

export interface TrailFxFiles { 'index.html': string; 'style.css': string; 'script.js': string; 'effect.json': string }
export const TRAILFX_FORMAT = 'shapeforge-trailfx';

/** The shader library an exported effect needs: only the pass kinds the effect actually uses (the full library, with the 25 field generators, is several hundred KB). */
function libraryFor(config: TrailFxConfig): typeof TRAILFX_SOURCES {
  const used = new Set(config.passes.map(pass => pass.kind));
  return { ...TRAILFX_SOURCES, kinds: Object.fromEntries(Object.entries(TRAILFX_SOURCES.kinds).filter(([kind]) => used.has(kind))) };
}

export function buildTrailFxJson(config: TrailFxConfig): string {
  return JSON.stringify({ format: TRAILFX_FORMAT, version: TRAILFX_FORMAT_VERSION, config: { ...config, enabled: true }, library: libraryFor(config) }, null, 1);
}

/** Runtime for attaching Trail FX to an existing ShapeForge gradient root. */
export function buildTrailFxRuntime(config: TrailFxConfig, rootSelector: string, touch = true): string {
  const runtime = runtimeSource.replace(/^export\s+/gm, '');
  const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  const effectData = JSON.parse(buildTrailFxJson(config)) as { config: TrailFxConfig; library: typeof TRAILFX_SOURCES };
  return `(() => {
${runtime}
const shapeForgeTrailFxData = ${safeJson(effectData)};
(() => {
  const hosts = document.querySelectorAll(${safeJson(rootSelector)});
  if (!hosts.length) throw new Error('ShapeForge Trail FX could not find its gradient element.');
  hosts.forEach(host => {
    const canvas = host.querySelector('[data-shapeforge-trailfx]');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.dataset.shapeforgeInitialized) return;
    canvas.dataset.shapeforgeInitialized = 'true';
    const fx = createTrailFx(canvas, {
      sources: shapeForgeTrailFxData.library,
      config: shapeForgeTrailFxData.config,
      onError: message => { console.warn('ShapeForge Trail FX disabled:', message); canvas.style.display = 'none'; },
    });
    if (!fx) return;
    const forward = kind => event => {
      if (event.pointerType === 'touch' && !${touch}) return;
      fx.handle(kind, event);
    };
    window.addEventListener('pointermove', forward('move'), { passive: true });
    window.addEventListener('pointerdown', forward('down'), { passive: true });
    window.addEventListener('pointerup', forward('up'));
    window.addEventListener('pointercancel', forward('cancel'));
    document.documentElement.addEventListener('pointerleave', forward('leave'), { passive: true });
    window.addEventListener('scroll', () => fx.invalidate(), { passive: true, capture: true });
    new ResizeObserver(() => fx.resize()).observe(canvas);
  });
})();
})();
`;
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
  const effectData = JSON.parse(buildTrailFxJson(config)) as { config: TrailFxConfig; library: typeof TRAILFX_SOURCES };
  const embeddedData = JSON.stringify(effectData).replace(/</g, '\\u003c');
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
const effectData = ${embeddedData};
(async () => {
  const canvas = document.getElementById('trailfx');
  const fx = createTrailFx(canvas, { sources: effectData.library, config: effectData.config, onError: (message) => { console.warn(message); canvas.style.display = 'none'; } });
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
