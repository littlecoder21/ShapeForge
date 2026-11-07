import type { SharedGpuContext } from './SharedGpuContext';

const COMPLETION_STATUS_KHR = 0x91b1;

export type ProgramState = 'compiling' | 'ready' | 'failed';
export type UniformLocations = Record<string, WebGLUniformLocation | null>;

export interface ProgramSources {
  vertex: string;
  fragment: string;
}

export interface ProgramEntry {
  readonly key: string;
  readonly program: WebGLProgram | null;
  readonly uniforms: UniformLocations;
  positionAttribute: number;
  uvAttribute: number;
  state: ProgramState;
  /** the compiler's message when the program failed */
  error: string;
  /** layers using this program right now */
  refs: number;
  /** wall time from the first compile request until the link finished (includes waiting for the async compiler) */
  compileMs: number;
  /** id of the layer whose uniform values the program currently holds (lets that layer skip re-uploading statics) */
  lastOwner: number;
  idleSince: number;
  readonly requestedAt: number;
  vertexShader: WebGLShader | null;
  fragmentShader: WebGLShader | null;
}

export interface ProgramStats {
  programs: number;
  compiling: number;
  failed: number;
  compiled: number;
  compileMs: number;
}

/** How long an unused program is kept in case the same configuration comes straight back (editing, undo). */
const IDLE_GRACE_MS = 4000;

/* Compiles and caches shader programs for every layer.
 *
 *   · layers with the same structure (same key) share ONE program: it is compiled once and linked once;
 *   · only the key (rig structure, noise quality, distortion types, …) selects a program — colours and sliders are uniforms,
 *     so editing them never reaches this class;
 *   · compilation is asynchronous where the browser supports KHR_parallel_shader_compile, and never blocks a frame;
 *   · a compile failure is remembered for its key, so a failing shader is never retried until the key changes;
 *   · programs nobody uses are deleted after a short grace period; `disposeAll` deletes everything deterministically. */
export class ShaderProgramManager {
  private readonly entries = new Map<string, ProgramEntry>();
  private readonly gpu: SharedGpuContext;
  private readonly now: () => number;
  private compiled = 0;
  private totalCompileMs = 0;

  constructor(gpu: SharedGpuContext, now: () => number = () => performance.now()) {
    this.gpu = gpu;
    this.now = now;
  }

