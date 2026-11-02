import { hexToRgb } from '../../engine/color';
import fragmentShaderSource from '../shaders/gradient.frag.glsl?raw';
import vertexShaderSource from '../shaders/gradient.vert.glsl?raw';
import { PointerManager } from '../input/PointerManager';
import { DEFAULT_INTERACTIVE_SETTINGS, DEFAULT_SHADER_GEOMETRY, normalizeInteractiveSettings, type InteractiveRendererStatus, type InteractiveSettings, type InteractiveUpdate, type ShaderGeometry, type ShaderLayerColorBlend, type ShaderMeshPoint, type ShaderStop } from '../types';
import { pointerModeId } from '../pointerModes';
import { bakePaletteLut } from '../paletteLut';
import { UNIFORM_NAMES } from '../uniforms';

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type Uniforms = Record<string, WebGLUniformLocation | null>;

const MAX_STOPS = 8;
const MAX_RIPPLES = 8;
const MAX_MESH_POINTS = 8;
const LUT_SIZE = 512;
const MAX_RENDER_PIXELS = 1_200_000;
const MAX_RENDER_SCALE = 1.25;
const QUALITY_SCALE = { low: 0.55, medium: 0.75, high: 1, ultra: 1.35 } as const;
const STYLE_ID = { flow: 0, aurora: 1, liquid: 2, holographic: 3, plasma: 4, silk: 5, nebula: 6, ribbons: 7, metaballs: 8, contours: 9, smoke: 10, fire: 11 } as const;
const GEOMETRY_ID = { linear: 0, radial: 1, conic: 2, curve: 3, mesh: 4, noise: 5 } as const;
const LAYER_BLEND_ID: Record<ShaderLayerColorBlend, number> = { mix: 0, multiply: 1, screen: 2, overlay: 3, add: 4 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function normalizePalette(stops: ShaderStop[]): ShaderStop[] {
  const valid = stops
    .filter(stop => /^#[0-9a-f]{6}$/i.test(stop.color) && Number.isFinite(stop.position))
    .map(stop => ({
      color: stop.color,
      position: clamp(stop.position, 0, 1),
      alpha: clamp(Number.isFinite(stop.alpha) ? stop.alpha! : 1, 0, 1),
      hard: stop.hard,
      mid: stop.mid,
      curve: stop.curve,
    }))
    .sort((a, b) => a.position - b.position);
  return valid.length ? valid : [
    { color: '#7c5cff', position: 0, alpha: 1 },
    { color: '#22d3ee', position: 1, alpha: 1 },
  ];
}

function shaderSource(source: string, stage: 'vertex' | 'fragment', webgl2: boolean) {
  if (!webgl2) return source;
  if (stage === 'vertex') {
    return `#version 300 es\n${source.replace(/\battribute\b/g, 'in').replace(/\bvarying\b/g, 'out')}`;
  }
  return `#version 300 es\n${source
    .replace(/\bvarying\b/g, 'in')
    .replace(/\bgl_FragColor\b/g, 'fragmentColor')
    .replace(/\btexture2D\b/g, 'texture')
    .replace('precision highp float;', 'precision highp float;\nout vec4 fragmentColor;')}`;
}

export interface InteractiveRendererOptions {
  palette?: ShaderStop[];
  settings?: Partial<InteractiveSettings>;
  geometry?: ShaderGeometry;
  meshPoints?: ShaderMeshPoint[];
  meshBase?: string;
  layerMix?: InteractiveUpdate['layerMix'];
  onStatusChange?: (status: InteractiveRendererStatus, message?: string) => void;
}

export class InteractiveRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly onStatusChange?: InteractiveRendererOptions['onStatusChange'];
  private settings: InteractiveSettings;
  private geometry: ShaderGeometry = { ...DEFAULT_SHADER_GEOMETRY };
  private palette: ShaderStop[];
  private layerMix: NonNullable<InteractiveUpdate['layerMix']>;
  private meshPoints: ShaderMeshPoint[];
  private meshBase: string;
  private readonly pointer: PointerManager;
  private gl: GL | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private paletteTexture: WebGLTexture | null = null;
  private layerMixTexture: WebGLTexture | null = null;
  private uniforms: Uniforms = {};
  private readonly paletteColors = new Float32Array(MAX_STOPS * 4);
  private readonly paletteAlphas = new Float32Array(MAX_STOPS);
  private readonly meshPointData = new Float32Array(MAX_MESH_POINTS * 4);
  private readonly meshColorData = new Float32Array(MAX_MESH_POINTS * 4);
  private readonly rippleData = new Float32Array(MAX_RIPPLES * 4);
  private paletteLut: Uint8Array = new Uint8Array(LUT_SIZE * 4);
  private lutEnabled = false;
  private cachedRippleCount = -1;
  private shaderTime = 0;
  private frameEma = 0;
  private slowFrameCount = 0;
  private adaptiveScale = 1;
  private maxFragmentUniformVectors = 0;
  private positionAttribute = -1;
  private uvAttribute = -1;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private mediaQuery: MediaQueryList | null = null;
  private frameId = 0;
  private previousFrame = 0;
  private clock = 0;
  private paused = false;
  private visible = true;
  private reducedMotion = false;
  private disposed = false;
  private status: InteractiveRendererStatus = 'fallback';
  private message = '';
  private readonly webgl2: boolean;

  constructor(canvas: HTMLCanvasElement, options: InteractiveRendererOptions = {}) {
    this.canvas = canvas;
    this.settings = normalizeInteractiveSettings({ ...DEFAULT_INTERACTIVE_SETTINGS, ...options.settings });
    this.palette = normalizePalette(options.palette ?? []);
    this.layerMix = options.layerMix ?? { palette: [], mode: 'mix', strength: 0, speed: 0 };
    this.meshPoints = (options.meshPoints ?? []).slice(0, MAX_MESH_POINTS);
    this.refreshMeshData();
    this.meshBase = /^#[0-9a-f]{6}$/i.test(options.meshBase ?? '') ? options.meshBase! : '';
    if (options.geometry) {
      this.geometry = {
        kind: options.geometry.kind,
        angle: Number.isFinite(options.geometry.angle) ? options.geometry.angle : DEFAULT_SHADER_GEOMETRY.angle,
        originX: clamp(options.geometry.originX, -100, 200),
        originY: clamp(options.geometry.originY, -100, 200),
        radiusX: clamp(options.geometry.radiusX, 1, 200),
        radiusY: clamp(options.geometry.radiusY, 1, 200),
        space: options.geometry.space,
      };
    }
    this.refreshPaletteData();
    this.onStatusChange = options.onStatusChange;
    this.pointer = new PointerManager(canvas, {
      touchEnabled: this.settings.touchEnabled,
      ripplesEnabled: this.settings.ripplesEnabled,
      maximumRipples: this.settings.maximumRipples,
      interactionDelay: this.settings.interactionDelay,
      onChange: () => this.schedule(),
    });

    const contextOptions: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'default',
    };
    const context2 = canvas.getContext('webgl2', contextOptions);
    const context1 = context2 ? null : canvas.getContext('webgl', contextOptions);
    this.gl = context2 ?? context1;
    this.webgl2 = context2 !== null;

    if (!this.gl) {
      this.setStatus('fallback', 'WebGL is unavailable; the static gradient can remain visible.');
    } else {
      this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
      this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
      try {
        this.createProgram();
        this.observe();
        this.resize();
        this.setStatus('ready', this.paletteNotice());
        this.schedule();
      } catch (error) {
        this.setStatus('error', error instanceof Error ? error.message : 'Shader initialization failed.');
      }
    }
  }

  getStatus() {
    return { status: this.status, message: this.message };
  }

  update(update: InteractiveUpdate) {
    if (update.settings) {
      this.settings = normalizeInteractiveSettings({ ...this.settings, ...update.settings });
      this.frameEma = 0;
      this.slowFrameCount = 0;
      this.adaptiveScale = 1;
      this.pointer.updateOptions({
        touchEnabled: this.settings.touchEnabled,
        ripplesEnabled: this.settings.ripplesEnabled,
        maximumRipples: this.settings.maximumRipples,
        interactionDelay: this.settings.interactionDelay,
      });
      this.resize();
      if (this.status === 'ready') this.setStatus('ready', this.paletteNotice());
    }
    if (update.palette) {
      this.palette = normalizePalette(update.palette);
      this.refreshPaletteData();
      if (this.status === 'ready') this.setStatus('ready', this.paletteNotice());
    }
    if (update.layerMix) {
      this.layerMix = update.layerMix;
      this.refreshLayerMixTexture();
    }
    if (update.geometry) {
      this.geometry = {
        kind: update.geometry.kind,
        angle: Number.isFinite(update.geometry.angle) ? update.geometry.angle : DEFAULT_SHADER_GEOMETRY.angle,
        originX: clamp(update.geometry.originX, -100, 200),
        originY: clamp(update.geometry.originY, -100, 200),
        radiusX: clamp(update.geometry.radiusX, 1, 200),
        radiusY: clamp(update.geometry.radiusY, 1, 200),
        space: update.geometry.space,
      };
      this.refreshPaletteData();
      this.refreshLayerMixTexture();
    }
    if (update.meshPoints) {
      this.meshPoints = update.meshPoints.slice(0, MAX_MESH_POINTS);
      this.refreshMeshData();
    }
    if (update.meshBase !== undefined) this.meshBase = /^#[0-9a-f]{6}$/i.test(update.meshBase) ? update.meshBase : '';
    this.schedule();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.schedule();
  }

  resetInteraction() {
    this.pointer.reset();
    this.schedule();
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.mediaQuery?.removeEventListener('change', this.handleMotionChange);
    window.removeEventListener('resize', this.handleWindowResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.pointer.destroy();
    if (this.gl) {
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      if (this.program) this.gl.deleteProgram(this.program);
      if (this.paletteTexture) this.gl.deleteTexture(this.paletteTexture);
      if (this.layerMixTexture) this.gl.deleteTexture(this.layerMixTexture);
    }
    this.buffer = null;
    this.program = null;
    this.paletteTexture = null;
    this.layerMixTexture = null;
    this.gl = null;
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.paletteTexture = null;
    this.layerMixTexture = null;
    this.setStatus('context-lost', 'WebGL context lost. Waiting for the browser to restore it.');
  };

  private readonly handleContextRestored = () => {
    try {
      const options: WebGLContextAttributes = {
        alpha: true, antialias: false, depth: false, premultipliedAlpha: false, powerPreference: 'default',
      };
      if (this.webgl2) {
        const context = this.canvas.getContext('webgl2', options);
        if (context) this.gl = context;
      } else {
        const context = this.canvas.getContext('webgl', options);
        if (context) this.gl = context;
      }
      if (!this.gl) throw new Error('The WebGL context could not be restored.');
      this.createProgram();
      this.resize();
      this.setStatus('ready');
      this.schedule();
    } catch (error) {
      this.setStatus('error', error instanceof Error ? error.message : 'WebGL context restoration failed.');
    }
  };

  private readonly handleMotionChange = (event: MediaQueryListEvent) => {
    this.reducedMotion = event.matches;
    this.schedule();
  };

  private readonly handleVisibilityChange = () => {
    this.visible = document.visibilityState === 'visible';
    if (this.visible) this.schedule();
    else {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  };

  private setStatus(status: InteractiveRendererStatus, message = '') {
    this.status = status;
    this.message = message;
    this.onStatusChange?.(status, message);
  }

  private paletteNotice() {
    return this.adaptiveScale < 1
      ? `Adaptive resolution reduced to ${Math.round(this.adaptiveScale * 100)}% to maintain performance.`
      : '';
  }

  private observe() {
    this.visible = document.visibilityState === 'visible';
    this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.mediaQuery.matches;
    this.mediaQuery.addEventListener('change', this.handleMotionChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    } else {
      window.addEventListener('resize', this.handleWindowResize);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(entries => {
        this.visible = entries[0]?.isIntersecting ?? true;
        if (this.visible) this.schedule();
        else {
          cancelAnimationFrame(this.frameId);
          this.frameId = 0;
        }
      });
      this.intersectionObserver.observe(this.canvas);
    }
  }

  private readonly handleWindowResize = () => this.resize();

  private resize() {
    if (!this.gl || this.disposed) return;
    const widthCss = this.canvas.clientWidth;
    const heightCss = this.canvas.clientHeight;
    const pixelBudgetScale = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, widthCss * heightCss));
    const scale = clamp(
      Math.min(this.baseResolutionScale() * this.adaptiveScale, MAX_RENDER_SCALE, pixelBudgetScale),
      0.35,
      MAX_RENDER_SCALE,
    );
    const width = Math.max(1, Math.min(4096, Math.round(widthCss * scale)));
    const height = Math.max(1, Math.min(4096, Math.round(heightCss * scale)));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
      this.schedule();
    }
  }

  private baseResolutionScale() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return clamp(dpr * QUALITY_SCALE[this.settings.quality] * this.settings.resolutionScale, 0.35, this.settings.quality === 'ultra' ? 1.75 : 2);
  }

  private createProgram() {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL is unavailable.');
    const vertexSource = shaderSource(vertexShaderSource, 'vertex', this.webgl2);
    const fragmentSource = shaderSource(fragmentShaderSource, 'fragment', this.webgl2);
    const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error('Could not allocate the WebGL shader program.');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const detail = gl.getProgramInfoLog(program)?.trim();
      gl.deleteProgram(program);
      throw new Error(`Could not link the gradient shader${detail ? `: ${detail}` : '.'}`);
    }
    if (this.program) gl.deleteProgram(this.program);
    this.program = program;
    this.uniforms = {};
    this.maxFragmentUniformVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
    UNIFORM_NAMES.forEach(name => { this.uniforms[name] = gl.getUniformLocation(program, name); });

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Could not allocate the WebGL vertex buffer.');
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
      -1,  1, 0, 1,
       1, -1, 1, 0,
       1,  1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.useProgram(program);
    this.positionAttribute = gl.getAttribLocation(program, 'aPosition');
    this.uvAttribute = gl.getAttribLocation(program, 'aUv');
    if (this.positionAttribute < 0 || this.uvAttribute < 0) throw new Error('The gradient shader is missing a required vertex attribute.');
    gl.enableVertexAttribArray(this.positionAttribute);
    gl.vertexAttribPointer(this.positionAttribute, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.uvAttribute);
    gl.vertexAttribPointer(this.uvAttribute, 2, gl.FLOAT, false, 16, 8);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.uploadPaletteTexture(gl);
    this.uploadLayerMixTexture(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.uniform1i(this.uniforms.uPaletteLut ?? null, 0);
  }

  private compileShader(type: number, source: string) {
    const gl = this.gl;
    if (!gl) throw new Error('WebGL is unavailable.');
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not allocate a WebGL shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const detail = gl.getShaderInfoLog(shader)?.trim();
      gl.deleteShader(shader);
      const name = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
      throw new Error(`Could not compile the ${name} shader${detail ? `: ${detail}` : '.'}`);
    }
    return shader;
  }

  private schedule() {
    if (this.disposed || !this.gl || !this.visible || this.frameId || this.status !== 'ready') return;
    this.frameId = requestAnimationFrame(this.render);
  }

  private readonly render = (now: number) => {
    this.frameId = 0;
    const gl = this.gl, program = this.program;
    if (this.disposed || !gl || !program || !this.visible || this.status !== 'ready') return;
    const rawDelta = this.previousFrame ? (now - this.previousFrame) / 1000 : 0;
    const delta = Math.min(0.05, rawDelta);
    this.previousFrame = now;
    this.clock += delta;
    const animated = this.settings.animate && this.settings.speed > 0 && !this.paused && !this.reducedMotion;
    if (animated) this.shaderTime += delta * this.settings.speed;
    else if (!this.settings.animate) this.shaderTime = 0;
    if (rawDelta > 0) {
      this.frameEma = this.frameEma ? this.frameEma * 0.9 + rawDelta * 0.1 : rawDelta;
      this.slowFrameCount = this.frameEma > 0.02 ? this.slowFrameCount + 1 : 0;
      if (this.slowFrameCount >= 18 && this.baseResolutionScale() * this.adaptiveScale > 0.5) {
        this.adaptiveScale = Math.max(
          0.5 / this.baseResolutionScale(),
          this.adaptiveScale * 0.8,
        );
        this.slowFrameCount = 0;
        this.resize();
        this.setStatus('ready', this.paletteNotice());
      }
    }
    const pointer = this.pointer.advance(delta, this.clock);
    this.draw(gl, program, pointer);

    const idleMotion = this.settings.idleMotion && !this.paused && !this.reducedMotion;
    if (animated || idleMotion || this.pointer.hasActivity()) this.schedule();
  };

  private draw(gl: GL, program: WebGLProgram, pointer: ReturnType<PointerManager['advance']>) {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const set1f = (name: string, value: number) => gl.uniform1f(this.uniforms[name] ?? null, value);
    const set2f = (name: string, x: number, y: number) => gl.uniform2f(this.uniforms[name] ?? null, x, y);
    const idlePointer = this.settings.idleMotion && pointer.active < 0.003 && !this.paused && !this.reducedMotion;
    const pointerX = idlePointer ? 0.5 + Math.sin(this.clock * 0.17) * 0.28 : pointer.x;
    const pointerY = idlePointer ? 0.5 + Math.sin(this.clock * 0.23 + 1.4) * 0.24 : pointer.y;
    const pointerActive = idlePointer ? 0.42 : pointer.active;
    set2f('uResolution', this.canvas.width, this.canvas.height);
    set2f('uPointer', pointerX, pointerY);
    set2f('uVelocity', pointer.velocityX, pointer.velocityY);
    set1f('uPointerActive', this.settings.interactionEnabled || idlePointer ? pointerActive : 0);
    set1f('uPointerDown', this.settings.interactionEnabled ? pointer.down : 0);
    set1f('uTime', this.settings.animate ? this.shaderTime : 0);
    set1f('uClock', this.clock);
    set1f('uAspect', this.canvas.width / Math.max(1, this.canvas.height));
    set1f('uStyle', STYLE_ID[this.settings.style]);
    set1f('uGradientKind', GEOMETRY_ID[this.geometry.kind]);
    set1f('uGradientAngle', this.geometry.angle * Math.PI / 180);
    set2f('uGradientOrigin', this.geometry.originX / 100, 1 - this.geometry.originY / 100);
    set2f('uGradientRadius', this.geometry.radiusX / 100, this.geometry.radiusY / 100);
    set1f('uPointerMode', pointerModeId(this.settings.pointerMode));
    set1f('uShaderMix', this.settings.shaderMix);
    const interactionColor = hexToRgb(this.settings.interactionColor);
    gl.uniform3f(this.uniforms.uInteractionColor ?? null, interactionColor.r / 255, interactionColor.g / 255, interactionColor.b / 255);
    const interactionColors = new Float32Array(5 * 3);
    this.settings.interactionColors.slice(0, 5).forEach((color, index) => {
      const rgb = hexToRgb(color);
      interactionColors.set([rgb.r / 255, rgb.g / 255, rgb.b / 255], index * 3);
    });
    gl.uniform3fv(this.uniforms['uInteractionColors[0]'] ?? null, interactionColors);
    set1f('uInteractionColorCount', Math.min(5, this.settings.interactionColors.length));
    set1f('uInteractionColorMix', this.settings.interactionColorMix);
    set1f('uInteractionColorSpeed', this.settings.interactionColorSpeed);
    set1f('uInteractionFalloff', { soft: 0, linear: 1, sharp: 2, gaussian: 3 }[this.settings.interactionFalloff]);
    set1f('uInteractionDistortion', this.settings.interactionDistortion);
    set1f('uInteractionDisplacement', this.settings.interactionDisplacement);
    set1f('uInteractionDisplacementMode', this.settings.interactionDisplacementMode === 'push' ? 0 : 1);
    set1f('uInteractionVelocityReaction', this.settings.interactionVelocityReaction);
    set1f('uInteractionGlitch', this.settings.interactionGlitch);
    set1f('uSpeed', this.settings.speed);
    set1f('uIntensity', this.settings.intensity);
    set1f('uDistortion', this.settings.distortion);
    set1f('uDistortionScale', this.settings.distortionScale);
    set1f('uTurbulence', this.settings.turbulence);
    set1f('uInteractionRadius', this.settings.interactionRadius);
    set1f('uInteractionStrength', this.settings.interactionStrength);
    set1f('uGlow', this.settings.glow);
    set1f('uRippleStrength', this.settings.rippleStrength);
    set1f('uRippleSpeed', this.settings.rippleSpeed);
    set1f('uOctaves', { low: 3, medium: 4, high: 5, ultra: 6 }[this.settings.quality]);
    set1f('uWarpDepth', this.settings.quality === 'low' ? 1 : 2);
    set1f('uWrapMode', this.settings.paletteWrap === 'repeat' ? 2 : 0);
    set1f('uToneMap', this.settings.toneMapping);
    set1f('uVignette', this.settings.vignette);
    set1f('uSheen', this.settings.sheen);
    set1f('uGrain', this.settings.filmGrain);
    set1f('uLutEnabled', this.lutEnabled ? 1 : 0);
    set1f('uLayerMixEnabled', this.layerMixTexture && this.layerMix.palette.length ? 1 : 0);
    set1f('uLayerMixMode', LAYER_BLEND_ID[this.layerMix.mode]);
    set1f('uLayerMixStrength', this.layerMix.strength);
    set1f('uLayerMixSpeed', this.layerMix.speed);
    set1f('uProjectOutput', this.settings.renderBackend === 'webgl' ? 1 : 0);
    gl.uniform1i(this.uniforms.uPaletteLut ?? null, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.layerMixTexture);
    gl.uniform1i(this.uniforms.uLayerMixLut ?? null, 1);
    gl.uniform1f(this.uniforms.uStopCount ?? null, MAX_STOPS);
    gl.uniform4fv(this.uniforms['uPalette[0]'] ?? null, this.paletteColors);
    gl.uniform1fv(this.uniforms['uPaletteAlpha[0]'] ?? null, this.paletteAlphas);

    const meshBase = this.meshBase ? hexToRgb(this.meshBase) : { r: 0, g: 0, b: 0 };
    gl.uniform1f(this.uniforms.uMeshCount ?? null, this.meshPoints.length);
    gl.uniform4f(this.uniforms.uMeshBase ?? null, meshBase.r / 255, meshBase.g / 255, meshBase.b / 255, this.meshBase ? 1 : 0);
    gl.uniform4fv(this.uniforms['uMeshPoints[0]'] ?? null, this.meshPointData);
    gl.uniform4fv(this.uniforms['uMeshColors[0]'] ?? null, this.meshColorData);

    const rippleCount = this.refreshRippleData();
    set1f('uRippleCount', rippleCount);
    gl.uniform4fv(this.uniforms['uRipples[0]'] ?? null, this.rippleData);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private refreshPaletteData() {
    this.paletteLut = bakePaletteLut(this.palette, this.geometry.space ?? 'srgb', LUT_SIZE);
    for (let i = 0; i < MAX_STOPS; i++) {
      const sample = Math.round(i / (MAX_STOPS - 1) * (LUT_SIZE - 1)) * 4;
      const offset = i * 4;
      this.paletteColors[offset] = this.paletteLut[sample] / 255;
      this.paletteColors[offset + 1] = this.paletteLut[sample + 1] / 255;
      this.paletteColors[offset + 2] = this.paletteLut[sample + 2] / 255;
      this.paletteColors[offset + 3] = i / (MAX_STOPS - 1);
      this.paletteAlphas[i] = this.paletteLut[sample + 3] / 255;
    }
    if (this.gl) this.uploadPaletteTexture(this.gl);
  }

  private uploadPaletteTexture(gl: GL) {
    if (!this.paletteTexture) this.paletteTexture = gl.createTexture();
    if (!this.paletteTexture) {
      this.lutEnabled = false;
      return;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.paletteLut);
    this.lutEnabled = gl.getError() === gl.NO_ERROR && this.maxFragmentUniformVectors >= 16;
  }

  private refreshLayerMixTexture() {
    if (this.gl) this.uploadLayerMixTexture(this.gl);
  }

  private uploadLayerMixTexture(gl: GL) {
    if (!this.layerMix.palette.length) {
      if (this.layerMixTexture) gl.deleteTexture(this.layerMixTexture);
      this.layerMixTexture = null;
      return;
    }
    const data = bakePaletteLut(this.layerMix.palette, this.layerMix.space ?? this.geometry.space ?? 'srgb', LUT_SIZE);
    if (!this.layerMixTexture) this.layerMixTexture = gl.createTexture();
    if (!this.layerMixTexture) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.layerMixTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (gl.getError() !== gl.NO_ERROR) {
      gl.deleteTexture(this.layerMixTexture);
      this.layerMixTexture = null;
    }
  }

  private refreshMeshData() {
    this.meshPointData.fill(0);
    this.meshColorData.fill(0);
    this.meshPoints.forEach((point, index) => {
      const color = hexToRgb(point.color);
      this.meshPointData.set([point.x / 100, 1 - point.y / 100, point.size / 100, point.alpha], index * 4);
      this.meshColorData.set([color.r / 255, color.g / 255, color.b / 255, 1], index * 4);
    });
  }

  private refreshRippleData() {
    const ripples = this.settings.ripplesEnabled ? this.pointer.getRipples() : [];
    const start = Math.max(0, ripples.length - MAX_RIPPLES);
    const count = ripples.length - start;
    let changed = count !== this.cachedRippleCount;
    if (!changed) {
      for (let i = 0; i < count; i++) {
        const ripple = ripples[start + i];
        const offset = i * 4;
        if (this.rippleData[offset] !== ripple.x || this.rippleData[offset + 1] !== ripple.y
          || this.rippleData[offset + 2] !== ripple.startedAt || this.rippleData[offset + 3] !== ripple.strength) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      this.rippleData.fill(0);
      for (let i = 0; i < count; i++) {
        const ripple = ripples[start + i];
        this.rippleData.set([ripple.x, ripple.y, ripple.startedAt, ripple.strength], i * 4);
      }
      this.cachedRippleCount = count;
    }
    return count;
  }
}
