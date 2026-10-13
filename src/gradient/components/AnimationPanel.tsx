import { Plus, Trash2 } from 'lucide-react';
import { Section, Seg, Switch, ValueControl } from '../../shared/controls';
import { hexToHsl, hslToHex } from '../engine/color';
import { uid, type AnimProp, type AnimTrack, type GradientLayer, type LayerAnimation } from '../engine/model';
import { mulberry } from '../engine/rng';
import { useStore } from '../engine/store';
import { ColorInput, Empty, useStudio } from './ui';

const PROPS: { id: AnimProp; label: string; min: number; max: number; step: number; unit: string }[] = [
  { id: 'x', label: 'Move X', min: -60, max: 60, step: 0.5, unit: '%' }, { id: 'y', label: 'Move Y', min: -60, max: 60, step: 0.5, unit: '%' },
  { id: 'scale', label: 'Scale', min: 0.2, max: 3, step: 0.05, unit: '×' }, { id: 'rotate', label: 'Rotate', min: -360, max: 360, step: 1, unit: '°' },
  { id: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, unit: '' }, { id: 'angle', label: 'Angle', min: 0, max: 360, step: 1, unit: '°' },
  { id: 'hue', label: 'Hue shift', min: 0, max: 360, step: 1, unit: '°' }, { id: 'stopPos', label: 'Stop position', min: 0, max: 100, step: 0.5, unit: '%' },
  { id: 'stopColor', label: 'Stop colour', min: 0, max: 0, step: 0, unit: '' },
  { id: 'meshX', label: 'Point X', min: -20, max: 120, step: 0.5, unit: '%' }, { id: 'meshY', label: 'Point Y', min: -20, max: 120, step: 0.5, unit: '%' },
];
const EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(0.4, 0, 0.2, 1)', 'cubic-bezier(0.65, 0, 0.35, 1)'];

function defaults(layer: GradientLayer, prop: AnimProp, stopId?: string): Pick<AnimTrack, 'from' | 'to'> {
  const t = layer.transform;
  switch (prop) {
    case 'x': return { from: t.x - 6, to: t.x + 6 }; case 'y': return { from: t.y - 4, to: t.y + 4 };
    case 'scale': return { from: t.scale, to: Math.round(t.scale * 115) / 100 }; case 'rotate': return { from: t.rotate - 8, to: t.rotate + 8 };
    case 'opacity': return { from: layer.opacity, to: Math.max(0.2, layer.opacity * 0.6) }; case 'angle': return { from: layer.angle, to: (layer.angle + 90) % 360 };
    case 'hue': return { from: 0, to: 60 };
    case 'meshX': { const q = layer.mesh.points.find(x => x.id === stopId); return { from: q?.x ?? 50, to: (q?.x ?? 50) + 8 }; }
    case 'meshY': { const q = layer.mesh.points.find(x => x.id === stopId); return { from: q?.y ?? 50, to: (q?.y ?? 50) + 8 }; }
    case 'stopPos': { const s = layer.stops.find(x => x.id === stopId); return { from: s?.pos ?? 0, to: Math.min(100, (s?.pos ?? 0) + 20) }; }
    default: { const s = layer.stops.find(x => x.id === stopId), h = hexToHsl(s?.color ?? '#7c5cff'); return { from: s?.color ?? '#7c5cff', to: hslToHex(h.h + 70, h.s, h.l) }; }
  }
}

