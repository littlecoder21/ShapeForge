/* Trail FX runtime — plain WebGL2, no libraries. Shared by the studio preview and the standalone export.
 *
 * Pipeline (the same ordering rules as the original Unicorn Studio player):
 *   1. every pass that owns a trail (reveal, blur) first draws the pointer segment into its own feedback buffer (ping-pong);
 *      every generator pass (particles, ribbon) simulates one frame on the CPU and draws into its own layer buffer;
 *   2. the enabled passes then run in order, each reading the previous result (rays also reads the picture before it started;
 *      a generator's pass composites its layer over / into the picture before it);
 *   3. the last pass draws to the canvas (premultiplied alpha).
 * Pointer bookkeeping for the original passes matches the original: a smoothed position per pass (momentum), a 100-point trail,
 * and the segment from the position 4 samples ago to the current one. Generators use CSS pixels (y down) and real elapsed time,
 * so their motion does not depend on the frame rate or the resolution scale. */

const FPS = 60;
const FRAME_MS = Math.floor(1000 / FPS);
const KIND_SPEED = { liquify: 0.21 };
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const PAL_MAX = 8;
const STRIDE = 13; // x, y, vx, vy, age, life, size, rot, vrot, seed, shape code, random colour, spare
const MAX_PARTS = 3000;
const MAX_BEADS = 60;
const INST = 8; // floats per particle instance
const MIXED_SHAPES = [2, 4, 0, 5, 3, 8];
const HISTORY_SECONDS = 8;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const hexToRgb = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const tri = (v) => 1 - Math.abs((v - Math.floor(v)) * 2 - 1);
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/* Stand-in for the project's blue-noise image (it only dithers the light rays): white noise, high-passed and rank-equalised. */
function makeBlueNoise(size) {
  const n = size * size;
  const white = new Float32Array(n);
  for (let i = 0; i < n; i++) white[i] = Math.random();
  const blur = (src, horizontal) => {
    const out = new Float32Array(n);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let k = -2; k <= 2; k++)
          sum +=
            src[
              (horizontal ? y : (y + k + size) % size) * size +
                (horizontal ? (x + k + size) % size : x)
            ];
        out[y * size + x] = sum / 5;
      }
    return out;
  };
  let low = white;
  for (let i = 0; i < 2; i++) low = blur(blur(low, true), false);
  const high = new Float32Array(n);
  for (let i = 0; i < n; i++) high[i] = white[i] - low[i];
  const data = new Uint8Array(n * 4);
  Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => high[a] - high[b])
    .forEach((index, rank) => {
      const v = Math.round((rank / (n - 1)) * 255);
      data.set([v, v, v, 255], index * 4);
    });
  return data;
}

