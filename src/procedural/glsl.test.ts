import { describe, expect, it } from 'vitest';
import { PROC_ANCHORS, generateProceduralGlsl, injectProceduralGlsl, assembleProceduralShader, PROCEDURAL_UNIFORM_NAMES } from './glsl';
import { newProcedural, proceduralSignature } from './types';
import proceduralRuntimeSource from './proceduralRuntime.js?raw';
import { createProceduralState, generatePoints } from './proceduralRuntime';

/** The three lines the injector attaches to, in a stand-in template. The real template is tested by the repo's shader checks. */
const TEMPLATE = `precision highp float;
uniform float uAspect;
/*@RIG_DEFINES*/
/*@RIG_FUNCTIONS*/
void main() {
  vec2 warped = vec2(0.0); vec2 p = vec2(0.0); float t = 0.0; vec4 color = vec4(0.0); float alpha = 1.0;
${PROC_ANCHORS.warp}
${PROC_ANCHORS.color}
    color.a = 1.0;
  }
}`;
const cfg = (patch: Record<string, unknown> = {}) => newProcedural({ enabled: true, ...patch });

describe('procedural GLSL injection', () => {
  it('leaves the template byte-identical when the engine is off', () => {
    expect(injectProceduralGlsl(TEMPLATE, null)).toBe(TEMPLATE);
    expect(injectProceduralGlsl(TEMPLATE, { ...cfg(), enabled: false })).toBe(TEMPLATE);
  });
  it('adds the functions after the rig functions and a hook at each anchor', () => {
    const out = injectProceduralGlsl(TEMPLATE, cfg());
    expect(out.indexOf('vec4 procSample')).toBeGreaterThan(out.indexOf('/*@RIG_FUNCTIONS*/'));
    expect(out.indexOf('procDistort(warped, t)')).toBeLessThan(out.indexOf(PROC_ANCHORS.warp));
    expect(out.indexOf('procSample(warped')).toBeLessThan(out.indexOf(PROC_ANCHORS.color));
    expect(out).toContain('procDistort(warped, uProcD.y)');
    for (const name of PROCEDURAL_UNIFORM_NAMES) expect(out).toContain(name.replace('[0]', ''));
  });
  it('compiles only the distortion types that are present', () => {
    const wave = generateProceduralGlsl(cfg({ distortion: [{ type: 'wave' }, { type: 'none' }, { type: 'none' }] })).functions;
    expect(wave).toContain('procStage_wave');
    expect(wave).not.toContain('procStage_curl');
    expect(wave).not.toContain('procStage_multiwarp');
    const two = generateProceduralGlsl(cfg({ distortion: [{ type: 'curl' }, { type: 'polar' }, { type: 'none' }] }));
    expect(two.functions).toContain('procStage_curl');
    expect(two.functions).toContain('procStage_polar');
    expect(two.signature).toBe('curl,polar,none');
    expect(proceduralSignature(cfg({ distortion: [{ type: 'curl' }, { type: 'polar' }, { type: 'none' }] }))).toBe('on:curl,polar,none');
  });
  it('uses constant loop bounds only (GLSL ES 1.00)', () => {
    const all = generateProceduralGlsl(cfg({ distortion: [{ type: 'multiwarp' }, { type: 'curl' }, { type: 'turbulence' }] })).functions;
    const loops = [...all.matchAll(/for \(int i = 0; i < (\w+); i\+\+\)/g)].map(match => match[1]);
    expect(loops.length).toBeGreaterThan(0);
    for (const bound of loops) expect(/^\d+$/.test(bound)).toBe(true);
    expect(all).not.toMatch(/\d\s%\s\d|\bwhile\b/);
  });
  it('generates distinct inverse-multiquadric and compact-support kernels', () => {
    const inverse = generateProceduralGlsl(cfg({ field: { method: 'inverse-multiquadric' } })).functions;
    const compact = generateProceduralGlsl(cfg({ field: { method: 'wendland-c2' } })).functions;
    expect(inverse).toContain('inversesqrt(1.0 + scaled * scaled)');
    expect(inverse).not.toContain('support * support * support * support');
    expect(compact).toContain('support * support * support * support * (4.0 * dn + 1.0)');
    expect(compact).not.toContain('inversesqrt(1.0 + scaled * scaled)');
  });
  it('fails loudly if the template changes and an anchor disappears or repeats', () => {
    expect(() => injectProceduralGlsl(TEMPLATE.replace(PROC_ANCHORS.warp, ''), cfg())).toThrow(/warp/);
    expect(() => injectProceduralGlsl(TEMPLATE.replace(PROC_ANCHORS.color, `${PROC_ANCHORS.color}\n${PROC_ANCHORS.color}`), cfg())).toThrow(/color/);
  });
  it('assembles after the rig markers have been resolved', () => {
    const out = assembleProceduralShader(TEMPLATE, null, { octaves: 4, warpDepth: 2 }, cfg());
    expect(out).not.toContain('/*@RIG_FUNCTIONS*/');
    expect(out).toContain('vec3 rigHue');
    expect(out.indexOf('vec3 rigHue')).toBeLessThan(out.indexOf('vec3 procGrade'));
  });
});

describe('the runtime embeds into exports', () => {
  it('evaluates as a self-contained expression with the same behaviour as the module', () => {
    const names = [...proceduralRuntimeSource.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)].map(match => match[1]);
    const body = proceduralRuntimeSource.replace(/^export\s+/gm, '');
    const embedded = new Function(`return (function () {\n${body}\nreturn { ${names.join(', ')} };\n})()`)() as typeof import('./proceduralRuntime');
    expect(Object.keys(embedded).sort()).toEqual(expect.arrayContaining(['createProceduralState', 'generatePoints', 'uploadProceduralUniforms', 'createRng']));
    const config = cfg({ seed: 21 });
    expect(embedded.generatePoints(config, null)).toEqual(generatePoints(config, null));
    const a = embedded.createProceduralState(config);
    const b = createProceduralState(config);
    for (let i = 0; i < 90; i++) {
      a.step(1 / 60, null, 1.5, 1);
      b.step(1 / 60, null, 1.5, 1);
    }
    expect(Array.from(a.buffers.points)).toEqual(Array.from(b.buffers.points));
    expect(proceduralRuntimeSource).not.toContain('</script');
  });
});
