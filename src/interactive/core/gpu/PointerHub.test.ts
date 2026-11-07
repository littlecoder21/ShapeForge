import { describe, expect, it } from 'vitest';
import { PointerHub, type PointerKind, type PointerSample, type PointerSink } from './PointerHub';

const sample: PointerSample = { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 20 };
const sink = (log: string[], name: string, fail = false): PointerSink => ({
  handle: (kind: PointerKind) => { if (fail) throw new Error('boom'); log.push(`${name}:${kind}`); },
  invalidate: () => { log.push(`${name}:invalidate`); },
});

describe('pointer hub', () => {
  it('hands one real event to every registered layer without creating DOM events', () => {
    const hub = new PointerHub();
    const log: string[] = [];
    hub.register(sink(log, 'a')); hub.register(sink(log, 'b')); hub.register(sink(log, 'c'));
    hub.dispatch('pointermove', sample);
    expect(log).toEqual(['a:move', 'b:move', 'c:move']);
    expect(hub.events).toBe(1);
    expect(hub.deliveries).toBe(3);
  });

  it('maps the pointer event types and ignores unknown ones', () => {
    const hub = new PointerHub();
    const log: string[] = [];
    hub.register(sink(log, 'a'));
    ['pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'click'].forEach(type => hub.dispatch(type, sample));
    expect(log).toEqual(['a:down', 'a:up', 'a:cancel', 'a:leave']);
  });

  it('stops delivering to a layer that unregistered', () => {
    const hub = new PointerHub();
    const log: string[] = [];
    const unregister = hub.register(sink(log, 'a'));
    hub.register(sink(log, 'b'));
    unregister();
    hub.dispatch('pointermove', sample);
    expect(log).toEqual(['b:move']);
    expect(hub.size).toBe(1);
  });

  it('keeps the other layers working when one layer throws', () => {
    const hub = new PointerHub();
    const log: string[] = [];
    const original = console.error; console.error = () => undefined;
    hub.register(sink(log, 'bad', true)); hub.register(sink(log, 'good'));
    hub.dispatch('pointermove', sample);
    console.error = original;
    expect(log).toEqual(['good:move']);
  });

  it('invalidates every layer rectangle at once', () => {
    const hub = new PointerHub();
    const log: string[] = [];
    hub.register(sink(log, 'a')); hub.register(sink(log, 'b'));
    hub.invalidateAll();
    expect(log).toEqual(['a:invalidate', 'b:invalidate']);
  });
});
