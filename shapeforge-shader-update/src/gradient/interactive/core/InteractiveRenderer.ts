import { hexToRgb } from '../../engine/color';
import fragmentShaderTemplate from '../shaders/gradient.frag.glsl?raw';
import vertexShaderSource from '../shaders/gradient.vert.glsl?raw';
import { PointerManager } from '../input/PointerManager';
import { assembleFragmentShader } from '../rig/glsl';
import { activeRules, rigSignature, type InteractionRig } from '../rig/model';
import { createRigBuffers, evaluateRig, idleMotionPoint, packTrail, type PointerFrame } from '../rigRuntime';
import { resolveStyleParams, SHADER_STYLE_INDEX } from '../styles';
import { DEFAULT_INTERACTIVE_SETTINGS, DEFAULT_SHADER_GEOMETRY, normalizeInteractiveSettings, type InteractiveLayerState, type InteractiveRendererStatus, type InteractiveSettings, type InteractiveUpdate, type ShaderGeometry, type ShaderLayerColorBlend, type ShaderMeshPoint, type ShaderStop } from '../types';
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
const QUALITY_OCTAVES = { low: 3, medium: 4, high: 5, ultra: 6 } as const;
const GEOMETRY_ID = { linear: 0, radial: 1, conic: 2, curve: 3, mesh: 4, noise: 5 } as const;
const LAYER_BLEND_ID: Record<ShaderLayerColorBlend, number> = { mix: 0, multiply: 1, screen: 2, overlay: 3, add: 4 };
const COMPLETION_STATUS_KHR = 0x91b1;
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

