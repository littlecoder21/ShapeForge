import { hexToRgb } from '../../engine/color';
import fragmentShaderSource from '../shaders/gradient.frag.glsl?raw';
import vertexShaderSource from '../shaders/gradient.vert.glsl?raw';
import { PointerManager } from '../input/PointerManager';
import { DEFAULT_INTERACTIVE_SETTINGS, DEFAULT_SHADER_GEOMETRY, normalizeInteractiveSettings, type InteractiveRendererStatus, type InteractiveSettings, type InteractiveUpdate, type ShaderGeometry, type ShaderMeshPoint, type ShaderStop } from '../types';

type GL = WebGLRenderingContext | WebGL2RenderingContext;
type Uniforms = Record<string, WebGLUniformLocation | null>;

const MAX_STOPS = 8;
const MAX_RIPPLES = 8;
const MAX_MESH_POINTS = 8;
const QUALITY_SCALE = { low: 0.55, medium: 0.75, high: 1, ultra: 1.35 } as const;
const STYLE_ID = { flow: 0, aurora: 1, liquid: 2, holographic: 3, plasma: 4, silk: 5, nebula: 6, ribbons: 7, metaballs: 8, contours: 9 } as const;
const POINTER_MODE_ID = {
  attract: 0, repel: 1, swirl: 2, glow: 3, drag: 4, wave: 5, orbit: 6,
  magnet: 7, ripple: 8, pulse: 9, trail: 10, spotlight: 11, hue: 12,
} as const;
const GEOMETRY_ID = { linear: 0, radial: 1, conic: 2, curve: 3, mesh: 4, noise: 5 } as const;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function normalizePalette(stops: ShaderStop[]): ShaderStop[] {
  const valid = stops
    .filter(stop => /^#[0-9a-f]{6}$/i.test(stop.color) && Number.isFinite(stop.position))
    .map(stop => ({
      color: stop.color,
      position: clamp(stop.position, 0, 1),
      alpha: clamp(Number.isFinite(stop.alpha) ? stop.alpha! : 1, 0, 1),
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
    .replace('precision highp float;', 'precision highp float;\nout vec4 fragmentColor;')}`;
}

export interface InteractiveRendererOptions {
  palette?: ShaderStop[];
  settings?: Partial<InteractiveSettings>;
  geometry?: ShaderGeometry;
  meshPoints?: ShaderMeshPoint[];
  meshBase?: string;
  onStatusChange?: (status: InteractiveRendererStatus, message?: string) => void;
}

export class InteractiveRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly onStatusChange?: InteractiveRendererOptions['onStatusChange'];
  private settings: InteractiveSettings;
  private geometry: ShaderGeometry = { ...DEFAULT_SHADER_GEOMETRY };
  private palette: ShaderStop[];
  private meshPoints: ShaderMeshPoint[];
  private meshBase: string;
  private readonly pointer: PointerManager;
  private gl: GL | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private uniforms: Uniforms = {};
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
    this.meshPoints = (options.meshPoints ?? []).slice(0, MAX_MESH_POINTS);
    this.meshBase = /^#[0-9a-f]{6}$/i.test(options.meshBase ?? '') ? options.meshBase! : '';
    if (options.geometry) {
      this.geometry = {
        kind: options.geometry.kind,
        angle: Number.isFinite(options.geometry.angle) ? options.geometry.angle : DEFAULT_SHADER_GEOMETRY.angle,
        originX: clamp(options.geometry.originX, -100, 200),
        originY: clamp(options.geometry.originY, -100, 200),
        radiusX: clamp(options.geometry.radiusX, 1, 200),
        radiusY: clamp(options.geometry.radiusY, 1, 200),
      };
    }
    this.onStatusChange = options.onStatusChange;
    this.pointer = new PointerManager(canvas, {
      touchEnabled: this.settings.touchEnabled,
      ripplesEnabled: this.settings.ripplesEnabled,
      maximumRipples: this.settings.maximumRipples,
      onChange: () => this.schedule(),
    });

    const contextOptions: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
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
      this.pointer.updateOptions({
        touchEnabled: this.settings.touchEnabled,
        ripplesEnabled: this.settings.ripplesEnabled,
        maximumRipples: this.settings.maximumRipples,
      });
      this.resize();
    }
    if (update.palette) {
      this.palette = normalizePalette(update.palette);
      if (this.status === 'ready') this.setStatus('ready', this.paletteNotice());
    }
    if (update.geometry) {
      this.geometry = {
        kind: update.geometry.kind,
        angle: Number.isFinite(update.geometry.angle) ? update.geometry.angle : DEFAULT_SHADER_GEOMETRY.angle,
        originX: clamp(update.geometry.originX, -100, 200),
        originY: clamp(update.geometry.originY, -100, 200),
        radiusX: clamp(update.geometry.radiusX, 1, 200),
        radiusY: clamp(update.geometry.radiusY, 1, 200),
      };
    }
    if (update.meshPoints) this.meshPoints = update.meshPoints.slice(0, MAX_MESH_POINTS);
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
    }
    this.buffer = null;
    this.program = null;
    this.gl = null;
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.setStatus('context-lost', 'WebGL context lost. Waiting for the browser to restore it.');
  };

  private readonly handleContextRestored = () => {
    try {
      const options: WebGLContextAttributes = {
        alpha: true, antialias: false, depth: false, premultipliedAlpha: false, powerPreference: 'low-power',
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
    return this.palette.length > MAX_STOPS
      ? `Shader rendering supports up to ${MAX_STOPS} stops; the CSS preview retains the complete gradient.`
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
    const quality = QUALITY_SCALE[this.settings.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = clamp(dpr * quality * this.settings.resolutionScale, 0.35, 2);
    const width = Math.max(1, Math.min(4096, Math.round(widthCss * scale)));
    const height = Math.max(1, Math.min(4096, Math.round(heightCss * scale)));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
      this.schedule();
    }
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
    const names = [
      'uResolution', 'uPointer', 'uVelocity', 'uPointerActive', 'uPointerDown', 'uTime', 'uClock', 'uAspect',
      'uStyle', 'uGradientKind', 'uGradientAngle', 'uGradientOrigin', 'uGradientRadius', 'uPointerMode', 'uInteractionColor', 'uStopCount', 'uSpeed', 'uIntensity', 'uDistortion', 'uDistortionScale',
      'uTurbulence', 'uInteractionRadius', 'uInteractionStrength', 'uGlow', 'uRippleStrength', 'uRippleSpeed',
      'uRippleCount', 'uMeshCount', 'uMeshBase', 'uMeshPoints[0]', 'uMeshColors[0]',
      'uPalette[0]', 'uPaletteAlpha[0]', 'uRipples[0]',
    ];
    names.forEach(name => { this.uniforms[name] = gl.getUniformLocation(program, name); });

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
    const delta = this.previousFrame ? Math.min(0.05, (now - this.previousFrame) / 1000) : 0;
    this.previousFrame = now;
    this.clock += delta;
    const pointer = this.pointer.advance(delta, this.clock);
    this.draw(gl, program, pointer);

    const animated = this.settings.animate && !this.paused && !this.reducedMotion;
    if (animated || this.pointer.hasActivity()) this.schedule();
  };

  private draw(gl: GL, program: WebGLProgram, pointer: ReturnType<PointerManager['advance']>) {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const set1f = (name: string, value: number) => gl.uniform1f(this.uniforms[name] ?? null, value);
    const set2f = (name: string, x: number, y: number) => gl.uniform2f(this.uniforms[name] ?? null, x, y);
    const animated = this.settings.animate && !this.paused && !this.reducedMotion;
    set2f('uResolution', this.canvas.width, this.canvas.height);
    set2f('uPointer', pointer.x, pointer.y);
    set2f('uVelocity', pointer.velocityX, pointer.velocityY);
    set1f('uPointerActive', this.settings.interactionEnabled ? pointer.active : 0);
    set1f('uPointerDown', this.settings.interactionEnabled ? pointer.down : 0);
    set1f('uTime', animated ? this.clock * this.settings.speed : 0);
    set1f('uClock', this.clock);
    set1f('uAspect', this.canvas.width / Math.max(1, this.canvas.height));
    set1f('uStyle', STYLE_ID[this.settings.style]);
    set1f('uGradientKind', GEOMETRY_ID[this.geometry.kind]);
    set1f('uGradientAngle', this.geometry.angle * Math.PI / 180);
    set2f('uGradientOrigin', this.geometry.originX / 100, 1 - this.geometry.originY / 100);
    set2f('uGradientRadius', this.geometry.radiusX / 100, this.geometry.radiusY / 100);
    set1f('uPointerMode', POINTER_MODE_ID[this.settings.pointerMode]);
    const interactionColor = hexToRgb(this.settings.interactionColor);
    gl.uniform3f(this.uniforms.uInteractionColor ?? null, interactionColor.r / 255, interactionColor.g / 255, interactionColor.b / 255);
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

    const colors = new Float32Array(MAX_STOPS * 4);
    const alphas = new Float32Array(MAX_STOPS);
    for (let i = 0; i < MAX_STOPS; i++) {
      const stop = this.palette[Math.min(i, this.palette.length - 1)];
      const color = hexToRgb(stop.color);
      colors.set([color.r / 255, color.g / 255, color.b / 255, stop.position], i * 4);
      alphas[i] = stop.alpha ?? 1;
    }
    gl.uniform1f(this.uniforms.uStopCount ?? null, Math.min(this.palette.length, MAX_STOPS));
    gl.uniform4fv(this.uniforms['uPalette[0]'] ?? null, colors);
    gl.uniform1fv(this.uniforms['uPaletteAlpha[0]'] ?? null, alphas);

    const meshPointData = new Float32Array(MAX_MESH_POINTS * 4);
    const meshColorData = new Float32Array(MAX_MESH_POINTS * 4);
    this.meshPoints.forEach((point, index) => {
      const color = hexToRgb(point.color);
      meshPointData.set([point.x / 100, 1 - point.y / 100, point.size / 100, point.alpha], index * 4);
      meshColorData.set([color.r / 255, color.g / 255, color.b / 255, 1], index * 4);
    });
    const meshBase = this.meshBase ? hexToRgb(this.meshBase) : { r: 0, g: 0, b: 0 };
    gl.uniform1f(this.uniforms.uMeshCount ?? null, this.meshPoints.length);
    gl.uniform4f(this.uniforms.uMeshBase ?? null, meshBase.r / 255, meshBase.g / 255, meshBase.b / 255, this.meshBase ? 1 : 0);
    gl.uniform4fv(this.uniforms['uMeshPoints[0]'] ?? null, meshPointData);
    gl.uniform4fv(this.uniforms['uMeshColors[0]'] ?? null, meshColorData);

    const rippleData = new Float32Array(MAX_RIPPLES * 4);
    const ripples = this.settings.ripplesEnabled ? this.pointer.getRipples().slice(-MAX_RIPPLES) : [];
    ripples.forEach((ripple, index) => {
      rippleData.set([ripple.x, ripple.y, ripple.startedAt, ripple.strength], index * 4);
    });
    set1f('uRippleCount', ripples.length);
    gl.uniform4fv(this.uniforms['uRipples[0]'] ?? null, rippleData);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
