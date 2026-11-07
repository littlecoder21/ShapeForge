export type GL = WebGLRenderingContext | WebGL2RenderingContext;

/** The context attributes every ShapeForge shader has always used (the shader output relies on straight alpha). */
export const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  depth: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: 'default',
};

export interface GpuContextListener {
  onLost(): void;
  onRestored(): void;
}

/** Creates the drawing surface. Injectable so tests can run without a browser. */
export type CanvasFactory = () => HTMLCanvasElement | null;
const defaultCanvasFactory: CanvasFactory = () => typeof document === 'undefined' ? null : document.createElement('canvas');

/* The ONE WebGL context of the preview.
 *
 * It renders into a detached canvas. Each shader layer is drawn into a rectangle of that canvas and copied (GPU copy) into the
 * layer's own 2D canvas, so every layer keeps its DOM element — and therefore its CSS blend mode, opacity, filters, mask, transform
 * and stacking order — exactly as before, while the browser only has to manage one GL context instead of one per layer. */
export class SharedGpuContext {
  readonly canvas: HTMLCanvasElement | null;
  gl: GL | null = null;
  webgl2 = false;
  parallelCompile = false;
  lost = false;
  maxFragmentUniformVectors = 0;
  /** how many times a context has been created (1 per page unless the browser forced a restore) */
  contextCount = 0;
  private readonly listeners = new Set<GpuContextListener>();
  private disposed = false;

  constructor(factory: CanvasFactory = defaultCanvasFactory) {
    this.canvas = factory();
    if (!this.canvas) return;
    this.canvas.addEventListener('webglcontextlost', this.handleLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleRestored);
    this.create();
  }

  get available() { return !!this.gl && !this.lost && !this.disposed; }

  private create() {
    const canvas = this.canvas;
    if (!canvas) return;
    const two = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES) as WebGL2RenderingContext | null;
    const one = two ? null : canvas.getContext('webgl', CONTEXT_ATTRIBUTES) as WebGLRenderingContext | null;
    this.gl = two ?? one;
    this.webgl2 = two !== null;
    if (!this.gl) return;
    this.contextCount += 1;
    this.configure(this.gl);
  }

  private configure(gl: GL) {
    this.parallelCompile = !!gl.getExtension('KHR_parallel_shader_compile');
    this.maxFragmentUniformVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
  }

  onContext(listener: GpuContextListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Grows the drawing buffer (never shrinks it here) so a layer of `width × height` fits. Returns the buffer size. */
  ensureSize(width: number, height: number): { width: number; height: number } {
    const canvas = this.canvas;
    const gl = this.gl;
    if (!canvas || !gl) return { width: 0, height: 0 };
    if (canvas.width < width || canvas.height < height) {
      canvas.width = Math.max(canvas.width, width);
      canvas.height = Math.max(canvas.height, height);
    }
    return { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
  }

  /** Shrinks the buffer to what the remaining layers need (called when layers are removed). */
  trimTo(width: number, height: number) {
    const canvas = this.canvas;
    if (!canvas || !this.gl) return;
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    // only worth reallocating when a lot of memory would come back
    if (canvas.width * canvas.height > w * h * 2.2) { canvas.width = w; canvas.height = h; }
  }

  /** Selects the top-left `width × height` rectangle of the buffer (image coordinates) and clears it. */
  beginRect(width: number, height: number): boolean {
    const gl = this.gl;
    if (!gl || this.lost) return false;
    const buffer = this.ensureSize(width, height);
    if (buffer.width < width || buffer.height < height) return false;
    // GL's origin is bottom-left, an image's is top-left: the top-left rectangle starts at (0, bufferHeight - height)
    const y = buffer.height - height;
    gl.viewport(0, y, width, height);
    gl.scissor(0, y, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return true;
  }

  /** Copies the rectangle drawn by `beginRect` into a layer's 2D canvas (must run in the same task as the draw). */
  copyTo(context: CanvasRenderingContext2D, width: number, height: number) {
    const canvas = this.canvas;
    if (!canvas) return;
    context.clearRect(0, 0, width, height);
    context.drawImage(canvas, 0, 0, width, height, 0, 0, width, height);
  }

  private readonly handleLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.listeners.forEach(listener => listener.onLost());
  };

  private readonly handleRestored = () => {
    if (this.disposed) return;
    this.lost = false;
    this.create();
    this.listeners.forEach(listener => listener.onRestored());
  };

  /** Releases the context for good. Browsers cap live contexts, so it is lost explicitly instead of waiting for GC. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas?.removeEventListener('webglcontextlost', this.handleLost);
    this.canvas?.removeEventListener('webglcontextrestored', this.handleRestored);
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
    this.listeners.clear();
    if (this.canvas) { this.canvas.width = 1; this.canvas.height = 1; }
  }
}
