import { layeredOutput } from '../engine/css';
import type { ColorSpace, GradientLayer, GradientProject } from '../engine/model';
import { gradientLayerToShader, gradientProjectToShaderPalette, interactionColorsForLayer, supportsDirectShaderGeometry, type ShaderLayerAdapter } from './adapter';
import { normalizeInteractiveSettings, type InteractiveSettings, type ShaderLayerColorBlend } from './types';
import { POINTER_MODES } from './pointerModes';
import { bakePaletteLut, encodePaletteLut } from './paletteLut';
import { UNIFORM_NAMES } from './uniforms';
import fragmentShaderSource from './shaders/gradient.frag.glsl?raw';
import vertexShaderSource from './shaders/gradient.vert.glsl?raw';

const escapeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

function shaderRuntime(rootExpression = 'document') {
  return `
(function (root) {
  const vertexSource = ${escapeJson(vertexShaderSource)};
  const fragmentSource = ${escapeJson(fragmentShaderSource)};
  const maxStops = 8, maxRipples = 8, maxRenderPixels = 1200000, maxRenderScale = 1.25;
  const uniformNames = ${JSON.stringify(UNIFORM_NAMES)};
  const pointerModeIds = ${JSON.stringify(Object.fromEntries(POINTER_MODES.map((mode, index) => [mode.id, index])))};
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const glOptions = { alpha: true, antialias: false, depth: false, premultipliedAlpha: false, powerPreference: 'default' };
  root.querySelectorAll('[data-shader-canvas]').forEach(canvas => {
  const settings = JSON.parse(canvas.dataset.shaderSettings);
  const palette = JSON.parse(canvas.dataset.shaderPalette);
  if (!palette.length) palette.push({ color: '#7c5cff', position: 0 }, { color: '#22d3ee', position: 1 });
  const geometry = JSON.parse(canvas.dataset.shaderGeometry);
  const meshPoints = JSON.parse(canvas.dataset.shaderMeshPoints || '[]');
  const meshBase = JSON.parse(canvas.dataset.shaderMeshBase || '""');
  const layerMix = JSON.parse(canvas.dataset.shaderMixSettings || '{}');
  let gl = canvas.getContext('webgl2', glOptions), isWebGL2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', glOptions);
  if (!gl) { canvas.dataset.shaderStatus = 'fallback'; return; }
  let program = null, buffer = null, paletteTexture = null, layerMixTexture = null, locations = {}, positionAttribute = -1, uvAttribute = -1;
  let frameId = 0, lastFrame = 0, clock = 0, shaderTime = 0, visible = true, lost = false;
  let frameEma = 0, slowFrameCount = 0, adaptiveScale = 1;
  let current = { x: 0.5, y: 0.5, active: 0, down: 0 }, target = { x: 0.5, y: 0.5, active: 0, down: 0 };
  let velocity = { x: 0, y: 0 }, ripples = [];
  const colors = new Float32Array(maxStops * 4), alphas = new Float32Array(maxStops);
  const meshPointData = new Float32Array(maxStops * 4), meshColorData = new Float32Array(maxStops * 4);
  const rippleData = new Float32Array(maxRipples * 4);
  let paletteLut = null;
  let layerMixLut = null;
  const encodedLut = canvas.dataset.shaderLut || '';
  if (encodedLut) {
    const binary = atob(encodedLut);
    paletteLut = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) paletteLut[i] = binary.charCodeAt(i);
  }
  const encodedLayerMixLut = canvas.dataset.shaderMixLut || '';
  if (encodedLayerMixLut) {
    const binary = atob(encodedLayerMixLut);
    layerMixLut = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) layerMixLut[i] = binary.charCodeAt(i);
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const convertShader = (source, vertex) => {
    if (!isWebGL2) return source;
    if (vertex) return '#version 300 es\\n' + source.replace(/\\battribute\\b/g, 'in').replace(/\\bvarying\\b/g, 'out');
    return '#version 300 es\\n' + source.replace(/\\bvarying\\b/g, 'in').replace(/\\bgl_FragColor\\b/g, 'fragmentColor').replace(/\\btexture2D\\b/g, 'texture').replace('precision highp float;', 'precision highp float;\\nout vec4 fragmentColor;');
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
  const colorAt = (stop) => {
    const number = parseInt((stop.color || '#000000').replace('#', ''), 16);
    return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255, stop.alpha == null ? 1 : stop.alpha];
  };
  const sampleFallback = (t) => {
    if (t <= palette[0].position) return colorAt(palette[0]);
    let index = 0;
    while (index < palette.length - 2 && palette[index + 1].position <= t) index++;
    const from = palette[index], to = palette[index + 1];
    if (!to || t >= palette[palette.length - 1].position) return colorAt(palette[palette.length - 1]);
    let f = from.hard ? 0 : clamp((t - from.position) / Math.max(1e-9, to.position - from.position), 0, 1);
    if (!from.hard && from.mid != null && !from.curve && Math.abs(from.mid - 50) > 0.5) f = Math.pow(f, Math.log(0.5) / Math.log(clamp(from.mid / 100, 0.005, 0.995)));
    if (!from.hard && from.curve) {
      const bezier = (x, a, b) => 3 * (1 - x) * (1 - x) * x * a + 3 * (1 - x) * x * x * b + x * x * x;
      let lo = 0, hi = 1;
      for (let k = 0; k < 18; k++) { const at = (lo + hi) / 2; if (bezier(at, from.curve.x1, from.curve.x2) < f) lo = at; else hi = at; }
      f = bezier((lo + hi) / 2, from.curve.y1, from.curve.y2);
    }
    const a = colorAt(from), b = colorAt(to);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
  };
  for (let i = 0; i < maxStops; i++) {
    const t = i / (maxStops - 1), sample = paletteLut && paletteLut.length === 512 * 4
      ? (() => { const at = Math.round(t * 511) * 4; return [paletteLut[at] / 255, paletteLut[at + 1] / 255, paletteLut[at + 2] / 255, paletteLut[at + 3] / 255]; })()
      : sampleFallback(t);
    colors.set([sample[0], sample[1], sample[2], t], i * 4);
    alphas[i] = sample[3];
  }
  meshPoints.slice(0, maxStops).forEach((point, index) => {
    const color = colorAt(point);
    meshPointData.set([point.x / 100, 1 - point.y / 100, point.size / 100, point.alpha], index * 4);
    meshColorData.set([color[0], color[1], color[2], 1], index * 4);
  });
  let cachedRippleCount = -1;
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
    uniformNames.forEach(name => { locations[name] = gl.getUniformLocation(program, name); });
    gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
    paletteTexture = null;
    if (paletteLut && paletteLut.length === 512 * 4) {
      paletteTexture = gl.createTexture();
      if (paletteTexture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteLut);
        if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(paletteTexture); paletteTexture = null; }
      }
    }
    if (layerMixLut && layerMixLut.length === 512 * 4) {
      layerMixTexture = gl.createTexture();
      if (layerMixTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, layerMixTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, layerMixLut);
        if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(layerMixTexture); layerMixTexture = null; }
      }
    }
    gl.uniform1i(locations.uPaletteLut, 0);
    gl.uniform1i(locations.uLayerMixLut, 1);
    canvas.dataset.shaderStatus = 'ready';
    if (settings.renderBackend === 'webgl') canvas.parentElement && canvas.parentElement.classList.add('gs-webgl-ready');
  };
  const resize = () => {
    if (!gl || lost) return;
    const widthCss = canvas.clientWidth, heightCss = canvas.clientHeight;
    const quality = { low: 0.55, medium: 0.75, high: 1, ultra: 1.35 }[settings.quality] || 1;
    const pixelBudgetScale = Math.sqrt(maxRenderPixels / Math.max(1, widthCss * heightCss));
    const scale = clamp(Math.min(Math.min(window.devicePixelRatio || 1, 2) * quality * settings.resolutionScale * adaptiveScale, maxRenderScale, pixelBudgetScale), 0.35, maxRenderScale);
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
    const delaySeconds = settings.interactionDelay / 1000;
    const smoothing = delaySeconds === 0 ? 1 : 1 - Math.exp(-delta / delaySeconds);
    const oldX = current.x, oldY = current.y;
    current.x += (target.x - current.x) * smoothing;
    current.y += (target.y - current.y) * smoothing;
    current.active += (target.active - current.active) * smoothing;
    current.down += (target.down - current.down) * smoothing;
    velocity.x = clamp((current.x - oldX) / Math.max(delta, 1 / 240), -2, 2);
    velocity.y = clamp((current.y - oldY) / Math.max(delta, 1 / 240), -2, 2);
    for (let i = ripples.length - 1; i >= 0; i--) if (clock - ripples[i][2] >= 5) ripples.splice(i, 1);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(locations.uResolution, canvas.width, canvas.height);
    const idlePointer = settings.idleMotion && current.active < 0.003 && !reducedMotion.matches;
    const pointerX = idlePointer ? 0.5 + Math.sin(clock * 0.17) * 0.28 : current.x;
    const pointerY = idlePointer ? 0.5 + Math.sin(clock * 0.23 + 1.4) * 0.24 : current.y;
    gl.uniform2f(locations.uPointer, pointerX, pointerY);
    gl.uniform2f(locations.uVelocity, velocity.x, velocity.y);
    gl.uniform1f(locations.uPointerActive, settings.interactionEnabled || idlePointer ? (idlePointer ? 0.42 : current.active) : 0);
    gl.uniform1f(locations.uPointerDown, settings.interactionEnabled ? current.down : 0);
    const animated = settings.animate && !reducedMotion.matches;
    if (animated) shaderTime += delta * settings.speed;
    else if (!settings.animate) shaderTime = 0;
    gl.uniform1f(locations.uTime, settings.animate ? shaderTime : 0);
    gl.uniform1f(locations.uClock, clock);
    gl.uniform1f(locations.uAspect, canvas.width / Math.max(1, canvas.height));
    gl.uniform1f(locations.uStyle, { flow: 0, aurora: 1, liquid: 2, holographic: 3, plasma: 4, silk: 5, nebula: 6, ribbons: 7, metaballs: 8, contours: 9, smoke: 10, fire: 11 }[settings.style] || 0);
    gl.uniform1f(locations.uGradientKind, { linear: 0, radial: 1, conic: 2, curve: 3, mesh: 4, noise: 5 }[geometry.kind] || 0);
    gl.uniform1f(locations.uGradientAngle, geometry.angle * Math.PI / 180);
    gl.uniform2f(locations.uGradientOrigin, geometry.originX / 100, 1 - geometry.originY / 100);
    gl.uniform2f(locations.uGradientRadius, geometry.radiusX / 100, geometry.radiusY / 100);
    gl.uniform1f(locations.uShaderMix, clamp(settings.shaderMix == null ? 1 : settings.shaderMix, 0, 1));
    gl.uniform1f(locations.uPointerMode, pointerModeIds[settings.pointerMode] ?? 2);
    const interactionHex = /^#[0-9a-f]{6}$/i.test(settings.interactionColor) ? settings.interactionColor.slice(1) : 'ffffff';
    const interactionRgb = parseInt(interactionHex, 16);
    gl.uniform3f(locations.uInteractionColor, ((interactionRgb >> 16) & 255) / 255, ((interactionRgb >> 8) & 255) / 255, (interactionRgb & 255) / 255);
    const interactionColors = new Float32Array(5 * 3);
    settings.interactionColors.slice(0, 5).forEach((color, index) => {
      const number = parseInt(color.slice(1), 16);
      interactionColors.set([((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255], index * 3);
    });
    gl.uniform3fv(locations['uInteractionColors[0]'], interactionColors);
    gl.uniform1f(locations.uInteractionColorCount, Math.min(5, settings.interactionColors.length));
    gl.uniform1f(locations.uInteractionColorMix, settings.interactionColorMix);
    gl.uniform1f(locations.uInteractionColorSpeed, settings.interactionColorSpeed);
    gl.uniform1f(locations.uInteractionFalloff, { soft: 0, linear: 1, sharp: 2, gaussian: 3 }[settings.interactionFalloff]);
    gl.uniform1f(locations.uInteractionDistortion, settings.interactionDistortion);
    gl.uniform1f(locations.uInteractionDisplacement, settings.interactionDisplacement);
    gl.uniform1f(locations.uInteractionDisplacementMode, settings.interactionDisplacementMode === 'push' ? 0 : 1);
    gl.uniform1f(locations.uInteractionVelocityReaction, settings.interactionVelocityReaction);
    gl.uniform1f(locations.uInteractionGlitch, settings.interactionGlitch);
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
    gl.uniform1f(locations.uOctaves, ({ low: 3, medium: 4, high: 5, ultra: 6 })[settings.quality] || 5);
    gl.uniform1f(locations.uWarpDepth, settings.quality === 'low' ? 1 : 2);
    gl.uniform1f(locations.uWrapMode, settings.paletteWrap === 'repeat' ? 2 : 0);
    gl.uniform1f(locations.uToneMap, settings.toneMapping || 0);
    gl.uniform1f(locations.uVignette, settings.vignette || 0);
    gl.uniform1f(locations.uSheen, settings.sheen || 0);
    gl.uniform1f(locations.uGrain, settings.filmGrain || 0);
    gl.uniform1f(locations.uLutEnabled, paletteTexture ? 1 : 0);
    gl.uniform1f(locations.uLayerMixEnabled, layerMixTexture ? 1 : 0);
    gl.uniform1f(locations.uLayerMixMode, ({ mix: 0, multiply: 1, screen: 2, overlay: 3, add: 4 })[layerMix.mode] ?? 0);
    gl.uniform1f(locations.uLayerMixStrength, clamp(layerMix.strength || 0, 0, 1));
    gl.uniform1f(locations.uLayerMixSpeed, clamp(layerMix.speed || 0, 0, 2));
    gl.uniform1f(locations.uProjectOutput, settings.renderBackend === 'webgl' ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.uniform1i(locations.uPaletteLut, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, layerMixTexture);
    gl.uniform1i(locations.uLayerMixLut, 1);
    gl.uniform1f(locations.uStopCount, maxStops);
    gl.uniform4fv(locations['uPalette[0]'], colors);
    gl.uniform1fv(locations['uPaletteAlpha[0]'], alphas);
    const baseNumber = meshBase ? parseInt(meshBase.replace('#', ''), 16) : 0;
    gl.uniform1f(locations.uMeshCount, Math.min(meshPoints.length, maxStops));
    gl.uniform4f(locations.uMeshBase, ((baseNumber >> 16) & 255) / 255, ((baseNumber >> 8) & 255) / 255, (baseNumber & 255) / 255, meshBase ? 1 : 0);
    gl.uniform4fv(locations['uMeshPoints[0]'], meshPointData);
    gl.uniform4fv(locations['uMeshColors[0]'], meshColorData);
    const start = settings.ripplesEnabled ? Math.max(0, ripples.length - maxRipples) : ripples.length;
    const activeCount = ripples.length - start;
    let rippleChanged = activeCount !== cachedRippleCount;
    if (!rippleChanged) {
      for (let i = 0; i < activeCount; i++) {
        const ripple = ripples[start + i], offset = i * 4;
        if (rippleData[offset] !== ripple[0] || rippleData[offset + 1] !== ripple[1] || rippleData[offset + 2] !== ripple[2]) { rippleChanged = true; break; }
      }
    }
    if (rippleChanged) {
      rippleData.fill(0);
      for (let i = 0; i < activeCount; i++) {
        const ripple = ripples[start + i], offset = i * 4;
        rippleData[offset] = ripple[0];
        rippleData[offset + 1] = ripple[1];
        rippleData[offset + 2] = ripple[2];
        rippleData[offset + 3] = 1;
      }
      cachedRippleCount = activeCount;
    }
    gl.uniform1f(locations.uRippleCount, activeCount);
    gl.uniform4fv(locations['uRipples[0]'], rippleData);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const schedule = () => {
    if (!frameId && visible && !lost) frameId = requestAnimationFrame(render);
  };
  const render = now => {
    frameId = 0;
    if (lost || !visible) return;
    const rawDelta = lastFrame ? (now - lastFrame) / 1000 : 0;
    const delta = Math.min(0.05, rawDelta);
    lastFrame = now;
    clock += delta;
    if (rawDelta > 0) {
      frameEma = frameEma ? frameEma * 0.9 + rawDelta * 0.1 : rawDelta;
      slowFrameCount = frameEma > 0.02 ? slowFrameCount + 1 : 0;
      const baseScale = Math.min(window.devicePixelRatio || 1, 2) * ({ low: 0.55, medium: 0.75, high: 1, ultra: 1.35 }[settings.quality] || 1) * settings.resolutionScale;
      if (slowFrameCount >= 18 && baseScale * adaptiveScale > 0.5) {
        adaptiveScale = Math.max(0.5 / baseScale, adaptiveScale * 0.8);
        slowFrameCount = 0;
        canvas.dataset.shaderResolution = Math.round(adaptiveScale * 100) + '%';
        canvas.dataset.shaderStatusMessage = 'Adaptive resolution reduced to ' + canvas.dataset.shaderResolution + ' to maintain performance.';
        resize();
      }
    }
    draw(delta);
    const moving = Math.abs(target.x - current.x) > 0.001 || Math.abs(target.y - current.y) > 0.001 ||
      Math.abs(target.active - current.active) > 0.003 || Math.abs(target.down - current.down) > 0.003;
    if ((settings.animate && !reducedMotion.matches) || (settings.idleMotion && !reducedMotion.matches) || moving || ripples.length) schedule();
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
  const onLost = event => { event.preventDefault(); lost = true; cancelAnimationFrame(frameId); frameId = 0; canvas.parentElement && canvas.parentElement.classList.remove('gs-webgl-ready'); canvas.dataset.shaderStatus = 'context-lost'; };
  const onRestored = () => {
    try { gl = canvas.getContext(isWebGL2 ? 'webgl2' : 'webgl', glOptions); lost = false; initialize(); resize(); schedule(); }
    catch (error) { canvas.parentElement && canvas.parentElement.classList.remove('gs-webgl-ready'); canvas.dataset.shaderStatus = 'error'; canvas.dataset.shaderError = String(error); }
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
    if (paletteTexture) gl.deleteTexture(paletteTexture);
    if (layerMixTexture) gl.deleteTexture(layerMixTexture);
  };
  });
})(${rootExpression});
`;
}

