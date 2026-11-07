import { describe, expect, it } from 'vitest';
import { FrameScheduler, type FrameSchedulerHost } from './FrameScheduler';

/** A host whose frames only happen when the test says so, and which counts how many browser callbacks were queued. */
function fakeHost() {
  let next = 1;
  const queued = new Map<number, (now: number) => void>();
  const host: FrameSchedulerHost & { requested: number; cancelled: number; flush(now?: number): void; readonly queuedCount: number } = {
    requested: 0,
    cancelled: 0,
    raf(callback) { host.requested += 1; const id = next++; queued.set(id, callback); return id; },
    caf(id) { host.cancelled += 1; queued.delete(id); },
    flush(now = 16) { const batch = [...queued.values()]; queued.clear(); batch.forEach(callback => callback(now)); },
    get queuedCount() { return queued.size; },
  };
  return host;
}

describe('FrameScheduler', () => {
  it('drives many callbacks from a single browser frame request', () => {
    const host = fakeHost();
    const scheduler = new FrameScheduler(host);
    const seen: string[] = [];
    scheduler.request(now => seen.push(`a${now}`));
    scheduler.request(now => seen.push(`b${now}`));
    scheduler.request(now => seen.push(`c${now}`));
    expect(host.requested).toBe(1);
    host.flush(33);
    expect(seen).toEqual(['a33', 'b33', 'c33']);
  });
  it('goes idle when nothing is waiting', () => {
    const host = fakeHost();
    const scheduler = new FrameScheduler(host);
    scheduler.request(() => undefined);
    host.flush();
    expect(host.queuedCount).toBe(0);
    expect(scheduler.waiting).toBe(0);
  });
  it('runs a callback that asks for another frame on the next frame, not this one', () => {
    const host = fakeHost();
    const scheduler = new FrameScheduler(host);
    let runs = 0;
    const tick = () => { runs += 1; if (runs < 3) scheduler.request(tick); };
    scheduler.request(tick);
    host.flush();
    expect(runs).toBe(1);
    host.flush();
    expect(runs).toBe(2);
    host.flush();
    expect(runs).toBe(3);
    expect(host.queuedCount).toBe(0);
  });
  it('cancel prevents a callback from running, even from inside the same frame', () => {
    const host = fakeHost();
    const scheduler = new FrameScheduler(host);
    const ran: string[] = [];
    let second = 0;
    scheduler.request(() => { ran.push('first'); scheduler.cancel(second); });
    second = scheduler.request(() => ran.push('second'));
    host.flush();
    expect(ran).toEqual(['first']);
    const only = scheduler.request(() => ran.push('never'));
    scheduler.cancel(only);
    expect(host.queuedCount).toBe(0);
    host.flush();
    expect(ran).toEqual(['first']);
  });
  it('pausing stops the loop and resuming continues with the waiting callbacks', () => {
    const host = fakeHost();
    const scheduler = new FrameScheduler(host);
    let runs = 0;
    scheduler.request(() => { runs += 1; });
    scheduler.setPaused(true);
    expect(host.queuedCount).toBe(0);
    host.flush();
    expect(runs).toBe(0);
    scheduler.setPaused(false);
    host.flush();
    expect(runs).toBe(1);
    expect(scheduler.isPaused).toBe(false);
  });
  it('one failing callback does not stop the others', () => {
    const host = fakeHost();
    const scheduler = new FrameScheduler(host);
    const original = console.error;
    console.error = () => undefined;
    try {
      let ok = false;
      scheduler.request(() => { throw new Error('boom'); });
      scheduler.request(() => { ok = true; });
      host.flush();
      expect(ok).toBe(true);
    } finally { console.error = original; }
  });
  it('keeps a global time scale for renderers to apply', () => {
    const scheduler = new FrameScheduler(fakeHost());
    expect(scheduler.timeScale).toBe(1);
    scheduler.setTimeScale(0.5);
    expect(scheduler.timeScale).toBe(0.5);
    scheduler.setTimeScale(-3);
    expect(scheduler.timeScale).toBe(0);
    scheduler.setTimeScale(Number.NaN);
    expect(scheduler.timeScale).toBe(1);
  });
});