export default function AnimationPanel({ layerId }: { layerId: string }) {
  const { store } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  if (!layer) return <Empty>Select a layer first.</Empty>;
  const a = layer.anim;
  const setAnim = (patch: Partial<LayerAnimation>, key?: string) => store.updateLayer(layerId, l => ({ ...l, anim: { ...l.anim, ...patch } }), { coalesce: key });
  const setTrack = (id: string, patch: Partial<AnimTrack>, key?: string) => setAnim({ tracks: a.tracks.map(t => (t.id === id ? { ...t, ...patch } : t)) }, key);
  const addTrack = (prop: AnimProp) => {
    const stopId = prop === 'stopPos' || prop === 'stopColor' ? layer.stops[0]?.id : prop === 'meshX' || prop === 'meshY' ? layer.mesh.points[0]?.id : undefined;
    setAnim({ enabled: true, tracks: [...a.tracks.filter(t => !(t.prop === prop && t.stopId === stopId)), { id: uid('t'), prop, stopId, ...defaults(layer, prop, stopId) }] });
  };
  const preset = (tracks: [AnimProp, number | string, number | string][], over: Partial<LayerAnimation> = {}) => setAnim({ enabled: true, tracks: tracks.map(([prop, from, to]) => ({ id: uid('t'), prop, from, to })), ...over });
  const t = layer.transform;
  const stopKind = layer.type === 'linear' || layer.type === 'radial' || layer.type === 'conic';
  const avail = PROPS.filter(p => {
    if (layer.type === 'noise') return ['x', 'y', 'opacity'].includes(p.id);
    if (layer.type === 'mesh') return !['angle', 'stopPos', 'stopColor'].includes(p.id);
    return stopKind && !(p.id === 'angle' && layer.type === 'radial') && p.id !== 'meshX' && p.id !== 'meshY';
  });
  const float = () => {
    const random = mulberry((layer.mesh.seed ?? 7) * 7919);
    const rnd = (n: number) => (random() - 0.5) * n;
    const tracks: AnimTrack[] = layer.mesh.points.flatMap(q => [
      { id: uid('t'), prop: 'meshX' as AnimProp, stopId: q.id, from: Math.round((q.x - 6 + rnd(6)) * 10) / 10, to: Math.round((q.x + 6 + rnd(6)) * 10) / 10 },
      { id: uid('t'), prop: 'meshY' as AnimProp, stopId: q.id, from: Math.round((q.y - 6 + rnd(6)) * 10) / 10, to: Math.round((q.y + 6 + rnd(6)) * 10) / 10 },
    ]);
    setAnim({ enabled: true, tracks, duration: 14, direction: 'alternate', easing: 'ease-in-out' });
  };
  const ripple = () => {
    const rnd = mulberry((layer.mesh.seed ?? 7) * 3571);
    const tracks: AnimTrack[] = layer.mesh.points.flatMap(point => {
      const angle = rnd() * Math.PI * 2, distance = 8 + rnd() * 10;
      return [
        { id: uid('t'), prop: 'meshX' as AnimProp, stopId: point.id, from: point.x, to: point.x + Math.cos(angle) * distance },
        { id: uid('t'), prop: 'meshY' as AnimProp, stopId: point.id, from: point.y, to: point.y + Math.sin(angle) * distance },
      ];
    });
    setAnim({ enabled: true, tracks, duration: 9, direction: 'alternate', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
  };

  return <div data-testid="animation-panel">
    <Section title="Animation">
      <Switch label="Animate this layer" checked={a.enabled} onChange={v => setAnim({ enabled: v })} testId="anim-on" />
      <div className="gs-chips" role="group" aria-label="Motion presets">
        <button type="button" className="chip" onClick={() => preset([['x', t.x - 7, t.x + 7], ['y', t.y - 3, t.y + 3]], { duration: 18, direction: 'alternate' })} data-testid="anim-drift">Drift</button>
        <button type="button" className="chip" onClick={() => preset([['rotate', t.rotate, t.rotate + 360]], { duration: 30, direction: 'normal', easing: 'linear' })} data-testid="anim-spin">Spin</button>
        <button type="button" className="chip" onClick={() => preset([['scale', t.scale, Math.round(t.scale * 118) / 100], ['opacity', layer.opacity, Math.max(0.25, layer.opacity * 0.55)]], { duration: 8, direction: 'alternate' })} data-testid="anim-pulse">Pulse</button>
        <button type="button" className="chip" onClick={() => preset([['hue', 0, 360]], { duration: 24, direction: 'normal', easing: 'linear' })} data-testid="anim-hue">Hue cycle</button>
        {layer.type === 'mesh' && <>
          <button type="button" className="chip" onClick={float} data-testid="anim-float">Float points</button>
          <button type="button" className="chip" onClick={ripple} data-testid="anim-ripple">Mesh ripple</button>
        </>}
        {(layer.type === 'linear' || layer.type === 'conic') && <button type="button" className="chip" onClick={() => preset([['angle', layer.angle, layer.angle + 360]], { duration: 20, direction: 'normal', easing: 'linear' })} data-testid="anim-sweep">Sweep</button>}
      </div>
      <ValueControl label="Duration" value={a.duration} min={1} max={90} step={0.5} unit="s" def={12} onChange={v => setAnim({ duration: v }, 'dur')} testId="anim-duration" />
      <ValueControl label="Delay" value={a.delay} min={-30} max={30} step={0.5} unit="s" def={0} onChange={v => setAnim({ delay: v }, 'delay')} testId="anim-delay" />
      <Switch label="Loop indefinitely" checked={(a.iterations ?? 'infinite') === 'infinite'} onChange={v => setAnim({ iterations: v ? 'infinite' : 1 })} testId="anim-infinite" />
      {a.iterations !== undefined && a.iterations !== 'infinite' && <ValueControl label="Iterations" value={a.iterations} min={1} max={100} step={1} def={1} onChange={v => setAnim({ iterations: v }, 'iterations')} testId="anim-iterations" />}
      <label className="field-label" htmlFor="anim-ease">Easing</label>
      <select id="anim-ease" className="generate-select" value={a.easing} onChange={e => setAnim({ easing: e.target.value })}>{EASINGS.map(x => <option key={x} value={x}>{x.startsWith('cubic') ? x.replace('cubic-bezier', 'bezier') : x}</option>)}</select>
      <Seg value={a.direction} label="Direction" options={[{ id: 'alternate', label: 'Ping-pong' }, { id: 'normal', label: 'Loop' }, { id: 'reverse', label: 'Reverse' }, { id: 'alternate-reverse', label: 'Reverse ping-pong' }]} onChange={v => setAnim({ direction: v })} testId="anim-direction" />
    </Section>
    <Section title="Tracks" hint={`${a.tracks.length}`}>
      <div className="gs-chips gs-addchips" role="group" aria-label="Add track">{avail.map(p => <button key={p.id} type="button" className="chip" onClick={() => addTrack(p.id)} data-testid={`anim-add-${p.id}`}><Plus />{p.label}</button>)}</div>
      {!a.tracks.length && <Empty>Add a track, or start from a motion preset. The play button over the canvas previews it.</Empty>}
      {a.tracks.map(tr => {
        const def = PROPS.find(p => p.id === tr.prop)!, isStop = tr.prop === 'stopPos' || tr.prop === 'stopColor', isPt = tr.prop === 'meshX' || tr.prop === 'meshY';
        return <div key={tr.id} className="gs-fxcard" data-testid="anim-track">
          <div className="gs-fxhead"><b>{def.label}</b>
            <button type="button" className="icon-btn" aria-label={`Remove ${def.label} track`} onClick={() => setAnim({ tracks: a.tracks.filter(x => x.id !== tr.id) })}><Trash2 /></button></div>
          {isPt && <select className="generate-select" value={tr.stopId} aria-label="Mesh point" onChange={e => setTrack(tr.id, { stopId: e.target.value, ...defaults(layer, tr.prop, e.target.value) })}>{layer.mesh.points.map((q, i) => <option key={q.id} value={q.id}>Point {i + 1} · {q.color}</option>)}</select>}
          {isStop && <select className="generate-select" value={tr.stopId} aria-label="Stop" onChange={e => setTrack(tr.id, { stopId: e.target.value, ...defaults(layer, tr.prop, e.target.value) })}>{layer.stops.map((s, i) => <option key={s.id} value={s.id}>Stop {i + 1} · {s.color} · {s.pos}%</option>)}</select>}
          {tr.prop === 'stopColor' ? <>
            <div className="field-label">From</div><ColorInput color={String(tr.from)} alpha={1} showAlpha={false} onChange={c => setTrack(tr.id, { from: c }, `tr-${tr.id}f`)} label="From colour" />
            <div className="field-label">To</div><ColorInput color={String(tr.to)} alpha={1} showAlpha={false} onChange={c => setTrack(tr.id, { to: c }, `tr-${tr.id}t`)} label="To colour" />
          </> : <>
            <ValueControl label="From" value={Number(tr.from)} min={def.min} max={def.max} step={def.step} unit={def.unit} onChange={v => setTrack(tr.id, { from: v }, `tr-${tr.id}f`)} />
            <ValueControl label="To" value={Number(tr.to)} min={def.min} max={def.max} step={def.step} unit={def.unit} onChange={v => setTrack(tr.id, { to: v }, `tr-${tr.id}t`)} />
          </>}
        </div>;
      })}
    </Section>
  </div>;
}