function makeDocument(project: GradientProject, useMarkers = false) {
  const layers = layeredOutput(project);
  const defaultSettings = normalizeInteractiveSettings(project.shader);
  const visibleLayers = project.layers.filter(layer => layer.visible);
  const enabledLayers = visibleLayers.filter(layer => layer.shader?.enabled);
  const targets = enabledLayers.length ? enabledLayers : visibleLayers.slice(0, 1);
  const fallbackPalette = gradientProjectToShaderPalette(project);
  const entries: {
    layer: GradientLayer | null;
    settings: InteractiveSettings;
    adapter: ShaderLayerAdapter;
    layerMix: { palette: ShaderLayerAdapter['palette']; space: ColorSpace; mode: ShaderLayerColorBlend; strength: number; speed: number };
  }[] = targets.map(layer => {
    const adapter = gradientLayerToShader(layer, project);
    const layerInteractionColors = interactionColorsForLayer(adapter.palette);
    const mixSource = project.layers.find(candidate => candidate.id === layer.shader?.mixLayerId && candidate.visible && candidate.id !== layer.id);
    const mixAdapter = mixSource ? gradientLayerToShader(mixSource, project) : null;
    return {
      layer,
      layerMix: {
        palette: mixAdapter?.palette ?? [],
        space: mixAdapter?.geometry.space ?? 'srgb',
        mode: layer.shader?.mixMode ?? 'mix',
        strength: mixAdapter ? layer.shader?.mixStrength ?? 0 : 0,
        speed: layer.shader?.mixSpeed ?? 0,
      },
      settings: {
      ...defaultSettings,
      ...(defaultSettings.interactionColorSource === 'layer' ? {
        interactionColor: layerInteractionColors[0] ?? defaultSettings.interactionColor,
        interactionColors: layerInteractionColors,
      } : {}),
      style: layer.shader?.style ?? defaultSettings.style,
      ...(layer.shader?.controls ?? {}),
      renderBackend: defaultSettings.renderBackend === 'webgl' && !supportsDirectShaderGeometry(layer) ? 'overlay' : defaultSettings.renderBackend,
      },
      adapter,
    };
  });
  if (!entries.length) {
    entries.push({
      layer: null,
      settings: defaultSettings,
      adapter: { ...fallbackPalette, geometry: { kind: 'linear' as const, angle: 135, originX: 50, originY: 50, radiusX: 50, radiusY: 50 }, meshPoints: [], meshBase: '' },
      layerMix: { palette: [], space: 'srgb', mode: 'mix', strength: 0, speed: 0 },
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
    const paletteLut = encodePaletteLut(bakePaletteLut(entry.adapter.palette, entry.adapter.geometry.space ?? 'srgb'));
    const layerMixLut = entry.layerMix.palette.length
      ? encodePaletteLut(bakePaletteLut(entry.layerMix.palette, entry.layerMix.space))
      : '';
    const attributes = useMarkers
      ? `data-shader-settings="__SHADER_CONFIG_${index}__" data-shader-palette="__SHADER_PALETTE_${index}__" data-shader-geometry="__SHADER_GEOMETRY_${index}__" data-shader-mesh-points="__SHADER_MESH_POINTS_${index}__" data-shader-mesh-base="__SHADER_MESH_BASE_${index}__" data-shader-lut="__SHADER_LUT_${index}__" data-shader-mix-settings="__SHADER_MIX_CONFIG_${index}__" data-shader-mix-lut="__SHADER_MIX_LUT_${index}__"`
      : `data-shader-settings="${escapeAttribute(entry.settings)}" data-shader-palette="${escapeAttribute(entry.adapter.palette)}" data-shader-geometry="${escapeAttribute(entry.adapter.geometry)}" data-shader-mesh-points="${escapeAttribute(entry.adapter.meshPoints)}" data-shader-mesh-base="${escapeAttribute(entry.adapter.meshBase)}" data-shader-lut="${paletteLut}" data-shader-mix-settings="${escapeAttribute(entry.layerMix)}" data-shader-mix-lut="${layerMixLut}"`;
    const canvas = `<canvas data-shader-canvas ${attributes} aria-hidden="true" style="position:absolute;inset:0;z-index:1;width:100%;height:100%;pointer-events:auto;touch-action:pan-y"></canvas>`;
    if (row) {
      html = html.replace(row, `${row.replace(/">$/, ' gs-shader-export-layer">')}${canvas}`);
    } else {
      const rootStart = html.indexOf('>');
      if (rootStart >= 0) html = `${html.slice(0, rootStart + 1)}${canvas}${html.slice(rootStart + 1)}`;
    }
  });
  const stylesheet = [
    layers.css,
    'html,body{margin:0;min-height:100%;}body{min-height:100vh;}canvas[data-shader-canvas]{display:block;} .gs-shader-export-layer::after{z-index:2;} .gs-shader-export-layer.gs-webgl-ready{background-image:none!important;background-color:transparent!important;} .gs-shader-export-layer.gs-webgl-ready>.mesh-point-0,.gs-shader-export-layer.gs-webgl-ready>.mesh-point-1,.gs-shader-export-layer.gs-webgl-ready>.mesh-point-2,.gs-shader-export-layer.gs-webgl-ready>.mesh-point-3,.gs-shader-export-layer.gs-webgl-ready>.mesh-point-4,.gs-shader-export-layer.gs-webgl-ready>.mesh-point-5,.gs-shader-export-layer.gs-webgl-ready>.mesh-point-6,.gs-shader-export-layer.gs-webgl-ready>.mesh-point-7{display:none!important;}',
  ].join('\n');
  const markup = html;
  const body = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Interactive gradient background</title>',
    `<style>${stylesheet}</style>`,
    `</head><body>${html}`,
    `<script>${shaderRuntime()}</script>`,
    '</body></html>',
  ].join('\n');
  return { body, markup, stylesheet, palette: paletteAdapter, entries };
}

