import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { getFrameScheduler } from '../../interactive/core/FrameScheduler';
import { getSharedRenderer } from '../../interactive/core/gpu/SharedRenderer';
import LayeredArt from '../components/LayeredArt';
import type { GradientProject } from '../engine/model';
import { DomRasterizer, type RasterGeometry } from './domRasterizer';
import { animationInfo, fitRect } from './exportPlan';
import { rasterizeProject } from './staticRaster';

/* Frame sources: where the pixels of an exported image or video frame come from.
 *
 *  - still video frames can reuse the standalone raster renderer; still-image exports clone the live preview to match it exactly;
 *  - a project with CSS animation and / or shader layers is mounted in a hidden stage (the very same <LayeredArt> the preview
 *    uses), then captured frame by frame at exact times: CSS animations are sought and shader time is stepped deterministically
 *    through the shared frame scheduler, so the result does not depend on how fast this computer renders.
 */

export interface FrameSource {
  /** true when the picture changes over time */
  readonly dynamic: boolean;
  /** things the exporter could not reproduce exactly, shown to the person */
  readonly notes: string[];
  /** Moves the scene forward to `sceneMs`. `speed` = scene time per output time (shader clocks are scaled to match). Never backwards. */
  advanceTo(sceneMs: number, speed?: number): Promise<void>;
  /** Draws the scene at the current time onto `ctx` (the caller fills the letterbox / background first). */
  render(ctx: CanvasRenderingContext2D, geometry: RasterGeometry): Promise<void>;
  dispose(): void;
}

export interface FrameSourceOptions {
  project: GradientProject;
  /** CSS colour painted behind the artwork, '' = transparent */
  background: string;
  /** Use the preview DOM renderer for still projects instead of the standalone raster renderer. */
  captureStatic?: boolean;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}

export const abortError = () => new DOMException('The export was cancelled.', 'AbortError');
export const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const throwIfAborted = (signal?: AbortSignal) => { if (signal?.aborted) throw abortError(); };
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>(resolve => { const timer = setTimeout(resolve, 120); requestAnimationFrame(() => { clearTimeout(timer); resolve(); }); });

/** Capture sessions take over the shared shader clock, so only one may be open at a time; the next one waits its turn. */
let stageLock: Promise<void> = Promise.resolve();
async function acquireStage(signal?: AbortSignal): Promise<() => void> {
  let release!: () => void;
  const mine = new Promise<void>(resolve => { release = resolve; });
  const previous = stageLock;
  stageLock = previous.then(() => mine);
  await previous;
  if (signal?.aborted) { release(); throw abortError(); }
  return release;
}

/* ───────────── still projects ───────────── */

class StaticSource implements FrameSource {
  readonly dynamic = false;
  notes: string[] = [];
  private raster: HTMLCanvasElement | null = null;
  private scale = 0;

  constructor(private readonly project: GradientProject, private readonly background: string, private readonly signal?: AbortSignal) {}

  async advanceTo() { /* nothing moves */ }

  async render(ctx: CanvasRenderingContext2D, geometry: RasterGeometry) {
    throwIfAborted(this.signal);
    const { w, h } = this.project.canvas;
    const needed = geometry.fit === 'contain' ? Math.min(geometry.width / w, geometry.height / h) : Math.max(geometry.width / w, geometry.height / h);
    if (!this.raster || this.scale < needed * 0.999) {
      const result = await rasterizeProject({ ...this.project, background: this.background }, Math.max(needed, 0.05));
      this.raster = result.canvas;
      this.scale = needed;
      this.notes = result.notes;
    }
    const rect = fitRect({ width: this.raster.width, height: this.raster.height }, geometry, geometry.fit);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.raster, rect.x, rect.y, rect.width, rect.height);
  }

  dispose() { this.raster = null; }
}

class LivePreviewSource implements FrameSource {
  readonly dynamic = false;
  readonly notes: string[] = [];
  private readonly rasterizer: DomRasterizer;

  constructor(root: HTMLElement, project: GradientProject, private readonly signal?: AbortSignal, background?: string) {
    this.rasterizer = new DomRasterizer({ root, width: project.canvas.w, height: project.canvas.h, background });
  }

  async advanceTo() { /* the preview is still */ }

  async render(ctx: CanvasRenderingContext2D, geometry: RasterGeometry) {
    throwIfAborted(this.signal);
    await this.rasterizer.render(ctx, geometry, 0);
  }

  dispose() {}
}

/* ───────────── moving projects ───────────── */

/** the shortest gap between two stepped frames: the shared renderer ignores frames that come faster than its phone frame cap */
const MIN_SPACING_MS = 34;
/** the longest gap one renderer step may cover (the shader clock itself clamps a step to 50 ms) */
const MAX_SPACING_MS = 48;
const READY_TIMEOUT_MS = 6000;

function hasContent(canvas: HTMLCanvasElement, probe: CanvasRenderingContext2D): boolean {
  if (!canvas.width || !canvas.height) return false;
  probe.clearRect(0, 0, 16, 16);
  try { probe.drawImage(canvas, 0, 0, 16, 16); } catch { return false; }
  const data = probe.getImageData(0, 0, 16, 16).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
  return false;
}

class CaptureSource implements FrameSource {
  readonly dynamic: boolean;
  readonly notes: string[] = [];
  private sceneMs = 0;
  private clockMs = 0;
  private disposed = false;

  private constructor(
    private readonly host: HTMLElement,
    private readonly root: Root,
    private readonly rasterizer: DomRasterizer,
    private readonly gpu: { canvases: number; restore: () => void } | null,
    private readonly signal: AbortSignal | undefined,
    private readonly onStatus: ((message: string) => void) | undefined,
    clockStart: number,
    dynamic: boolean,
    private readonly release: () => void,
  ) {
    this.clockMs = clockStart;
    this.dynamic = dynamic;
  }

