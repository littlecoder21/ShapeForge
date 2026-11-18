/* Trail FX runtime — plain WebGL2, no libraries. Shared by the studio preview and the standalone export.
 *
 * Pipeline (the same ordering rules as the original Unicorn Studio player):
 *   1. every pass that owns a trail (reveal, blur) first draws the pointer segment into its own feedback buffer (ping-pong);
 *   2. the enabled passes then run in order, each reading the previous result (rays also reads the picture before it started);
 *   3. the last pass draws to the canvas (premultiplied alpha).
 * Pointer bookkeeping matches the original: a smoothed position per pass (momentum), a 100-point trail, and the segment from the
 * position 4 samples ago to the current one. Fast movement therefore makes a long, bright segment; slow movement barely marks. */

const FPS = 60;
const FRAME_MS = Math.floor(1000 / FPS);
const KIND_SPEED = { liquify: 0.21 };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/* Stand-in for the project's blue-noise image (it only dithers the light rays): white noise, high-passed and rank-equalised. */
function makeBlueNoise(size) {
  const n = size * size;
  const white = new Float32Array(n);
  for (let i = 0; i < n; i++) white[i] = Math.random();
  const blur = (src, horizontal) => {
    const out = new Float32Array(n);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += src[(horizontal ? y : (y + k + size) % size) * size + (horizontal ? (x + k + size) % size : x)];
      out[y * size + x] = sum / 5;
    }
    return out;
  };
  let low = white;
  for (let i = 0; i < 2; i++) low = blur(blur(low, true), false);
  const high = new Float32Array(n);
  for (let i = 0; i < n; i++) high[i] = white[i] - low[i];
  const data = new Uint8Array(n * 4);
  Array.from({ length: n }, (_, i) => i).sort((a, b) => high[a] - high[b]).forEach((index, rank) => {
    const v = Math.round((rank / (n - 1)) * 255);
    data.set([v, v, v, 255], index * 4);
  });
  return data;
}