export function interactiveHtmlExport(project: GradientProject) {
  const { body, palette } = makeDocument(project);
  const note = palette.notes.map(message => `<!-- ${message.replace(/--/g, '—')} -->`).join('\n');
  return `${note ? `${note}\n` : ''}${body}`;
}

export function interactiveJavaScriptExport(project: GradientProject) {
  const { markup, stylesheet } = makeDocument(project);
  return `const SHAPEFORGE_GRADIENT_MARKUP = ${JSON.stringify(markup)};
const SHAPEFORGE_GRADIENT_STYLES = ${JSON.stringify(stylesheet)};
const SHAPEFORGE_SHADER_RUNTIME = ${JSON.stringify(shaderRuntime('document.currentScript.parentElement'))};

function mountShapeForgeGradient(target = document.body) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!(host instanceof Element)) throw new Error('Provide a valid element or selector to mount the gradient.');
  const template = document.createElement('template');
  template.innerHTML = SHAPEFORGE_GRADIENT_MARKUP;
  host.append(template.content.cloneNode(true));
  if (!document.getElementById('shapeforge-gradient-export-styles')) {
    const style = document.createElement('style');
    style.id = 'shapeforge-gradient-export-styles';
    style.textContent = SHAPEFORGE_GRADIENT_STYLES;
    document.head.appendChild(style);
  }
  const runtime = document.createElement('script');
  runtime.textContent = SHAPEFORGE_SHADER_RUNTIME;
  host.appendChild(runtime);
  return host;
}

window.mountShapeForgeGradient = mountShapeForgeGradient;
mountShapeForgeGradient();`;
}

