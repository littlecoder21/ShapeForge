import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FrameScheduler } from './FrameScheduler';
import { InteractiveRenderer } from './InteractiveRenderer';
import { SharedRenderer } from './gpu/SharedRenderer';
import { createFakeGpu } from './gpu/testing/fakeGl';

/* Runs the real layer renderer against a fake GPU: shows what the shared architecture does across layers, without a browser. */

const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const palette = (a: string, b: string) => [{ color: a, position: 0, alpha: 1 }, { color: b, position: 1, alpha: 1 }];

function fakeCanvas(width = 1200, height = 800) {
  const fake = { width, height, clientWidth: width, clientHeight: height, style: {} as Record<string, string> };
  return Object.assign(fake, {
    getContext: (type: string) => type === '2d' ? gpuFake.context2d : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  }) as unknown as HTMLCanvasElement;
}
let gpuFake: ReturnType<typeof createFakeGpu>;
let scheduler: FrameScheduler;
let hub: SharedRenderer;
let now = 0;
const frame = () => { now += 16; scheduler.flush(now); };

beforeEach(() => {
  for (const key of ['window', 'document']) saved[key] = g[key];
  g.window = { devicePixelRatio: 1, location: { search: '' }, localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }), addEventListener: () => undefined, removeEventListener: () => undefined };
  g.document = { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined };
  gpuFake = createFakeGpu({ width: 16, height: 16 });
  scheduler = new FrameScheduler();
  hub = new SharedRenderer({ scheduler, canvasFactory: () => gpuFake.canvas, disposeDelay: 10_000 });
  now = 0;
});
afterEach(() => { hub.dispose(); for (const key of ['window', 'document']) g[key] = saved[key]; });

const layer = (canvas: HTMLCanvasElement, colors = palette('#ff0000', '#0000ff'), over: Record<string, unknown> = {}) =>
  new InteractiveRenderer(canvas, { renderer: hub, palette: colors, settings: { enabled: true, animate: false, interactionEnabled: false, ...over } });

describe('layer renderer on the shared renderer', () => {
  it('draws a layer through the one shared context and copies it into the layer canvas', () => {
    const canvas = fakeCanvas();
    const renderer = layer(canvas);
    frame(); frame();
    expect(renderer.getStatus().status).toBe('ready');
    expect(gpuFake.log.contextsRequested).toEqual(['webgl2']);
    expect(gpuFake.log.draws).toBe(1);
    expect(gpuFake.log.copies.length).toBe(1);
    expect(canvas.width).toBeGreaterThan(0);
    renderer.destroy();
  });

  it('compiles ONE program and uploads ONE palette texture for layers that share them', () => {
    const canvases = [fakeCanvas(), fakeCanvas(), fakeCanvas(), fakeCanvas(), fakeCanvas()];
    const renderers = canvases.map(canvas => layer(canvas));
    frame(); frame();
    expect(gpuFake.log.programsCreated).toBe(1);
    expect(gpuFake.log.linked).toBe(1);
    expect(gpuFake.log.texturesCreated).toBe(1);
    expect(gpuFake.log.draws).toBe(5);
    expect(hub.snapshot().webglContexts).toBe(1);
    renderers.forEach(renderer => renderer.destroy());
  });

  it('gives different palettes their own texture and frees them with the layer', () => {
    const a = layer(fakeCanvas(), palette('#ff0000', '#0000ff'));
    const b = layer(fakeCanvas(), palette('#00ff00', '#ffffff'));
    frame();
    expect(gpuFake.log.texturesCreated).toBe(2);
    a.destroy(); b.destroy();
    expect(gpuFake.log.texturesDeleted).toBe(2);
    expect(hub.programs.stats().programs).toBe(1);
    hub.programs.sweep(true);
    expect(gpuFake.log.programsDeleted).toBe(1);
  });

  it('renders each layer from one shared budget: more layers means a lower render scale each', () => {
    const solo = fakeCanvas();
    const one = layer(solo);
    frame();
    const soloWidth = solo.width;
    const others = [fakeCanvas(), fakeCanvas(), fakeCanvas()].map(canvas => layer(canvas));
    frame(); frame();
    expect(solo.width).toBeLessThan(soloWidth);
    one.destroy(); others.forEach(renderer => renderer.destroy());
  });

  it('re-sends settings only when they changed or another layer used the shared program', () => {
    const canvas = fakeCanvas();
    const renderer = layer(canvas, undefined, { animate: true, speed: 0.5 });
    frame();                                   // first draw: everything goes up
    const first = gpuFake.log.uniformCalls;
    frame();
    const second = gpuFake.log.uniformCalls - first;
    expect(second).toBeLessThan(first / 2);
    renderer.update({ settings: { intensity: 0.4 } });
    const before = gpuFake.log.uniformCalls;
    frame();
    expect(gpuFake.log.uniformCalls - before).toBeGreaterThan(second);
    renderer.destroy();
  });

  it('a layer that is not animated is drawn once and then costs nothing', () => {
    const renderer = layer(fakeCanvas());
    frame(); frame(); frame(); frame();
    expect(gpuFake.log.draws).toBe(1);
    renderer.destroy();
  });

  it('delivers one pointer event to every layer through the hub (no synthetic DOM events)', () => {
    const renderers = [layer(fakeCanvas()), layer(fakeCanvas()), layer(fakeCanvas())];
    frame();
    hub.pointers.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 });
    expect(hub.pointers.events).toBeGreaterThanOrEqual(1);
    expect(hub.pointers.deliveries).toBeGreaterThanOrEqual(3);
    renderers.forEach(renderer => renderer.destroy());
  });

  it('survives a lost and restored context', () => {
    const renderer = layer(fakeCanvas());
    frame();
    gpuFake.fire('webglcontextlost');
    expect(renderer.getStatus().status).toBe('context-lost');
    gpuFake.fire('webglcontextrestored');
    frame(); frame();
    expect(renderer.getStatus().status).toBe('ready');
    renderer.destroy();
  });

  it('removes its pointer and frame registrations when destroyed', () => {
    const renderer = layer(fakeCanvas());
    frame();
    renderer.destroy();
    expect(hub.pointers.size).toBe(0);
    expect(hub.clientCount).toBe(0);
    expect(scheduler.pending.size).toBe(0);
  });
});