  /** Returns the program for `key`, compiling it first if nobody has needed it yet. Every acquire needs a release. */
  acquire(key: string, build: () => ProgramSources, uniformNames: readonly string[]): ProgramEntry | null {
    const gl = this.gpu.gl;
    if (!gl || this.gpu.lost) return null;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = this.compile(gl, key, build, uniformNames);
      this.entries.set(key, entry);
    }
    entry.refs += 1;
    entry.idleSince = 0;
    return entry;
  }

  release(entry: ProgramEntry | null) {
    if (!entry || entry.refs <= 0) return;
    entry.refs -= 1;
    if (entry.refs === 0) entry.idleSince = this.now();
  }

  /** Advances a program that is still compiling. Never blocks when the parallel-compile extension exists. */
  poll(entry: ProgramEntry): ProgramState {
    const gl = this.gpu.gl;
    if (entry.state !== 'compiling' || !gl || !entry.program) return entry.state;
    if (this.gpu.parallelCompile && !gl.getProgramParameter(entry.program, COMPLETION_STATUS_KHR)) return 'compiling';
    const linked = gl.getProgramParameter(entry.program, gl.LINK_STATUS) as boolean;
    entry.compileMs = this.now() - entry.requestedAt;
    if (!linked) {
      entry.error = (gl.getShaderInfoLog(entry.fragmentShader as WebGLShader) || gl.getShaderInfoLog(entry.vertexShader as WebGLShader) || gl.getProgramInfoLog(entry.program) || '').trim().slice(0, 500);
      entry.state = 'failed';
      this.freeShaders(gl, entry);
      return entry.state;
    }
    this.freeShaders(gl, entry);
    entry.positionAttribute = gl.getAttribLocation(entry.program, 'aPosition');
    entry.uvAttribute = gl.getAttribLocation(entry.program, 'aUv');
    entry.state = 'ready';
    this.compiled += 1;
    this.totalCompileMs += entry.compileMs;
    return entry.state;
  }

  /** Deletes programs that have been unused for longer than the grace period. Call from the frame loop. */
  sweep(force = false): number {
    const gl = this.gpu.gl;
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.refs > 0) continue;
      if (!force && this.now() - entry.idleSince < IDLE_GRACE_MS) continue;
      if (gl) this.destroy(gl, entry);
      this.entries.delete(key);
      removed += 1;
    }
    return removed;
  }

  /** The context was lost: every GL object is gone. Entries are dropped; layers re-acquire after the restore. */
  invalidate() {
    this.entries.clear();
  }

  disposeAll() {
    const gl = this.gpu.gl;
    if (gl) this.entries.forEach(entry => this.destroy(gl, entry));
    this.entries.clear();
  }

  stats(): ProgramStats {
    let compiling = 0;
    let failed = 0;
    this.entries.forEach(entry => { if (entry.state === 'compiling') compiling += 1; else if (entry.state === 'failed') failed += 1; });
    return { programs: this.entries.size, compiling, failed, compiled: this.compiled, compileMs: this.totalCompileMs };
  }

  private compile(gl: NonNullable<SharedGpuContext['gl']>, key: string, build: () => ProgramSources, uniformNames: readonly string[]): ProgramEntry {
    const requestedAt = this.now();
    const uniforms: UniformLocations = {};
    const entry: ProgramEntry = {
      key, program: null, uniforms, positionAttribute: -1, uvAttribute: -1, state: 'compiling', error: '', refs: 0,
      compileMs: 0, lastOwner: -1, idleSince: 0, requestedAt, vertexShader: null, fragmentShader: null,
    };
    try {
      const sources = build();
      const vertex = gl.createShader(gl.VERTEX_SHADER);
      const fragment = gl.createShader(gl.FRAGMENT_SHADER);
      const program = gl.createProgram();
      if (!vertex || !fragment || !program) throw new Error('Could not allocate the WebGL shader program.');
      gl.shaderSource(vertex, sources.vertex);
      gl.compileShader(vertex);
      gl.shaderSource(fragment, sources.fragment);
      gl.compileShader(fragment);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      (entry as { program: WebGLProgram | null }).program = program;
      entry.vertexShader = vertex;
      entry.fragmentShader = fragment;
      // uniform locations resolve lazily, once, after the link (see `locate`)
      this.pendingNames.set(key, uniformNames);
    } catch (error) {
      entry.state = 'failed';
      entry.error = error instanceof Error ? error.message : 'Shader program creation failed.';
      entry.compileMs = this.now() - requestedAt;
    }
    return entry;
  }

  private readonly pendingNames = new Map<string, readonly string[]>();

  /** Resolves the uniform locations of a finished program (once). Safe to call every frame. */
  locate(entry: ProgramEntry): UniformLocations {
    const gl = this.gpu.gl;
    const names = this.pendingNames.get(entry.key);
    if (names && gl && entry.program && entry.state === 'ready') {
      names.forEach(name => { entry.uniforms[name] = gl.getUniformLocation(entry.program as WebGLProgram, name); });
      this.pendingNames.delete(entry.key);
    }
    return entry.uniforms;
  }

  private freeShaders(gl: NonNullable<SharedGpuContext['gl']>, entry: ProgramEntry) {
    if (entry.vertexShader) gl.deleteShader(entry.vertexShader);
    if (entry.fragmentShader) gl.deleteShader(entry.fragmentShader);
    entry.vertexShader = null;
    entry.fragmentShader = null;
  }

  private destroy(gl: NonNullable<SharedGpuContext['gl']>, entry: ProgramEntry) {
    this.freeShaders(gl, entry);
    if (entry.program) gl.deleteProgram(entry.program);
    this.pendingNames.delete(entry.key);
  }
}
