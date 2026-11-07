/* One animation loop for every renderer.
 *
 * Before this, each InteractiveRenderer called requestAnimationFrame on its own, so a project with N shader layers ran
 * N browser frame callbacks per frame. The scheduler keeps a single requestAnimationFrame alive while anything is
 * waiting for a frame, hands every waiting callback the same timestamp, and goes completely idle (no callback queued with
 * the browser) when nothing is. It is a drop-in replacement for rAF / cAF: `request(cb)` returns an id, `cancel(id)` cancels.
 *
 * Global controls live here so they apply to every layer at once:
 *   setPaused(true)      stops the loop entirely; queued callbacks wait and resume together
 *   setTimeScale(0…n)    a global speed multiplier renderers fold into their own time (0.5 = half speed)
 * One failing callback never stops the others. */

export type FrameCallback = (now: number) => void;

export interface FrameSchedulerHost {
  raf: (callback: (now: number) => void) => number;
  caf: (id: number) => void;
}

const browserHost = (): FrameSchedulerHost | null =>
  typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
    ? { raf: callback => window.requestAnimationFrame(callback), caf: id => window.cancelAnimationFrame(id) }
    : null;

export class FrameScheduler {
  private readonly pending = new Map<number, FrameCallback>();
  private running: Map<number, FrameCallback> | null = null;
  private nextId = 1;
  private handle = 0;
  private paused = false;
  private scale = 1;
  private frames = 0;
  private host: FrameSchedulerHost | null;

  constructor(host?: FrameSchedulerHost) {
    this.host = host ?? browserHost();
  }

  /** Queues `callback` for the next frame. Same contract as requestAnimationFrame (one call, then it is gone). */
  request(callback: FrameCallback): number {
    const id = this.nextId++;
    this.pending.set(id, callback);
    this.ensureLoop();
    return id;
  }

  cancel(id: number): void {
    this.pending.delete(id);
    this.running?.delete(id);
    if (!this.pending.size) this.stopLoop();
  }

  get timeScale(): number { return this.scale; }
  setTimeScale(value: number): void { this.scale = Number.isFinite(value) ? Math.max(0, value) : 1; }

  get isPaused(): boolean { return this.paused; }
  setPaused(value: boolean): void {
    if (this.paused === value) return;
    this.paused = value;
    if (value) this.stopLoop();
    else this.ensureLoop();
  }

  /** Callbacks waiting for a frame (0 means the scheduler is idle). */
  get waiting(): number { return this.pending.size; }
  /** Frames the loop has delivered since creation (handy for tests and diagnostics). */
  get frameCount(): number { return this.frames; }

  private ensureLoop(): void {
    if (this.handle || this.paused || !this.pending.size || !this.host) return;
    this.handle = this.host.raf(this.tick);
  }

  private stopLoop(): void {
    if (!this.handle || !this.host) return;
    this.host.caf(this.handle);
    this.handle = 0;
  }

  private readonly tick = (now: number): void => {
    this.handle = 0;
    if (this.paused) return;
    this.frames += 1;
    // callbacks that ask for another frame while running land in `pending` and run next frame
    const batch = new Map(this.pending);
    this.pending.clear();
    this.running = batch;
    for (const [id, callback] of batch) {
      if (!batch.has(id)) continue;
      try {
        callback(now);
      } catch (error) {
        console.error('Frame callback failed', error);
      }
    }
    this.running = null;
    this.ensureLoop();
  };
}

let shared: FrameScheduler | null = null;
/** The one scheduler every renderer uses. */
export function getFrameScheduler(): FrameScheduler {
  if (!shared) shared = new FrameScheduler();
  return shared;
}
