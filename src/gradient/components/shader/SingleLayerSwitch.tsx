import { useMemo } from 'react';
import { Switch } from '../../../shared/controls';
import type { GradientProject } from '../../engine/model';
import { singleLayerAvailability, type SingleLayerReason } from '../../interactive/singleLayer';
import { useShader } from './context';

const REASON: Record<Exclude<SingleLayerReason, '' | 'off'>, string> = {
  'shader-off': 'Turn the shader on first.',
  'css-backend': 'Set the render backend to WebGL or Overlay (Finish & quality) to use shader layers.',
  'needs-two-layers': 'Needs at least two visible layers with the shader switched on.',
  'needs-procedural': 'Switch Procedural on for at least one shader layer: its settings drive the merged layer.',
};

/** Project-level switch: combine shader-layer colours in one procedural overlay without changing the CSS stack. */
export default function SingleLayerSwitch() {
  const { settings, layers, update, announce } = useShader();
  const on = settings.singleLayer === true;
  // the panel context lists layers reversed (InteractivePanel); the helper wants project order (index 0 = top layer)
  const info = useMemo(
    () => singleLayerAvailability({ shader: settings, layers: [...layers].reverse() } as unknown as GradientProject),
    [settings, layers],
  );
  const hint = info.available
    ? `Uses the colours and shapes of ${info.members} shader layers in one animated overlay. The original CSS layers, colors, stacking, opacity and blend modes stay unchanged; motion comes from an animated procedural layer, and interaction stays enabled if any member allows it.`
    : on
      ? `Switched on, but not active right now. ${info.reason ? REASON[info.reason as keyof typeof REASON] : ''}`
      : info.reason ? REASON[info.reason as keyof typeof REASON] : '';

  return <div className="gs-single-layer" data-testid="single-layer" style={{ border: '1px solid rgba(127,127,127,.3)', borderRadius: 10, padding: '10px 12px', margin: '8px 0 12px' }}>
    <div className="gs-section-title">
      <b>Use as single layer</b>
      <Switch
        label={on ? 'On' : 'Off'}
        checked={on}
        onChange={value => {
          if (value && !info.available) { announce(info.reason ? REASON[info.reason as keyof typeof REASON] : 'Single layer is not available.'); return; }
          update({ singleLayer: value }, 'single-layer');
          announce(value ? 'Shader-layer colors combined in one animated overlay.' : 'Shader layers separated again.');
        }}
        testId="shader-single-layer"
      />
    </div>
    <p className="hint" style={{ margin: '6px 0 0' }}>{hint}</p>
  </div>;
}