  static async open(options: FrameSourceOptions): Promise<CaptureSource> {
    const { project, signal, onStatus } = options;
    const { w, h } = project.canvas;
    const info = animationInfo(project);
    const scheduler = getFrameScheduler();
    const release = await acquireStage(signal);

    // 1. take over the shader clock: pause the live loop so only our steps move time, and freeze adaptive resolution
    let restore: (() => void) | null = null;
    let clockStart = 0;
    if (info.shader) {
      const renderer = getSharedRenderer();
      const budget = renderer.budget;
      const wasPaused = scheduler.isPaused, previousScale = scheduler.timeScale;
      scheduler.setPaused(true);
      scheduler.setTimeScale(0);
      budget.observeFrame = () => false;
      budget.reset();
      renderer.invalidateBudget();
      clockStart = scheduler.clock();
      restore = () => {
        delete (budget as { observeFrame?: unknown }).observeFrame;
        budget.reset();
        renderer.invalidateBudget();
        scheduler.setTimeScale(previousScale);
        scheduler.setPaused(wasPaused);
      };
    }

    // 2. mount the artwork (same component, own scope, off-screen but "visible" to the observers that gate shader drawing)
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;visibility:hidden;pointer-events:none;z-index:-1`;
    document.body.appendChild(host);
    const root = createRoot(host);
    const cleanup = () => { try { root.unmount(); } catch { /* ignore */ } host.remove(); restore?.(); release(); };
    try {
      flushSync(() => root.render(<LayeredArt project={project} rootClass="gs-capture" playing />));
      await nextFrame();
      await nextFrame();
      const art = host.querySelector<HTMLElement>('.gs-art-root');
      if (!art) throw new Error('The artwork could not be prepared for capture.');
      const canvases = Array.from(art.querySelectorAll<HTMLCanvasElement>('canvas.gs-shader-canvas'));

      // 3. let every shader finish compiling and draw its first frame; the clock is held at 0 while that happens
      if (canvases.length) {
        onStatus?.('Preparing shaders…');
        const probe = document.createElement('canvas');
        probe.width = probe.height = 16;
        const probeContext = probe.getContext('2d', { willReadFrequently: true })!;
        const deadline = performance.now() + READY_TIMEOUT_MS;
        let step = clockStart;
        while (performance.now() < deadline) {
          throwIfAborted(signal);
          step += MIN_SPACING_MS;
          scheduler.step(step);
          await sleep(10);
          if (canvases.every(canvas => canvas.parentElement?.classList.contains('gs-webgl-ready') || hasContent(canvas, probeContext))) break;
        }
        clockStart = step;
      }
      try { await document.fonts?.ready; } catch { /* fonts API unavailable */ }
      throwIfAborted(signal);
      const rasterizer = new DomRasterizer({ root: art, width: w, height: h, background: options.background });
      return new CaptureSource(host, root, rasterizer, restore ? { canvases: canvases.length, restore } : null, signal, onStatus, clockStart, info.dynamic, release);
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  private async visible() {
    while (document.visibilityState !== 'visible') {
      throwIfAborted(this.signal);
      this.onStatus?.('Waiting for this tab to be visible…');
      await new Promise<void>(resolve => document.addEventListener('visibilitychange', () => resolve(), { once: true }));
    }
  }

  async advanceTo(sceneMs: number, speed = 1) {
    throwIfAborted(this.signal);
    const delta = sceneMs - this.sceneMs;
    if (delta < -0.5) throw new Error('A capture can only move forward in time.');
    if (this.gpu && this.gpu.canvases && delta > 0.0001) {
      await this.visible();
      const scheduler = getFrameScheduler();
      const real = delta / Math.max(0.01, speed);
      const steps = Math.max(1, Math.ceil(real / MAX_SPACING_MS));
      const spacing = Math.max(MIN_SPACING_MS, real / steps);
      // every step covers `spacing` ms of renderer time; the time scale folds that back to exactly `real` ms per frame
      scheduler.setTimeScale((speed * real) / (steps * spacing));
      for (let k = 0; k < steps; k++) {
        this.clockMs += spacing;
        scheduler.step(this.clockMs);
        if (k % 40 === 39) { await sleep(0); throwIfAborted(this.signal); }
      }
    }
    this.sceneMs = sceneMs;
  }

  async render(ctx: CanvasRenderingContext2D, geometry: RasterGeometry) {
    throwIfAborted(this.signal);
    await this.visible();
    await this.rasterizer.render(ctx, geometry, this.sceneMs);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.root.unmount(); } catch { /* ignore */ }
    this.host.remove();
    this.gpu?.restore();
    this.release();
  }
}

export async function openFrameSource(options: FrameSourceOptions): Promise<FrameSource> {
  const info = animationInfo(options.project);
  if (options.captureStatic && !info.dynamic) {
    const root = document.querySelector<HTMLElement>('.gs-stage .gs-art-root.gs-art, .gs-stage .gs-art-root.gs-after-art');
    if (root) return new LivePreviewSource(root, options.project, options.signal, options.background);
  }
  if (info.dynamic || options.captureStatic) {
    const source = await CaptureSource.open(options);
    if (info.shader) source.notes.push('Shader layers are drawn at their preview resolution (up to about 1.2 megapixels each) and scaled to the export size. Pointer interaction is not recorded.');
    return source;
  }
  return new StaticSource(options.project, options.background, options.signal);
}
