import { getFrameScheduler, type FrameScheduler } from '../FrameScheduler';
import { GlobalRenderBudget, type LayerLoad } from './GlobalRenderBudget';
import { GpuResourceManager } from './GpuResourceManager';
import { getPointerHub, type PointerHub } from './PointerHub';
import { PerfOverlay } from './PerfOverlay';
import { EMPTY_COUNTERS, RenderDiagnostics, type DiagnosticsSnapshot } from './RenderDiagnostics';
import { ShaderProgramManager, type ProgramEntry } from './ShaderProgramManager';
import { SharedGpuContext, type CanvasFactory } from './SharedGpuContext';

/** What a shader layer must provide to be driven by the shared renderer. */
export interface RenderClient {
  /** assigned by `register` */
  id: number;
  /** Draws this layer into the shared canvas and copies it to its own canvas. Returns true when another frame is needed. */
  renderFrame(now: number): boolean;
  /** The layer's current request for the global budget, or null while it needs none (destroyed / not drawable). */
  getLoad(): LayerLoad | null;
  /** The shared budget changed this layer's allocation: resize the layer canvas. */
  applyScale(): void;
  onContextLost(): void;
  onContextRestored(): void;
  /** diagnostics only */
  getInfo(): { width: number; height: number; procedural: boolean; animating: boolean };
}

export interface SharedRendererOptions {
  scheduler?: FrameScheduler;
  canvasFactory?: CanvasFactory;
  /** how long the context is kept after the last layer left (ms) */
  disposeDelay?: number;
}

/* The shared rendering engine of the preview.
 *
 *   ShapeForge preview ── layers (Layer Manager = the existing project model)
 *        │
 *        ▼
 *   SharedRenderer ── ONE WebGL context, ONE frame loop (the existing FrameScheduler), ONE budget, ONE pointer hub
 *        │   ShaderProgramManager  → compiled programs, shared by layers with the same structure
 *        │   GpuResourceManager    → quad buffer + palette textures, shared by content
 *        │   GlobalRenderBudget    → resolution for every layer from one pixel / complexity budget + one frame-time controller
 *        ▼
 *   each layer is drawn into the shared canvas and copied into ITS OWN canvas, which stays in its own CSS layer — so opacity,
 *   blend modes, filters, masks, transforms and stacking with CSS layers are still done by the browser, exactly as before.
 *
 * A layer is only rendered when it asked for a frame (dirty-state rendering): static layers cost nothing until something changes. */
export class SharedRenderer {
  readonly gpu: SharedGpuContext;
  readonly programs: ShaderProgramManager;
  readonly resources: GpuResourceManager;
  readonly diagnostics = new RenderDiagnostics();
  readonly budget = new GlobalRenderBudget();
  readonly pointers: PointerHub = getPointerHub();
  private readonly overlay: PerfOverlay | null;
  private readonly scheduler: FrameScheduler;
  private readonly disposeDelay: number;
  private readonly clients = new Map<number, RenderClient>();
  private readonly dirty = new Set<RenderClient>();
  private allocation = new Map<number, number>();
  private budgetDirty = true;
  private nextId = 1;
  private frameId = 0;
  private lastTick = 0;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lastDrawnPixels = 0;
  private boundProgram: ProgramEntry | null = null;
  private readonly samplersBound = new WeakSet<ProgramEntry>();

  constructor(options: SharedRendererOptions = {}) {
    this.scheduler = options.scheduler ?? getFrameScheduler();
    this.disposeDelay = options.disposeDelay ?? 2000;
    this.gpu = new SharedGpuContext(options.canvasFactory);
    this.programs = new ShaderProgramManager(this.gpu);
    this.resources = new GpuResourceManager(this.gpu);
    this.gpu.onContext({ onLost: this.handleLost, onRestored: this.handleRestored });
    this.overlay = typeof window === 'undefined' ? null : new PerfOverlay(this);
  }

  get available() { return this.gpu.available; }
  get clientCount() { return this.clients.size; }

