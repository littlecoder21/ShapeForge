import { Switch } from '../../../shared/controls';
import { DEFAULT_INTERACTIVE_SETTINGS, IDLE_PATHS, MOTION_RANGES, type IdlePath, type ShaderLayerControls } from '../../interactive/types';
import { Num, Section, Select } from './parts';
import { useShader } from './context';

type MotionKey = keyof ShaderLayerControls;
const IDLE_LABEL: Record<IdlePath, string> = { drift: 'Slow drift', circle: 'Circle', figure8: 'Figure eight', scan: 'Scan sweep', wander: 'Wander' };

/** Advanced motion: playback, fluid distortion, flow direction & spin, breathing, time offset and the idle pointer. */
export default function MotionPanel() {
  const { settings, update, primary, targets, patchLayers } = useShader();
  const independent = !!primary?.shader?.controls;
  const values: ShaderLayerControls = primary?.shader?.controls ?? {
    speed: settings.speed, intensity: settings.intensity, distortion: settings.distortion, distortionScale: settings.distortionScale, turbulence: settings.turbulence,
    timeOffset: settings.timeOffset, flowAngle: settings.flowAngle, flowDrift: settings.flowDrift, breath: settings.breath, breathRate: settings.breathRate,
    rotation: settings.rotation, zoom: settings.zoom, meshDrift: settings.meshDrift, meshSpread: settings.meshSpread, meshBlend: settings.meshBlend,
  };
  const globalDefaults = (): ShaderLayerControls => ({ ...values });
  const set = (key: MotionKey, value: number) => {
    if (!independent) { update({ [key]: value } as Partial<typeof settings>, key); return; }
    // independent controls: each target keeps its own copy and receives only the changed key
    targets.forEach(layer => patchLayers({ controls: { ...(layer.shader?.controls ?? globalDefaults()), [key]: value } }, [layer.id], `motion-${key}`));
  };
  const slider = (key: MotionKey, label: string, step: number, extra: { unit?: string; testId: string }) => <Num
    label={label} value={values[key]} min={MOTION_RANGES[key].min} max={MOTION_RANGES[key].max} step={step}
    def={DEFAULT_INTERACTIVE_SETTINGS[key]} {...(extra.unit ? { unit: extra.unit } : {})} onChange={value => set(key, value)} testId={extra.testId}
  />;

  return <div data-testid="shader-panel-motion">
    <Section title="Playback">
      <Switch label="Animate" checked={settings.animate} onChange={animate => update({ animate })} testId="shader-animate" />
      {slider('speed', 'Animation speed', 0.01, { unit: '×', testId: 'shader-speed' })}
      {slider('intensity', 'Intensity', 0.01, { testId: 'shader-intensity' })}
      <Switch
        label="Independent controls per layer"
        checked={independent}
        onChange={enabled => patchLayers({ enabled: true, controls: enabled ? globalDefaults() : undefined })}
        testId="shader-layer-controls"
      />
      <p className="hint">{independent ? 'Every motion value on this page now belongs to the selected layers only, so stacked layers can move differently.' : 'Motion values are shared by all shader layers. Turn this on to give the selected layers their own.'}</p>
    </Section>
    <Section title="Fluid distortion">
      {slider('distortion', 'Distortion', 0.01, { testId: 'shader-distortion' })}
      {slider('distortionScale', 'Distortion scale', 0.1, { testId: 'shader-distortion-scale' })}
      {slider('turbulence', 'Turbulence', 0.01, { testId: 'shader-turbulence' })}
    </Section>
    <Section title="Flow & direction">
      {slider('flowAngle', 'Pattern angle', 1, { unit: '°', testId: 'shader-flow-angle' })}
      {slider('flowDrift', 'Drift along the pattern', 0.01, { unit: '×', testId: 'shader-flow-drift' })}
      {slider('rotation', 'Slow spin', 0.01, { unit: 'rad/s', testId: 'shader-rotation' })}
      {slider('zoom', 'Zoom', 0.01, { unit: '×', testId: 'shader-zoom' })}
    </Section>
    <Section title="Mesh field">
      {slider('meshDrift', 'Mesh point drift', 0.01, { testId: 'shader-mesh-drift' })}
      {slider('meshSpread', 'Mesh color spread', 0.01, { testId: 'shader-mesh-spread' })}
      {slider('meshBlend', 'Mesh field strength', 0.01, { testId: 'shader-mesh-blend' })}
      <p className="hint">Drift gives each mesh color point its own slow orbit. Spread blends colors farther across the field without changing point sizes. Field strength mixes the mesh colors over the selected procedural style.</p>
    </Section>
    <Section title="Breathing & time">
      {slider('breath', 'Breathing depth', 0.01, { testId: 'shader-breath' })}
      {slider('breathRate', 'Breathing rate', 0.01, { unit: 'Hz', testId: 'shader-breath-rate' })}
      {slider('timeOffset', 'Time offset (seed)', 0.5, { unit: 's', testId: 'shader-time-offset' })}
      <p className="hint">Breathing pulses the distortion in and out. Time offset starts the pattern at a different moment, so each layer can look unique.</p>
    </Section>
    <Section title="Idle motion" aside={settings.idleMotion ? 'On' : 'Off'}>
      <Switch label="Move a virtual pointer when idle" checked={settings.idleMotion} onChange={idleMotion => update({ idleMotion })} testId="shader-idle-motion" />
      {settings.idleMotion && <>
        <Select id="shader-idle-path" label="Path" value={settings.idlePath} options={IDLE_PATHS.map(id => ({ id, label: IDLE_LABEL[id] }))} onChange={idlePath => update({ idlePath })} />
        <Num label="Idle speed" value={settings.idleSpeed} min={0.1} max={3} def={DEFAULT_INTERACTIVE_SETTINGS.idleSpeed} unit="×" onChange={idleSpeed => update({ idleSpeed }, 'idle-speed')} testId="shader-idle-speed" />
        <Num label="Idle size" value={settings.idleSize} min={0.05} max={0.48} def={DEFAULT_INTERACTIVE_SETTINGS.idleSize} onChange={idleSize => update({ idleSize }, 'idle-size')} testId="shader-idle-size" />
        <p className="hint">The interaction builder reacts to this virtual pointer, so your effects keep playing while nobody touches the canvas.</p>
      </>}
    </Section>
  </div>;
}
