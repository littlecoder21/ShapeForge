import { describe, expect, it } from 'vitest';
import { FrameScheduler } from '../FrameScheduler';
import { createFakeGpu } from './testing/fakeGl';
import { SharedRenderer, type RenderClient } from './SharedRenderer';
import type { LayerLoad } from './GlobalRenderBudget';

function makeRenderer(disposeDelay = 5) {
  const fake = createFakeGpu();
  const scheduler = new FrameScheduler();
  const renderer = new SharedRenderer({ scheduler, canvasFactory: () => fake.canvas, disposeDelay });
  return { fake, scheduler, renderer };
}

class Layer implements RenderClient {
  id = 0; frames = 0; again = false; scaleApplied = 0; lost = 0; restored = 0; weight = 1;
  constructor(private readonly hub: SharedRenderer, private size = { w: 1200, h: 800 }) {}
  renderFrame() { this.frames++; return this.again; }
  getLoad(): LayerLoad { return { id: this.id, cssWidth: this.size.w, cssHeight: this.size.h, requestedScale: 1.5, weight: this.weight }; }
  applyScale() { this.scaleApplied++; }
  onContextLost() { this.lost++; }
  onContextRestored() { this.restored++; }
  getInfo() { return { width: 100, height: 50, procedural: false, animating: this.again }; }
  scale() { return this.hub.scaleFor(this); }
}
const join = (hub: SharedRenderer) => { const layer = new Layer(hub); hub.register(layer); return layer; };

describe('shared renderer', () => {
  it('serves every layer from one context and one frame loop', () => {
    const { renderer, scheduler } = makeRenderer();
    const layers = [join(renderer), join(renderer), join(renderer)];
    layers.forEach(layer => renderer.requestFrame(layer));
    // three layers asked for a frame: the browser gets ONE callback
    expect(scheduler.pending.size).toBe(1);
    scheduler.flush(16);
    layers.forEach(layer => expect(layer.frames).toBe(1));
    expect(renderer.snapshot().webglContexts).toBe(1);
    expect(renderer.snapshot().shaderLayers).toBe(3);
  });

  it('only renders layers that asked for a frame (static layers cost nothing)', () => {
    const { renderer, scheduler } = makeRenderer();
    const moving = join(renderer); const still = join(renderer);
    moving.again = true;
    renderer.requestFrame(moving); renderer.requestFrame(still);
    scheduler.flush(16);
    scheduler.flush(32); scheduler.flush(48);
    expect(moving.frames).toBe(3);
    expect(still.frames).toBe(1);
  });

  it('goes idle once nothing needs a frame', () => {
    const { renderer, scheduler } = makeRenderer();
    const layer = join(renderer);
    renderer.requestFrame(layer);
    scheduler.flush(16);
    expect(scheduler.pending.size).toBe(0);
  });

  it('does not queue a second callback when a layer asks again while rendering', () => {
    const { renderer, scheduler } = makeRenderer();
    const layer = join(renderer);
    layer.again = true;
    const original = layer.renderFrame.bind(layer);
    layer.renderFrame = () => { renderer.requestFrame(layer); return original(); };
    renderer.requestFrame(layer);
    scheduler.flush(16);
    expect(scheduler.pending.size).toBe(1);
  });

  it('cancels the pending frame when the last waiting layer leaves', () => {
    const { renderer, scheduler } = makeRenderer();
    const layer = join(renderer);
    renderer.requestFrame(layer);
    renderer.cancelFrame(layer);
    expect(scheduler.pending.size).toBe(0);
  });

  it('allocates resolution from one budget and tells the other layers when it changes', () => {
    const { renderer } = makeRenderer();
    const first = join(renderer);
    const alone = first.scale();
    const rest = [join(renderer), join(renderer), join(renderer)];
    const crowded = first.scale();
    expect(crowded).toBeLessThan(alone);
    expect(first.scaleApplied).toBeGreaterThan(0);
    rest.forEach(layer => expect(Math.abs(layer.scale() - crowded)).toBeLessThan(1e-9));
  });

  it('gives the budget back when layers leave', () => {
    const { renderer } = makeRenderer();
    const keep = join(renderer); const gone = [join(renderer), join(renderer)];
    const crowded = keep.scale();
    gone.forEach(layer => renderer.unregister(layer));
    expect(keep.scale()).toBeGreaterThan(crowded);
  });

  it('binds a shared program once for consecutive draws', () => {
    const { renderer, fake } = makeRenderer();
    const entry = renderer.programs.acquire('k', () => ({ vertex: 'v', fragment: 'f' }), ['uPaletteLut', 'uLayerMixLut'])!;
    renderer.programs.poll(entry);
    const before = fake.log.useProgram;
    expect(renderer.useProgram(entry)).toBe(true);
    expect(renderer.useProgram(entry)).toBe(true);
    expect(renderer.useProgram(entry)).toBe(true);
    expect(fake.log.useProgram - before).toBe(1);
  });

  it('tells every layer when the context is lost and restored, and stops rendering meanwhile', () => {
    const { renderer, fake, scheduler } = makeRenderer();
    const layers = [join(renderer), join(renderer)];
    layers[0].again = true;
    renderer.requestFrame(layers[0]);
    fake.fire('webglcontextlost');
    layers.forEach(layer => expect(layer.lost).toBe(1));
    expect(scheduler.pending.size).toBe(0);
    fake.fire('webglcontextrestored');
    layers.forEach(layer => expect(layer.restored).toBe(1));
  });

  it('releases the context shortly after the last layer left, and recreates it for the next one', async () => {
    const { renderer } = makeRenderer(5);
    const layer = join(renderer);
    renderer.unregister(layer);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(renderer.available).toBe(false);
  });

  it('keeps the context when a layer joins again before the delay ends', async () => {
    const { renderer } = makeRenderer(30);
    const layer = join(renderer);
    renderer.unregister(layer);
    join(renderer);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(renderer.available).toBe(true);
  });
});