function normalizeGeometry(geometry: ShaderGeometry): ShaderGeometry {
  return {
    kind: geometry.kind,
    angle: Number.isFinite(geometry.angle) ? geometry.angle : DEFAULT_SHADER_GEOMETRY.angle,
    originX: clamp(geometry.originX, -100, 200),
    originY: clamp(geometry.originY, -100, 200),
    radiusX: clamp(geometry.radiusX, 1, 200),
    radiusY: clamp(geometry.radiusY, 1, 200),
    space: geometry.space,
  };
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

/** Cheap structural comparison so identical updates never touch the GPU. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) if (!sameValue(left[key], right[key])) return false;
  return true;
}

export interface InteractiveRendererOptions {
  palette?: ShaderStop[];
  settings?: Partial<InteractiveSettings>;
  layer?: Partial<InteractiveLayerState>;
  geometry?: ShaderGeometry;
  meshPoints?: ShaderMeshPoint[];
  meshBase?: string;
  layerMix?: InteractiveUpdate['layerMix'];
  onStatusChange?: (status: InteractiveRendererStatus, message?: string) => void;
}

interface PendingBuild {
  program: WebGLProgram;
  vertex: WebGLShader;
  fragment: WebGLShader;
  key: string;
  withRig: boolean;
}

export class InteractiveRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly onStatusChange?: InteractiveRendererOptions['onStatusChange'];
  private settings: InteractiveSettings;
  private layerState: InteractiveLayerState = { styleParams: resolveStyleParams('flow'), reaction: 1 };
  private geometry: ShaderGeometry = { ...DEFAULT_SHADER_GEOMETRY };
  private palette: ShaderStop[];
  private layerMix: NonNullable<InteractiveUpdate['layerMix']>;
  private meshPoints: ShaderMeshPoint[];
  private meshBase: string;
  private readonly pointer: PointerManager;
  private gl: GL | null = null;
  private program: WebGLProgram | null = null;
  private pending: PendingBuild | null = null;
  private builtKey = '';
  private failedKey = '';
  private parallelCompile = false;
  private buffer: WebGLBuffer | null = null;
  private paletteTexture: WebGLTexture | null = null;
  private layerMixTexture: WebGLTexture | null = null;
  private uniforms: Uniforms = {};
  private readonly paletteColors = new Float32Array(MAX_STOPS * 4);
  private readonly paletteAlphas = new Float32Array(MAX_STOPS);
  private readonly meshPointData = new Float32Array(MAX_MESH_POINTS * 4);
  private readonly meshColorData = new Float32Array(MAX_MESH_POINTS * 4);
  private readonly rippleData = new Float32Array(MAX_RIPPLES * 4);
  private readonly interactionColorData = new Float32Array(5 * 3);
  private interactionColor: [number, number, number] = [1, 1, 1];
  private meshBaseRgb: [number, number, number] = [0, 0, 0];
  private readonly rigBuffers = createRigBuffers();
  private readonly rigFrame: PointerFrame = {
    x: 0.5, y: 0.5, vx: 0, vy: 0, active: 0, down: 0, press: 0, speed: 0, hold: 0, sinceClick: 1e6, clock: 0, trailLife: 0.9,
    t2x: 0.5, t2y: 0.5, t2active: 0, pinch: 0, twist: 0,
  };
  private rigAmbient = false;
  private paletteLut: Uint8Array = new Uint8Array(LUT_SIZE * 4);
  private paletteKey = '';
  private layerMixKey = '';
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
    this.layerState = {
      styleParams: resolveStyleParams(this.settings.style, options.layer?.styleParams),
      reaction: options.layer?.reaction ?? 1,
    };
    this.palette = normalizePalette(options.palette ?? []);
    this.layerMix = options.layerMix ?? { palette: [], mode: 'mix', strength: 0, speed: 0 };
    this.meshPoints = (options.meshPoints ?? []).slice(0, MAX_MESH_POINTS);
    this.refreshMeshData();
    this.meshBase = /^#[0-9a-f]{6}$/i.test(options.meshBase ?? '') ? options.meshBase! : '';
    this.refreshMeshBase();
    if (options.geometry) this.geometry = normalizeGeometry(options.geometry);
    this.refreshPaletteData();
    this.refreshInteractionColors();
    this.refreshRigFlags();
    this.onStatusChange = options.onStatusChange;
    this.pointer = new PointerManager(canvas, this.pointerOptions());

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
        this.parallelCompile = !!this.gl.getExtension('KHR_parallel_shader_compile');
        this.initGeometryAndTextures(this.gl);
        this.observe();
        this.resize();
        this.beginBuild(true);
        this.setStatus('compiling', 'Compiling the gradient shader…');
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
    let needsResize = false;
    if (update.settings) {
      const next = normalizeInteractiveSettings({ ...this.settings, ...update.settings });
      if (!sameValue(next, this.settings)) {
        const previous = this.settings;
        this.settings = next;
        // Only a change of quality / resolution should restart adaptive resolution; slider drags must not.
        if (previous.quality !== next.quality || previous.resolutionScale !== next.resolutionScale) {
          this.frameEma = 0;
          this.slowFrameCount = 0;
          this.adaptiveScale = 1;
          needsResize = true;
        }
        if (!sameValue(previous.interactionColors, next.interactionColors) || previous.interactionColor !== next.interactionColor) this.refreshInteractionColors();
        if (previous.style !== next.style) this.layerState = { ...this.layerState, styleParams: resolveStyleParams(next.style, this.layerState.styleParams) };
        this.pointer.updateOptions(this.pointerOptions());
        this.refreshRigFlags();
        this.ensureBuild();
        if (this.status === 'ready') this.setStatus('ready', this.paletteNotice());
      }
    }
    if (update.layer) {
      this.layerState = {
        styleParams: resolveStyleParams(this.settings.style, update.layer.styleParams ?? this.layerState.styleParams),
        reaction: update.layer.reaction ?? this.layerState.reaction,
      };
    }
    if (update.palette) {
      const palette = normalizePalette(update.palette);
      if (!sameValue(palette, this.palette)) {
        this.palette = palette;
        this.refreshPaletteData();
        if (this.status === 'ready') this.setStatus('ready', this.paletteNotice());
      }
    }
    if (update.layerMix && !sameValue(update.layerMix, this.layerMix)) {
      this.layerMix = update.layerMix;
      this.refreshLayerMixTexture();
    }
    if (update.geometry) {
      const geometry = normalizeGeometry(update.geometry);
      if (!sameValue(geometry, this.geometry)) {
        this.geometry = geometry;
        this.refreshPaletteData();
        this.refreshLayerMixTexture();
      }
    }
    if (update.meshPoints && !sameValue(update.meshPoints, this.meshPoints)) {
      this.meshPoints = update.meshPoints.slice(0, MAX_MESH_POINTS);
      this.refreshMeshData();
    }
    if (update.meshBase !== undefined) {
      const base = /^#[0-9a-f]{6}$/i.test(update.meshBase) ? update.meshBase : '';
      if (base !== this.meshBase) { this.meshBase = base; this.refreshMeshBase(); }
    }
    if (needsResize) this.resize();
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
    const gl = this.gl;
    if (gl) {
      this.discardPending(gl);
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
      if (this.paletteTexture) gl.deleteTexture(this.paletteTexture);
      if (this.layerMixTexture) gl.deleteTexture(this.layerMixTexture);
      // Browsers cap live WebGL contexts (about 16). Releasing explicitly stops removed shader layers from
      // pushing the remaining layers' contexts out ("too many active WebGL contexts") while garbage collection lags.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.buffer = null;
    this.program = null;
    this.paletteTexture = null;
    this.layerMixTexture = null;
    this.gl = null;
  }

  /* ───────────── program building ───────────── */

  private pointerOptions() {
    const { physics } = this.settings.rig;
    return {
      touchEnabled: this.settings.touchEnabled,
      ripplesEnabled: this.settings.ripplesEnabled,
      maximumRipples: this.settings.maximumRipples,
      interactionDelay: this.settings.interactionDelay,
      physics: physics.mode,
      stiffness: physics.stiffness,
      damping: physics.damping,
      trailLife: physics.trailLife,
      pressAttack: physics.pressAttack,
      pressRelease: physics.pressRelease,
      holdTime: physics.holdTime,
      onChange: () => this.schedule(),
    };
  }

  private desiredKey(withRig: boolean) {
    const octaves = QUALITY_OCTAVES[this.settings.quality];
    const depth = this.settings.quality === 'low' ? 1 : 2;
    return `${withRig ? rigSignature(this.settings.rig) : 'base'}#${octaves}#${depth}`;
  }

  /** Starts a new compile when the structure of the interaction (or the quality) changed. */
  private ensureBuild() {
    if (!this.gl || this.disposed) return;
    const key = this.desiredKey(true);
    if (key === this.builtKey || key === this.pending?.key || key === this.failedKey) return;
    this.beginBuild(true);
  }

  private beginBuild(withRig: boolean) {
    const gl = this.gl;
    if (!gl) return;
    this.discardPending(gl);
    const rig: InteractionRig | null = withRig ? this.settings.rig : null;
    const octaves = QUALITY_OCTAVES[this.settings.quality];
    const warpDepth = this.settings.quality === 'low' ? 1 : 2;
    const fragmentSource = shaderSource(assembleFragmentShader(fragmentShaderTemplate, rig, { octaves, warpDepth }), 'fragment', this.webgl2);
    const vertexSource = shaderSource(vertexShaderSource, 'vertex', this.webgl2);
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) throw new Error('Could not allocate the WebGL shader program.');
    gl.shaderSource(vertex, vertexSource);
    gl.compileShader(vertex);
    gl.shaderSource(fragment, fragmentSource);
    gl.compileShader(fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    this.pending = { program, vertex, fragment, key: this.desiredKey(withRig), withRig };
  }

  private discardPending(gl: GL) {
    const pending = this.pending;
    if (!pending) return;
    gl.deleteProgram(pending.program);
    gl.deleteShader(pending.vertex);
    gl.deleteShader(pending.fragment);
    this.pending = null;
  }

  /** Returns true while the build is still running. Finishing never blocks when parallel compile is available. */
  private pollBuild(): boolean {
    const gl = this.gl;
    const pending = this.pending;
    if (!gl || !pending) return false;
    if (this.parallelCompile && !gl.getProgramParameter(pending.program, COMPLETION_STATUS_KHR)) return true;
    const linked = gl.getProgramParameter(pending.program, gl.LINK_STATUS) as boolean;
    if (!linked) {
      const detail = (gl.getShaderInfoLog(pending.fragment) || gl.getProgramInfoLog(pending.program) || '').trim().slice(0, 500);
      this.discardPending(gl);
      if (pending.withRig) {
        // The interaction rig could not run here: keep the gradient alive without it and say why.
        this.failedKey = pending.key;
        this.beginBuild(false);
        this.message = `Interaction effects could not compile on this device${detail ? `: ${detail}` : '.'}`;
        return true;
      }
      this.setStatus('error', `Could not compile the gradient shader${detail ? `: ${detail}` : '.'}`);
      return false;
    }
    gl.deleteShader(pending.vertex);
    gl.deleteShader(pending.fragment);
    const previous = this.program;
    this.program = pending.program;
    this.builtKey = pending.key;
    this.pending = null;
    if (previous) gl.deleteProgram(previous);
    this.bindProgram(gl, pending.program);
    const message = !pending.withRig && this.failedKey ? this.message : this.paletteNotice();
    this.setStatus('ready', message);
    return false;
  }

  private bindProgram(gl: GL, program: WebGLProgram) {
    this.uniforms = {};
    UNIFORM_NAMES.forEach(name => { this.uniforms[name] = gl.getUniformLocation(program, name); });
    gl.useProgram(program);
    this.positionAttribute = gl.getAttribLocation(program, 'aPosition');
    this.uvAttribute = gl.getAttribLocation(program, 'aUv');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (this.positionAttribute >= 0) {
      gl.enableVertexAttribArray(this.positionAttribute);
      gl.vertexAttribPointer(this.positionAttribute, 2, gl.FLOAT, false, 16, 0);
    }
    if (this.uvAttribute >= 0) {
      gl.enableVertexAttribArray(this.uvAttribute);
      gl.vertexAttribPointer(this.uvAttribute, 2, gl.FLOAT, false, 16, 8);
    }
    gl.uniform1i(this.uniforms.uPaletteLut ?? null, 0);
    gl.uniform1i(this.uniforms.uLayerMixLut ?? null, 1);
  }

  private initGeometryAndTextures(gl: GL) {
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
    this.maxFragmentUniformVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.uploadPaletteTexture(gl);
    this.uploadLayerMixTexture(gl);
  }

  /* ───────────── lifecycle ───────────── */

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.paletteTexture = null;
    this.layerMixTexture = null;
    this.pending = null;
    this.program = null;
    this.builtKey = '';
    this.setStatus('context-lost', 'WebGL context lost. Waiting for the browser to restore it.');
  };

  private readonly handleContextRestored = () => {
    try {
      const options: WebGLContextAttributes = {
        alpha: true, antialias: false, depth: false, premultipliedAlpha: false, powerPreference: 'default',
      };
      const context = this.webgl2 ? this.canvas.getContext('webgl2', options) : this.canvas.getContext('webgl', options);
      if (context) this.gl = context;
      if (!this.gl) throw new Error('The WebGL context could not be restored.');
      this.parallelCompile = !!this.gl.getExtension('KHR_parallel_shader_compile');
      this.failedKey = '';
      this.initGeometryAndTextures(this.gl);
      this.resize();
      this.beginBuild(true);
      this.setStatus('compiling', 'Compiling the gradient shader…');
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
    if (this.status === status && this.message === message) return;
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
    this.pointer.invalidateRect();
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

  private schedule() {
    if (this.disposed || !this.gl || !this.visible || this.frameId) return;
    if (this.status !== 'ready' && this.status !== 'compiling') return;
    this.frameId = requestAnimationFrame(this.render);
  }

  private readonly render = (now: number) => {
    this.frameId = 0;
    const gl = this.gl;
    if (this.disposed || !gl || !this.visible) return;
    if (this.pending) {
      // Keep drawing the previous program while a new one compiles; never block the main thread on a compile.
      if (this.pollBuild() || this.pending) {
        if (!this.program) { this.schedule(); return; }
      }
    }
    const program = this.program;
    if (!program || this.status === 'error' || this.status === 'context-lost') return;
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
    const ambient = !this.paused && !this.reducedMotion && (this.rigAmbient || this.settings.breath > 0);
    const hovering = this.rigRuleCount() > 0 && pointer.active > 0.003;
    if (animated || idleMotion || ambient || hovering || this.pointer.hasActivity() || this.pending) this.schedule();
  };

  private rigRuleCount() {
    return activeRules(this.settings.rig).length;
  }

  private refreshRigFlags() {
    this.rigAmbient = activeRules(this.settings.rig).some(rule => rule.source === 'orbit' || rule.source === 'fixed'
      || (rule.source === 'symmetry' && rule.sp2 !== 0) || rule.drives.some(item => item.source.startsWith('lfo')));
  }

  /* ───────────── drawing ───────────── */

  private draw(gl: GL, program: WebGLProgram, pointer: PointerFrame) {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const settings = this.settings;
    const reaction = this.layerState.reaction;
    const reacts = settings.interactionEnabled && reaction !== 0;
    const set1f = (name: string, value: number) => gl.uniform1f(this.uniforms[name] ?? null, value);
    const set2f = (name: string, x: number, y: number) => gl.uniform2f(this.uniforms[name] ?? null, x, y);
    const idlePointer = settings.idleMotion && pointer.active < 0.003 && !this.paused && !this.reducedMotion;
    const idle = idlePointer ? idleMotionPoint(settings.idlePath, this.clock, settings.idleSpeed, settings.idleSize) : null;
    const pointerX = idle ? idle.x : pointer.x;
    const pointerY = idle ? idle.y : pointer.y;
    const pointerActive = idle ? 0.42 : pointer.active;

    set2f('uResolution', this.canvas.width, this.canvas.height);
    set2f('uPointer', pointerX, pointerY);
    set2f('uVelocity', pointer.vx, pointer.vy);
    set1f('uPointerActive', reacts || idlePointer ? pointerActive : 0);
    set1f('uPointerDown', reacts ? pointer.down : 0);
    set1f('uTime', settings.animate ? this.shaderTime : 0);
    set1f('uClock', this.clock);
    set1f('uAspect', this.canvas.width / Math.max(1, this.canvas.height));
    set1f('uStyle', SHADER_STYLE_INDEX[settings.style]);
    const styleParams = this.layerState.styleParams;
    gl.uniform4f(this.uniforms.uStyleP ?? null, styleParams[0], styleParams[1], styleParams[2], styleParams[3]);
    set1f('uGradientKind', GEOMETRY_ID[this.geometry.kind]);
    set1f('uGradientAngle', this.geometry.angle * Math.PI / 180);
    set2f('uGradientOrigin', this.geometry.originX / 100, 1 - this.geometry.originY / 100);
    set2f('uGradientRadius', this.geometry.radiusX / 100, this.geometry.radiusY / 100);
    set1f('uShaderMix', settings.shaderMix);
    gl.uniform3f(this.uniforms.uInteractionColor ?? null, this.interactionColor[0], this.interactionColor[1], this.interactionColor[2]);
    gl.uniform3fv(this.uniforms['uInteractionColors[0]'] ?? null, this.interactionColorData);
    set1f('uInteractionColorCount', Math.min(5, settings.interactionColors.length));
    set1f('uInteractionColorMix', settings.interactionColorMix);
    set1f('uInteractionColorSpeed', settings.interactionColorSpeed);
    set1f('uInteractionFalloff', { soft: 0, linear: 1, sharp: 2, gaussian: 3 }[settings.interactionFalloff]);
    set1f('uInteractionDistortion', settings.interactionDistortion);
    set1f('uInteractionDisplacement', settings.interactionDisplacement);
    set1f('uInteractionDisplacementMode', (settings.interactionDisplacementMode === 'push') === (reaction >= 0) ? 0 : 1);
    set1f('uInteractionVelocityReaction', settings.interactionVelocityReaction);
    set1f('uInteractionGlitch', settings.interactionGlitch);
    set1f('uSpeed', settings.speed);
    set1f('uIntensity', settings.intensity);
    set1f('uDistortion', settings.distortion);
    set1f('uDistortionScale', settings.distortionScale);
    set1f('uTurbulence', settings.turbulence);
    set1f('uTimeOffset', settings.timeOffset);
    set1f('uFlowAngle', settings.flowAngle * Math.PI / 180);
    set1f('uFlowDrift', settings.flowDrift);
    set1f('uBreath', settings.breath);
    set1f('uBreathRate', settings.breathRate);
    set1f('uRotation', settings.rotation);
    set1f('uZoom', settings.zoom);
    set1f('uInteractionRadius', settings.interactionRadius);
    set1f('uInteractionStrength', settings.interactionStrength * Math.min(1, Math.abs(reaction)));
    set1f('uGlow', settings.glow);
    set1f('uRippleStrength', settings.rippleStrength);
    set1f('uRippleSpeed', settings.rippleSpeed);
    set1f('uWrapMode', settings.paletteWrap === 'repeat' ? 2 : 0);
    set1f('uToneMap', settings.toneMapping);
    set1f('uVignette', settings.vignette);
    set1f('uSheen', settings.sheen);
    set1f('uGrain', settings.filmGrain);
    set1f('uLutEnabled', this.lutEnabled ? 1 : 0);
    set1f('uLayerMixEnabled', this.layerMixTexture && this.layerMix.palette.length ? 1 : 0);
    set1f('uLayerMixMode', LAYER_BLEND_ID[this.layerMix.mode]);
    set1f('uLayerMixStrength', this.layerMix.strength);
    set1f('uLayerMixSpeed', this.layerMix.speed);
    set1f('uProjectOutput', settings.renderBackend === 'webgl' ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.layerMixTexture);
    gl.uniform1f(this.uniforms.uStopCount ?? null, MAX_STOPS);
    gl.uniform4fv(this.uniforms['uPalette[0]'] ?? null, this.paletteColors);
    gl.uniform1fv(this.uniforms['uPaletteAlpha[0]'] ?? null, this.paletteAlphas);

    gl.uniform1f(this.uniforms.uMeshCount ?? null, this.meshPoints.length);
    gl.uniform4f(this.uniforms.uMeshBase ?? null, this.meshBaseRgb[0], this.meshBaseRgb[1], this.meshBaseRgb[2], this.meshBase ? 1 : 0);
    gl.uniform4fv(this.uniforms['uMeshPoints[0]'] ?? null, this.meshPointData);
    gl.uniform4fv(this.uniforms['uMeshColors[0]'] ?? null, this.meshColorData);

    const rippleCount = this.refreshRippleData();
    set1f('uRippleCount', rippleCount);
    gl.uniform4fv(this.uniforms['uRipples[0]'] ?? null, this.rippleData);

    // interaction rig: drives are evaluated on the CPU, the shader only receives the final numbers
    if (!this.builtKey.startsWith('base#') && this.rigRuleCount() > 0) {
      const frame = this.rigFrame;
      Object.assign(frame, pointer);
      frame.clock = this.clock;
      frame.trailLife = settings.rig.physics.trailLife;
      if (idle) { frame.x = idle.x; frame.y = idle.y; frame.active = pointerActive; }
      evaluateRig(settings.rig, frame, this.rigBuffers, { radiusScale: settings.interactionRadius, reaction, enabled: reacts || idlePointer });
      packTrail(this.pointer.getEngine(), frame, this.rigBuffers, reacts);
      gl.uniform4fv(this.uniforms['uRuleB[0]'] ?? null, this.rigBuffers.b);
      gl.uniform4fv(this.uniforms['uRuleC[0]'] ?? null, this.rigBuffers.c);
      gl.uniform4fv(this.uniforms['uRuleD[0]'] ?? null, this.rigBuffers.d);
      gl.uniform4fv(this.uniforms['uRuleE[0]'] ?? null, this.rigBuffers.e);
      gl.uniform4fv(this.uniforms['uTrail[0]'] ?? null, this.rigBuffers.trail);
      gl.uniform3f(this.uniforms.uTouch2 ?? null, pointer.t2x, pointer.t2y, reacts ? pointer.t2active : 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private refreshInteractionColors() {
    const rgb = hexToRgb(this.settings.interactionColor);
    this.interactionColor = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
    this.interactionColorData.fill(0);
    this.settings.interactionColors.slice(0, 5).forEach((color, index) => {
      const value = hexToRgb(color);
      this.interactionColorData.set([value.r / 255, value.g / 255, value.b / 255], index * 3);
    });
  }

  private refreshMeshBase() {
    const rgb = this.meshBase ? hexToRgb(this.meshBase) : { r: 0, g: 0, b: 0 };
    this.meshBaseRgb = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  }

  private refreshPaletteData() {
    const key = JSON.stringify([this.palette, this.geometry.space ?? 'srgb']);
    if (key === this.paletteKey) return;
    this.paletteKey = key;
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
      this.layerMixKey = '';
      return;
    }
    const space = this.layerMix.space ?? this.geometry.space ?? 'srgb';
    const key = JSON.stringify([this.layerMix.palette, space]);
    if (key === this.layerMixKey && this.layerMixTexture) return;
    const data = bakePaletteLut(this.layerMix.palette, space, LUT_SIZE);
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
      this.layerMixKey = '';
    } else this.layerMixKey = key;
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
    const clicks = this.settings.ripplesEnabled ? this.pointer.getRipples() : [];
    const start = Math.max(0, clicks.length - MAX_RIPPLES);
    const count = clicks.length - start;
    let changed = count !== this.cachedRippleCount;
    if (!changed) {
      for (let i = 0; i < count; i++) {
        const click = clicks[start + i];
        const offset = i * 4;
        if (this.rippleData[offset] !== click.x || this.rippleData[offset + 1] !== click.y
          || this.rippleData[offset + 2] !== click.t || this.rippleData[offset + 3] !== click.s) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      this.rippleData.fill(0);
      for (let i = 0; i < count; i++) {
        const click = clicks[start + i];
        this.rippleData.set([click.x, click.y, click.t, click.s], i * 4);
      }
      this.cachedRippleCount = count;
    }
    return count;
  }
}
