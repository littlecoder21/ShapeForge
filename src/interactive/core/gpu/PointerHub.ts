/* Centralised pointer input.
 *
 * Before: every shader layer's PointerManager listened on its own canvas, and the preview stage re-dispatched each real pointer
 * event as a synthetic DOM PointerEvent to every canvas (N allocations + N dispatches per move event).
 * Now: the stage hands the real event to this hub ONCE; the hub calls each registered layer's handler directly. Layers still own
 * their own pointer engines (physics, ripples, trails, multi-touch), so each layer keeps its own interaction behaviour. */

export type PointerKind = 'move' | 'down' | 'up' | 'cancel' | 'leave';

/** the only fields of a pointer event any layer reads (a DOM PointerEvent and a React synthetic event both satisfy it) */
export interface PointerSample {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
}

export interface PointerSink {
  handle(kind: PointerKind, sample: PointerSample): void;
  /** the layout of the sink moved (scroll / resize): drop cached rectangles */
  invalidate(): void;
}

const KIND_BY_TYPE: Record<string, PointerKind> = {
  pointermove: 'move',
  pointerdown: 'down',
  pointerup: 'up',
  pointercancel: 'cancel',
  pointerleave: 'leave',
  pointerout: 'leave',
};

export class PointerHub {
  private readonly sinks = new Set<PointerSink>();
  private scrollAttached = false;
  /** real events received and layer deliveries made (diagnostics) */
  events = 0;
  deliveries = 0;

  /** Registers a layer. Returns the function that removes it again. */
  register(sink: PointerSink): () => void {
    this.sinks.add(sink);
    this.attachScroll();
    return () => this.unregister(sink);
  }

  unregister(sink: PointerSink) {
    this.sinks.delete(sink);
    if (!this.sinks.size) this.detachScroll();
  }

  get size() { return this.sinks.size; }

  /** One real pointer event → every registered layer. Unknown event types are ignored. */
  dispatch(type: string, sample: PointerSample): void {
    const kind = KIND_BY_TYPE[type];
    if (!kind || !this.sinks.size) return;
    this.events += 1;
    for (const sink of this.sinks) {
      this.deliveries += 1;
      try { sink.handle(kind, sample); } catch (error) { console.error('Pointer sink failed', error); }
    }
  }

  invalidateAll() {
    this.sinks.forEach(sink => sink.invalidate());
  }

  private readonly onScroll = () => this.invalidateAll();

  private attachScroll() {
    if (this.scrollAttached || typeof window === 'undefined') return;
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
    this.scrollAttached = true;
  }

  private detachScroll() {
    if (!this.scrollAttached || typeof window === 'undefined') return;
    window.removeEventListener('scroll', this.onScroll, { capture: true });
    this.scrollAttached = false;
  }
}

let shared: PointerHub | null = null;
/** The one pointer hub of the page. */
export function getPointerHub(): PointerHub {
  if (!shared) shared = new PointerHub();
  return shared;
}
