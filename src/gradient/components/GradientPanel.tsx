import { useState } from 'react';
import { Section, Seg, Switch, ValueControl } from '../../shared/controls';
import { sortedStops, stop as makeStop, type GradientKind, type GradientLayer } from '../engine/model';
import { useStore } from '../engine/store';
import MeshPanel from './MeshPanel';
import NoisePanel from './NoisePanel';
import StopEditor from './StopEditor';
import { uid, type AnimTrack } from '../engine/model';
import { ColorInput, Dial, Empty, useStudio } from './ui';

type StopGradientKind = Extract<GradientKind, 'linear' | 'radial' | 'conic'>;
const KINDS: { id: StopGradientKind; label: string }[] = [{ id: 'linear', label: 'Linear' }, { id: 'radial', label: 'Radial' }, { id: 'conic', label: 'Conic' }];
const spinTrack = (l: GradientLayer): AnimTrack | undefined => (l.anim.enabled ? l.anim.tracks.find(t => t.prop === 'angle') : undefined);
const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/** Stripes from the layer's own colours: each colour becomes one hard-edged band, optionally separated by a transparent gap. */
export function buildStripes(layer: GradientLayer, stripe: number, gap: number): Partial<GradientLayer> {
  const cols: string[] = [];
  sortedStops(layer.stops).forEach(s => { if (!cols.includes(s.color) && cols.length < 5) cols.push(s.color); });
  const bands: { color: string; alpha: number; w: number }[] = [];
  cols.forEach(c => { bands.push({ color: c, alpha: 1, w: stripe }); if (gap > 0) bands.push({ color: c, alpha: 0, w: gap }); });
  const total = bands.reduce((a, b) => a + b.w, 0) || 1;
  let acc = 0;
  const stops = bands.map(b => { const p = (acc / total) * 100; acc += b.w; return makeStop(b.color, Math.round(p * 100) / 100, b.alpha, { hard: true }); });
  stops.push(makeStop(bands[bands.length - 1].color, 100, bands[bands.length - 1].alpha));
  return { repeating: true, repeat: { size: Math.round(total * 100) / 100, unit: layer.type === 'conic' ? 'deg' : 'px', offset: 0 }, stops };
}