  /* ───────────── layers ───────────── */

  register(client: RenderClient): number {
    if (this.disposeTimer) { clearTimeout(this.disposeTimer); this.disposeTimer = null; }
    client.id = this.nextId++;
    this.clients.set(client.id, client);
    this.budgetDirty = true;
    return client.id;
  }

  unregister(client: RenderClient) {
    if (!this.clients.delete(client.id)) return;
    this.dirty.delete(client);
    this.allocation.delete(client.id);
    this.budgetDirty = true;
    if (!this.dirty.size) this.stopLoop();
    if (!this.clients.size) {
      this.disposeTimer = setTimeout(() => this.dispose(), this.disposeDelay);
      return;
    }
    // layers left: give the budget back to the rest and shrink the shared buffer when it got much too big
    this.reallocate();
    this.trim();
  }

  /** Asks for a frame for this layer. Many calls in one frame cost one browser callback. */
  requestFrame(client: RenderClient) {
    if (this.disposed || !this.clients.has(client.id)) return;
    this.dirty.add(client);
    if (!this.frameId) this.frameId = this.scheduler.request(this.tick);
  }

  cancelFrame(client: RenderClient) {
    this.dirty.delete(client);
    if (!this.dirty.size) this.stopLoop();
  }

  /* ───────────── program binding ───────────── */

