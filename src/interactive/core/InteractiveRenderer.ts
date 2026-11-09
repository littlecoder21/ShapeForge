import { hexToRgb } from '../../gradient/engine/color';
import fragmentShaderTemplate from '../../gradient/interactive/shaders/gradient.frag.glsl?raw';
import vertexShaderSource from '../../gradient/interactive/shaders/gradient.vert.glsl?raw';
import { PointerManager } from '../../gradient/interactive/input/PointerManager';
import { activeRules, rigSignature, type InteractionRig } from '../../gradient/interactive/rig/model';
import { createRigBuffers, evaluateRig, idleMotionPoint, packTrail, type PointerFrame } from '../../gradient/interactive/rigRuntime';
import { resolveStyleParams, SHADER_STYLE_INDEX } from '../../gradient/interactive/styles';
import { DEFAULT_INTERACTIVE_SETTINGS, DEFAULT_SHADER_GEOMETRY, normalizeInteractiveSettings, type InteractiveLayerState, type InteractiveRendererStatus, type InteractiveSettings, type InteractiveUpdate, type ShaderGeometry, type ShaderLayerColorBlend, type ShaderMeshPoint, type ShaderStop } from '../types';
import { bakePaletteLut } from '../../gradient/interactive/paletteLut';
import { UNIFORM_NAMES } from '../uniforms';
import { assembleProceduralShader } from '../../procedural/glsl';
import { createProceduralState, uploadProceduralUniforms, type ProceduralState } from '../../procedural/proceduralRuntime';
import { isProceduralActive, proceduralSignature, type ProceduralConfig } from '../../procedural/types';
import { ruleTextureAtlasDataUri } from '../../gradient/interactive/rig/textureAtlas';
import { bakeShapeAtlas, shapeAtlasKey, SHAPE_ATLAS_HEIGHT, SHAPE_ATLAS_WIDTH } from '../../gradient/interactive/rig/shapeField';
import { getFrameScheduler } from './FrameScheduler';
import { QUALITY_PRESETS, layerWeight, requestedScale, renderSize, type LayerLoad } from './gpu/GlobalRenderBudget';
import type { LutHandle } from './gpu/GpuResourceManager';
import type { ProgramEntry } from './gpu/ShaderProgramManager';
import { getSharedRenderer, type RenderClient, type SharedRenderer } from './gpu/SharedRenderer';

type GL = WebGLRenderingContext | WebGL2RenderingContext;

const MAX_STOPS = 8;
const MAX_RIPPLES = 8;
const MAX_MESH_POINTS = 8;
const LUT_SIZE = 512;
/** texture edits are applied after the slider has paused this long, so dragging never decodes an atlas per tick */
const TEXTURE_DEBOUNCE_MS = 90;
/** a zoom / pan of the preview re-measures the layer once it has settled */
const VIEW_SETTLE_MS = 160;
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

/** Palette lookup tables baked on the CPU are shared by every layer with the same colours (small LRU). */
const lutBakeCache = new Map<string, Uint8Array>();
function bakeLutCached(key: string, palette: ShaderStop[], space: ShaderGeometry['space']): Uint8Array {
  const cached = lutBakeCache.get(key);
  if (cached) { lutBakeCache.delete(key); lutBakeCache.set(key, cached); return cached; }
  const baked = bakePaletteLut(palette, space ?? 'srgb', LUT_SIZE);
  lutBakeCache.set(key, baked);
  if (lutBakeCache.size > 48) lutBakeCache.delete(lutBakeCache.keys().next().value as string);
  return baked;
}

/** The rule textures are the same for every layer (the rig is project-wide), so the atlas image is decoded once and shared. */
const atlasImageCache = new Map<string, Promise<HTMLImageElement>>();
function loadAtlasImage(uri: string): Promise<HTMLImageElement> {
  const hit = atlasImageCache.get(uri);
  if (hit) return hit;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The interaction texture atlas could not be decoded.'));
    image.src = uri;
  });
  atlasImageCache.set(uri, promise);
  promise.catch(() => { atlasImageCache.delete(uri); });
  if (atlasImageCache.size > 4) atlasImageCache.delete(atlasImageCache.keys().next().value as string);
  return promise;
}

export interface InteractiveRendererOptions {
  palette?: ShaderStop[];
  settings?: Partial<InteractiveSettings>;
  layer?: Partial<InteractiveLayerState>;
  geometry?: ShaderGeometry;
  meshPoints?: ShaderMeshPoint[];
  meshBase?: string;
  layerMix?: InteractiveUpdate['layerMix'];
  /** the layer's procedural engine; null / disabled = the manual gradient only */
  procedural?: ProceduralConfig | null;
  onStatusChange?: (status: InteractiveRendererStatus, message?: string) => void;
  /** injected for tests; the app always uses the one shared renderer */
  renderer?: SharedRenderer;
}

interface PendingBuild {
  entry: ProgramEntry;
  /** the structural key (without the WebGL version tag) */
  key: string;
  withRig: boolean;
  /** true when the procedural engine is compiled into this program */
  withProcedural: boolean;
}

