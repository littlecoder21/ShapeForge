/* A tiny fake WebGL used by the unit tests: it records what the code under test asks the GPU to do, so tests can assert
 * "compiled once", "one context", "rectangle placed at the top-left" without a browser. */

export interface FakeLog {
  programsCreated: number; programsDeleted: number; shadersCreated: number; linked: number;
  useProgram: number; draws: number; texturesCreated: number; texturesDeleted: number; buffersCreated: number;
  viewports: number[][]; scissors: number[][]; contextsRequested: string[]; copies: number[][]; uniformCalls: number;
}

export function createFakeGpu(options: { webgl2?: boolean; parallel?: boolean; width?: number; height?: number } = {}) {
  const log: FakeLog = { programsCreated: 0, programsDeleted: 0, shadersCreated: 0, linked: 0, useProgram: 0, draws: 0, texturesCreated: 0, texturesDeleted: 0, buffersCreated: 0, viewports: [], scissors: [], contextsRequested: [], copies: [], uniformCalls: 0 };
  const sources = new Map<object, string>();
  const programShaders = new Map<object, object[]>();
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const canvas: any = { width: options.width ?? 300, height: options.height ?? 150 };
  const gl: any = {
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, LINK_STATUS: 0x8b82, ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4, FLOAT: 0x1406,
    TEXTURE0: 0x84c0, TEXTURE1: 0x84c1, TEXTURE_2D: 0x0de1, TEXTURE_WRAP_S: 1, TEXTURE_WRAP_T: 2, TEXTURE_MIN_FILTER: 3, TEXTURE_MAG_FILTER: 4,
    CLAMP_TO_EDGE: 5, LINEAR: 6, RGBA: 7, UNSIGNED_BYTE: 8, NO_ERROR: 0, TRIANGLES: 4, COLOR_BUFFER_BIT: 0x4000, DEPTH_TEST: 9, CULL_FACE: 10,
    BLEND: 11, SRC_ALPHA: 12, ONE_MINUS_SRC_ALPHA: 13, SCISSOR_TEST: 14, MAX_FRAGMENT_UNIFORM_VECTORS: 15,
    get drawingBufferWidth() { return canvas.width; }, get drawingBufferHeight() { return canvas.height; },
    createShader: () => { log.shadersCreated++; return {}; },
    shaderSource: (shader: object, source: string) => { sources.set(shader, source); },
    compileShader: () => undefined,
    createProgram: () => { log.programsCreated++; return {}; },
    attachShader: (program: object, shader: object) => { programShaders.set(program, [...(programShaders.get(program) ?? []), shader]); },
    linkProgram: () => { log.linked++; },
    // a source containing the word FAIL makes the link fail
    getProgramParameter: (program: object, name: number) => {
      if (name === 0x91b1) return true;
      const failing = (programShaders.get(program) ?? []).some(shader => (sources.get(shader) ?? '').includes('FAIL'));
      return !failing;
    },
    getShaderInfoLog: () => 'ERROR: 0:1: simulated compile failure', getProgramInfoLog: () => '',
    deleteShader: () => undefined,
    deleteProgram: () => { log.programsDeleted++; },
    getAttribLocation: (_p: object, name: string) => name === 'aPosition' ? 0 : 1,
    getUniformLocation: (_p: object, name: string) => ({ name }),
    useProgram: () => { log.useProgram++; },
    createBuffer: () => { log.buffersCreated++; return {}; }, bindBuffer: () => undefined, bufferData: () => undefined, deleteBuffer: () => undefined,
    enableVertexAttribArray: () => undefined, vertexAttribPointer: () => undefined,
    uniform1f: () => { log.uniformCalls++; }, uniform2f: () => { log.uniformCalls++; }, uniform3f: () => { log.uniformCalls++; }, uniform4f: () => { log.uniformCalls++; }, uniform1i: () => undefined,
    uniform1fv: () => { log.uniformCalls++; }, uniform3fv: () => { log.uniformCalls++; }, uniform4fv: () => { log.uniformCalls++; },
    activeTexture: () => undefined, bindTexture: () => undefined,
    createTexture: () => { log.texturesCreated++; return {}; }, deleteTexture: () => { log.texturesDeleted++; },
    texParameteri: () => undefined, texImage2D: () => undefined, getError: () => 0,
    drawArrays: () => { log.draws++; },
    viewport: (...args: number[]) => { log.viewports.push(args); }, scissor: (...args: number[]) => { log.scissors.push(args); },
    clearColor: () => undefined, clear: () => undefined, disable: () => undefined, enable: () => undefined, blendFunc: () => undefined,
    getParameter: (name: number) => name === 15 ? 221 : 0,
    getExtension: (name: string) => name === 'KHR_parallel_shader_compile' ? (options.parallel ? {} : null) : name === 'WEBGL_lose_context' ? { loseContext: () => undefined } : null,
  };
  canvas.getContext = (type: string) => { log.contextsRequested.push(type); return type === 'webgl2' && options.webgl2 !== false ? gl : null; };
  canvas.addEventListener = (type: string, fn: (event: unknown) => void) => { listeners.set(type, [...(listeners.get(type) ?? []), fn]); };
  canvas.removeEventListener = (type: string, fn: (event: unknown) => void) => { listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== fn)); };
  const fire = (type: string) => (listeners.get(type) ?? []).forEach(fn => fn({ preventDefault: () => undefined }));
  const context2d = { clearRect: () => undefined, drawImage: (...args: unknown[]) => { log.copies.push(args.slice(1) as number[]); } };
  return { canvas: canvas as HTMLCanvasElement, gl, log, fire, context2d: context2d as unknown as CanvasRenderingContext2D };
}
