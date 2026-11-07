import { describe, expect, it } from 'vitest';
import { createFakeGpu } from './testing/fakeGl';
import { SharedGpuContext } from './SharedGpuContext';
import { ShaderProgramManager } from './ShaderProgramManager';
import { GpuResourceManager } from './GpuResourceManager';

const setup = (options: Parameters<typeof createFakeGpu>[0] = {}) => {
  const fake = createFakeGpu(options);
  const gpu = new SharedGpuContext(() => fake.canvas);
  let clock = 0;
  const programs = new ShaderProgramManager(gpu, () => clock);
  return { fake, gpu, programs, advance: (ms: number) => { clock += ms; } };
};
const sources = (tag = 'ok') => () => ({ vertex: 'void main(){}', fragment: `void main(){} // ${tag}` });
const names = ['uTime', 'uResolution'] as const;

describe('shader program manager', () => {
  it('creates ONE WebGL context for the page', () => {
    const { fake, gpu } = setup();
    expect(gpu.available).toBe(true);
    expect(fake.log.contextsRequested).toEqual(['webgl2']);
  });

  it('compiles a program once and shares it between layers with the same key', () => {
    const { fake, programs } = setup();
    const a = programs.acquire('k', sources(), names)!;
    const b = programs.acquire('k', sources(), names)!;
    expect(a).toBe(b);
    expect(a.refs).toBe(2);
    expect(fake.log.programsCreated).toBe(1);
    expect(fake.log.linked).toBe(1);
    expect(programs.poll(a)).toBe('ready');
    expect(programs.stats().compiled).toBe(1);
  });

  it('uses different programs for different keys', () => {
    const { fake, programs } = setup();
    programs.acquire('a', sources(), names); programs.acquire('b', sources(), names);
    expect(fake.log.programsCreated).toBe(2);
  });

  it('resolves uniform locations once, after the link', () => {
    const { programs } = setup();
    const entry = programs.acquire('k', sources(), names)!;
    programs.poll(entry);
    const locations = programs.locate(entry);
    expect(Object.keys(locations)).toEqual(['uTime', 'uResolution']);
    expect(programs.locate(entry)).toBe(locations);
  });

  it('does not block while the browser compiles in parallel', () => {
    const { programs, fake } = setup({ parallel: true });
    const entry = programs.acquire('k', sources(), names)!;
    // the fake reports COMPLETION_STATUS true, so it finishes on the first poll without a blocking link query
    expect(programs.poll(entry)).toBe('ready');
    expect(fake.log.linked).toBe(1);
  });

  it('remembers a failed compile and never retries that key', () => {
    const { fake, programs } = setup();
    const first = programs.acquire('bad', sources('FAIL'), names)!;
    expect(programs.poll(first)).toBe('failed');
    expect(first.error).toMatch(/simulated compile failure/);
    const second = programs.acquire('bad', sources('FAIL'), names)!;
    expect(second).toBe(first);
    expect(fake.log.programsCreated).toBe(1);
    expect(programs.stats().failed).toBe(1);
  });

  it('deletes a program after its last user left and the grace period passed', () => {
    const { fake, programs, advance } = setup();
    const entry = programs.acquire('k', sources(), names)!;
    programs.poll(entry);
    programs.release(entry);
    expect(programs.sweep()).toBe(0);
    advance(5000);
    expect(programs.sweep()).toBe(1);
    expect(fake.log.programsDeleted).toBe(1);
    expect(programs.stats().programs).toBe(0);
  });

  it('keeps a program that is still used and reuses one that came back within the grace period', () => {
    const { fake, programs, advance } = setup();
    const entry = programs.acquire('k', sources(), names)!;
    programs.release(entry);
    advance(1000);
    const again = programs.acquire('k', sources(), names)!;
    advance(10000);
    expect(programs.sweep()).toBe(0);
    expect(again).toBe(entry);
    expect(fake.log.programsCreated).toBe(1);
  });

  it('forgets every program when the context is lost', () => {
    const { programs, gpu, fake } = setup();
    programs.acquire('k', sources(), names);
    fake.fire('webglcontextlost');
    expect(gpu.lost).toBe(true);
    programs.invalidate();
    expect(programs.stats().programs).toBe(0);
    expect(programs.acquire('k', sources(), names)).toBeNull();
  });
});

describe('gpu resource manager', () => {
  it('shares palette textures by content and frees them with the last user', () => {
    const { fake, gpu } = setup();
    const resources = new GpuResourceManager(gpu);
    const a = resources.acquireLut('palette-1', 4, () => new Uint8Array(16))!;
    const b = resources.acquireLut('palette-1', 4, () => { throw new Error('must not bake twice'); })!;
    expect(a.texture).toBe(b.texture);
    expect(fake.log.texturesCreated).toBe(1);
    resources.releaseLut(a);
    expect(fake.log.texturesDeleted).toBe(0);
    resources.releaseLut(b);
    expect(fake.log.texturesDeleted).toBe(1);
    expect(resources.stats().textures).toBe(0);
  });

  it('creates the full-screen quad once', () => {
    const { fake, gpu } = setup();
    const resources = new GpuResourceManager(gpu);
    expect(resources.quad()).toBe(resources.quad());
    expect(fake.log.buffersCreated).toBe(1);
    expect(resources.stats().framebuffers).toBe(0);
  });
});

describe('shared drawing surface', () => {
  it('places a layer in the top-left of the image (bottom-left origin in GL)', () => {
    const { fake, gpu } = setup({ width: 100, height: 100 });
    expect(gpu.beginRect(60, 40)).toBe(true);
    expect(fake.log.viewports.at(-1)).toEqual([0, 60, 60, 40]);
    expect(fake.log.scissors.at(-1)).toEqual([0, 60, 60, 40]);
  });

  it('grows the shared buffer to fit the largest layer and never needs one buffer per layer', () => {
    const { fake, gpu } = setup({ width: 10, height: 10 });
    gpu.beginRect(200, 120);
    expect(fake.canvas.width).toBe(200);
    expect(fake.canvas.height).toBe(120);
    gpu.beginRect(50, 50);
    expect(fake.canvas.width).toBe(200);
  });

  it('copies the finished rectangle into the layer canvas', () => {
    const { fake, gpu } = setup();
    gpu.copyTo(fake.context2d, 80, 30);
    expect(fake.log.copies.at(-1)).toEqual([0, 0, 80, 30, 0, 0, 80, 30]);
  });

  it('releases the context on dispose', () => {
    const { gpu } = setup();
    gpu.dispose();
    expect(gpu.available).toBe(false);
  });
});