export default function GradientPanel({ layerId }: { layerId: string }) {
  const { store } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  const [stripe, setStripe] = useState(24), [gap, setGap] = useState(0);
  if (!layer) return <Empty>Select a layer to edit its gradient.</Empty>;
  if (layer.solidColor !== undefined) return <div className="gs-gradient" data-testid="gradient-panel">
    <Section title="Solid color" hint="This base layer is a color, not a gradient.">
      <ColorInput
        color={layer.solidColor}
        alpha={1}
        showAlpha={false}
        onChange={color => store.updateLayer(layerId, current => ({
          ...current,
          solidColor: color,
          stops: current.stops.map((item, i) => ({ ...item, color, alpha: 1, pos: i === 0 ? 0 : 100 })),
        }), { coalesce: 'solid-color' })}
        label="Solid color"
        testId="solid-color"
      />
    </Section>
  </div>;
  if (layer.type === 'mesh') return <MeshPanel layerId={layerId} />;
  if (layer.type === 'noise') return <NoisePanel layerId={layerId} />;

  const set = (patch: Partial<GradientLayer>, key?: string) => store.updateLayer(layerId, patch, { coalesce: key });
  const commit = () => undefined;
  const changeType = (t: StopGradientKind) => set({
    type: t, angle: t === 'conic' ? 0 : t === 'linear' ? 135 : layer.angle,
    repeat: { ...layer.repeat, unit: t === 'conic' ? 'deg' : layer.repeat.unit === 'deg' ? 'px' : layer.repeat.unit, size: t === 'conic' ? 45 : layer.repeat.unit === 'deg' ? 40 : layer.repeat.size },
    anim: { ...layer.anim, tracks: t === 'radial' ? layer.anim.tracks.filter(x => x.prop !== 'angle') : layer.anim.tracks },
  });
  const t = layer.type;
  const spin = spinTrack(layer);
  const setSpin = (on: boolean) => store.updateLayer(layerId, l => ({ ...l, anim: on
    ? { ...l.anim, enabled: true, easing: 'linear', direction: 'normal', duration: l.anim.tracks.length ? l.anim.duration : 16, tracks: [...l.anim.tracks.filter(x => x.prop !== 'angle'), { id: uid('t'), prop: 'angle', from: l.angle, to: l.angle + 360 }] }
    : { ...l.anim, tracks: l.anim.tracks.filter(x => x.prop !== 'angle') } }));

  return <div className="gs-gradient" data-testid="gradient-panel">
    <Section title="Colour stops" hint={`${layer.stops.length} stops`}><StopEditor layerId={layerId} /></Section>
    <Section title="Type">
      <Seg value={t} label="Gradient type" options={KINDS.map(k => ({ id: k.id, label: k.label }))} onChange={changeType} testId="gradient-type" />
      <Switch label="Repeating" checked={layer.repeating} onChange={v => set({ repeating: v })} testId="gradient-repeating" />
      <div className="field-label">Colour interpolation</div>
      <Seg value={layer.space} label="Colour space" options={[{ id: 'srgb', label: 'sRGB' }, { id: 'oklab', label: 'OKLab' }, { id: 'oklch', label: 'OKLCH' }]} onChange={v => set({ space: v })} testId="gradient-space" />
    </Section>
    {t === 'linear' && <Section title="Direction">
      <div className="gs-anglerow"><Dial value={layer.angle} onChange={a => set({ angle: a }, 'angle')} onCommit={commit} />
        <div className="gs-anglechips">{ANGLES.map(a => <button key={a} type="button" className={`chip ${layer.angle === a ? 'active' : ''}`} onClick={() => set({ angle: a })}>{a}°</button>)}</div></div>
      <ValueControl label="Angle" value={layer.angle} min={0} max={360} step={0.5} unit="°" def={135} onChange={v => set({ angle: v }, 'angle')} testId="gradient-angle" />
    </Section>}
    {t === 'conic' && <Section title="Origin & start angle">
      <div className="gs-anglerow"><Dial value={layer.angle} onChange={a => set({ angle: a }, 'angle')} label="Start angle" />
        <div className="gs-anglechips">{ANGLES.map(a => <button key={a} type="button" className={`chip ${layer.angle === a ? 'active' : ''}`} onClick={() => set({ angle: a })}>{a}°</button>)}</div></div>
      <ValueControl label="Start angle" value={layer.angle} min={0} max={360} step={0.5} unit="°" def={0} onChange={v => set({ angle: v }, 'angle')} testId="gradient-from" />
      <ValueControl label="Position X" value={layer.cx} min={-50} max={150} step={0.5} unit="%" def={50} onChange={v => set({ cx: v }, 'cx')} testId="gradient-cx" />
      <ValueControl label="Position Y" value={layer.cy} min={-50} max={150} step={0.5} unit="%" def={50} onChange={v => set({ cy: v }, 'cy')} testId="gradient-cy" />
      <Switch label="Spin — rotate continuously" checked={!!spin} onChange={setSpin} testId="conic-spin" />
      {spin && <ValueControl label="Spin duration" value={layer.anim.duration} min={2} max={120} step={0.5} unit="s" def={16} onChange={v => store.updateLayer(layerId, l => ({ ...l, anim: { ...l.anim, duration: v } }), { coalesce: 'spin' })} testId="conic-spin-duration" />}
    </Section>}
    {t === 'radial' && <Section title="Shape & size">
      <Seg value={layer.shape} label="Radial shape" options={[{ id: 'ellipse', label: 'Ellipse' }, { id: 'circle', label: 'Circle' }]} onChange={v => set({ shape: v })} testId="gradient-shape" />
      <ValueControl label="Position X" value={layer.cx} min={-50} max={150} step={0.5} unit="%" def={50} onChange={v => set({ cx: v }, 'cx')} testId="gradient-cx" />
      <ValueControl label="Position Y" value={layer.cy} min={-50} max={150} step={0.5} unit="%" def={50} onChange={v => set({ cy: v }, 'cy')} testId="gradient-cy" />
      <ValueControl label={layer.shape === 'circle' ? 'Radius' : 'Radius X'} value={layer.rx} min={1} max={200} step={0.5} unit="%" def={50} onChange={v => set({ rx: v }, 'rx')} testId="gradient-rx" />
      {layer.shape === 'ellipse' && <ValueControl label="Radius Y" value={layer.ry} min={1} max={200} step={0.5} unit="%" def={50} onChange={v => set({ ry: v }, 'ry')} testId="gradient-ry" />}
    </Section>}
    {layer.repeating && <Section title="Repeat">
      <ValueControl label="Repeat size" value={layer.repeat.size} min={1} max={layer.repeat.unit === 'deg' ? 360 : layer.repeat.unit === '%' ? 100 : 600} step={layer.repeat.unit === 'px' ? 1 : 0.5} unit={layer.repeat.unit} def={layer.repeat.unit === 'deg' ? 45 : 40} onChange={v => set({ repeat: { ...layer.repeat, size: v } }, 'rsize')} testId="repeat-size" />
      <ValueControl label="Offset" value={layer.repeat.offset} min={-200} max={layer.repeat.unit === 'deg' ? 360 : 200} step={0.5} unit={layer.repeat.unit} def={0} onChange={v => set({ repeat: { ...layer.repeat, offset: v } }, 'roff')} testId="repeat-offset" />
      {t !== 'conic' && <>
        <div className="field-label">Size unit</div>
        <Seg value={layer.repeat.unit === 'deg' ? 'px' : layer.repeat.unit} label="Repeat unit" options={[{ id: 'px', label: 'px' }, { id: '%', label: '%' }]} onChange={u => set({ repeat: { ...layer.repeat, unit: u } })} testId="repeat-unit" />
      </>}
    </Section>}
    {layer.repeating && <Section title="Stripe builder" open={false} hint="from your colours">
      <ValueControl label="Stripe size" value={stripe} min={1} max={t === 'conic' ? 90 : 200} unit={t === 'conic' ? '°' : 'px'} onChange={v => { setStripe(v); set(buildStripes(layer, v, gap)); }} testId="stripe-size" />
      <ValueControl label="Gap" value={gap} min={0} max={t === 'conic' ? 90 : 200} unit={t === 'conic' ? '°' : 'px'} onChange={v => { setGap(v); set(buildStripes(layer, stripe, v)); }} testId="stripe-gap" />
      <p className="hint">Each colour becomes a hard-edged band. Change a size to rebuild the stops from the colours currently in the layer.</p>
    </Section>}
  </div>;
}