/* One shader layer.
 *
 * It keeps everything that belongs to the layer — palette, geometry, mesh points, style, motion settings, interaction state,
 * its own pointer engine and procedural simulation — and draws through the SHARED renderer: the WebGL context, the compiled
 * programs, the palette textures, the frame loop, the pointer input and the resolution budget are all shared infrastructure.
 * The public interface (constructor, update, setPaused, resetInteraction, getStatus, destroy) is unchanged.
 *
 * Resolution follows what is VISIBLE: the preview scales the artboard with a CSS transform, so a 1200 × 800 layer shown at
 * 24 % on a phone only needs about a quarter of the pixels. The layer measures its on-screen size and renders for that. */
export class InteractiveRenderer implements RenderClient {
  id = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly hub: SharedRenderer;
  private readonly context2d: CanvasRenderingContext2D | null;
  private readonly onStatusChange?: InteractiveRendererOptions['onStatusChange'];
  private settings: InteractiveSettings;
  private layerState: InteractiveLayerState = { styleParams: resolveStyleParams('flow'), reaction: 1 };
  private geometry: ShaderGeometry = { ...DEFAULT_SHADER_GEOMETRY };
  private palette: ShaderStop[];
  private layerMix: NonNullable<InteractiveUpdate['layerMix']>;
  private meshPoints: ShaderMeshPoint[];
  private meshBase: string;
  private readonly pointer: PointerManager;
  private entry: ProgramEntry | null = null;
  private pending: PendingBuild | null = null;
  private builtKey = '';
  /** keys whose compile failed on this device, so a failing shader is never retried until its key changes */
  private readonly failedKeys = new Set<string>();
  private paletteHandle: LutHandle | null = null;
  private layerMixHandle: LutHandle | null = null;
  /** CSS textures of the rules (unit 2); only exists while a rule uses a texture */
  private ruleTextureAtlas: WebGLTexture | null = null;
  private ruleTextureKey = '';
  private ruleTextureRequest = 0;
  private ruleTextureTimer: ReturnType<typeof setTimeout> | null = null;
  /** distance fields of custom shapes (unit 3); only exists while a rule uses a custom shape */
  private shapeAtlas: WebGLTexture | null = null;
  private shapeKey = '';
  private readonly paletteColors = new Float32Array(MAX_STOPS * 4);
  private readonly paletteAlphas = new Float32Array(MAX_STOPS);
  private readonly meshPointData = new Float32Array(MAX_MESH_POINTS * 4);
  private readonly meshColorData = new Float32Array(MAX_MESH_POINTS * 4);
  private readonly rippleData = new Float32Array(MAX_RIPPLES * 4);
  private readonly interactionColorData = new Float32Array(5 * 3);
  private interactionColor: [number, number, number] = [1, 1, 1];
  private meshBaseRgb: [number, number, number] = [0, 0, 0];
  private readonly rigBuffers = createRigBuffers();
  private suppressRigWhileBuilding = false;
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
  /** the procedural engine's config when it is active, else null */
  private procedural: ProceduralConfig | null = null;
  private proceduralState: ProceduralState | null = null;
  /** true while the program in use has the procedural code compiled in */
  private proceduralBuilt = false;
  /** the procedural simulation only advances when something can have changed */
  private proceduralDirty = true;
  private lastOctaveCap = -1;
  /** settings-derived uniforms are uploaded only when they changed (or another layer used the shared program since) */
  private staticDirty = true;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private viewObserver: MutationObserver | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  /** the on-screen width the canvas was last sized for */
  private measuredWidth = 0;
  private mediaQuery: MediaQueryList | null = null;
  private previousFrame = 0;
  private clock = 0;
  private paused = false;
  private visible = true;
  private reducedMotion = false;
  private disposed = false;
  private registered = false;
  private animating = false;
  private lastBudgetKey = '';
  private status: InteractiveRendererStatus = 'fallback';
  private message = '';

