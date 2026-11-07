import type { GL, SharedGpuContext } from './SharedGpuContext';

export interface LutHandle {
  readonly key: string;
  readonly texture: WebGLTexture;
}

interface LutEntry extends LutHandle {
  refs: number;
}

/** two triangles covering clip space: x, y, u, v */
const QUAD = new Float32Array([
  -1, -1, 0, 0,
   1, -1, 1, 0,
  -1,  1, 0, 1,
  -1,  1, 0, 1,
   1, -1, 1, 0,
   1,  1, 1, 1,
]);

/* Owns every GPU object that is not a program.
 *
 *   · ONE vertex buffer for the full-screen quad, shared by every layer and every program;
 *   · palette lookup textures, keyed by their CONTENT: two layers with the same colours share one texture, and a texture is
 *     deleted the moment its last user releases it, so a removed layer never keeps GPU memory;
 *   · deterministic disposal, and a clean "everything is gone" path for a lost context.
 * The preview renders straight into the shared canvas, so no framebuffers or render targets are needed (the count stays 0). */
export class GpuResourceManager {
  private readonly gpu: SharedGpuContext;
  private buffer: WebGLBuffer | null = null;
  private readonly luts = new Map<string, LutEntry>();
  /** textures uploaded and deleted since creation (diagnostics) */
  uploads = 0;

  constructor(gpu: SharedGpuContext) {
    this.gpu = gpu;
  }

  /** The shared full-screen quad (created on first use, and again after a context restore). */
  quad(): WebGLBuffer | null {
    const gl = this.gpu.gl;
    if (!gl || this.gpu.lost) return null;
    if (!this.buffer) {
      const buffer = gl.createBuffer();
      if (!buffer) return null;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
      this.buffer = buffer;
    }
    return this.buffer;
  }

  /** A palette texture for `key` (its content signature). `bake` runs only when the texture does not exist yet. */
  acquireLut(key: string, size: number, bake: () => Uint8Array): LutHandle | null {
    const gl = this.gpu.gl;
    if (!gl || this.gpu.lost) return null;
    const existing = this.luts.get(key);
    if (existing) { existing.refs += 1; return existing; }
    const texture = gl.createTexture();
    if (!texture) return null;
    if (!this.upload(gl, texture, size, bake())) { gl.deleteTexture(texture); return null; }
    const entry: LutEntry = { key, texture, refs: 1 };
    this.luts.set(key, entry);
    return entry;
  }

  releaseLut(handle: LutHandle | null) {
    if (!handle) return;
    const entry = this.luts.get(handle.key);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this.luts.delete(handle.key);
    this.gpu.gl?.deleteTexture(entry.texture);
  }

  private upload(gl: GL, texture: WebGLTexture, size: number, data: Uint8Array): boolean {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    this.uploads += 1;
    return gl.getError() === gl.NO_ERROR;
  }

  stats() {
    return { textures: this.luts.size, buffers: this.buffer ? 1 : 0, framebuffers: 0, renderbuffers: 0 };
  }

  /** The context was lost: every GL object is gone with it. */
  invalidate() {
    this.buffer = null;
    this.luts.clear();
  }

  disposeAll() {
    const gl = this.gpu.gl;
    if (gl) {
      if (this.buffer) gl.deleteBuffer(this.buffer);
      this.luts.forEach(entry => gl.deleteTexture(entry.texture));
    }
    this.buffer = null;
    this.luts.clear();
  }
}
