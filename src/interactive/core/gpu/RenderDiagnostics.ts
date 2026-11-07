/* Rendering diagnostics.
 *
 * Everything here is measured, not guessed:
 *   · counters (layers, contexts, programs, textures, buffers) are read from the managers that own those objects;
 *   · FPS and CPU frame time come from the frame loop (CPU time = time spent inside our render callbacks, NOT GPU time);
 *   · GPU time only exists when the browser offers EXT_disjoint_timer_query(_webgl2); otherwise it is reported as null,
 *     never estimated from CPU time.
 * Timing is collected only while `detailed` is on (the dev overlay turns it on), so production pays for nothing. */

type TimerGl = WebGL2RenderingContext | WebGLRenderingContext;

export interface DiagnosticsCounters {
  shaderLayers: number;
  proceduralLayers: number;
  webglContexts: number;
  programs: number;
  framebuffers: number;
  textures: number;
  buffers: number;
  activeAnimations: number;
  renderedPixels: number;
  /** largest single layer, render pixels */
  largestLayer: { width: number; height: number };
  compileMs: number;
  compiledPrograms: number;
  compileFailures: number;
  pointerEvents: number;
  pointerDeliveries: number;
  globalScale: number;
  effort: number;
}

export interface DiagnosticsSnapshot extends DiagnosticsCounters {
  fps: number;
  /** average CPU time spent in our render callbacks per frame (ms) */
  cpuFrameMs: number;
  /** average GPU time per frame (ms), null when the browser has no timer-query extension */
  gpuFrameMs: number | null;
  gpuTimerSupported: boolean;
  frames: number;
  layersRenderedLastFrame: number;
  timestamp: number;
}

export const EMPTY_COUNTERS: DiagnosticsCounters = {
  shaderLayers: 0, proceduralLayers: 0, webglContexts: 0, programs: 0, framebuffers: 0, textures: 0, buffers: 0,
  activeAnimations: 0, renderedPixels: 0, largestLayer: { width: 0, height: 0 }, compileMs: 0, compiledPrograms: 0,
  compileFailures: 0, pointerEvents: 0, pointerDeliveries: 0, globalScale: 1, effort: 0,
};

const WINDOW = 60;

export class RenderDiagnostics {
  /** collect frame / GPU timing (cheap counters are always available) */
  detailed = false;
  private readonly cpu: number[] = [];
  private readonly intervals: number[] = [];
  private lastTick = 0;
  private frameStart = 0;
  private frames = 0;
  private layersLastFrame = 0;
  private gpuSamples: number[] = [];
  private timer: { ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }; gl: WebGL2RenderingContext } | null = null;
  private timerChecked = false;
  private activeQuery: WebGLQuery | null = null;
  private readonly pending: WebGLQuery[] = [];

  /** Called once per frame-loop tick, before any layer renders. `now` is the rAF timestamp (ms). */
  beginFrame(now: number, gl: TimerGl | null) {
    if (!this.detailed) { this.lastTick = now; return; }
    if (this.lastTick) {
      const interval = now - this.lastTick;
      if (interval > 0 && interval < 250) this.push(this.intervals, interval);
    }
    this.lastTick = now;
    this.frameStart = performance.now();
    this.layersLastFrame = 0;
    this.beginGpu(gl);
  }

  layerRendered() { this.layersLastFrame += 1; }

  endFrame() {
    if (!this.detailed) return;
    this.push(this.cpu, performance.now() - this.frameStart);
    this.frames += 1;
    this.endGpu();
  }

  /** the frame loop went idle: the next interval must not count the idle gap */
  idle() { this.lastTick = 0; }

  private push(list: number[], value: number) {
    list.push(value);
    if (list.length > WINDOW) list.shift();
  }

  private initTimer(gl: TimerGl | null) {
    if (this.timerChecked || !gl) return;
    this.timerChecked = true;
    // WebGL2 timer queries only: the WebGL1 extension is a different API and rarely exposed any more
    const ext = (gl as WebGL2RenderingContext).getExtension?.('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    if (ext && typeof (gl as WebGL2RenderingContext).createQuery === 'function') this.timer = { ext, gl: gl as WebGL2RenderingContext };
  }

  private beginGpu(gl: TimerGl | null) {
    this.initTimer(gl);
    this.collectGpu();
    const timer = this.timer;
    if (!timer || this.activeQuery || this.pending.length > 6) return;
    const query = timer.gl.createQuery();
    if (!query) return;
    timer.gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, query);
    this.activeQuery = query;
  }

  private endGpu() {
    const timer = this.timer;
    if (!timer || !this.activeQuery) return;
    timer.gl.endQuery(timer.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.activeQuery);
    this.activeQuery = null;
  }

  private collectGpu() {
    const timer = this.timer;
    if (!timer) return;
    while (this.pending.length) {
      const query = this.pending[0];
      if (!timer.gl.getQueryParameter(query, timer.gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      const disjoint = timer.gl.getParameter(timer.ext.GPU_DISJOINT_EXT);
      if (!disjoint) this.push(this.gpuSamples, Number(timer.gl.getQueryParameter(query, timer.gl.QUERY_RESULT)) / 1e6);
      timer.gl.deleteQuery(query);
    }
  }

  /** the GL context went away: pending queries are gone with it */
  resetGpu() {
    this.timer = null;
    this.timerChecked = false;
    this.activeQuery = null;
    this.pending.length = 0;
    this.gpuSamples = [];
  }

  snapshot(counters: DiagnosticsCounters): DiagnosticsSnapshot {
    const average = (list: number[]) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
    const interval = average(this.intervals);
    return {
      ...counters,
      fps: interval > 0 ? 1000 / interval : 0,
      cpuFrameMs: average(this.cpu),
      gpuFrameMs: this.gpuSamples.length ? average(this.gpuSamples) : null,
      gpuTimerSupported: this.timer !== null,
      frames: this.frames,
      layersRenderedLastFrame: this.layersLastFrame,
      timestamp: Date.now(),
    };
  }
}