  constructor(canvas: HTMLCanvasElement, options: InteractiveRendererOptions = {}) {
    this.canvas = canvas;
    this.hub = options.renderer ?? getSharedRenderer();
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
    this.procedural = options.procedural && isProceduralActive(options.procedural) ? options.procedural : null;
    this.syncProceduralState();
    this.refreshInteractionColors();
    this.refreshRigFlags();
    this.onStatusChange = options.onStatusChange;
    this.pointer = new PointerManager(canvas, this.pointerOptions(), this.hub.pointers);
    // the layer's own canvas is a plain 2D surface now; the shared renderer copies finished frames into it
    this.context2d = canvas.getContext('2d');

    if (!this.hub.available || !this.context2d) {
      this.setStatus('fallback', 'WebGL is unavailable; the static gradient can remain visible.');
    } else {
      this.hub.register(this);
      this.registered = true;
      try {
        this.refreshRuleTextureAtlas(true);
        this.refreshShapeAtlas();
        this.observe();
        this.resize();
        this.acquireTextures();
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
        if (rigSignature(previous.rig) !== rigSignature(next.rig)) this.suppressRigWhileBuilding = true;
        this.settings = next;
        this.staticDirty = true;
        // Only a change of quality / resolution should restart adaptive resolution; slider drags must not.
        if (previous.quality !== next.quality || previous.resolutionScale !== next.resolutionScale) {
          this.hub.budget.reset();
          needsResize = true;
        }
        if (!sameValue(previous.interactionColors, next.interactionColors) || previous.interactionColor !== next.interactionColor) this.refreshInteractionColors();
        if (!sameValue(previous.rig, next.rig)) {
          this.refreshRuleTextureAtlas();
          this.refreshShapeAtlas();
        }
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
      this.staticDirty = true;
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
      this.staticDirty = true;
      this.refreshLayerMixTexture();
    }
    if (update.geometry) {
      const geometry = normalizeGeometry(update.geometry);
      if (!sameValue(geometry, this.geometry)) {
        this.geometry = geometry;
        this.staticDirty = true;
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
    if (update.procedural !== undefined) {
      const active = update.procedural && isProceduralActive(update.procedural) ? update.procedural : null;
      if (!sameValue(active, this.procedural)) {
        this.procedural = active;
        this.syncProceduralState();
        this.hub.invalidateBudget();
        needsResize = true;
        // only a change in which distortion types exist (or on / off) changes the compiled shader
        this.ensureBuild();
      }
    }
    if (needsResize) this.resize();
    this.proceduralDirty = true;
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
    this.hub.cancelFrame(this);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.viewObserver?.disconnect();
    this.viewObserver = null;
    if (this.viewTimer !== null) clearTimeout(this.viewTimer);
    this.viewTimer = null;
    if (this.ruleTextureTimer !== null) clearTimeout(this.ruleTextureTimer);
    this.ruleTextureTimer = null;
    this.mediaQuery?.removeEventListener('change', this.handleMotionChange);
    window.removeEventListener('resize', this.handleWindowResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.pointer.destroy();
    this.discardPending();
    // deterministic cleanup: this layer gives back its program reference and its textures; the manager frees what nobody uses
    this.hub.programs.release(this.entry);
    this.hub.resources.releaseLut(this.paletteHandle);
    this.hub.resources.releaseLut(this.layerMixHandle);
    this.freeRuleTexture();
    this.freeShapeTexture();
    this.entry = null;
    this.paletteHandle = null;
    this.layerMixHandle = null;
    this.ruleTextureKey = '';
    this.shapeKey = '';
    this.proceduralState = null;
    if (this.registered) this.hub.unregister(this);
    this.registered = false;
  }

  /* ───────────── RenderClient ───────────── */

  getLoad(): LayerLoad | null {
    if (this.disposed) return null;
    const { width: cssWidth, height: cssHeight } = this.displaySize();
    if (!cssWidth || !cssHeight) return null;
    const preset = QUALITY_PRESETS[this.settings.quality];
    return {
      id: this.id,
      cssWidth,
      cssHeight,
      requestedScale: requestedScale(window.devicePixelRatio || 1, this.settings.quality, this.settings.resolutionScale),
      weight: layerWeight(this.procedural, preset.octaves),
    };
  }

  getInfo() {
    return { width: this.canvas.width, height: this.canvas.height, procedural: this.proceduralBuilt, animating: this.animating };
  }

  applyScale() {
    this.resize(false);
    if (this.status === 'ready') this.setStatus('ready', this.paletteNotice());
  }

  onContextLost() {
    this.hub.cancelFrame(this);
    // every GL object died with the context: forget the handles without releasing them
    this.entry = null;
    this.pending = null;
    this.paletteHandle = null;
    this.layerMixHandle = null;
    this.ruleTextureAtlas = null;
    this.shapeAtlas = null;
    this.ruleTextureKey = '';
    this.shapeKey = '';
    this.builtKey = '';
    this.proceduralBuilt = false;
    this.setStatus('context-lost', 'WebGL context lost. Waiting for the browser to restore it.');
  }

  onContextRestored() {
    try {
      this.failedKeys.clear();
      this.staticDirty = true;
      this.proceduralDirty = true;
      this.ruleTextureKey = '';
      this.shapeKey = '';
      this.refreshRuleTextureAtlas(true);
      this.refreshShapeAtlas();
      this.acquireTextures();
      this.resize();
      this.beginBuild(true);
      this.setStatus('compiling', 'Compiling the gradient shader…');
      this.schedule();
    } catch (error) {
      this.setStatus('error', error instanceof Error ? error.message : 'WebGL context restoration failed.');
    }
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

  /* ───────────── rule textures and custom shapes ───────────── */

  private freeRuleTexture() {
    if (this.ruleTextureAtlas) this.hub.gpu.gl?.deleteTexture(this.ruleTextureAtlas);
    this.ruleTextureAtlas = null;
  }

  private freeShapeTexture() {
    if (this.shapeAtlas) this.hub.gpu.gl?.deleteTexture(this.shapeAtlas);
    this.shapeAtlas = null;
  }

  /** Builds the CSS texture atlas of the rules. The texture exists only while a rule uses one, and edits are applied once
   *  the slider has paused, so dragging a texture control never decodes an atlas per tick. */
  private refreshRuleTextureAtlas(immediate = false) {
    const rules = activeRules(this.settings.rig);
    const key = JSON.stringify(rules.map(rule => rule.texture.enabled ? rule.texture : 0));
    if (key === this.ruleTextureKey) return;
    this.ruleTextureKey = key;
    const request = ++this.ruleTextureRequest;
    if (this.ruleTextureTimer !== null) { clearTimeout(this.ruleTextureTimer); this.ruleTextureTimer = null; }
    if (!rules.some(rule => rule.texture.enabled)) {
      this.freeRuleTexture();
      this.schedule();
      return;
    }
    const run = () => {
      this.ruleTextureTimer = null;
      if (request !== this.ruleTextureRequest || this.disposed) return;
      const uri = ruleTextureAtlasDataUri(this.settings.rig);
      if (!uri) { this.freeRuleTexture(); this.schedule(); return; }
      loadAtlasImage(uri).then(
        image => this.uploadRuleTexture(image, request),
        () => { if (request === this.ruleTextureRequest) this.setStatus('ready', 'Could not load an interaction texture; check the selected texture preset.'); },
      );
    };
    if (immediate) run();
    else this.ruleTextureTimer = setTimeout(run, TEXTURE_DEBOUNCE_MS);
  }

  private uploadRuleTexture(image: HTMLImageElement, request: number) {
    const gl = this.hub.gpu.gl;
    if (!gl || !this.registered || this.disposed || request !== this.ruleTextureRequest) return;
    if (!this.ruleTextureAtlas) this.ruleTextureAtlas = gl.createTexture();
    if (!this.ruleTextureAtlas) {
      this.setStatus('ready', 'Could not allocate the interaction texture atlas.');
      return;
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.ruleTextureAtlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // the shader reads the atlas in image order (row 0 = top), so it must NOT be flipped on upload
    gl.pixelStorei?.(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    if (gl.getError() !== gl.NO_ERROR) {
      this.setStatus('ready', 'Could not upload an interaction texture; other shader effects remain available.');
      return;
    }
    this.schedule();
  }

  /** Bakes custom outlines into the distance-field atlas. Cheap (a few kB), synchronous and never recompiles the shader. */
  private refreshShapeAtlas() {
    const key = shapeAtlasKey(this.settings.rig);
    if (key === this.shapeKey) return;
    this.shapeKey = key;
    const gl = this.hub.gpu.gl;
    if (!gl || !this.registered || this.disposed) return;
    const data = key ? bakeShapeAtlas(this.settings.rig) : null;
    if (!data) { this.freeShapeTexture(); this.schedule(); return; }
    if (!this.shapeAtlas) this.shapeAtlas = gl.createTexture();
    if (!this.shapeAtlas) {
      this.setStatus('ready', 'Could not allocate the custom shape texture.');
      return;
    }
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.shapeAtlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei?.(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHAPE_ATLAS_WIDTH, SHAPE_ATLAS_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (gl.getError() !== gl.NO_ERROR) {
      this.setStatus('ready', 'Could not upload the custom shape; other shader effects remain available.');
      return;
    }
    this.schedule();
  }

  /** What the shader is built from: interaction rules, quality, and which procedural distortion types exist. */
  private desiredKey(withRig: boolean, withProcedural = withRig) {
    const { octaves, warpDepth } = QUALITY_PRESETS[this.settings.quality];
    const procedural = withProcedural ? proceduralSignature(this.procedural) : 'off';
    return `${withRig ? rigSignature(this.settings.rig) : 'base'}#${octaves}#${warpDepth}#${procedural}`;
  }

  /** Starts a new compile when the structure of the interaction (or the quality) changed. */
  private ensureBuild() {
    if (!this.registered || this.disposed || !this.hub.available) return;
    const key = this.desiredKey(true);
    if (this.pending && this.pending.key !== key) this.discardPending();
    if (key === this.builtKey) {
      this.suppressRigWhileBuilding = false;
      return;
    }
    if (key === this.pending?.key || this.failedKeys.has(key)) return;
    this.beginBuild(true);
  }

  private beginBuild(withRig: boolean, withProcedural = withRig) {
    this.discardPending();
    const rig: InteractionRig | null = withRig ? this.settings.rig : null;
    const procedural = withProcedural && isProceduralActive(this.procedural) ? this.procedural : null;
    const { octaves, warpDepth } = QUALITY_PRESETS[this.settings.quality];
    const webgl2 = this.hub.gpu.webgl2;
    const key = this.desiredKey(withRig, withProcedural);
    // layers whose key matches share this program: it is compiled (and its source assembled) once
    const entry = this.hub.programs.acquire(`${webgl2 ? 'gl2' : 'gl1'}|${key}`, () => ({
      vertex: shaderSource(vertexShaderSource, 'vertex', webgl2),
      fragment: shaderSource(assembleProceduralShader(fragmentShaderTemplate, rig, { octaves, warpDepth }, procedural), 'fragment', webgl2),
    }), UNIFORM_NAMES);
    if (!entry) throw new Error('Could not allocate the WebGL shader program.');
    this.pending = { entry, key, withRig, withProcedural: procedural !== null };
  }

  private discardPending() {
    if (!this.pending) return;
    this.hub.programs.release(this.pending.entry);
    this.pending = null;
  }

  /** Returns true while the build is still running. Finishing never blocks when parallel compile is available. */
  private pollBuild(): boolean {
    const pending = this.pending;
    if (!pending) return false;
    const state = this.hub.programs.poll(pending.entry);
    if (state === 'compiling') return true;
    if (state === 'failed') {
      const detail = pending.entry.error;
      this.discardPending();
      this.failedKeys.add(pending.key);
      if (pending.withProcedural) {
        // Fallback ladder, step 1: keep the interaction rig, drop only the procedural engine.
        this.beginBuild(true, false);
        this.message = `The procedural gradient could not compile on this device${detail ? `: ${detail}` : '.'} Showing the manual gradient instead.`;
        return true;
      }
      if (pending.withRig) {
        // Step 2: the interaction rig could not run here: keep the gradient alive without it and say why.
        this.beginBuild(false);
        this.message = `Interaction effects could not compile on this device${detail ? `: ${detail}` : '.'}`;
        return true;
      }
      this.setStatus('error', `Could not compile the gradient shader${detail ? `: ${detail}` : '.'}`);
      return false;
    }
    const previous = this.entry;
    this.entry = pending.entry;
    this.builtKey = pending.key;
    this.proceduralBuilt = pending.withProcedural;
    this.pending = null;
    this.suppressRigWhileBuilding = false;
    this.hub.programs.release(previous);
    this.hub.programs.locate(pending.entry);
    this.proceduralDirty = true;
    this.staticDirty = true;
    const message = this.failedKeys.size && (!pending.withRig || (!pending.withProcedural && isProceduralActive(this.procedural))) ? this.message : this.paletteNotice();
    this.setStatus('ready', message);
    return false;
  }

  /* ───────────── procedural engine ───────────── */

  /** Most noise octaves a procedural distortion stage may use right now: the quality level, minus the shared adaptive effort. */
  private octaveCap() {
    return Math.max(1, QUALITY_PRESETS[this.settings.quality].octaves - this.hub.budget.effort);
  }

  /** Keeps the animated state in step with the config. A disabled config keeps its state but uploads "off". */
  private syncProceduralState() {
    this.proceduralDirty = true;
    this.staticDirty = true;
    if (this.procedural) {
      if (this.proceduralState) this.proceduralState.setConfig(this.procedural);
      else this.proceduralState = createProceduralState(this.procedural, { lut: this.paletteLut, octaveCap: this.octaveCap() });
    } else if (this.proceduralState) {
      this.proceduralState.setConfig({ ...this.proceduralState.getConfig(), enabled: false });
    }
  }

  /* ───────────── lifecycle ───────────── */

  private readonly handleMotionChange = (event: MediaQueryListEvent) => {
    this.reducedMotion = event.matches;
    this.schedule();
  };

  private readonly handleVisibilityChange = () => {
    this.visible = document.visibilityState === 'visible';
    if (this.visible) this.schedule();
    else this.hub.cancelFrame(this);
  };

  private setStatus(status: InteractiveRendererStatus, message = '') {
    if (this.status === status && this.message === message) return;
    this.status = status;
    this.message = message;
    this.onStatusChange?.(status, message);
  }

  private paletteNotice() {
    return this.hub.budget.describe();
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
        else this.hub.cancelFrame(this);
      });
      this.intersectionObserver.observe(this.canvas);
    }
    // The studio preview zooms and pans with a CSS transform on `.gs-world`, which no resize observer reports. Watching its
    // style lets a layer re-measure after a zoom has settled, so a layer shown small renders small and one zoomed in sharpens.
    const world = typeof this.canvas.closest === 'function' ? this.canvas.closest('.gs-world') : null;
    if (world && typeof MutationObserver !== 'undefined') {
      this.viewObserver = new MutationObserver(() => this.scheduleViewCheck());
      this.viewObserver.observe(world, { attributes: true, attributeFilter: ['style'] });
    }
  }

  private readonly handleWindowResize = () => this.resize();

  private scheduleViewCheck() {
    if (this.viewTimer !== null) clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => { this.viewTimer = null; this.checkView(); }, VIEW_SETTLE_MS);
  }

  private checkView() {
    if (this.disposed || !this.registered) return;
    const { width } = this.displaySize();
    if (!width || Math.abs(width - this.measuredWidth) < Math.max(24, this.measuredWidth * 0.1)) return;
    this.resize();
    this.schedule();
  }

  /** The canvas as the person sees it: its layout size scaled by whatever CSS transform the preview applies. Never larger
   *  than the layout size, so zooming in cannot raise the cost of a layer. */
  private displaySize(): { width: number; height: number } {
    const canvas = this.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height || typeof canvas.getBoundingClientRect !== 'function') return { width, height };
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return { width, height };
    return {
      width: Math.max(1, Math.round(width * clamp(rect.width / width, 0.08, 1))),
      height: Math.max(1, Math.round(height * clamp(rect.height / height, 0.08, 1))),
    };
  }

  /** `measure` = the CSS size (or quality) may have changed, so the shared budget must be recomputed. */
  private resize(measure = true) {
    if (!this.registered || this.disposed || !this.hub.available) return;
    if (measure) this.hub.invalidateBudget();
    const scale = this.hub.scaleFor(this);
    const display = this.displaySize();
    this.measuredWidth = display.width;
    const { width, height } = renderSize(display.width, display.height, scale);
    this.pointer.invalidateRect();
    this.proceduralDirty = true;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      // resizing a canvas clears it, so the layer must draw again right away
      this.canvas.width = width;
      this.canvas.height = height;
      this.schedule();
    }
  }

  private schedule() {
    if (this.disposed || !this.registered || !this.visible) return;
    if (this.status !== 'ready' && this.status !== 'compiling') return;
    this.hub.requestFrame(this);
  }

  /** Draws one frame of this layer. Called by the shared frame loop; returns true when another frame is needed. */
  renderFrame(now: number): boolean {
    const gl = this.hub.gpu.gl;
    if (this.disposed || !gl || !this.visible) return false;
    if (this.pending) {
      // Keep drawing the previous program while a new one compiles; never block the main thread on a compile.
      this.pollBuild();
    }
    const entry = this.entry;
    if (this.status === 'error' || this.status === 'context-lost') return false;
    if (!entry) return this.pending !== null;
    const rawDelta = this.previousFrame ? (now - this.previousFrame) / 1000 : 0;
    const delta = Math.min(0.05, rawDelta);
    this.previousFrame = now;
    this.clock += delta;
    const motionEnabled = this.settings.animate && !this.paused && !this.reducedMotion;
    const animated = motionEnabled && this.settings.speed > 0;
    const timeScale = getFrameScheduler().timeScale;
    if (animated) this.shaderTime += delta * this.settings.speed * timeScale;
    else if (!this.settings.animate) this.shaderTime = 0;
    const budgetKey = `${this.hub.budget.globalScale}|${this.hub.budget.effort}`;
    if (budgetKey !== this.lastBudgetKey) {
      this.lastBudgetKey = budgetKey;
      if (this.status === 'ready') this.setStatus('ready', this.paletteNotice());
    }
    const pointer = this.pointer.advance(delta, this.clock);
    this.draw(gl, entry, pointer, delta, motionEnabled ? timeScale : 0, motionEnabled);

    const idleMotion = this.settings.idleMotion && !this.paused && !this.reducedMotion;
    const ambient = !this.paused && !this.reducedMotion && (this.rigAmbient || this.settings.breath > 0);
    const hovering = this.rigRuleCount() > 0 && pointer.active > 0.003;
    const proceduralSettling = this.proceduralBuilt && !!this.proceduralState && this.proceduralState.isSettling();
    const proceduralAnimating = motionEnabled && this.proceduralBuilt && !!this.proceduralState && this.proceduralState.isAnimated();
    this.animating = animated || idleMotion || ambient || proceduralAnimating;
    return animated || idleMotion || ambient || hovering || proceduralSettling || proceduralAnimating || this.pointer.hasActivity() || this.pending !== null;
  }

  private rigRuleCount() {
    return activeRules(this.settings.rig).length;
  }

  private refreshRigFlags() {
    // texture rules that drift, spin or twinkle need a frame every tick even while the pointer is away
    this.rigAmbient = activeRules(this.settings.rig).some(rule => rule.source === 'orbit' || rule.source === 'fixed'
      || (rule.source === 'symmetry' && rule.sp2 !== 0) || rule.drives.some(item => item.source.startsWith('lfo')));
  }

  /* ───────────── drawing ───────────── */

  private draw(gl: GL, entry: ProgramEntry, pointer: PointerFrame, delta: number, motionScale: number, motionEnabled: boolean) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (!this.context2d || !this.hub.useProgram(entry) || !this.hub.gpu.beginRect(width, height)) return;
    const loc = entry.uniforms;
    const settings = this.settings;
    const reaction = this.layerState.reaction;
    const reacts = settings.interactionEnabled && reaction !== 0;
    const set1f = (name: string, value: number) => gl.uniform1f(loc[name] ?? null, value);
    const set2f = (name: string, x: number, y: number) => gl.uniform2f(loc[name] ?? null, x, y);

    // the program is shared: its uniforms hold whatever the last layer wrote, so a layer re-sends its settings whenever it
    // changed or another layer drew with this program in between; when neither happened only the per-frame values go up
    const uploadStatic = this.staticDirty || entry.lastOwner !== this.id;
    if (uploadStatic) {
      this.uploadStatic(gl, loc, set1f, set2f, reaction);
      entry.lastOwner = this.id;
      this.staticDirty = false;
    }

    const idlePointer = settings.idleMotion && pointer.active < 0.003 && !this.paused && !this.reducedMotion;
    const idle = idlePointer ? idleMotionPoint(settings.idlePath, this.clock, settings.idleSpeed, settings.idleSize) : null;
    const pointerX = idle ? idle.x : pointer.x;
    const pointerY = idle ? idle.y : pointer.y;
    const pointerActive = idle ? 0.42 : pointer.active;

    set2f('uResolution', width, height);
    set2f('uPointer', pointerX, pointerY);
    set2f('uVelocity', pointer.vx, pointer.vy);
    set1f('uPointerActive', reacts || idlePointer ? pointerActive : 0);
    set1f('uInputActive', reacts && this.pointer.hasPointer() ? 1 : 0);
    set1f('uPointerDown', reacts ? pointer.down : 0);
    set1f('uTime', settings.animate ? this.shaderTime : 0);
    set1f('uClock', this.clock);
    set1f('uAspect', width / Math.max(1, height));

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteHandle?.texture ?? null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.layerMixHandle?.texture ?? null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.ruleTextureAtlas);
    gl.uniform1i(loc.uRuleTextureAtlas ?? null, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.shapeAtlas);
    gl.uniform1i(loc.uRuleShapeAtlas ?? null, 3);

    const rippleCount = this.refreshRippleData();
    set1f('uRippleCount', rippleCount);
    gl.uniform4fv(loc['uRipples[0]'] ?? null, this.rippleData);

    // procedural engine: positions, colours and forces are advanced on the CPU (12 points), the shader gets the numbers
    const procedural = this.proceduralState;
    if (procedural && this.proceduralBuilt) {
      const octaveCap = this.octaveCap();
      if (octaveCap !== this.lastOctaveCap) { this.lastOctaveCap = octaveCap; procedural.setQuality({ octaveCap }); this.proceduralDirty = true; }
      // update the simulation only when it can have changed: it moves, it is settling, the pointer is involved, or its inputs changed
      const needsStep = this.proceduralDirty || (motionEnabled && procedural.isAnimated()) || procedural.isSettling() || pointer.active > 0.003 || idle !== null || this.pointer.hasActivity();
      if (needsStep) {
        const frame = this.rigFrame;
        Object.assign(frame, pointer);
        if (idle) { frame.x = idle.x; frame.y = idle.y; frame.active = pointerActive; }
        if (!reacts && !idlePointer) { frame.active = 0; frame.down = 0; frame.t2active = 0; }
        procedural.step(delta, frame, width / Math.max(1, height), motionScale);
        this.proceduralDirty = false;
      }
      if (uploadStatic) uploadProceduralUniforms(gl, loc, procedural.buffers);
      else {
        // only the numbers that move: the colour centres, their colours, the palette-mean base colour, octave cap and clock
        const buffers = procedural.buffers;
        gl.uniform4fv(loc['uProcPoints[0]'] ?? null, buffers.points);
        gl.uniform4fv(loc['uProcColors[0]'] ?? null, buffers.colors);
        gl.uniform4fv(loc.uProcBase ?? null, buffers.base);
        gl.uniform4fv(loc.uProcC ?? null, buffers.c);
        gl.uniform4fv(loc.uProcD ?? null, buffers.d);
      }
    }

    // interaction rig: drives are evaluated on the CPU, the shader only receives the final numbers
    if (!this.builtKey.startsWith('base#') && this.rigRuleCount() > 0) {
      const frame = this.rigFrame;
      Object.assign(frame, pointer);
      frame.clock = this.clock;
      frame.trailLife = settings.rig.physics.trailLife;
      if (idle) { frame.x = idle.x; frame.y = idle.y; frame.active = pointerActive; }
      evaluateRig(settings.rig, frame, this.rigBuffers, {
        radiusScale: settings.interactionRadius,
        reaction,
        enabled: !this.suppressRigWhileBuilding && (reacts || idlePointer),
        canvasHeight: this.canvas.clientHeight || 800,
      });
      packTrail(this.pointer.getEngine(), frame, this.rigBuffers, reacts);
      const rig = this.rigBuffers;
      gl.uniform4fv(loc['uRuleB[0]'] ?? null, rig.b);
      gl.uniform4fv(loc['uRuleC[0]'] ?? null, rig.c);
      gl.uniform4fv(loc['uRuleD[0]'] ?? null, rig.d);
      gl.uniform4fv(loc['uRuleE[0]'] ?? null, rig.e);
      gl.uniform4fv(loc['uRuleF[0]'] ?? null, rig.f);
      gl.uniform4fv(loc['uRuleG[0]'] ?? null, rig.g);
      gl.uniform4fv(loc['uRuleH[0]'] ?? null, rig.h);
      gl.uniform4fv(loc['uRuleI[0]'] ?? null, rig.i);
      gl.uniform4fv(loc['uRuleJ[0]'] ?? null, rig.j);
      gl.uniform4fv(loc['uRuleK[0]'] ?? null, rig.k);
      gl.uniform4fv(loc['uTrail[0]'] ?? null, rig.trail);
      gl.uniform3f(loc.uTouch2 ?? null, pointer.t2x, pointer.t2y, reacts ? pointer.t2active : 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // copy this layer's rectangle into its own canvas right away: the shared buffer is reused by the next layer
    this.hub.gpu.copyTo(this.context2d, width, height);
  }

  /** Uniforms that follow from the layer's settings, palette, geometry and mesh (not from time or the pointer). */
  private uploadStatic(
    gl: GL,
    loc: ProgramEntry['uniforms'],
    set1f: (name: string, value: number) => void,
    set2f: (name: string, x: number, y: number) => void,
    reaction: number,
  ) {
    const settings = this.settings;
    set1f('uStyle', SHADER_STYLE_INDEX[settings.style]);
    const styleParams = this.layerState.styleParams;
    gl.uniform4f(loc.uStyleP ?? null, styleParams[0], styleParams[1], styleParams[2], styleParams[3]);
    set1f('uGradientKind', GEOMETRY_ID[this.geometry.kind]);
    set1f('uGradientAngle', this.geometry.angle * Math.PI / 180);
    set2f('uGradientOrigin', this.geometry.originX / 100, 1 - this.geometry.originY / 100);
    set2f('uGradientRadius', this.geometry.radiusX / 100, this.geometry.radiusY / 100);
    set1f('uShaderMix', settings.shaderMix);
    gl.uniform3f(loc.uInteractionColor ?? null, this.interactionColor[0], this.interactionColor[1], this.interactionColor[2]);
    gl.uniform3fv(loc['uInteractionColors[0]'] ?? null, this.interactionColorData);
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
    set1f('uMeshDrift', settings.meshDrift);
    set1f('uMeshSpread', settings.meshSpread);
    set1f('uMeshBlend', settings.meshBlend);
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
    set1f('uLayerMixEnabled', this.layerMixHandle && this.layerMix.palette.length ? 1 : 0);
    set1f('uLayerMixMode', LAYER_BLEND_ID[this.layerMix.mode]);
    set1f('uLayerMixStrength', this.layerMix.strength);
    set1f('uLayerMixSpeed', this.layerMix.speed);
    set1f('uProjectOutput', settings.renderBackend === 'webgl' ? 1 : 0);
    gl.uniform1f(loc.uStopCount ?? null, MAX_STOPS);
    gl.uniform4fv(loc['uPalette[0]'] ?? null, this.paletteColors);
    gl.uniform1fv(loc['uPaletteAlpha[0]'] ?? null, this.paletteAlphas);
    gl.uniform1f(loc.uMeshCount ?? null, this.meshPoints.length);
    gl.uniform4f(loc.uMeshBase ?? null, this.meshBaseRgb[0], this.meshBaseRgb[1], this.meshBaseRgb[2], this.meshBase ? 1 : 0);
    gl.uniform4fv(loc['uMeshPoints[0]'] ?? null, this.meshPointData);
    gl.uniform4fv(loc['uMeshColors[0]'] ?? null, this.meshColorData);
  }

  private refreshInteractionColors() {
    this.staticDirty = true;
    const rgb = hexToRgb(this.settings.interactionColor);
    this.interactionColor = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
    this.interactionColorData.fill(0);
    this.settings.interactionColors.slice(0, 5).forEach((color, index) => {
      const value = hexToRgb(color);
      this.interactionColorData.set([value.r / 255, value.g / 255, value.b / 255], index * 3);
    });
  }

  private refreshMeshBase() {
    this.staticDirty = true;
    const rgb = this.meshBase ? hexToRgb(this.meshBase) : { r: 0, g: 0, b: 0 };
    this.meshBaseRgb = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  }

  private refreshPaletteData() {
    const key = JSON.stringify([this.palette, this.geometry.space ?? 'srgb']);
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    this.staticDirty = true;
    this.paletteLut = bakeLutCached(key, this.palette, this.geometry.space);
    for (let i = 0; i < MAX_STOPS; i++) {
      const sample = Math.round(i / (MAX_STOPS - 1) * (LUT_SIZE - 1)) * 4;
      const offset = i * 4;
      this.paletteColors[offset] = this.paletteLut[sample] / 255;
      this.paletteColors[offset + 1] = this.paletteLut[sample + 1] / 255;
      this.paletteColors[offset + 2] = this.paletteLut[sample + 2] / 255;
      this.paletteColors[offset + 3] = i / (MAX_STOPS - 1);
      this.paletteAlphas[i] = this.paletteLut[sample + 3] / 255;
    }
    // procedural points take their colours from this same palette LUT
    this.proceduralState?.setPaletteLut(this.paletteLut);
    this.proceduralDirty = true;
    if (this.registered && this.hub.available) this.acquirePaletteTexture();
  }

  /** Palette textures are shared by content: layers with the same colours use one GPU texture. */
  private acquirePaletteTexture() {
    const previous = this.paletteHandle;
    this.paletteHandle = this.hub.resources.acquireLut(this.paletteKey, LUT_SIZE, () => this.paletteLut);
    this.hub.resources.releaseLut(previous);
    this.lutEnabled = this.paletteHandle !== null && this.hub.gpu.maxFragmentUniformVectors >= 16;
    this.staticDirty = true;
  }

  private acquireTextures() {
    this.acquirePaletteTexture();
    this.refreshLayerMixTexture();
  }

  private refreshLayerMixTexture() {
    if (!this.registered || !this.hub.available) return;
    if (!this.layerMix.palette.length) {
      this.hub.resources.releaseLut(this.layerMixHandle);
      this.layerMixHandle = null;
      this.layerMixKey = '';
      return;
    }
    const space = this.layerMix.space ?? this.geometry.space ?? 'srgb';
    const key = JSON.stringify([this.layerMix.palette, space]);
    if (key === this.layerMixKey && this.layerMixHandle) return;
    const previous = this.layerMixHandle;
    this.layerMixHandle = this.hub.resources.acquireLut(key, LUT_SIZE, () => bakeLutCached(key, this.layerMix.palette, space));
    this.hub.resources.releaseLut(previous);
    this.layerMixKey = this.layerMixHandle ? key : '';
    this.staticDirty = true;
  }

  private refreshMeshData() {
    this.staticDirty = true;
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
