import { layeredOutput } from '../engine/css';
import type { GradientLayer, GradientProject } from '../engine/model';
import { gradientLayerToShader, gradientProjectToShaderPalette, type ShaderLayerAdapter } from './adapter';
import { normalizeInteractiveSettings, type InteractiveSettings } from './types';
import fragmentShaderSource from './shaders/gradient.frag.glsl?raw';
import vertexShaderSource from './shaders/gradient.vert.glsl?raw';

const escapeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

function shaderRuntime() {
  return `
(function () {
  const vertexSource = ${escapeJson(vertexShaderSource)};
  const fragmentSource = ${escapeJson(fragmentShaderSource)};
  const maxStops = 8, maxRipples = 8;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const glOptions = { alpha: true, antialias: false, depth: false, premultipliedAlpha: false, powerPreference: 'low-power' };
  document.querySelectorAll('[data-shader-canvas]').forEach(canvas => {
  const settings = JSON.parse(canvas.dataset.shaderSettings);
  const palette = JSON.parse(canvas.dataset.shaderPalette);
  const geometry = JSON.parse(canvas.dataset.shaderGeometry);
  const meshPoints = JSON.parse(canvas.dataset.shaderMeshPoints || '[]');
  const meshBase = JSON.parse(canvas.dataset.shaderMeshBase || '""');
  let gl = canvas.getContext('webgl2', glOptions), isWebGL2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', glOptions);
  if (!gl) { canvas.dataset.shaderStatus = 'fallback'; return; }
  let program = null, buffer = null, locations = {}, positionAttribute = -1, uvAttribute = -1;
  let frameId = 0, lastFrame = 0, clock = 0, visible = true, lost = false;
  let current = { x: 0.5, y: 0.5, active: 0, down: 0 }, target = { x: 0.5, y: 0.5, active: 0, down: 0 };
  let velocity = { x: 0, y: 0 }, ripples = [];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const convertShader = (source, vertex) => {
    if (!isWebGL2) return source;
    if (vertex) return '#version 300 es\\n' + source.replace(/\\battribute\\b/g, 'in').replace(/\\bvarying\\b/g, 'out');
    return '#version 300 es\\n' + source.replace(/\\bvarying\\b/g, 'in').replace(/\\bgl_FragColor\\b/g, 'fragmentColor').replace('precision highp float;', 'precision highp float;\\nout vec4 fragmentColor;');
  };
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not allocate a shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error.';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  };
  const initialize = () => {
    const vertex = compile(gl.VERTEX_SHADER, convertShader(vertexSource, true));
    const fragment = compile(gl.FRAGMENT_SHADER, convertShader(fragmentSource, false));
    const next = gl.createProgram();
    if (!next) throw new Error('Could not allocate the shader program.');
    gl.attachShader(next, vertex);
    gl.attachShader(next, fragment);
    gl.linkProgram(next);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(next, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(next) || 'Unknown shader link error.';
      gl.deleteProgram(next);
      throw new Error(message);
    }
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    program = next;
    buffer = gl.createBuffer();
    if (!buffer) throw new Error('Could not allocate the vertex buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1,
      -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.useProgram(program);
    positionAttribute = gl.getAttribLocation(program, 'aPosition');
    uvAttribute = gl.getAttribLocation(program, 'aUv');
    gl.enableVertexAttribArray(positionAttribute);
    gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvAttribute);
    gl.vertexAttribPointer(uvAttribute, 2, gl.FLOAT, false, 16, 8);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    locations = {};
    [
      'uResolution', 'uPointer', 'uVelocity', 'uPointerActive', 'uPointerDown', 'uTime', 'uClock', 'uAspect',
      'uStyle', 'uGradientKind', 'uGradientAngle', 'uGradientOrigin', 'uGradientRadius', 'uPointerMode', 'uInteractionColor', 'uStopCount', 'uSpeed', 'uIntensity', 'uDistortion', 'uDistortionScale',
      'uTurbulence', 'uInteractionRadius', 'uInteractionStrength', 'uGlow', 'uRippleStrength', 'uRippleSpeed',
      'uRippleCount', 'uMeshCount', 'uMeshBase', 'uMeshPoints[0]', 'uMeshColors[0]',
      'uPalette[0]', 'uPaletteAlpha[0]', 'uRipples[0]',
    ].forEach(name => { locations[name] = gl.getUniformLocation(program, name); });
    canvas.dataset.shaderStatus = 'ready';
  };
  const resize = () => {
    if (!gl || lost) return;
    const widthCss = canvas.clientWidth, heightCss = canvas.clientHeight;
    const quality = { low: 0.55, medium: 0.75, high: 1, ultra: 1.35 }[settings.quality] || 1;
    const scale = clamp((window.devicePixelRatio || 1) * quality * settings.resolutionScale, 0.35, 2);
    const width = Math.max(1, Math.min(4096, Math.round(widthCss * scale)));
    const height = Math.max(1, Math.min(4096, Math.round(heightCss * scale)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      schedule();
    }
  };
  const draw = (delta) => {
    const smoothing = 1 - Math.exp(-delta * 12);
    const oldX = current.x, oldY = current.y;
    current.x += (target.x - current.x) * smoothing;
    current.y += (target.y - current.y) * smoothing;
    current.active += (target.active - current.active) * smoothing;
    current.down += (target.down - current.down) * smoothing;
    velocity.x = clamp((current.x - oldX) / Math.max(delta, 1 / 240), -2, 2);
    velocity.y = clamp((current.y - oldY) / Math.max(delta, 1 / 240), -2, 2);
    ripples = ripples.filter(ripple => clock - ripple[2] < 5);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(locations.uResolution, canvas.width, canvas.height);
    gl.uniform2f(locations.uPointer, current.x, current.y);
    gl.uniform2f(locations.uVelocity, velocity.x, velocity.y);
    gl.uniform1f(locations.uPointerActive, settings.interactionEnabled ? current.active : 0);
    gl.uniform1f(locations.uPointerDown, settings.interactionEnabled ? current.down : 0);
    const animated = settings.animate && !reducedMotion.matches;
    gl.uniform1f(locations.uTime, animated ? clock * settings.speed : 0);
    gl.uniform1f(locations.uClock, clock);
    gl.uniform1f(locations.uAspect, canvas.width / Math.max(1, canvas.height));
    gl.uniform1f(locations.uStyle, { flow: 0, aurora: 1, liquid: 2, holographic: 3, plasma: 4, silk: 5, nebula: 6, ribbons: 7, metaballs: 8, contours: 9 }[settings.style] || 0);
    gl.uniform1f(locations.uGradientKind, { linear: 0, radial: 1, conic: 2, curve: 3, mesh: 4, noise: 5 }[geometry.kind] || 0);
    gl.uniform1f(locations.uGradientAngle, geometry.angle * Math.PI / 180);
    gl.uniform2f(locations.uGradientOrigin, geometry.originX / 100, 1 - geometry.originY / 100);
    gl.uniform2f(locations.uGradientRadius, geometry.radiusX / 100, geometry.radiusY / 100);
    gl.uniform1f(locations.uPointerMode, {
      attract: 0, repel: 1, swirl: 2, glow: 3, drag: 4, wave: 5, orbit: 6,
      magnet: 7, ripple: 8, pulse: 9, trail: 10, spotlight: 11, hue: 12,
    }[settings.pointerMode] ?? 2);
    const interactionHex = /^#[0-9a-f]{6}$/i.test(settings.interactionColor) ? settings.interactionColor.slice(1) : 'ffffff';
    const interactionRgb = parseInt(interactionHex, 16);
    gl.uniform3f(locations.uInteractionColor, ((interactionRgb >> 16) & 255) / 255, ((interactionRgb >> 8) & 255) / 255, (interactionRgb & 255) / 255);
    gl.uniform1f(locations.uSpeed, settings.speed);
    gl.uniform1f(locations.uIntensity, settings.intensity);
    gl.uniform1f(locations.uDistortion, settings.distortion);
    gl.uniform1f(locations.uDistortionScale, settings.distortionScale);
    gl.uniform1f(locations.uTurbulence, settings.turbulence);
    gl.uniform1f(locations.uInteractionRadius, settings.interactionRadius);
    gl.uniform1f(locations.uInteractionStrength, settings.interactionStrength);
    gl.uniform1f(locations.uGlow, settings.glow);
    gl.uniform1f(locations.uRippleStrength, settings.rippleStrength);
    gl.uniform1f(locations.uRippleSpeed, settings.rippleSpeed);
    const stops = palette.slice(0, maxStops), colors = new Float32Array(maxStops * 4), alphas = new Float32Array(maxStops);
    for (let i = 0; i < maxStops; i++) {
      const stop = stops[Math.min(i, stops.length - 1)];
      const hex = stop.color.replace('#', '');
      const number = parseInt(hex, 16);
      colors.set([((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255, stop.position], i * 4);
      alphas[i] = stop.alpha == null ? 1 : stop.alpha;
    }
    gl.uniform1f(locations.uStopCount, stops.length);
    gl.uniform4fv(locations['uPalette[0]'], colors);
    gl.uniform1fv(locations['uPaletteAlpha[0]'], alphas);
    const meshPointData = new Float32Array(maxStops * 4);
    const meshColorData = new Float32Array(maxStops * 4);
    meshPoints.slice(0, maxStops).forEach((point, index) => {
      const number = parseInt(point.color.replace('#', ''), 16);
      meshPointData.set([point.x / 100, 1 - point.y / 100, point.size / 100, point.alpha], index * 4);
      meshColorData.set([((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255, 1], index * 4);
    });
    const baseNumber = meshBase ? parseInt(meshBase.replace('#', ''), 16) : 0;
    gl.uniform1f(locations.uMeshCount, Math.min(meshPoints.length, maxStops));
    gl.uniform4f(locations.uMeshBase, ((baseNumber >> 16) & 255) / 255, ((baseNumber >> 8) & 255) / 255, (baseNumber & 255) / 255, meshBase ? 1 : 0);
    gl.uniform4fv(locations['uMeshPoints[0]'], meshPointData);
    gl.uniform4fv(locations['uMeshColors[0]'], meshColorData);
    const rippleData = new Float32Array(maxRipples * 4);
    const activeRipples = settings.ripplesEnabled ? ripples.slice(-maxRipples) : [];
    activeRipples.forEach((ripple, index) => rippleData.set([ripple[0], ripple[1], ripple[2], 1], index * 4));
    gl.uniform1f(locations.uRippleCount, activeRipples.length);
    gl.uniform4fv(locations['uRipples[0]'], rippleData);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const schedule = () => {
    if (!frameId && visible && !lost) frameId = requestAnimationFrame(render);
  };
  const render = now => {
    frameId = 0;
    if (lost || !visible) return;
    const delta = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    clock += delta;
    draw(delta);
    const moving = Math.abs(target.x - current.x) > 0.001 || Math.abs(target.y - current.y) > 0.001 ||
      Math.abs(target.active - current.active) > 0.003 || Math.abs(target.down - current.down) > 0.003;
    if ((settings.animate && !reducedMotion.matches) || moving || ripples.length) schedule();
  };
  const updatePointer = event => {
    if (event.pointerType === 'touch' && !settings.touchEnabled) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    target.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    target.y = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);
    target.active = 1;
    schedule();
  };
  const onMove = event => { if (settings.interactionEnabled) updatePointer(event); };
  const onDown = event => {
    if (!settings.interactionEnabled || (event.pointerType === 'touch' && !settings.touchEnabled)) return;
    updatePointer(event);
    target.down = 1;
    if (settings.ripplesEnabled) {
      ripples.push([target.x, target.y, clock, 1]);
      ripples = ripples.slice(-clamp(settings.maximumRipples, 1, maxRipples));
    }
    schedule();
  };
  const onUp = () => { target.down = 0; schedule(); };
  const onLeave = () => { target.active = 0; target.down = 0; schedule(); };
  const onLost = event => { event.preventDefault(); lost = true; cancelAnimationFrame(frameId); frameId = 0; canvas.dataset.shaderStatus = 'context-lost'; };
  const onRestored = () => {
    try { gl = canvas.getContext(isWebGL2 ? 'webgl2' : 'webgl', glOptions); lost = false; initialize(); resize(); schedule(); }
    catch (error) { canvas.dataset.shaderStatus = 'error'; canvas.dataset.shaderError = String(error); }
  };
  const onVisibility = () => { visible = document.visibilityState === 'visible'; if (visible) schedule(); else { cancelAnimationFrame(frameId); frameId = 0; } };
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerdown', onDown, { passive: true });
  canvas.addEventListener('pointerup', onUp, { passive: true });
  canvas.addEventListener('pointercancel', onUp, { passive: true });
  canvas.addEventListener('pointerleave', onLeave, { passive: true });
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  document.addEventListener('visibilitychange', onVisibility);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (observer) observer.observe(canvas); else window.addEventListener('resize', resize);
  const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) schedule(); else { cancelAnimationFrame(frameId); frameId = 0; } }) : null;
  if (intersection) intersection.observe(canvas);
  const motion = () => schedule();
  reducedMotion.addEventListener('change', motion);
  try { initialize(); resize(); schedule(); }
  catch (error) { canvas.dataset.shaderStatus = 'error'; canvas.dataset.shaderError = String(error); }
  return () => {
    cancelAnimationFrame(frameId);
    observer && observer.disconnect();
    intersection && intersection.disconnect();
    reducedMotion.removeEventListener('change', motion);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
  };
  });
})();
`;
}

