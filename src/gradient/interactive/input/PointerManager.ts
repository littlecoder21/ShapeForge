import { createPointerEngine, type PointerClick, type PointerEngine, type PointerFrame } from '../rigRuntime';
import { getPointerHub, type PointerHub, type PointerKind, type PointerSample, type PointerSink } from '../../../interactive/core/gpu/PointerHub';

export { pointerSmoothingFactor } from '../rigRuntime';
export type { PointerFrame } from '../rigRuntime';

export interface PointerOptions {
  touchEnabled: boolean;
  ripplesEnabled: boolean;
  maximumRipples: number;
  interactionDelay: number;
  physics?: 'smooth' | 'spring';
  stiffness?: number;
  damping?: number;
  trailLife?: number;
  pressAttack?: number;
  pressRelease?: number;
  holdTime?: number;
  onChange: () => void;
}

function engineOptions(options: Omit<PointerOptions, 'onChange'>) {
  return {
    touchEnabled: options.touchEnabled,
    ripplesEnabled: options.ripplesEnabled,
    maximumRipples: options.maximumRipples,
    delay: options.interactionDelay,
    ...(options.physics ? { physics: options.physics } : {}),
    ...(options.stiffness !== undefined ? { stiffness: options.stiffness } : {}),
    ...(options.damping !== undefined ? { damping: options.damping } : {}),
    ...(options.trailLife !== undefined ? { trailLife: options.trailLife } : {}),
    ...(options.pressAttack !== undefined ? { pressAttack: options.pressAttack } : {}),
    ...(options.pressRelease !== undefined ? { pressRelease: options.pressRelease } : {}),
    ...(options.holdTime !== undefined ? { holdTime: options.holdTime } : {}),
  };
}

/** One layer's pointer state: the shared engine (rigRuntime.js) plus this layer's canvas rectangle.
 *  It no longer listens to the DOM itself: the central PointerHub hands it every pointer event once. */
export class PointerManager implements PointerSink {
  private readonly canvas: HTMLCanvasElement;
  private readonly onChange: () => void;
  private readonly engine: PointerEngine;
  private readonly unregister: () => void;
  private readonly activePointers = new Map<number, string>();
  private touchEnabled: boolean;
  private rect: DOMRect | null = null;

  constructor(canvas: HTMLCanvasElement, options: PointerOptions, hub: PointerHub = getPointerHub()) {
    this.canvas = canvas;
    this.onChange = options.onChange;
    this.engine = createPointerEngine(engineOptions(options));
    this.touchEnabled = options.touchEnabled;
    canvas.style.touchAction = 'none';
    this.unregister = hub.register(this);
  }

  updateOptions(options: Omit<PointerOptions, 'onChange'>) {
    this.touchEnabled = options.touchEnabled;
    if (!this.touchEnabled) {
      for (const [id, type] of this.activePointers) {
        if (type === 'touch') {
          this.engine.leave(id, type);
          this.activePointers.delete(id);
        }
      }
    }
    this.engine.setOptions(engineOptions(options));
  }

  /** Called by the renderer when the canvas is resized so pointer events do not force a layout read. */
  invalidateRect() {
    this.rect = null;
  }

  invalidate() {
    this.rect = null;
  }

  getEngine() {
    return this.engine;
  }

  advance(deltaSeconds: number, nowSeconds: number): PointerFrame {
    return this.engine.advance(deltaSeconds, nowSeconds);
  }

  getRipples(): PointerClick[] {
    return this.engine.getClicks();
  }

  reset() {
    this.activePointers.clear();
    this.engine.reset();
  }

  hasPointer() {
    return this.activePointers.size > 0;
  }

  hasActivity() {
    return this.engine.hasActivity();
  }

  destroy() {
    this.unregister();
    this.activePointers.clear();
    this.engine.reset();
  }

  private position(sample: PointerSample) {
    // getBoundingClientRect forces layout; cache it between resizes and refresh when scrolled / moved.
    const rect = this.rect ?? (this.rect = this.canvas.getBoundingClientRect());
    if (!rect.width || !rect.height) { this.rect = null; return null; }
    const x = (sample.clientX - rect.left) / rect.width;
    const y = (sample.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y: 1 - y };
  }

  handle(kind: PointerKind, sample: PointerSample) {
    switch (kind) {
      case 'move': {
        if (sample.pointerType === 'touch' && !this.touchEnabled) {
          this.activePointers.delete(sample.pointerId);
          this.engine.leave(sample.pointerId, sample.pointerType);
          this.onChange();
          return;
        }
        const position = this.position(sample);
        if (!position) {
          if (this.activePointers.has(sample.pointerId)) {
            this.activePointers.delete(sample.pointerId);
            this.engine.leave(sample.pointerId, sample.pointerType);
            this.onChange();
          }
          return;
        }
        this.activePointers.set(sample.pointerId, sample.pointerType);
        this.engine.move(sample.pointerId, position.x, position.y, sample.pointerType);
        break;
      }
      case 'down': {
        this.rect = null;
        const position = this.position(sample);
        if (!position || (sample.pointerType === 'touch' && !this.touchEnabled)) {
          this.activePointers.delete(sample.pointerId);
          this.engine.leave(sample.pointerId, sample.pointerType);
          return;
        }
        this.activePointers.set(sample.pointerId, sample.pointerType);
        this.engine.down(sample.pointerId, position.x, position.y, sample.pointerType);
        break;
      }
      case 'up':
        this.engine.up(sample.pointerId);
        if (sample.pointerType === 'touch') {
          this.activePointers.delete(sample.pointerId);
          this.engine.leave(sample.pointerId, sample.pointerType);
        }
        break;
      case 'cancel':
        this.engine.up(sample.pointerId);
        this.engine.leave(sample.pointerId, sample.pointerType);
        this.activePointers.delete(sample.pointerId);
        break;
      case 'leave':
        this.rect = null;
        this.engine.leave(sample.pointerId, sample.pointerType);
        this.activePointers.delete(sample.pointerId);
        break;
    }
    this.onChange();
  }
}
