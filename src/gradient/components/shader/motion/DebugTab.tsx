import { useMemo } from 'react';
import { generateMotionGlsl, isMotionActive, motionSignature } from '../../../../motion/glsl';
import { createMotionState, qualityDualPhase, qualityOctaves, stepMotion } from '../../../../motion/motionRuntime';
import { QUALITY_MODES, type MotionQuality } from '../../../../motion/types';
import { Section, Select } from '../parts';
import { labelOf } from './controls';
import type { MotionEditor } from './useMotion';

const QUALITY_HINT: Record<MotionQuality, string> = {
  auto: 'Follows the project quality and backs off on slow devices.',
  performance: 'Fewer noise octaves, a single flow phase: cheapest, slightly more visible loop seams.',
  balanced: 'The default trade-off.',
  high: 'More octaves and the cross-faded dual flow phase.',
  ultra: 'Everything on. Use for exports and strong GPUs.',
};

/** Real numbers about the compiled motion: what the shader contains, how many uniforms it needs, what the engine did last. */
export default function DebugTab({ editor }: { editor: MotionEditor }) {
  const { config, edit } = editor;
  const info = useMemo(() => {
    const active = isMotionActive(config);
    const state = createMotionState();
    stepMotion(state, config, null, 1 / 60, { aspect: 1.6, shaderDt: 1 / 60, animate: true, projectQuality: 'medium', octaveCap: 4, dual: true, clock: 0 });
    let glsl = 0;
    try { glsl = active ? generateMotionGlsl(config).functions.length : 0; } catch { glsl = -1; }
    return { active, signature: motionSignature(config), glsl, stats: state.stats };
  }, [config]);
  return <div data-testid="motion-debug-tab">
    <Section title="Quality">
      <Select id="motion-quality" label="Quality mode" value={config.performance.quality} options={QUALITY_MODES.map(id => ({ id, label: labelOf(id) }))} onChange={quality => edit(d => { d.performance.quality = quality; })} />
      <p className="hint">{QUALITY_HINT[config.performance.quality]}</p>
      <p className="hint">Octave cap at medium project quality: {qualityOctaves(config.performance.quality, 'medium')}; dual flow phase {qualityDualPhase(config.performance.quality, 'medium') ? 'on' : 'off'}.</p>
    </Section>
    <Section title="Compiled motion" aside={info.active ? 'Active' : 'Idle'}>
      <dl className="gs-mot-stats">
        <dt>Shader variant</dt><dd><code>{info.signature}</code></dd>
        <dt>Generated GLSL</dt><dd>{info.glsl < 0 ? 'failed to build' : `${info.glsl.toLocaleString()} characters`}</dd>
        <dt>Flow sources packed</dt><dd>{info.stats.sources}</dd>
        <dt>Paths</dt><dd>{info.stats.paths}</dd>
        <dt>Active modulators</dt><dd>{info.stats.modulators}</dd>
        <dt>Flow phases</dt><dd>{info.stats.phases}</dd>
      </dl>
      <p className="hint">The shader is recompiled only when this variant string changes (a different flow type, turbulence kind, source count tier, pointer response or colour modulator). Moving any slider never recompiles. If a variant fails to compile on a device, the renderer falls back to the shader without motion instead of showing nothing.</p>
    </Section>
  </div>;
}