export function interactiveGlslExport() {
  return [
    '// ShapeForge interactive gradient shader sources',
    '// Vertex shader: aPosition (clip-space vec2), aUv (normalized vec2).',
    `// Fragment shader uniforms: ${UNIFORM_NAMES.join(', ')}`,
    `// Pointer modes: ${POINTER_MODES.map(mode => mode.id).join(', ')}`,
    '// uTime, uClock, uAspect, uStyle (flow / aurora / liquid / holographic / plasma / silk / nebula / ribbons / metaballs / contours / smoke / fire), uPointerMode,',
    '// uGradientKind (linear/radial/conic), uGradientAngle, uGradientOrigin, uGradientRadius,',
    '// uInteractionColor, uStopCount, uPalette[8], uPaletteAlpha[8], uMeshCount, uMeshPoints[8], uMeshColors[8], uMeshBase, and uRipples[8].',
    '// Additional controls: uSpeed, uIntensity, uDistortion, uDistortionScale, uTurbulence,',
    '// uInteractionColors[5], uInteractionColorCount, uInteractionColorMix, uInteractionColorSpeed, uInteractionFalloff, uInteractionDistortion, uInteractionDisplacement, uInteractionDisplacementMode, uInteractionVelocityReaction, uInteractionGlitch,',
    '// uInteractionRadius, uInteractionStrength, uGlow, uRippleStrength, uRippleSpeed, uRippleCount.',
    '// Finishing: uToneMap, uVignette, uSheen, uGrain; palette texture: uPaletteLut.',
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
  const paletteLuts = entries.map(entry => encodePaletteLut(bakePaletteLut(entry.adapter.palette, entry.adapter.geometry.space ?? 'srgb')));
  const layerMixSettings = entries.map(entry => entry.layerMix);
  const layerMixLuts = entries.map(entry => entry.layerMix.palette.length
    ? encodePaletteLut(bakePaletteLut(entry.layerMix.palette, entry.layerMix.space))
    : '');
  const pointerModeType = POINTER_MODES.map(mode => `'${mode.id}'`).join(' | ');
  return `import { useMemo } from 'react';
import type { CSSProperties } from 'react';

export interface ShaderSettings {
  enabled: boolean;
  style: 'flow' | 'aurora' | 'liquid' | 'holographic' | 'plasma' | 'silk' | 'nebula' | 'ribbons' | 'metaballs' | 'contours' | 'smoke' | 'fire';
  quality: 'low' | 'medium' | 'high' | 'ultra';
  resolutionScale: number;
  animate: boolean;
  speed: number;
  shaderMix?: number;
  intensity: number;
  distortion: number;
  distortionScale: number;
  turbulence: number;
  interactionEnabled: boolean;
  touchEnabled: boolean;
  pointerMode: ${pointerModeType};
  interactionColorSource?: 'layer' | 'custom';
  interactionColor: string;
  interactionColors?: string[];
  interactionColorMix?: number;
  interactionColorSpeed?: number;
  interactionFalloff?: 'soft' | 'linear' | 'sharp' | 'gaussian';
  interactionDistortion?: number;
  interactionDisplacement?: number;
  interactionDisplacementMode?: 'push' | 'pull';
  interactionVelocityReaction?: number;
  interactionDelay?: number;
  interactionGlitch?: number;
  interactionRadius: number;
  interactionStrength: number;
  glow: number;
  ripplesEnabled: boolean;
  rippleStrength: number;
  rippleSpeed: number;
  maximumRipples: number;
  toneMapping?: number;
  vignette?: number;
  sheen?: number;
  filmGrain?: number;
  idleMotion?: boolean;
  paletteWrap?: 'mirror' | 'repeat';
  renderBackend?: 'css' | 'webgl' | 'overlay';
}

export interface ShaderStop { color: string; position: number; alpha?: number; hard?: boolean; mid?: number; curve?: { x1: number; y1: number; x2: number; y2: number } }
export interface ShaderGeometry { kind: 'linear' | 'radial' | 'conic' | 'curve' | 'mesh' | 'noise'; angle: number; originX: number; originY: number; radiusX: number; radiusY: number; space?: 'srgb' | 'srgb-linear' | 'oklab' | 'oklch' }
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
const DEFAULT_PALETTE_LUTS: string[] = ${escapeJson(paletteLuts)};
const DEFAULT_LAYER_MIX_SETTINGS = ${escapeJson(layerMixSettings)};
const DEFAULT_LAYER_MIX_LUTS: string[] = ${escapeJson(layerMixLuts)};
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
    .replace(/__SHADER_MESH_BASE_(\\d+)__/g, (_match, index: string) => escapeAttribute(meshBase ?? DEFAULT_MESH_BASES[Number(index)]))
    .replace(/__SHADER_LUT_(\\d+)__/g, (_match, index: string) => palette ? '' : DEFAULT_PALETTE_LUTS[Number(index)])
    .replace(/__SHADER_MIX_CONFIG_(\\d+)__/g, (_match, index: string) => escapeAttribute(DEFAULT_LAYER_MIX_SETTINGS[Number(index)]))
    .replace(/__SHADER_MIX_LUT_(\\d+)__/g, (_match, index: string) => DEFAULT_LAYER_MIX_LUTS[Number(index)]), [settings, palette, geometry, meshPoints, meshBase]);
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
  const built = makeDocument(project);
  const note = built.palette.notes.map(message => `<!-- ${message.replace(/--/g, '—')} -->`).join('\n');
  return {
    html: `${note ? `${note}\n` : ''}${built.body}`,
    markup: `${note ? `${note}\n` : ''}${built.markup}`,
    stylesheet: built.stylesheet,
    runtime: shaderRuntime(),
    javascript: interactiveJavaScriptExport(project),
    glsl: interactiveGlslExport(),
    react: interactiveReactExport(project),
  };
}
