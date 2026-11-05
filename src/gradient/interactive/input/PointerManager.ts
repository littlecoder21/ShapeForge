import { createPointerEngine, type PointerClick, type PointerEngine, type PointerFrame } from '../rigRuntime';

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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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

/** Listens to pointer events on one canvas and feeds the shared engine (rigRuntime.js). */
export class PointerManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly onChange: () => void;
  private readonly engine: PointerEngine;
  private readonly listeners: Array<[string, EventListener]> = [];
  private rect: DOMRect | null = null;

  constructor(canvas: HTMLCanvasElement, options: PointerOptions) {
    this.canvas = canvas;
    this.onChange = options.onChange;
    this.engine = createPointerEngine(engineOptions(options));
    canvas.style.touchAction = 'none';
    this.listen('pointermove', this.handleMove);
    this.listen('pointerdown', this.handleDown);
    this.listen('pointerup', this.handleUp);
    this.listen('pointercancel', this.handleCancel);
    this.listen('pointerleave', this.handleLeave);
    window.addEventListener('scroll', this.invalidate, { passive: true, capture: true });
  }

  updateOptions(options: Omit<PointerOptions, 'onChange'>) {
    this.engine.setOptions(engineOptions(options));
  }

  /** Called by the renderer when the canvas is resized so pointer events do not force a layout read. */
  invalidateRect() {
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
    this.engine.reset();
  }

  hasActivity() {
    return this.engine.hasActivity();
  }

  destroy() {
    window.removeEventListener('scroll', this.invalidate, { capture: true });
    this.listeners.forEach(([type, listener]) => this.canvas.removeEventListener(type, listener));
    this.listeners.length = 0;
    this.engine.reset();
  }

  private listen(type: string, handler: (event: PointerEvent) => void) {
    const listener: EventListener = event => handler(event as PointerEvent);
    this.canvas.addEventListener(type, listener, { passive: true });
    this.listeners.push([type, listener]);
  }

  private position(event: PointerEvent) {
    // getBoundingClientRect forces layout; cache it between resizes and refresh when scrolled / moved.
    const rect = this.rect ?? (this.rect = this.canvas.getBoundingClientRect());
    if (!rect.width || !rect.height) { this.rect = null; return null; }
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  private readonly invalidate = () => { this.rect = null; };

  private readonly handleMove = (event: PointerEvent) => {
    const position = this.position(event);
    if (!position) return;
    this.engine.move(event.pointerId, position.x, position.y, event.pointerType);
    this.onChange();
  };

  private readonly handleDown = (event: PointerEvent) => {
    this.rect = null;
    const position = this.position(event);
    if (!position) return;
    this.engine.down(event.pointerId, position.x, position.y, event.pointerType);
    this.onChange();
  };

  private readonly handleUp = (event: PointerEvent) => {
    this.engine.up(event.pointerId);
    this.onChange();
  };

  private readonly handleCancel = (event: PointerEvent) => {
    this.engine.up(event.pointerId);
    this.engine.leave(event.pointerId, event.pointerType);
    this.onChange();
  };

  private readonly handleLeave = (event: PointerEvent) => {
    this.rect = null;
    this.engine.leave(event.pointerId, event.pointerType);
    this.onChange();
  };
}