export function createTrailFx(canvas, options) {
  const sources = options.sources;
  let config = options.config;
  const fail = (message) => { if (options.onError) options.onError(message); };
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) { fail('WebGL2 is not available.'); return null; }
  let useHalf = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 0, 1, -1, 0, 1, 0, -1, 1, 0, 0, 1, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

  /* ----- programs (compiled once per shader, reused across rebuilds) ----- */
  const SAMPLERS = { uTexture: 0, uBgTexture: 1, uPingPongTexture: 2, uBlueNoise: 3 };
  const programs = new Map();
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
    return shader;
  };
  function getProgram(key, fragment) {
    if (programs.has(key)) return programs.get(key);
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, sources.vert));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'aVertexPosition');
    gl.bindAttribLocation(program, 1, 'aTextureCoord');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Shader link failed');
    gl.useProgram(program);
    for (const name in SAMPLERS) gl.uniform1i(gl.getUniformLocation(program, name), SAMPLERS[name]);
    const entry = { program, locations: {} };
    programs.set(key, entry);
    return entry;
  }
  const loc = (entry, name) => (name in entry.locations ? entry.locations[name] : (entry.locations[name] = gl.getUniformLocation(entry.program, name)));

  /* ----- textures ----- */
  const white = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const noise = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, noise);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, makeBlueNoise(128));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  const targets = [];
  const disposeTargets = () => targets.splice(0).forEach((t) => { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); });
  function makeTarget(w, h) {
    const build = (half) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, half ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (ok) { gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      return { tex, fbo, ok };
    };
    let target = build(useHalf);
    if (!target.ok && useHalf) { useHalf = false; target = build(false); }
    targets.push(target);
    return target;
  }

  /* ----- pass list -> planes ----- */
  let enabled = [];
  let stack = [];
  let pingPongs = [];
  let renderTargets = [];
  let signature = '';
  const sig = (c) => c.passes.filter((pass) => pass.enabled).map((pass) => pass.kind).join('|');

  function build() {
    enabled = config.passes.filter((pass) => pass.enabled && sources.kinds[pass.kind]);
    stack = [];
    pingPongs = [];
    enabled.forEach((pass, passIdx) => {
      const src = sources.kinds[pass.kind];
      const shared = { last: null };
      src.frag.forEach((frag, index) => {
        stack.push({ passIdx, kind: pass.kind, shared, passIndex: index, time: 0, mouse: [0.5, 0.5], previous: [0.5, 0.5], entry: getProgram(`${pass.kind}:${index}`, frag) });
      });
      if (src.trail) {
        const feedback = { passIdx, kind: pass.kind, shared, passIndex: 0, time: 0, mouse: [0.5, 0.5], previous: [0.5, 0.5], entry: getProgram(`${pass.kind}:trail`, src.trail), trail: true };
        pingPongs.push(feedback);
        stack[stack.length - 1].pingPong = feedback;
      }
    });
    signature = sig(config);
    allocate();
  }

  let scale = config.scale || 1;
  let maxScale = scale;
  let rect = canvas.getBoundingClientRect();
  function allocate() {
    disposeTargets();
    const w = canvas.width, h = canvas.height;
    renderTargets = stack.map((plane, k) => (k < stack.length - 1 ? makeTarget(w, h) : null));
    pingPongs.forEach((plane) => { plane.read = makeTarget(w, h); plane.write = makeTarget(w, h); });
  }
  function resize() {
    const cw = canvas.clientWidth || window.innerWidth, ch = canvas.clientHeight || window.innerHeight;
    const w = Math.max(2, Math.round(cw * scale)), h = Math.max(2, Math.round(ch * scale));
    rect = canvas.getBoundingClientRect();
    if (w === canvas.width && h === canvas.height && renderTargets.length === stack.length) return;
    canvas.width = w;
    canvas.height = h;
    allocate();
  }

  /* ----- pointer state (same bookkeeping as the original player; positions in half CSS pixels) ----- */
  const mouse = { pos: { x: 0, y: 0 }, move: { x: 0, y: 0 }, trail: [] };
  let moving = false;
  let movingTimer = 0;
  const center = () => { mouse.pos.x = mouse.move.x = rect.width / 4; mouse.pos.y = mouse.move.y = rect.height / 4; };
  const recordTrail = () => {
    mouse.trail.unshift([mouse.pos.x / (rect.width * 0.5), 1 - mouse.pos.y / (rect.height * 0.5)]);
    if (mouse.trail.length > 100) mouse.trail.pop();
  };
  function handle(kind, sample) {
    if (kind === 'move') {
      const x = sample.clientX - rect.left, y = sample.clientY - rect.top;
      if (x < -24 || y < -24 || x > rect.width + 24 || y > rect.height + 24) return;
      recordTrail();
      moving = true;
      clearTimeout(movingTimer);
      movingTimer = setTimeout(() => { moving = false; }, 16);
      mouse.move.x = x / 2;
      mouse.move.y = y / 2;
    } else if (kind === 'down' && sample.pointerType === 'touch') {
      // a new touch starts where the finger lands: no streak from the previous touch
      mouse.move.x = mouse.pos.x = (sample.clientX - rect.left) / 2;
      mouse.move.y = mouse.pos.y = (sample.clientY - rect.top) / 2;
      mouse.trail.length = 0;
      stack.forEach((plane) => { plane.shared.last = null; });
    }
  }
  const momentum = (value, previous, amount) => {
    for (let s = 0; s < amount; s++) value = (value + previous) / 2;
    return +((value + previous) / 2).toFixed(4);
  };
  function updatePlane(plane) {
    const pass = enabled[plane.passIdx];
    plane.time += (KIND_SPEED[plane.kind] || 0.5) * 60 / FPS;
    const halfW = rect.width / 2 || 1, halfH = rect.height / 2 || 1;
    let x = mouse.pos.x, y = mouse.pos.y;
    const m = pass.p.momentum || 0;
    if (m) {
      const shared = plane.shared;
      if (!shared.last) shared.last = { x: x / halfW, y: 1 - y / halfH };
      x = momentum(x, shared.last.x * halfW, m * 2);
      y = momentum(y, (1 - shared.last.y) * halfH, m * 2);
      shared.last.x = x / halfW;
      shared.last.y = 1 - y / halfH;
    }
    plane.mouse[0] = x / halfW;
    plane.mouse[1] = 1 - y / halfH;
    const previous = mouse.trail.length > 3 ? mouse.trail[3] : plane.mouse;
    plane.previous[0] = previous[0];
    plane.previous[1] = previous[1];
  }

  const bind = (unit, texture) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); };
  function draw(plane, input, background, trail, output) {
    const pass = enabled[plane.passIdx], entry = plane.entry;
    gl.useProgram(entry.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output ? output.fbo : null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(loc(entry, 'uResolution'), canvas.width, canvas.height);
    gl.uniform2f(loc(entry, 'uMousePos'), plane.mouse[0], plane.mouse[1]);
    gl.uniform2f(loc(entry, 'uPreviousMousePos'), plane.previous[0], plane.previous[1]);
    gl.uniform1f(loc(entry, 'uTime'), plane.time);
    for (const key in pass.p) { const l = loc(entry, 'u' + cap(key)); if (l) gl.uniform1f(l, pass.p[key]); }
    if (pass.kind === 'base') pass.colors.forEach((hex, i) => { const l = loc(entry, 'uC' + i); if (l) gl.uniform3fv(l, hexToRgb(hex)); });
    else if (pass.colors[0]) { const l = loc(entry, 'uTint'); if (l) gl.uniform3fv(l, hexToRgb(pass.colors[0])); }
    bind(0, input);
    bind(1, background);
    bind(2, trail || white);
    bind(3, noise);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function renderFrame() {
    gl.bindVertexArray(quad);
    pingPongs.forEach((plane) => {
      updatePlane(plane);
      draw(plane, white, white, plane.read.tex, plane.write);
      const swap = plane.read; plane.read = plane.write; plane.write = swap;
    });
    stack.forEach((plane, k) => {
      updatePlane(plane);
      const input = k > 0 ? renderTargets[k - 1].tex : white;
      const bgIndex = k - (1 + plane.passIndex);
      const background = plane.passIndex > 0 ? (bgIndex >= 0 ? renderTargets[bgIndex].tex : white) : white;
      draw(plane, input, background, plane.pingPong ? plane.pingPong.read.tex : null, renderTargets[k]);
    });
  }

  /* ----- loop, with a soft safety net for weak GPUs ----- */
  let raf = 0, lastTime = 0, lastFrame = 0, sum = 0, count = 0, dead = false;
  function frame(time) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    mouse.pos.x = mouse.move.x;
    mouse.pos.y = mouse.move.y;
    if (!moving) recordTrail();
    if (time - lastTime >= FRAME_MS) { renderFrame(); lastTime = time; }
    if (lastFrame && time - lastFrame < 200) {
      sum += time - lastFrame;
      if (++count === 90) {
        if (sum / count > 28 && scale > 0.5) { scale = Math.max(0.5, scale - 0.125); resize(); }
        sum = 0; count = 0;
      }
    } else { sum = 0; count = 0; }
    lastFrame = time;
  }

  const onLost = (event) => { event.preventDefault(); dead = true; cancelAnimationFrame(raf); fail('The WebGL context was lost.'); };
  canvas.addEventListener('webglcontextlost', onLost);

  try {
    resize();
    center();
    build();
    resize();
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
    return null;
  }
  raf = requestAnimationFrame(frame);

  return {
    handle,
    invalidate() { rect = canvas.getBoundingClientRect(); },
    resize,
    setConfig(next) {
      const rebuild = sig(next) !== signature;
      config = next;
      if ((next.scale || 1) !== maxScale) { maxScale = next.scale || 1; scale = maxScale; resize(); }
      if (rebuild) { try { build(); } catch (error) { fail(error && error.message ? error.message : String(error)); } }
      else enabled = config.passes.filter((pass) => pass.enabled && sources.kinds[pass.kind]);
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      clearTimeout(movingTimer);
      canvas.removeEventListener('webglcontextlost', onLost);
      disposeTargets();
      programs.forEach((entry) => gl.deleteProgram(entry.program));
      programs.clear();
    },
  };
}