  /** Makes `entry` the current program (with the shared quad attached). Cheap when it already is. */
  useProgram(entry: ProgramEntry): boolean {
    const gl = this.gpu.gl;
    if (!gl || this.gpu.lost || !entry.program || entry.state !== 'ready') return false;
    const quad = this.resources.quad();
    if (!quad) return false;
    if (this.boundProgram !== entry) {
      gl.useProgram(entry.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      if (entry.positionAttribute >= 0) {
        gl.enableVertexAttribArray(entry.positionAttribute);
        gl.vertexAttribPointer(entry.positionAttribute, 2, gl.FLOAT, false, 16, 0);
      }
      if (entry.uvAttribute >= 0) {
        gl.enableVertexAttribArray(entry.uvAttribute);
        gl.vertexAttribPointer(entry.uvAttribute, 2, gl.FLOAT, false, 16, 8);
      }
      const uniforms = this.programs.locate(entry);
      if (!this.samplersBound.has(entry)) {
        gl.uniform1i(uniforms.uPaletteLut ?? null, 0);
        gl.uniform1i(uniforms.uLayerMixLut ?? null, 1);
        this.samplersBound.add(entry);
      }
      this.boundProgram = entry;
    }
    return true;
  }

  /* ───────────── budget ───────────── */

  /** Something that affects the allocation changed (a layer's size, quality or procedural cost). */
  invalidateBudget() {
    this.budgetDirty = true;
  }

  /** The render scale this layer should use right now. */
  scaleFor(client: RenderClient): number {
    if (this.budgetDirty) this.reallocate();
    return this.allocation.get(client.id) ?? 1;
  }

  private reallocate() {
    const loads: LayerLoad[] = [];
    this.clients.forEach(client => { const load = client.getLoad(); if (load) loads.push(load); });
    const previous = this.allocation;
    this.allocation = this.budget.allocate(loads);
    this.budgetDirty = false;
    this.clients.forEach(client => {
      const before = previous.get(client.id);
      const after = this.allocation.get(client.id);
      if (before !== undefined && after !== undefined && before !== after) client.applyScale();
    });
  }

  private trim() {
    let width = 0;
    let height = 0;
    this.clients.forEach(client => { const info = client.getInfo(); width = Math.max(width, info.width); height = Math.max(height, info.height); });
    if (width && height) this.gpu.trimTo(width, height);
  }

  /* ───────────── frame loop ───────────── */

  private readonly tick = (now: number) => {
    this.frameId = 0;
    const gl = this.gpu.gl;
    if (this.disposed || !gl || this.gpu.lost) { this.dirty.clear(); return; }
    this.diagnostics.beginFrame(now, gl);
    // ONE controller judges the real frame interval for every layer (never across an idle gap)
    if (this.lastTick) {
      const seconds = (now - this.lastTick) / 1000;
      if (seconds > 0 && this.budget.observeFrame(seconds)) this.invalidateBudget();
    }
    this.lastTick = now;
    if (this.budgetDirty) this.reallocate();

    const batch = [...this.dirty];
    this.dirty.clear();
    let pixels = 0;
    for (const client of batch) {
      if (!this.clients.has(client.id)) continue;
      let again = false;
      try { again = client.renderFrame(now); } catch (error) { console.error('Shader layer failed', error); }
      this.diagnostics.layerRendered();
      const info = client.getInfo();
      pixels += info.width * info.height;
      if (again && this.clients.has(client.id)) this.dirty.add(client);
    }
    this.lastDrawnPixels = pixels;
    this.diagnostics.endFrame();
    this.programs.sweep();
    // a layer may have asked for a frame while rendering (frameId is already set then): never queue a second callback
    if (this.dirty.size) { if (!this.frameId) this.frameId = this.scheduler.request(this.tick); }
    else { this.lastTick = 0; this.diagnostics.idle(); }
  };

  private stopLoop() {
    if (this.frameId) this.scheduler.cancel(this.frameId);
    this.frameId = 0;
    this.lastTick = 0;
    this.diagnostics.idle();
  }

  /* ───────────── context loss ───────────── */

  private readonly handleLost = () => {
    this.stopLoop();
    this.dirty.clear();
    this.programs.invalidate();
    this.resources.invalidate();
    this.boundProgram = null;
    this.diagnostics.resetGpu();
    this.clients.forEach(client => client.onContextLost());
  };

  private readonly handleRestored = () => {
    this.budgetDirty = true;
    this.boundProgram = null;
    this.clients.forEach(client => client.onContextRestored());
  };

  /* ───────────── diagnostics ───────────── */

  snapshot(): DiagnosticsSnapshot {
    const counters = { ...EMPTY_COUNTERS, largestLayer: { width: 0, height: 0 } };
    this.clients.forEach(client => {
      const info = client.getInfo();
      counters.shaderLayers += 1;
      if (info.procedural) counters.proceduralLayers += 1;
      if (info.animating) counters.activeAnimations += 1;
      counters.renderedPixels += info.width * info.height;
      if (info.width * info.height > counters.largestLayer.width * counters.largestLayer.height) counters.largestLayer = { width: info.width, height: info.height };
    });
    const programs = this.programs.stats();
    const resources = this.resources.stats();
    counters.webglContexts = this.gpu.available ? 1 : 0;
    counters.programs = programs.programs;
    counters.compiledPrograms = programs.compiled;
    counters.compileFailures = programs.failed;
    counters.compileMs = programs.compileMs;
    counters.textures = resources.textures;
    counters.buffers = resources.buffers;
    counters.framebuffers = resources.framebuffers;
    counters.pointerEvents = this.pointers.events;
    counters.pointerDeliveries = this.pointers.deliveries;
    counters.globalScale = this.budget.globalScale;
    counters.effort = this.budget.effort;
    return this.diagnostics.snapshot(counters);
  }

  /** Pixels drawn in the last frame (only layers that actually rendered). */
  get drawnPixels() { return this.lastDrawnPixels; }

  /* ───────────── lifecycle ───────────── */

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.disposeTimer) clearTimeout(this.disposeTimer);
    this.stopLoop();
    this.dirty.clear();
    this.clients.clear();
    this.programs.disposeAll();
    this.resources.disposeAll();
    this.gpu.dispose();
    this.overlay?.dispose();
    if (shared === this) shared = null;
  }
}

let shared: SharedRenderer | null = null;
/** The one shared renderer of the page (created on first use, released shortly after the last layer leaves). */
export function getSharedRenderer(): SharedRenderer {
  if (!shared) shared = new SharedRenderer();
  return shared;
}