export function createTrailFx(canvas, options) {
  const sources = options.sources;
  let config = options.config;
  const fail = (message) => {
    if (options.onError) options.onError(message);
  };
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) {
    fail("WebGL2 is not available.");
    return null;
  }
  let useHalf = !!(
    gl.getExtension("EXT_color_buffer_float") ||
    gl.getExtension("EXT_color_buffer_half_float")
  );
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);

  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1, 0, 0, 0, 1, -1, 0, 1, 0, -1, 1, 0, 0, 1, 1, 1, 0, 1, 1,
    ]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

  /* ----- programs (compiled once per shader, reused across rebuilds) ----- */
  const SAMPLERS = {
    uTexture: 0,
    uBgTexture: 1,
    uPingPongTexture: 2,
    uBlueNoise: 3,
    uGlyph: 4,
  };
  const programs = new Map();
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) || "Shader compile failed");
    return shader;
  };
  function makeProgram(key, vertex, fragment) {
    if (programs.has(key)) return programs.get(key);
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, "aVertexPosition");
    gl.bindAttribLocation(program, 1, "aTextureCoord");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) || "Shader link failed");
    gl.useProgram(program);
    for (const name in SAMPLERS)
      gl.uniform1i(gl.getUniformLocation(program, name), SAMPLERS[name]);
    const entry = { program, locations: {} };
    programs.set(key, entry);
    return entry;
  }
  const getProgram = (key, fragment) =>
    makeProgram(key, sources.vert, fragment);
  const loc = (entry, name) =>
    name in entry.locations
      ? entry.locations[name]
      : (entry.locations[name] = gl.getUniformLocation(entry.program, name));
  const setFloat = (entry, name, value) => {
    const l = loc(entry, name);
    if (l) gl.uniform1f(l, value);
  };

  /* ----- textures ----- */
  const white = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const noise = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, noise);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    128,
    128,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    makeBlueNoise(128),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const blank = gl.createTexture(); // a transparent texel for glyph slots before a glyph sheet exists
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const targets = [];
  const disposeTargets = () =>
    targets.splice(0).forEach((t) => {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    });
  function makeTarget(w, h) {
    const build = (half) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        half ? gl.RGBA16F : gl.RGBA8,
        w,
        h,
        0,
        gl.RGBA,
        half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        tex,
        0,
      );
      const ok =
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (ok) {
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      return { tex, fbo, ok };
    };
    let target = build(useHalf);
    if (!target.ok && useHalf) {
      useHalf = false;
      target = build(false);
    }
    targets.push(target);
    return target;
  }

  /* ----- palettes: every pass that reads colours gets up to eight, as uPal[] + uPalN ----- */
  const palCache = new Map();
  function packPalette(colors) {
    const key = colors.join(",");
    let hit = palCache.get(key);
    if (!hit) {
      const list = (colors.length ? colors : ["#ffffff"]).slice(0, PAL_MAX);
      const flat = new Float32Array(PAL_MAX * 3);
      for (let i = 0; i < PAL_MAX; i++)
        flat.set(hexToRgb(list[Math.min(i, list.length - 1)]), i * 3);
      hit = { flat, n: list.length };
      if (palCache.size > 64) palCache.clear();
      palCache.set(key, hit);
    }
    return hit;
  }
  function setPalette(entry, colors, stepped) {
    const l = loc(entry, "uPal");
    if (l) {
      const pal = packPalette(colors);
      gl.uniform3fv(l, pal.flat);
      setFloat(entry, "uPalN", pal.n);
    }
    if (stepped !== undefined) setFloat(entry, "uStepped", stepped);
  }

  /* ----- pass list -> planes ----- */
  let enabled = [];
  let stack = [];
  let pingPongs = [];
  let genPlanes = [];
  let renderTargets = [];
  let signature = "";
  const sig = (c) =>
    c.passes
      .filter((pass) => pass.enabled)
      .map((pass) => pass.kind)
      .join("|");

  function disposeGen() {
    genPlanes.forEach((plane) => {
      const s = plane.state;
      if (s.vao) gl.deleteVertexArray(s.vao);
      if (s.buf) gl.deleteBuffer(s.buf);
      if (s.glyphTex) gl.deleteTexture(s.glyphTex);
    });
    genPlanes = [];
  }
  function makeGenState(kind) {
    const state = { vao: null, buf: null };
    if (kind === "emitter") {
      Object.assign(state, {
        data: new Float32Array(STRIDE * MAX_PARTS),
        n: 0,
        inst: new Float32Array(INST * (MAX_PARTS + MAX_BEADS)),
        accMove: 0,
        accHold: 0,
        accAmb: 0,
        glyphKey: null,
        glyphTex: null,
        glyphN: 1,
      });
    } else {
      Object.assign(state, {
        pts: [],
        head: null,
        broke: true,
        verts: new Float32Array(INST * 4096),
      });
    }
    state.vao = gl.createVertexArray();
    gl.bindVertexArray(state.vao);
    state.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buf);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, INST * 4, 0);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, INST * 4, 16);
    if (kind === "emitter") {
      gl.vertexAttribDivisor(0, 1);
      gl.vertexAttribDivisor(1, 1);
    }
    gl.bindVertexArray(quad);
    return state;
  }

  function build() {
    disposeGen();
    enabled = config.passes.filter(
      (pass) => pass.enabled && sources.kinds[pass.kind],
    );
    stack = [];
    pingPongs = [];
    enabled.forEach((pass, passIdx) => {
      const src = sources.kinds[pass.kind];
      const shared = { last: null };
      src.frag.forEach((frag, index) => {
        stack.push({
          passIdx,
          kind: pass.kind,
          shared,
          passIndex: index,
          time: 0,
          mouse: [0.5, 0.5],
          previous: [0.5, 0.5],
          entry: getProgram(`${pass.kind}:${index}`, frag),
        });
      });
      if (src.trail) {
        const feedback = {
          passIdx,
          kind: pass.kind,
          shared,
          passIndex: 0,
          time: 0,
          mouse: [0.5, 0.5],
          previous: [0.5, 0.5],
          entry: getProgram(`${pass.kind}:trail`, src.trail),
          trail: true,
        };
        pingPongs.push(feedback);
        stack[stack.length - 1].pingPong = feedback;
      } else if (src.gen && sources.gen) {
        if (src.gen === "emitter")
          makeProgram(
            "gen:particle",
            sources.gen.particle.vert,
            sources.gen.particle.frag,
          );
        else
          makeProgram(
            "gen:ribbon",
            sources.gen.ribbon.vert,
            sources.gen.ribbon.frag,
          );
        getProgram("gen:fade", sources.gen.fade);
        const feedback = {
          passIdx,
          kind: src.gen,
          shared,
          passIndex: 0,
          time: 0,
          gen: true,
          state: makeGenState(src.gen),
        };
        pingPongs.push(feedback);
        genPlanes.push(feedback);
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
    const w = canvas.width,
      h = canvas.height;
    renderTargets = stack.map((plane, k) =>
      k < stack.length - 1 ? makeTarget(w, h) : null,
    );
    pingPongs.forEach((plane) => {
      plane.read = makeTarget(w, h);
      plane.write = makeTarget(w, h);
    });
  }
  function resize() {
    const cw = canvas.clientWidth || window.innerWidth,
      ch = canvas.clientHeight || window.innerHeight;
    const w = Math.max(2, Math.round(cw * scale)),
      h = Math.max(2, Math.round(ch * scale));
    rect = canvas.getBoundingClientRect();
    if (
      w === canvas.width &&
      h === canvas.height &&
      renderTargets.length === stack.length
    )
      return;
    canvas.width = w;
    canvas.height = h;
    allocate();
  }

  /* ----- pointer state ----- */
  // Original passes: positions in half CSS pixels. Generators: ptr, in CSS pixels, plus a short history for chains.
  const mouse = { pos: { x: 0, y: 0 }, move: { x: 0, y: 0 }, trail: [] };
  const ptr = {
    x: 0,
    y: 0,
    lx: 0,
    ly: 0,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    dist: 0,
    down: false,
    active: false,
    inside: false,
    clicks: [],
  };
  const history = [];
  const clock = { now: 0, dt: 1 / 60 };
  let moving = false;
  let movingTimer = 0;
  const center = () => {
    mouse.pos.x = mouse.move.x = rect.width / 4;
    mouse.pos.y = mouse.move.y = rect.height / 4;
  };
  const recordTrail = () => {
    mouse.trail.unshift([
      mouse.pos.x / (rect.width * 0.5),
      1 - mouse.pos.y / (rect.height * 0.5),
    ]);
    if (mouse.trail.length > 100) mouse.trail.pop();
  };
  function setPointer(x, y) {
    if (!ptr.active || !ptr.inside) {
      ptr.lx = ptr.px = x;
      ptr.ly = ptr.py = y;
    } // entering: no streak from wherever it was before
    ptr.x = x;
    ptr.y = y;
    ptr.active = true;
    ptr.inside = true;
  }
  function handle(kind, sample) {
    if (kind === "leave") {
      ptr.inside = false;
      ptr.down = false;
      return;
    }
    if (kind === "up" || kind === "cancel") {
      ptr.down = false;
      if (sample && sample.pointerType === "touch") ptr.inside = false; // a lifted finger is not a hovering pointer
      return;
    }
    const x = sample.clientX - rect.left,
      y = sample.clientY - rect.top;
    const near = !(
      x < -24 ||
      y < -24 ||
      x > rect.width + 24 ||
      y > rect.height + 24
    );
    if (kind === "move") {
      if (!near) {
        ptr.inside = false;
        return;
      }
      recordTrail();
      moving = true;
      clearTimeout(movingTimer);
      movingTimer = setTimeout(() => {
        moving = false;
      }, 16);
      mouse.move.x = x / 2;
      mouse.move.y = y / 2;
      setPointer(x, y);
    } else if (kind === "down") {
      if (!near) return;
      if (sample.pointerType === "touch") {
        // a new touch starts where the finger lands: no streak from the previous touch
        mouse.move.x = mouse.pos.x = x / 2;
        mouse.move.y = mouse.pos.y = y / 2;
        mouse.trail.length = 0;
        stack.forEach((plane) => {
          plane.shared.last = null;
        });
        ptr.inside = false;
      }
      setPointer(x, y);
      ptr.down = true;
      ptr.clicks.push({ x, y });
    }
  }
  function tickPointer(dt) {
    ptr.px = ptr.lx;
    ptr.py = ptr.ly;
    const dx = ptr.x - ptr.lx,
      dy = ptr.y - ptr.ly;
    ptr.dist = Math.hypot(dx, dy);
    ptr.vx += (dx / dt - ptr.vx) * 0.45;
    ptr.vy += (dy / dt - ptr.vy) * 0.45;
    ptr.speed = Math.hypot(ptr.vx, ptr.vy);
    ptr.lx = ptr.x;
    ptr.ly = ptr.y;
    if (ptr.active) history.push({ x: ptr.x, y: ptr.y, t: clock.now });
    while (history.length && clock.now - history[0].t > HISTORY_SECONDS)
      history.shift();
  }
  const historyAt = (time) => {
    let j = history.length - 1;
    while (j > 0 && history[j - 1].t > time) j--;
    if (j <= 0) return history[0] || ptr;
    const a = history[j - 1],
      b = history[j],
      span = b.t - a.t || 1,
      k = clamp01((time - a.t) / span);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };

  const momentum = (value, previous, amount) => {
    for (let s = 0; s < amount; s++) value = (value + previous) / 2;
    return +((value + previous) / 2).toFixed(4);
  };
  function updatePlane(plane) {
    const pass = enabled[plane.passIdx];
    plane.time += ((KIND_SPEED[plane.kind] || 0.5) * 60) / FPS;
    const halfW = rect.width / 2 || 1,
      halfH = rect.height / 2 || 1;
    let x = mouse.pos.x,
      y = mouse.pos.y;
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

  /* ═════════════ generators: particles ═════════════ */

  function ensureGlyphs(S, text) {
    const chars = Array.from(text || "✦").slice(0, 12);
    const key = chars.join("");
    if (S.glyphKey === key) return;
    S.glyphKey = key;
    S.glyphN = chars.length;
    const cell = 96;
    const sheet = document.createElement("canvas");
    sheet.width = cell * chars.length;
    sheet.height = cell;
    const ctx = sheet.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(cell * 0.7)}px system-ui, "Segoe UI Symbol", "Apple Color Emoji", "Noto Color Emoji", "DejaVu Sans", sans-serif`;
    chars.forEach((ch, i) => ctx.fillText(ch, cell * (i + 0.5), cell * 0.54));
    if (!S.glyphTex) S.glyphTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, S.glyphTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sheet);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function spawn(S, P, x, y, ambient) {
    if (S.n >= S.limit) return;
    const R = Math.random;
    const o = S.n * STRIDE;
    S.n++;
    if (!ambient && P.scatter > 0) {
      const a = R() * TAU,
        r = Math.sqrt(R()) * P.scatter;
      x += Math.cos(a) * r;
      y += Math.sin(a) * r;
    }
    const motion = ptr.speed > 25 ? Math.atan2(ptr.vy, ptr.vx) : R() * TAU;
    const dir = Math.round(P.dir);
    const cone = (P.cone === undefined ? 360 : P.cone) * DEG;
    let angle = R() * TAU;
    if (dir > 0) {
      const base =
        dir === 1
          ? -Math.PI / 2
          : dir === 2
            ? Math.PI / 2
            : dir === 3
              ? Math.PI
              : dir === 4
                ? 0
                : dir === 5
                  ? motion
                  : dir === 6
                    ? motion + Math.PI
                    : motion + ((R() < 0.5 ? 1 : -1) * Math.PI) / 2;
      angle = base + (R() - 0.5) * cone;
    }
    const v = Math.max(0, P.speed * (1 + (R() * 2 - 1) * P.speedVar));
    const inherit = ambient || !ptr.active ? 0 : P.inherit;
    const shapeCode = Math.round(P.shape);
    const shape =
      shapeCode === 11
        ? MIXED_SHAPES[Math.floor(R() * MIXED_SHAPES.length)]
        : shapeCode;
    S.data[o] = x;
    S.data[o + 1] = y;
    S.data[o + 2] = Math.cos(angle) * v + ptr.vx * inherit;
    S.data[o + 3] = Math.sin(angle) * v + ptr.vy * inherit;
    S.data[o + 4] = 0;
    S.data[o + 5] = Math.max(0.05, P.life * (1 - P.lifeVar * R()));
    S.data[o + 6] = Math.max(
      1,
      P.size *
        (1 + (R() * 2 - 1) * P.sizeVar) *
        (1 + (P.speedSize * ptr.speed) / 1000),
    );
    S.data[o + 7] = Math.round(P.orient) === 1 ? 0 : R() * TAU;
    S.data[o + 8] = P.spin * DEG * (1 - P.spinVar + P.spinVar * (R() * 2 - 1));
    S.data[o + 9] = R();
    S.data[o + 10] =
      shape === 12 ? 12 + Math.floor(R() * S.glyphN) / 32 : shape;
    S.data[o + 11] = R();
  }
  function ambientPoint(area, W, H) {
    const R = Math.random;
    switch (Math.round(area)) {
      case 1:
        return [R() * W, -12];
      case 2:
        return [R() * W, H + 12];
      case 3:
        return [-12, R() * H];
      case 4:
        return [W + 12, R() * H];
      case 5: {
        if (!ptr.active) return [R() * W, R() * H];
        const a = R() * TAU,
          r = 60 + R() * 220;
        return [ptr.x + Math.cos(a) * r, ptr.y + Math.sin(a) * r];
      }
      case 6:
        return [W / 2, H / 2];
      default:
        return [R() * W, R() * H];
    }
  }

  function stepEmitter(plane, pass) {
    const P = pass.p,
      S = plane.state,
      dt = clock.dt,
      now = clock.now;
    const W = rect.width || 1,
      H = rect.height || 1;
    S.limit = Math.min(MAX_PARTS, Math.max(1, Math.round(P.maxCount)));
    if (Math.round(P.shape) === 12) ensureGlyphs(S, pass.text);
    const live = ptr.active && ptr.inside;

    /* spawn */
    if (live && P.onMove > 0 && ptr.speed >= P.minSpeed && ptr.dist > 0)
      S.accMove += (P.onMove * ptr.dist) / 100;
    const moveWhole = Math.floor(S.accMove);
    S.accMove -= moveWhole;
    const moveCount = Math.min(moveWhole, 90);
    for (let k = 0; k < moveCount; k++) {
      const t = (k + Math.random()) / moveCount;
      spawn(
        S,
        P,
        ptr.px + (ptr.x - ptr.px) * t,
        ptr.py + (ptr.y - ptr.py) * t,
        false,
      );
    }
    if (live && ptr.down && P.onHold > 0) S.accHold += P.onHold * dt;
    const holdCount = Math.min(Math.floor(S.accHold), 90);
    S.accHold -= Math.floor(S.accHold);
    for (let k = 0; k < holdCount; k++) spawn(S, P, ptr.x, ptr.y, false);
    if (P.onClick > 0) {
      const burst = Math.round(P.onClick);
      ptr.clicks.forEach((click) => {
        for (let k = 0; k < burst; k++) spawn(S, P, click.x, click.y, false);
      });
    }
    if (P.ambient > 0) S.accAmb += P.ambient * dt;
    const ambientCount = Math.min(Math.floor(S.accAmb), 90);
    S.accAmb -= Math.floor(S.accAmb);
    for (let k = 0; k < ambientCount; k++) {
      const pt = ambientPoint(P.area, W, H);
      spawn(S, P, pt[0], pt[1], true);
    }

    /* simulate + pack instances */
    const Dt = S.data,
      inst = S.inst;
    const drag = Math.exp(-P.drag * dt);
    const turb = P.turbulence,
      tk = P.turbScale * 0.006;
    const forceType = Math.round(P.force);
    const forceOn = forceType > 0 && live;
    const forceR = Math.max(1, P.forceRadius),
      forceS = P.forceStrength;
    const edges = Math.round(P.edges);
    const colorBy = Math.round(P.colorBy);
    const face = Math.round(P.orient) === 2 || P.stretch > 0;
    let count = 0;
    for (let i = 0; i < S.n; ) {
      const o = i * STRIDE;
      const life = Dt[o + 5];
      const age = Dt[o + 4] + dt;
      let x = Dt[o],
        y = Dt[o + 1],
        vx = Dt[o + 2],
        vy = Dt[o + 3];
      let dead = age >= life;
      if (!dead) {
        let ax = P.wind,
          ay = P.gravity;
        if (turb > 0) {
          ax +=
            turb *
            (Math.sin(y * tk + now * 0.9 + 1.3) +
              0.5 * Math.sin(y * tk * 2.3 - now * 1.7 + x * tk * 0.7));
          ay +=
            turb *
            (Math.cos(x * tk - now * 1.1) +
              0.5 * Math.cos(x * tk * 2.1 + now * 1.9 + y * tk * 0.6));
        }
        if (forceOn) {
          const dx = ptr.x - x,
            dy = ptr.y - y,
            r = Math.hypot(dx, dy);
          if (r < forceR && r > 0.001) {
            const f = (1 - r / forceR) * (1 - r / forceR) * forceS,
              nx = dx / r,
              ny = dy / r;
            if (forceType === 1) {
              ax += nx * f;
              ay += ny * f;
            } else if (forceType === 2) {
              ax -= nx * f;
              ay -= ny * f;
            } else if (forceType === 3) {
              ax += -ny * f;
              ay += nx * f;
            } else {
              ax += -ny * f * 0.9 + nx * f * 0.35;
              ay += nx * f * 0.9 + ny * f * 0.35;
            }
          }
        }
        vx = (vx + ax * dt) * drag;
        vy = (vy + ay * dt) * drag;
        x += vx * dt;
        y += vy * dt;
        if (edges === 1) {
          if (x < 0) {
            x = 0;
            vx = Math.abs(vx) * 0.7;
          } else if (x > W) {
            x = W;
            vx = -Math.abs(vx) * 0.7;
          }
          if (y < 0) {
            y = 0;
            vy = Math.abs(vy) * 0.7;
          } else if (y > H) {
            y = H;
            vy = -Math.abs(vy) * 0.7;
          }
        } else if (edges === 2) {
          if (x < -20) x += W + 40;
          else if (x > W + 20) x -= W + 40;
          if (y < -20) y += H + 40;
          else if (y > H + 20) y -= H + 40;
        } else if (
          edges === 3 &&
          (x < -40 || x > W + 40 || y < -40 || y > H + 40) &&
          age > 0.3
        )
          dead = true;
      }
      if (dead) {
        const last = (S.n - 1) * STRIDE;
        if (o !== last) Dt.copyWithin(o, last, last + STRIDE);
        S.n--;
        continue;
      }
      Dt[o] = x;
      Dt[o + 1] = y;
      Dt[o + 2] = vx;
      Dt[o + 3] = vy;
      Dt[o + 4] = age;
      Dt[o + 7] += Dt[o + 8] * dt;
      const t = age / life,
        e = 1 - (1 - t) * (1 - t);
      let alpha = 1;
      if (P.fadeIn > 0) alpha = Math.min(alpha, t / P.fadeIn);
      if (P.fadeOut > 0) alpha = Math.min(alpha, (1 - t) / P.fadeOut);
      alpha = clamp01(alpha);
      alpha = alpha * alpha * (3 - 2 * alpha);
      i++;
      if (alpha < 0.004) continue;
      const sp = Math.hypot(vx, vy);
      const ct =
        colorBy === 0
          ? Dt[o + 11]
          : colorBy === 1
            ? t
            : colorBy === 2
              ? clamp01(sp / Math.max(80, P.speed * 1.2 + 160))
              : colorBy === 3
                ? Math.atan2(vy, vx) / TAU + 0.5
                : colorBy === 4
                  ? clamp01(x / W)
                  : tri(now * 0.15 + Dt[o + 9] * 0.25);
      const q = count * INST;
      inst[q] = x;
      inst[q + 1] = y;
      inst[q + 2] = Math.max(0.01, Dt[o + 6] * (1 + (P.sizeEnd - 1) * e));
      inst[q + 3] = face && sp > 1 ? Math.atan2(vy, vx) : Dt[o + 7];
      inst[q + 4] = ct;
      inst[q + 5] = alpha;
      inst[q + 6] = 1 + (P.stretch * Math.min(sp, 1200)) / 300;
      inst[q + 7] = Dt[o + 10];
      count++;
    }

    /* a chain of beads that follows the pointer's recent path */
    const beads = Math.min(MAX_BEADS, Math.round(P.follow));
    if (beads > 0 && ptr.active && history.length) {
      const gap = P.followGap / 1000;
      const shapeCode = Math.round(P.shape);
      const shape = shapeCode === 11 ? 0 : shapeCode;
      for (let b = 0; b < beads; b++) {
        const t = beads > 1 ? b / (beads - 1) : 0,
          e = 1 - (1 - t) * (1 - t);
        const at = historyAt(now - b * gap);
        let alpha = P.fadeOut > 0 ? clamp01((1 - t) / P.fadeOut) : 1;
        alpha = alpha * alpha * (3 - 2 * alpha);
        const q = count * INST;
        inst[q] = at.x;
        inst[q + 1] = at.y;
        inst[q + 2] = Math.max(0.01, P.size * (1 + (P.sizeEnd - 1) * e));
        inst[q + 3] = 0;
        inst[q + 4] =
          colorBy === 0
            ? hash(b + 1)
            : colorBy === 4
              ? clamp01(at.x / W)
              : colorBy === 5
                ? tri(now * 0.15 + t * 0.5)
                : t;
        inst[q + 5] = alpha;
        inst[q + 6] = 1;
        inst[q + 7] = shape === 12 ? 12 + (b % S.glyphN) / 32 : shape;
        count++;
      }
    }

    if (!count) return;
    const entry = makeProgram(
      "gen:particle",
      sources.gen.particle.vert,
      sources.gen.particle.frag,
    );
    gl.useProgram(entry.program);
    gl.bindVertexArray(S.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      inst.subarray(0, count * INST),
      gl.DYNAMIC_DRAW,
    );
    gl.uniform2f(loc(entry, "uView"), W, H);
    setFloat(entry, "uSoft", P.soft);
    setFloat(entry, "uOutline", P.outline);
    setFloat(entry, "uCore", P.core);
    setFloat(entry, "uBright", P.bright);
    setFloat(entry, "uGlyphTint", P.glyphTint === undefined ? 1 : P.glyphTint);
    setFloat(entry, "uGlyphN", S.glyphN);
    setPalette(entry, pass.colors, Math.round(P.stepped));
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, S.glyphTex || blank);
    gl.enable(gl.BLEND);
    gl.blendFunc(
      gl.ONE,
      Math.round(P.blend) === 1 ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(quad);
  }

  /* ═════════════ generators: ribbon ═════════════ */

  function stepRibbon(plane, pass) {
    const P = pass.p,
      S = plane.state,
      dt = clock.dt,
      now = clock.now;
    const W = rect.width || 1,
      H = rect.height || 1;
    if (ptr.active) {
      if (!S.head) S.head = { x: ptr.x, y: ptr.y };
      const k = 1 - Math.pow(clamp(P.smooth, 0, 0.98), dt * 60);
      S.head.x += (ptr.x - S.head.x) * k;
      S.head.y += (ptr.y - S.head.y) * k;
    }
    const drawing =
      ptr.active &&
      ptr.inside &&
      (P.draw < 0.5 || ptr.down) &&
      ptr.speed >= P.minSpeed;
    if (drawing) {
      S.pts.push({
        x: S.head.x,
        y: S.head.y,
        t: now,
        s: ptr.speed,
        b: S.broke,
      });
      S.broke = false;
    } else S.broke = true;
    while (S.pts.length && now - S.pts[0].t > P.length) S.pts.shift();
    if (S.pts.length < 2) return;

    const style = Math.round(P.style);
    const glow = style === 1 ? Math.max(P.glow, 0.35) : P.glow;
    const coreAmt = style === 1 ? Math.max(P.core, 0.55) : P.core;
    const ext = 1 + 2.5 * glow;
    const copies = Math.max(1, Math.round(P.copies));
    const colorBy = Math.round(P.colorBy);
    const jseed = Math.floor(now * 24);

    /* split into runs (a new stroke starts wherever the pointer stopped drawing) */
    const runs = [];
    let run = [];
    S.pts.forEach((pt) => {
      if (pt.b && run.length) {
        runs.push(run);
        run = [];
      }
      run.push(pt);
    });
    if (run.length) runs.push(run);

    const ranges = [];
    let used = 0;
    const ensure = (floats) => {
      if (S.verts.length < floats) {
        const bigger = new Float32Array(Math.max(floats, S.verts.length * 2));
        bigger.set(S.verts.subarray(0, used));
        S.verts = bigger;
      }
    };

    runs.forEach((raw) => {
      /* drop near-duplicates, then smooth with Catmull-Rom so fast strokes are curves, not polylines */
      const kept = [];
      raw.forEach((pt) => {
        const last = kept[kept.length - 1];
        if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 0.6)
          kept.push(pt);
      });
      if (kept.length < 2) return;
      const path = [];
      const stepPx =
        P.wiggle > 0 ? clamp(100 / Math.max(P.wiggleFreq, 0.2) / 12, 2, 8) : 8; // finer sampling so a wiggle stays a curve
      for (let i = 0; i < kept.length - 1; i++) {
        const p0 = kept[Math.max(0, i - 1)],
          p1 = kept[i],
          p2 = kept[i + 1],
          p3 = kept[Math.min(kept.length - 1, i + 2)];
        const segs = clamp(
          Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / stepPx),
          1,
          16,
        );
        for (let s = 0; s < segs; s++) {
          const u = s / segs,
            u2 = u * u,
            u3 = u2 * u;
          const cx =
            0.5 *
            (2 * p1.x +
              (-p0.x + p2.x) * u +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3);
          const cy =
            0.5 *
            (2 * p1.y +
              (-p0.y + p2.y) * u +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3);
          path.push({
            x: cx,
            y: cy,
            age: now - (p1.t + (p2.t - p1.t) * u),
            s: p1.s + (p2.s - p1.s) * u,
          });
        }
      }
      const tail = kept[kept.length - 1];
      path.push({ x: tail.x, y: tail.y, age: now - tail.t, s: tail.s });
      const n = path.length;
      if (n < 2) return;
      /* distance from the head (the newest end) and unit normals */
      let acc = 0;
      path[n - 1].d = 0;
      for (let i = n - 2; i >= 0; i--) {
        acc += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
        path[i].d = acc;
      }
      path.forEach((pt, i) => {
        const a = path[Math.max(0, i - 1)],
          b = path[Math.min(n - 1, i + 1)];
        const tx = b.x - a.x,
          ty = b.y - a.y,
          len = Math.hypot(tx, ty) || 1;
        pt.nx = -ty / len;
        pt.ny = tx / len;
      });
      for (let c = 0; c < copies; c++) {
        ensure((used / INST + n * 2) * INST);
        const first = used / INST;
        const offset = (c - (copies - 1) / 2) * P.copySpread;
        for (let i = 0; i < n; i++) {
          const pt = path[i];
          const along = clamp01(pt.age / Math.max(P.length, 0.001));
          const hw = Math.max(
            0.5,
            0.5 * P.width * (1 - P.taper * Math.pow(along, 0.8)),
          );
          const alpha = Math.pow(Math.max(0, 1 - along), P.fade * 1.6);
          const ramp = clamp01(pt.d / 40);
          const ease = ramp * ramp * (3 - 2 * ramp);
          let shift = offset;
          if (P.wiggle > 0)
            shift +=
              P.wiggle *
              Math.sin(
                pt.d * ((P.wiggleFreq * TAU) / 100) -
                  now * P.wiggleSpeed * Math.PI +
                  (c * TAU) / copies,
              ) *
              ease;
          if (style === 4 && P.jitter > 0) {
            const kk = pt.d / 9,
              k0 = Math.floor(kk),
              f = kk - k0,
              sf = f * f * (3 - 2 * f),
              base = jseed * 7.13 + c * 17;
            shift +=
              (hash(k0 + base) * (1 - sf) + hash(k0 + 1 + base) * sf - 0.5) *
              2 *
              P.jitter *
              ease;
          }
          const cx = pt.x + pt.nx * shift,
            cy = pt.y + pt.ny * shift;
          const ct =
            colorBy === 0
              ? along
              : colorBy === 1
                ? tri(now * 0.18 + along * 0.6)
                : colorBy === 2
                  ? clamp01(pt.s / 1500)
                  : 0;
          for (let side = -1; side <= 1; side += 2) {
            const q = used;
            S.verts[q] = cx + pt.nx * side * hw * ext;
            S.verts[q + 1] = cy + pt.ny * side * hw * ext;
            S.verts[q + 2] = side;
            S.verts[q + 3] = along;
            S.verts[q + 4] = alpha;
            S.verts[q + 5] = ct;
            S.verts[q + 6] = pt.d;
            S.verts[q + 7] = hw;
            used += INST;
          }
        }
        ranges.push([first, n * 2]);
      }
    });
    if (!ranges.length) return;

    const entry = makeProgram(
      "gen:ribbon",
      sources.gen.ribbon.vert,
      sources.gen.ribbon.frag,
    );
    gl.useProgram(entry.program);
    gl.bindVertexArray(S.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, S.buf);
    gl.bufferData(gl.ARRAY_BUFFER, S.verts.subarray(0, used), gl.DYNAMIC_DRAW);
    gl.uniform2f(loc(entry, "uView"), W, H);
    setFloat(entry, "uStyle", style);
    setFloat(entry, "uSoft", P.soft);
    setFloat(entry, "uGlow", glow);
    setFloat(entry, "uCore", coreAmt);
    setFloat(entry, "uBright", P.bright);
    setFloat(entry, "uDash", P.dash === undefined ? 20 : P.dash);
    setFloat(entry, "uDashGap", P.dashGap === undefined ? 14 : P.dashGap);
    setFloat(entry, "uDashSpeed", P.dashSpeed === undefined ? 0 : P.dashSpeed);
    setFloat(entry, "uTime", now);
    setFloat(entry, "uExt", ext);
    setPalette(entry, pass.colors, Math.round(P.stepped));
    gl.enable(gl.BLEND);
    gl.blendFunc(
      gl.ONE,
      Math.round(P.blend) === 1 ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA,
    );
    ranges.forEach((r) => gl.drawArrays(gl.TRIANGLE_STRIP, r[0], r[1]));
    gl.disable(gl.BLEND);
    gl.bindVertexArray(quad);
  }

  /* one frame of a generator: afterglow (decay / spread / drift) into the write buffer, then draw this frame's particles or ribbon on top */
  function genStep(plane) {
    const pass = enabled[plane.passIdx];
    if (!pass || !sources.gen) return;
    const P = pass.p;
    gl.bindVertexArray(quad);
    gl.bindFramebuffer(gl.FRAMEBUFFER, plane.write.fbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (P.persistence > 0.001) {
      const entry = getProgram("gen:fade", sources.gen.fade);
      gl.useProgram(entry.program);
      gl.uniform2f(loc(entry, "uResolution"), canvas.width, canvas.height);
      gl.uniform2f(
        loc(entry, "uDrift"),
        ((P.driftX || 0) * clock.dt) / (rect.width || 1),
        (-(P.driftY || 0) * clock.dt) / (rect.height || 1),
      );
      setFloat(entry, "uDecay", Math.pow(P.persistence, clock.dt * 60));
      setFloat(entry, "uSpread", P.spread || 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, plane.read.tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    if (plane.kind === "emitter") stepEmitter(plane, pass);
    else stepRibbon(plane, pass);
    const swap = plane.read;
    plane.read = plane.write;
    plane.write = swap;
  }

  /* ═════════════ drawing the pass stack ═════════════ */

  const bind = (unit, texture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };
  function draw(plane, input, background, trail, output) {
    const pass = enabled[plane.passIdx],
      entry = plane.entry;
    gl.useProgram(entry.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output ? output.fbo : null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(loc(entry, "uResolution"), canvas.width, canvas.height);
    gl.uniform2f(loc(entry, "uMousePos"), plane.mouse[0], plane.mouse[1]);
    gl.uniform2f(
      loc(entry, "uPreviousMousePos"),
      plane.previous[0],
      plane.previous[1],
    );
    gl.uniform1f(loc(entry, "uTime"), plane.time);
    for (const key in pass.p) {
      const l = loc(entry, "u" + cap(key));
      if (l) gl.uniform1f(l, pass.p[key]);
    }
    if (pass.colors && pass.colors.length) {
      setPalette(entry, pass.colors);
      const tint = loc(entry, "uTint");
      if (tint) gl.uniform3fv(tint, hexToRgb(pass.colors[0]));
    }
    setFloat(entry, "uHasInput", plane.hasInput ? 1 : 0);
    bind(0, input);
    bind(1, background);
    bind(2, trail || white);
    bind(3, noise);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function renderFrame() {
    gl.bindVertexArray(quad);
    pingPongs.forEach((plane) => {
      if (plane.gen) {
        genStep(plane);
        return;
      }
      updatePlane(plane);
      draw(plane, white, white, plane.read.tex, plane.write);
      const swap = plane.read;
      plane.read = plane.write;
      plane.write = swap;
    });
    ptr.clicks.length = 0;
    gl.bindVertexArray(quad);
    stack.forEach((plane, k) => {
      updatePlane(plane);
      plane.hasInput = k > 0;
      const input = k > 0 ? renderTargets[k - 1].tex : white;
      const bgIndex = k - (1 + plane.passIndex);
      const background =
        plane.passIndex > 0
          ? bgIndex >= 0
            ? renderTargets[bgIndex].tex
            : white
          : white;
      draw(
        plane,
        input,
        background,
        plane.pingPong ? plane.pingPong.read.tex : null,
        renderTargets[k],
      );
    });
  }

  /* ----- loop, with a soft safety net for weak GPUs ----- */
  let raf = 0,
    lastTime = 0,
    lastFrame = 0,
    sum = 0,
    count = 0,
    dead = false;
  function frame(time) {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    mouse.pos.x = mouse.move.x;
    mouse.pos.y = mouse.move.y;
    if (!moving) recordTrail();
    if (time - lastTime >= FRAME_MS) {
      clock.dt = clamp((time - lastTime) / 1000, 0.001, 0.05);
      clock.now = time / 1000;
      tickPointer(clock.dt);
      try {
        renderFrame();
      } catch (error) {
        dead = true;
        cancelAnimationFrame(raf);
        fail(error && error.message ? error.message : String(error));
        return;
      }
      lastTime = time;
    }
    if (lastFrame && time - lastFrame < 200) {
      sum += time - lastFrame;
      if (++count === 90) {
        if (sum / count > 28 && scale > 0.5) {
          scale = Math.max(0.5, scale - 0.125);
          resize();
        }
        sum = 0;
        count = 0;
      }
    } else {
      sum = 0;
      count = 0;
    }
    lastFrame = time;
  }

  const onLost = (event) => {
    event.preventDefault();
    dead = true;
    cancelAnimationFrame(raf);
    fail("The WebGL context was lost.");
  };
  canvas.addEventListener("webglcontextlost", onLost);

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
    invalidate() {
      rect = canvas.getBoundingClientRect();
    },
    resize,
    setConfig(next) {
      const rebuild = sig(next) !== signature;
      config = next;
      if ((next.scale || 1) !== maxScale) {
        maxScale = next.scale || 1;
        scale = maxScale;
        resize();
      }
      if (rebuild) {
        try {
          build();
        } catch (error) {
          fail(error && error.message ? error.message : String(error));
        }
      } else
        enabled = config.passes.filter(
          (pass) => pass.enabled && sources.kinds[pass.kind],
        );
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      clearTimeout(movingTimer);
      canvas.removeEventListener("webglcontextlost", onLost);
      disposeGen();
      disposeTargets();
      programs.forEach((entry) => gl.deleteProgram(entry.program));
      programs.clear();
      const lose = gl.getExtension("WEBGL_lose_context"); // free the context now: pages that mount and unmount the effect would otherwise hit the browser's context limit
      if (lose) lose.loseContext();
    },
  };
}
