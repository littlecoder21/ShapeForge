(() => {
  'use strict';

  const layer = document.getElementById('gradient');
  const canvas = document.getElementById('chroma');
  if (!layer) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* =====================================================================
     1. Spring gradient (values copied from the original page script)
     ===================================================================== */
  const colors = ['rgb(27, 77, 128)', 'rgb(6, 17, 38)', 'rgb(48, 139, 191)'];
  const stiffness = 200;
  const damping = 28;
  const mass = 0.8;
  const orbitRadius = 15;
  const loopDuration = 10;
  const hoverOverscan = 48;

  const pointer = { x: 50, y: 50, targetX: 50, targetY: 50, velocityX: 0, velocityY: 0 };
  const clamp = (value) => Math.max(0, Math.min(100, value));
  let bounds = null;
  let previousTime = performance.now();
  const startTime = previousTime;

  function returnToCenter() {
    pointer.targetX = 50;
    pointer.targetY = 50;
  }

  function stopFollowing() {
    returnToCenter();
    window.removeEventListener('pointermove', followPointer);
    bounds = null;
  }

  function followPointer(event) {
    if (!bounds) return;
    const outside =
      event.clientX < bounds.left - hoverOverscan ||
      event.clientX > bounds.right + hoverOverscan ||
      event.clientY < bounds.top - hoverOverscan ||
      event.clientY > bounds.bottom + hoverOverscan;
    if (outside) {
      stopFollowing();
      return;
    }
    pointer.targetX = clamp(((event.clientX - bounds.left) / bounds.width) * 100);
    pointer.targetY = clamp(((event.clientY - bounds.top) / bounds.height) * 100);
  }

  function startFollowing(event) {
    bounds = layer.getBoundingClientRect();
    followPointer(event);
    window.addEventListener('pointermove', followPointer, { passive: true });
  }

  function renderGradient(now) {
    const delta = Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;

    if (!reducedMotion) {
      pointer.velocityX += ((stiffness * (pointer.targetX - pointer.x) - damping * pointer.velocityX) / mass) * delta;
      pointer.velocityY += ((stiffness * (pointer.targetY - pointer.y) - damping * pointer.velocityY) / mass) * delta;
      pointer.x += pointer.velocityX * delta;
      pointer.y += pointer.velocityY * delta;
    }

    const phase = reducedMotion ? 0 : ((now - startTime) / 1000 / loopDuration) * Math.PI * 2;
    const firstX = 50 + (pointer.x - 50) * 0.5;
    const firstY = 50 + (pointer.y - 50) * 0.5;
    const secondX = 50 + Math.cos(phase) * orbitRadius;
    const secondY = 50 + Math.sin(phase) * orbitRadius;
    const thirdX = 50 + Math.cos(phase + (2 * Math.PI) / 3) * orbitRadius;
    const thirdY = 50 + Math.sin(phase + (2 * Math.PI) / 3) * orbitRadius;

    layer.style.background =
      `radial-gradient(circle at ${firstX}% ${firstY}%, ${colors[0]} 0%, ${colors[0]} 22%, rgba(0,0,0,0) 60%), ` +
      `radial-gradient(circle at ${secondX}% ${secondY}%, ${colors[1]} 0%, ${colors[1]} 22%, rgba(0,0,0,0) 60%), ` +
      `radial-gradient(circle at ${thirdX}% ${thirdY}%, ${colors[2]} 0%, ${colors[2]} 22%, rgba(0,0,0,0) 60%)`;

    if (!reducedMotion) requestAnimationFrame(renderGradient);
  }

  layer.addEventListener('pointerenter', startFollowing);
  layer.addEventListener('pointerdown', startFollowing, { passive: true });
  const releaseGradient = (event) => { if (event.pointerType === 'touch') stopFollowing(); };
  window.addEventListener('pointerup', releaseGradient);
  window.addEventListener('pointercancel', releaseGradient);
  window.addEventListener('blur', returnToCenter);
  window.addEventListener('resize', () => {
    if (bounds) bounds = layer.getBoundingClientRect();
    if (reducedMotion) requestAnimationFrame(renderGradient);
  });
  requestAnimationFrame(renderGradient);

  /* =====================================================================
     2. Chroma layer: the shader pipeline stored in effect.json, run with
        plain WebGL2. Same pass order, uniforms, mouse smoothing and trail
        logic as the original player, without any library.
     ===================================================================== */
  const FPS = 60;
  const FRAME_MS = Math.floor(1000 / FPS);

  const showNotice = (text) => {
    const note = document.createElement('p');
    note.className = 'notice';
    note.textContent = text;
    document.body.appendChild(note);
  };

  // Library-free stand-in for the project's blue-noise image (used only to dither the light rays)
  function makeBlueNoise(size) {
    const n = size * size;
    const white = new Float32Array(n);
    for (let i = 0; i < n; i++) white[i] = Math.random();
    let a = white;
    const blurPass = (src, horizontal) => {
      const out = new Float32Array(n);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let sum = 0;
          for (let k = -2; k <= 2; k++) {
            const xx = horizontal ? (x + k + size) % size : x;
            const yy = horizontal ? y : (y + k + size) % size;
            sum += src[yy * size + xx];
          }
          out[y * size + x] = sum / 5;
        }
      }
      return out;
    };
    for (let i = 0; i < 2; i++) a = blurPass(blurPass(a, true), false);
    const high = new Float32Array(n);
    for (let i = 0; i < n; i++) high[i] = white[i] - a[i];
    const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => high[i] - high[j]);
    const data = new Uint8Array(n * 4);
    order.forEach((index, rank) => {
      const v = Math.round((rank / (n - 1)) * 255);
      data.set([v, v, v, 255], index * 4);
    });
    return data;
  }

  // Guards the ping-pong shader against a zero-length mouse segment (identical maths otherwise)
  const guardMouseShader = (src) => src
    .replace('dir = normalize(dir);', 'dir = dist > 0.000001 ? dir / dist : vec2(1.0, 0.0);')
    .replace('/ dist, 0.0, 1.0)', '/ max(dist, 0.000001), 0.0, 1.0)')
    .replace('smoothstep(0.0, dist,', 'smoothstep(0.0, max(dist, 0.000001),');

  async function startChroma() {
    if (!canvas) return;
    if (reducedMotion) { canvas.style.display = 'none'; return; }

    let project;
    try {
      const response = await fetch('effect.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      project = await response.json();
    } catch (error) {
      console.warn('effect.json could not be loaded:', error);
      canvas.style.display = 'none';
      showNotice('Open this page through a local server (for example VS Code Live Server) so effect.json can load.');
      return;
    }

    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) { canvas.style.display = 'none'; return; }
    const halfFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    /* ----- full-screen quad ----- */
    const quad = gl.createVertexArray();
    gl.bindVertexArray(quad);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0, 0,
       1, -1, 0, 1, 0,
      -1,  1, 0, 0, 1,
       1,  1, 0, 1, 1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

    /* ----- programs ----- */
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const SAMPLERS = { uTexture: 0, uBgTexture: 1, uPingPongTexture: 2, uBlueNoise: 3 };

    function makeProgram(vertex, fragment) {
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.bindAttribLocation(program, 0, 'aVertexPosition');
      gl.bindAttribLocation(program, 1, 'aTextureCoord');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const u = {};
      ['uMVMatrix', 'uPMatrix', 'uTextureMatrix', 'uResolution', 'uMousePos', 'uPreviousMousePos', 'uTime', 'uSampleBg']
        .forEach((name) => { u[name] = gl.getUniformLocation(program, name); });
      for (const name in SAMPLERS) gl.uniform1i(gl.getUniformLocation(program, name), SAMPLERS[name]);
      ['uMVMatrix', 'uPMatrix', 'uTextureMatrix'].forEach((name) => { if (u[name]) gl.uniformMatrix4fv(u[name], false, identity); });
      if (u.uSampleBg) gl.uniform1i(u.uSampleBg, 1);
      return { program, u };
    }

    /* ----- layers -> planes (same ordering rules as the original player) ----- */
    // The gradient and shape layers in this project only produce a flat white image, so that base is a 1x1 white texture.
    const stack = [];
    const pingPongs = [];
    const layers = project.history.filter((l) => l.layerType === 'effect' && l.type !== 'gradient');

    layers.forEach((def) => {
      const state = {
        def,
        speed: def.speed || 0.5,
        animating: !!def.animating,
        momentum: def.mouseMomentum || 0,
        last: null
      };
      const makePlane = (index, extra) => {
        const frag = def.compiledFragmentShaders[index] || def.compiledFragmentShaders[0];
        const vert = def.compiledVertexShaders[index] || def.compiledVertexShaders[0];
        const guarded = def.type === 'mouse' && extra.pingPong ? guardMouseShader(frag) : frag;
        return Object.assign({ state, time: 0, mouse: [0.5, 0.5], previous: [0.5, 0.5], passIndex: 0 }, makeProgram(vert, guarded), extra);
      };
      const passes = def.data && def.data.passes;
      if (passes && passes.length) {
        stack.push(makePlane(0, { passIndex: 0 }));
        passes.forEach((pass, i) => stack.push(makePlane(i + 1, { passIndex: i + 1 })));
      } else {
        stack.push(makePlane(0, { passIndex: 0 }));
        if (def.type === 'mouse') {
          const pingPong = makePlane(1, { pingPong: true });
          stack[stack.length - 1].pingPong = pingPong;
          pingPongs.push(pingPong);
        }
      }
    });
    if (!stack.length) { canvas.style.display = 'none'; return; }

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

    let useHalfFloat = halfFloat;
    const targets = [];
    const disposeTargets = () => {
      targets.splice(0).forEach((t) => { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); });
    };

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
      let target = build(useHalfFloat);
      if (!target.ok && useHalfFloat) { useHalfFloat = false; target = build(false); }
      targets.push(target);
      return target;
    }

    /* ----- size ----- */
    let scale = 1;
    let bbox = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    let renderTargets = [];

    function setSize() {
      canvas.width = Math.max(2, Math.round(window.innerWidth * scale));
      canvas.height = Math.max(2, Math.round(window.innerHeight * scale));
      bbox = canvas.getBoundingClientRect();
      disposeTargets();
      renderTargets = stack.map((plane, k) => (k < stack.length - 1 ? makeTarget(canvas.width, canvas.height) : null));
      pingPongs.forEach((plane) => { plane.read = makeTarget(canvas.width, canvas.height); plane.write = makeTarget(canvas.width, canvas.height); });
    }
    setSize();

    /* ----- mouse state (same bookkeeping as the original player) ----- */
    const mouse = {
      pos: { x: window.innerWidth / 4, y: window.innerHeight / 4 },
      move: { x: window.innerWidth / 4, y: window.innerHeight / 4 },
      trail: []
    };
    let moving = false;
    let movingTimer;

    const recordTrail = () => {
      mouse.trail.unshift([mouse.pos.x / (bbox.width * 0.5), 1 - mouse.pos.y / (bbox.height * 0.5)]);
      if (mouse.trail.length > 100) mouse.trail.pop();
    };

    window.addEventListener('pointermove', (event) => {
      recordTrail();
      moving = true;
      clearTimeout(movingTimer);
      movingTimer = setTimeout(() => { moving = false; }, 16);
      mouse.move.x = event.clientX / 2 - bbox.left / 2;
      mouse.move.y = event.clientY / 2 - bbox.top / 2;
    }, { passive: true });

    // A new touch starts where the finger lands, so no streak is drawn from the previous touch
    window.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      mouse.move.x = mouse.pos.x = event.clientX / 2 - bbox.left / 2;
      mouse.move.y = mouse.pos.y = event.clientY / 2 - bbox.top / 2;
      mouse.trail.length = 0;
      stack.forEach((p) => { p.state.last = null; });
    }, { passive: true });

    // Averages the position towards its previous value; momentum 0.47 gives 25% new / 75% old
    const momentum = (value, previous, amount) => {
      for (let s = 0; s < amount; s++) value = (value + previous) / 2;
      return +((value + previous) / 2).toFixed(4);
    };

    function updatePlane(plane) {
      const state = plane.state;
      if (state.animating) plane.time += (state.speed || 1) * 60 / FPS;
      const halfW = bbox.width / 2;
      const halfH = bbox.height / 2;
      let x = mouse.pos.x;
      let y = mouse.pos.y;
      if (state.momentum) {
        if (!state.last) state.last = { x: mouse.pos.x / halfW, y: 1 - mouse.pos.y / halfH };
        const lastX = state.last.x * halfW;
        const lastY = (1 - state.last.y) * halfH;
        x = momentum(x, lastX, state.momentum * 2);
        y = momentum(y, lastY, state.momentum * 2);
        state.last.x = x / halfW;
        state.last.y = 1 - y / halfH;
      }
      plane.mouse[0] = x / halfW;
      plane.mouse[1] = 1 - y / halfH;
      if (mouse.trail.length > 3) {
        plane.previous[0] = mouse.trail[3][0];
        plane.previous[1] = mouse.trail[3][1];
      } else {
        plane.previous[0] = plane.mouse[0];
        plane.previous[1] = plane.mouse[1];
      }
    }

    const bind = (unit, texture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    };

    function drawPlane(plane, input, background, trail, output) {
      gl.useProgram(plane.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, output ? output.fbo : null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      const u = plane.u;
      if (u.uResolution) gl.uniform2f(u.uResolution, canvas.width, canvas.height);
      if (u.uMousePos) gl.uniform2f(u.uMousePos, plane.mouse[0], plane.mouse[1]);
      if (u.uPreviousMousePos) gl.uniform2f(u.uPreviousMousePos, plane.previous[0], plane.previous[1]);
      if (u.uTime) gl.uniform1f(u.uTime, plane.time);
      bind(0, input);
      bind(1, background);
      bind(2, trail || white);
      bind(3, noise);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function renderFrame() {
      gl.bindVertexArray(quad);

      // 1) feedback (trail) passes first, as in the original player
      pingPongs.forEach((plane) => {
        updatePlane(plane);
        drawPlane(plane, white, white, plane.read.tex, plane.write);
        const swap = plane.read; plane.read = plane.write; plane.write = swap;
      });

      // 2) the layer stack, each pass reading the previous result
      stack.forEach((plane, k) => {
        updatePlane(plane);
        const input = k > 0 ? renderTargets[k - 1].tex : white;
        const bgIndex = k - (1 + plane.passIndex);
        const background = plane.passIndex > 0 ? (bgIndex >= 0 ? renderTargets[bgIndex].tex : white) : white;
        const trail = plane.pingPong ? plane.pingPong.read.tex : null;
        drawPlane(plane, input, background, trail, renderTargets[k]);
      });
    }

    /* ----- loop ----- */
    let lastTime = 0;
    let lastFrame = 0;
    let sum = 0;
    let count = 0;

    function frame(time) {
      requestAnimationFrame(frame);

      mouse.pos.x = mouse.move.x;
      mouse.pos.y = mouse.move.y;
      if (!moving) recordTrail();

      if (time - lastTime >= FRAME_MS) {
        renderFrame();
        lastTime = time;
      }

      // Soft safety net for weak GPUs: lower the internal resolution if frames stay slow
      if (lastFrame && time - lastFrame < 200) {
        sum += time - lastFrame;
        if (++count === 90) {
          if (sum / count > 28 && scale > 0.5) { scale = Math.max(0.5, scale - 0.125); setSize(); }
          sum = 0;
          count = 0;
        }
      } else {
        sum = 0;
        count = 0;
      }
      lastFrame = time;
    }

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const dw = Math.abs(Math.round(window.innerWidth * scale) - canvas.width);
        const dh = Math.abs(Math.round(window.innerHeight * scale) - canvas.height);
        if (dw > 1 || dh > 1) setSize();
      }, 150);
    });

    requestAnimationFrame(frame);
  }

  startChroma().catch((error) => {
    console.warn('Chroma layer disabled:', error);
    if (canvas) canvas.style.display = 'none';
  });
})();