function makeDocument(project: GradientProject, useMarkers = false) {
  const layers = layeredOutput(project);
  const defaultSettings = normalizeInteractiveSettings(project.shader);
  const visibleLayers = project.layers.filter(layer => layer.visible);
  const enabledLayers = visibleLayers.filter(layer => layer.shader?.enabled);
  const targets = enabledLayers.length ? enabledLayers : visibleLayers.slice(0, 1);
  const fallbackPalette = gradientProjectToShaderPalette(project);
  const entries: { layer: GradientLayer | null; settings: InteractiveSettings; adapter: ShaderLayerAdapter }[] = targets.map(layer => ({
    layer,
    settings: { ...defaultSettings, style: layer.shader?.style ?? defaultSettings.style },
    adapter: gradientLayerToShader(layer, project),
  }));
  if (!entries.length) {
    entries.push({
      layer: null,
      settings: defaultSettings,
      adapter: { ...fallbackPalette, geometry: { kind: 'linear' as const, angle: 135, originX: 50, originY: 50, radiusX: 50, radiusY: 50 }, meshPoints: [], meshBase: '' },
    });
  }
  const paletteAdapter = { ...entries[0].adapter, notes: entries.flatMap(entry => entry.adapter.notes) };
  const rowMatches = [...layers.html.matchAll(/^  <i class="[^"]*">/gm)];
  const layerOrder = [...visibleLayers].reverse();
  const escapeAttribute = (value: unknown) => escapeJson(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  let html = layers.html;
  entries.forEach((entry, index) => {
    const rowIndex = entry.layer ? layerOrder.findIndex(layer => layer.id === entry.layer?.id) : -1;
    const row = rowIndex >= 0 ? rowMatches[rowIndex]?.[0] : undefined;
    const attributes = useMarkers
      ? `data-shader-settings="__SHADER_CONFIG_${index}__" data-shader-palette="__SHADER_PALETTE_${index}__" data-shader-geometry="__SHADER_GEOMETRY_${index}__" data-shader-mesh-points="__SHADER_MESH_POINTS_${index}__" data-shader-mesh-base="__SHADER_MESH_BASE_${index}__"`
      : `data-shader-settings="${escapeAttribute(entry.settings)}" data-shader-palette="${escapeAttribute(entry.adapter.palette)}" data-shader-geometry="${escapeAttribute(entry.adapter.geometry)}" data-shader-mesh-points="${escapeAttribute(entry.adapter.meshPoints)}" data-shader-mesh-base="${escapeAttribute(entry.adapter.meshBase)}"`;
    const canvas = `<canvas data-shader-canvas ${attributes} aria-hidden="true" style="position:absolute;inset:0;z-index:1;width:100%;height:100%;pointer-events:auto;touch-action:pan-y"></canvas>`;
    if (row) {
      html = html.replace(row, `${row.replace(/">$/, ' gs-shader-export-layer">')}${canvas}`);
    } else {
      const rootStart = html.indexOf('>');
      if (rootStart >= 0) html = `${html.slice(0, rootStart + 1)}${canvas}${html.slice(rootStart + 1)}`;
    }
  });
  const body = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Interactive gradient background</title>',
    `<style>html,body{margin:0;min-height:100%;}body{min-height:100vh;}canvas[data-shader-canvas]{display:block;} .gs-shader-export-layer::after{z-index:2;}</style>`,
    `</head><body>${html}`,
    `<script>${shaderRuntime()}</script>`,
    '</body></html>',
  ].join('\n');
  return { body, palette: paletteAdapter, entries };
}

export function interactiveHtmlExport(project: GradientProject) {
  const { body, palette } = makeDocument(project);
  const note = palette.notes.map(message => `<!-- ${message.replace(/--/g, '—')} -->`).join('\n');
  return `${note ? `${note}\n` : ''}${body}`;
}

export function interactiveGlslExport() {
  return [
    '// ShapeForge interactive gradient shader sources',
    '// Vertex shader: aPosition (clip-space vec2), aUv (normalized vec2).',
    '// Fragment shader uniforms: uResolution, uPointer, uVelocity, uPointerActive, uPointerDown,',
    '// uTime, uClock, uAspect, uStyle (flow / aurora / liquid / holographic / plasma / silk / nebula / ribbons / metaballs / contours), uPointerMode,',
    '// uGradientKind (linear/radial/conic), uGradientAngle, uGradientOrigin, uGradientRadius,',
    '// uInteractionColor, uStopCount, uPalette[8], uPaletteAlpha[8], uMeshCount, uMeshPoints[8], uMeshColors[8], uMeshBase, and uRipples[8].',
    '// Additional controls: uSpeed, uIntensity, uDistortion, uDistortionScale, uTurbulence,',
    '// uInteractionRadius, uInteractionStrength, uGlow, uRippleStrength, uRippleSpeed, uRippleCount.',
    '',
    '// --- vertex.glsl ---',
    vertexShaderSource,
    '',
    '// --- fragment.glsl ---',
    fragmentShaderSource,
  ].join('\n');
}

export function interactiveReactExport(project: GradientProject) {
  const { body, entries } = makeDocument(project, true);
  const template = escapeJson(body);
  const settings = entries.map(entry => entry.settings);
  const palettes = entries.map(entry => entry.adapter.palette);
  const geometries = entries.map(entry => entry.adapter.geometry);
  const meshPoints = entries.map(entry => entry.adapter.meshPoints);
  const meshBases = entries.map(entry => entry.adapter.meshBase);
  return `import { useMemo } from 'react';
import type { CSSProperties } from 'react';

export interface ShaderSettings {
  enabled: boolean;
  style: 'flow' | 'aurora' | 'liquid' | 'holographic' | 'plasma' | 'silk' | 'nebula' | 'ribbons' | 'metaballs' | 'contours';
  quality: 'low' | 'medium' | 'high' | 'ultra';
  resolutionScale: number;
  animate: boolean;
  speed: number;
  intensity: number;
  distortion: number;
  distortionScale: number;
  turbulence: number;
  interactionEnabled: boolean;
  touchEnabled: boolean;
  pointerMode: 'attract' | 'repel' | 'swirl' | 'glow' | 'drag' | 'wave' | 'orbit' | 'magnet' | 'ripple' | 'pulse' | 'trail' | 'spotlight' | 'hue';
  interactionColor: string;
  interactionRadius: number;
  interactionStrength: number;
  glow: number;
  ripplesEnabled: boolean;
  rippleStrength: number;
  rippleSpeed: number;
  maximumRipples: number;
}

export interface ShaderStop { color: string; position: number; alpha?: number }
export interface ShaderGeometry { kind: 'linear' | 'radial' | 'conic' | 'curve' | 'mesh' | 'noise'; angle: number; originX: number; originY: number; radiusX: number; radiusY: number }
export interface ShaderMeshPoint { color: string; x: number; y: number; size: number; alpha: number }
export interface InteractiveGradientProps {
  settings?: Partial<ShaderSettings>;
  palette?: ShaderStop[];
  geometry?: ShaderGeometry;
  meshPoints?: ShaderMeshPoint[];
  meshBase?: string;
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_SETTINGS: ShaderSettings[] = ${escapeJson(settings)};
const DEFAULT_PALETTES: ShaderStop[][] = ${escapeJson(palettes)};
const DEFAULT_GEOMETRIES: ShaderGeometry[] = ${escapeJson(geometries)};
const DEFAULT_MESH_POINTS: ShaderMeshPoint[][] = ${escapeJson(meshPoints)};
const DEFAULT_MESH_BASES: string[] = ${escapeJson(meshBases)};
const HTML_TEMPLATE = ${template};
const escapeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e').replace(/&/g, '\\\\u0026');
const escapeAttribute = (value: unknown) => escapeJson(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export default function InteractiveGradientBackground({ settings, palette, geometry, meshPoints, meshBase, className, style }: InteractiveGradientProps) {
  const srcDoc = useMemo(() => HTML_TEMPLATE
    .replace(/__SHADER_CONFIG_(\\d+)__/g, (_match, index: string) => {
      const layerSettings = DEFAULT_SETTINGS[Number(index)];
      const merged = { ...layerSettings, ...settings };
      if (settings?.style === undefined) merged.style = layerSettings.style;
      return escapeAttribute(merged);
    })
    .replace(/__SHADER_PALETTE_(\\d+)__/g, (_match, index: string) => escapeAttribute(palette ?? DEFAULT_PALETTES[Number(index)]))
    .replace(/__SHADER_GEOMETRY_(\\d+)__/g, (_match, index: string) => escapeAttribute(geometry ?? DEFAULT_GEOMETRIES[Number(index)]))
    .replace(/__SHADER_MESH_POINTS_(\\d+)__/g, (_match, index: string) => escapeAttribute(meshPoints ?? DEFAULT_MESH_POINTS[Number(index)]))
    .replace(/__SHADER_MESH_BASE_(\\d+)__/g, (_match, index: string) => escapeAttribute(meshBase ?? DEFAULT_MESH_BASES[Number(index)])), [settings, palette, geometry, meshPoints, meshBase]);
  return <iframe
    title="Interactive gradient background"
    className={className}
    style={{ display: 'block', width: '100%', height: '100%', border: 0, ...style }}
    sandbox="allow-scripts"
    srcDoc={srcDoc}
  />;
}
`;
}

export function interactiveExports(project: GradientProject) {
  return {
    html: interactiveHtmlExport(project),
    glsl: interactiveGlslExport(),
    react: interactiveReactExport(project),
  };
}
