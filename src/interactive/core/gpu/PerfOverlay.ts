import type { SharedRenderer } from './SharedRenderer';

/* Development-only performance overlay.
 *
 * Shown in dev builds, or in any build when the page is opened with ?perf=1 (remembered in localStorage until ?perf=0).
 * Ctrl+Alt+P toggles it. It is plain DOM, outside React, so it never re-renders the studio. While visible it switches the
 * diagnostics to detailed mode (frame timing, GPU timer queries); when hidden nothing is collected. "Copy report" puts a JSON
 * snapshot on the clipboard for before/after comparisons. */

const STORAGE_KEY = 'shapeforge.perf';
const isDev = () => {
  try { return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true; } catch { return false; }
};

export function overlayEnabledByDefault(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const param = new URLSearchParams(window.location.search).get('perf');
    if (param === '1') window.localStorage.setItem(STORAGE_KEY, '1');
    if (param === '0') window.localStorage.removeItem(STORAGE_KEY);
    return isDev() || window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch { return isDev(); }
}

const fixed = (value: number, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '–';
const mega = (value: number) => `${(value / 1e6).toFixed(2)} MP`;

export class PerfOverlay {
  private element: HTMLDivElement | null = null;
  private body: HTMLPreElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly renderer: SharedRenderer;

  constructor(renderer: SharedRenderer) {
    this.renderer = renderer;
    // development builds, or a page opened with ?perf=1: otherwise the overlay does not exist at all
    if (typeof window !== 'undefined' && overlayEnabledByDefault()) {
      window.addEventListener('keydown', this.onKey);
      this.show();
    }
  }

  get visible() { return this.element !== null; }

  show() {
    if (this.element || typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.setAttribute('data-testid', 'gs-perf-overlay');
    root.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483000;padding:8px 10px;border-radius:8px;background:rgba(10,12,20,.86);color:#d6e2ff;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;pointer-events:auto;max-width:320px;box-shadow:0 4px 18px rgba(0,0,0,.4)';
    const body = document.createElement('pre');
    body.style.cssText = 'margin:0;white-space:pre;font:inherit';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy report';
    copy.style.cssText = 'margin-top:6px;margin-right:6px;font:inherit;padding:2px 8px;border-radius:5px;border:1px solid #4b5b88;background:#18203a;color:inherit;cursor:pointer';
    copy.addEventListener('click', () => { void navigator.clipboard?.writeText(JSON.stringify(this.renderer.snapshot(), null, 2)); });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Hide';
    close.style.cssText = copy.style.cssText;
    close.addEventListener('click', () => this.hide());
    root.append(body, copy, close);
    document.body.appendChild(root);
    this.element = root;
    this.body = body;
    this.renderer.diagnostics.detailed = true;
    this.update();
    this.timer = setInterval(() => this.update(), 250);
  }

  hide() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.element?.remove();
    this.element = null;
    this.body = null;
    this.renderer.diagnostics.detailed = false;
  }

  toggle() {
    if (this.visible) this.hide(); else this.show();
  }

  dispose() {
    this.hide();
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKey);
  }

  private readonly onKey = (event: KeyboardEvent) => {
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'p') { event.preventDefault(); this.toggle(); }
  };

  private update() {
    if (!this.body) return;
    const s = this.renderer.snapshot();
    const gpu = s.gpuFrameMs === null ? (s.gpuTimerSupported ? 'measuring…' : 'n/a (no timer query)') : `${fixed(s.gpuFrameMs, 2)} ms`;
    this.body.textContent = [
      `shader layers   ${s.shaderLayers}  (procedural ${s.proceduralLayers})`,
      `animating       ${s.activeAnimations}   drawn last frame ${s.layersRenderedLastFrame}`,
      `WebGL contexts  ${s.webglContexts}`,
      `programs        ${s.programs}  (compiled ${s.compiledPrograms}, failed ${s.compileFailures})`,
      `compile time    ${fixed(s.compileMs, 0)} ms total`,
      `textures        ${s.textures}  buffers ${s.buffers}  FBOs ${s.framebuffers}`,
      `FPS             ${fixed(s.fps)}`,
      `CPU frame       ${fixed(s.cpuFrameMs, 2)} ms (render callbacks only)`,
      `GPU frame       ${gpu}`,
      `render size     ${s.largestLayer.width}×${s.largestLayer.height} (largest)`,
      `rendered pixels ${mega(s.renderedPixels)}`,
      `budget          scale ${fixed(s.globalScale, 2)}  effort −${s.effort}`,
      `pointer         ${s.pointerEvents} events → ${s.pointerDeliveries} deliveries`,
    ].join('\n');
  }
}
