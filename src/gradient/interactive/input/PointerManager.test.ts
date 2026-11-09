import { describe, expect, it, vi } from 'vitest';
import { PointerHub } from '../../../interactive/core/gpu/PointerHub';
import { PointerManager, type PointerOptions } from './PointerManager';

const options = (touchEnabled = true): PointerOptions => ({
  touchEnabled,
  ripplesEnabled: true,
  maximumRipples: 5,
  interactionDelay: 85,
  onChange: vi.fn(),
});

function createManager(touchEnabled = true) {
  const canvas = {
    style: {},
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 80 }),
  } as unknown as HTMLCanvasElement;
  const manager = new PointerManager(canvas, options(touchEnabled), new PointerHub());
  return manager;
}

describe('pointer manager live input tracking', () => {
  it('only considers mouse input active while it is over the canvas', () => {
    const manager = createManager();
    manager.handle('move', { pointerId: 1, pointerType: 'mouse', clientX: 50, clientY: 50 });
    expect(manager.hasPointer()).toBe(true);

    manager.handle('move', { pointerId: 1, pointerType: 'mouse', clientX: 120, clientY: 50 });
    expect(manager.hasPointer()).toBe(false);
    manager.destroy();
  });

  it('clears touch input on pointer-up even when no pointer-leave is received', () => {
    const manager = createManager();
    manager.handle('down', { pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 50 });
    expect(manager.hasPointer()).toBe(true);

    manager.handle('up', { pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 50 });
    expect(manager.hasPointer()).toBe(false);
    manager.destroy();
  });

  it('does not track touch input when touch interaction is disabled', () => {
    const manager = createManager(false);
    manager.handle('down', { pointerId: 3, pointerType: 'touch', clientX: 50, clientY: 50 });
    expect(manager.hasPointer()).toBe(false);
    manager.destroy();
  });
});
