export interface PointerSnapshot {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  active: number;
  down: number;
}

export interface RippleSnapshot {
  x: number;
  y: number;
  startedAt: number;
  strength: number;
}

interface PointerOptions {
  touchEnabled: boolean;
  ripplesEnabled: boolean;
  maximumRipples: number;
  onChange: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class PointerManager {
  private readonly canvas: HTMLCanvasElement;
  private readonly onChange: () => void;
  private options: PointerOptions;
  private target = { x: 0.5, y: 0.5, active: 0, down: 0 };
  private current: PointerSnapshot = { x: 0.5, y: 0.5, velocityX: 0, velocityY: 0, active: 0, down: 0 };
  private ripples: RippleSnapshot[] = [];
  private lastMoveAt = 0;
  private readonly timeOrigin = performance.now() / 1000;
  private readonly listeners: Array<[string, EventListener]> = [];

  constructor(canvas: HTMLCanvasElement, options: PointerOptions) {
    this.canvas = canvas;
    this.options = options;
    this.onChange = options.onChange;
    canvas.style.touchAction = 'none';
    this.listen('pointermove', this.handleMove);
    this.listen('pointerdown', this.handleDown);
    this.listen('pointerup', this.handleUp);
    this.listen('pointercancel', this.handleUp);
    this.listen('pointerleave', this.handleLeave);
  }

  updateOptions(options: Omit<PointerOptions, 'onChange'>) {
    this.options = { ...options, onChange: this.onChange };
    const maximum = Math.max(1, Math.min(8, Math.floor(options.maximumRipples)));
    if (this.ripples.length > maximum) this.ripples = this.ripples.slice(-maximum);
  }

  advance(deltaSeconds: number, nowSeconds: number): PointerSnapshot {
    const smoothing = 1 - Math.exp(-Math.max(0, deltaSeconds) * 12);
    const priorX = this.current.x, priorY = this.current.y;
    this.current.x += (this.target.x - this.current.x) * smoothing;
    this.current.y += (this.target.y - this.current.y) * smoothing;
    this.current.active += (this.target.active - this.current.active) * smoothing;
    this.current.down += (this.target.down - this.current.down) * smoothing;
    const velocityBlend = 1 - Math.exp(-Math.max(0, deltaSeconds) * 8);
    const delta = Math.max(deltaSeconds, 1 / 240);
    const vx = clamp((this.current.x - priorX) / delta, -2, 2);
    const vy = clamp((this.current.y - priorY) / delta, -2, 2);
    this.current.velocityX += (vx - this.current.velocityX) * velocityBlend;
    this.current.velocityY += (vy - this.current.velocityY) * velocityBlend;
    if (this.target.active === 0 && this.current.active < 0.003) this.current.active = 0;
    this.ripples = this.ripples.filter(ripple => nowSeconds - ripple.startedAt < 5);
    return this.current;
  }

  getRipples() {
    return this.ripples;
  }

  reset() {
    this.target = { x: 0.5, y: 0.5, active: 0, down: 0 };
    this.current = { x: 0.5, y: 0.5, velocityX: 0, velocityY: 0, active: 0, down: 0 };
    this.ripples = [];
    this.lastMoveAt = 0;
  }

  hasActivity() {
    return Math.abs(this.target.x - this.current.x) > 0.001
      || Math.abs(this.target.y - this.current.y) > 0.001
      || Math.abs(this.target.active - this.current.active) > 0.003
      || Math.abs(this.target.down - this.current.down) > 0.003
      || Math.abs(this.current.velocityX) > 0.003
      || Math.abs(this.current.velocityY) > 0.003
      || this.ripples.length > 0;
  }

  destroy() {
    this.listeners.forEach(([type, listener]) => this.canvas.removeEventListener(type, listener));
    this.listeners.length = 0;
    this.ripples = [];
  }

  private listen(type: string, handler: (event: PointerEvent) => void) {
    const listener: EventListener = event => handler(event as PointerEvent);
    this.canvas.addEventListener(type, listener, { passive: true });
    this.listeners.push([type, listener]);
  }

  private position(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1),
    };
  }

  private accepts(event: PointerEvent) {
    return event.pointerType !== 'touch' || this.options.touchEnabled;
  }

  private readonly handleMove = (event: PointerEvent) => {
    if (!this.accepts(event)) return;
    const position = this.position(event);
    if (!position) return;
    this.target.x = position.x;
    this.target.y = position.y;
    this.target.active = 1;
    const now = performance.now();
    this.lastMoveAt = now;
    this.onChange();
  };

  private readonly handleDown = (event: PointerEvent) => {
    if (!this.accepts(event)) return;
    const position = this.position(event);
    if (!position) return;
    this.target.x = position.x;
    this.target.y = position.y;
    this.target.active = 1;
    this.target.down = 1;
    if (this.options.ripplesEnabled) {
      const maximum = Math.max(1, Math.min(8, Math.floor(this.options.maximumRipples)));
      this.ripples.push({ ...position, startedAt: performance.now() / 1000 - this.timeOrigin, strength: 1 });
      this.ripples = this.ripples.slice(-maximum);
    }
    this.onChange();
  };

  private readonly handleUp = (event: PointerEvent) => {
    if (!this.accepts(event)) return;
    this.target.down = 0;
    this.onChange();
  };

  private readonly handleLeave = (event: PointerEvent) => {
    if (!this.accepts(event)) return;
    this.target.active = 0;
    this.target.down = 0;
    this.lastMoveAt = 0;
    this.onChange();
  };
}
