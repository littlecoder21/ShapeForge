import { useMemo, useState } from 'react';
import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import {
  ANIMATION_GROUPS, captureAnimationValues, createAnimationPreset, createPolygonMorph,
  type AnimatedShape, type AnimationGroup, type AnimationValues, type ShapeAnimation,
} from '../../lib/shape/animation';
import type { ShapeModel } from '../../lib/shape/geometry';
import { Section, ValueControl } from '../../shared/controls';

const GROUPS = ANIMATION_GROUPS.map(group => group.id);
const MORPH_TARGETS = ['Triangle', 'Rectangle', 'Pentagon', 'Hexagon', 'Octagon', 'Star', 'Diamond', 'Arrow'];
const newId = () => `kf-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const emptyAnimation = (): ShapeAnimation => ({ duration: 1800, loop: true, iterations: 1, keyframes: [] });

type Props = {
  shape: ShapeModel;
  animation: ShapeAnimation | undefined;
  playhead: number;
  playing: boolean;
  previewing: boolean;
  onChange: (animation: ShapeAnimation) => void;
  onLiveChange: (animation: ShapeAnimation) => void;
  onLiveEnd: () => void;
  onPlayhead: (time: number) => void;
  onTogglePlay: () => void;
  onTogglePreview: () => void;
};

export default function AnimationPanel({ shape, animation, playhead, playing, previewing, onChange, onLiveChange, onLiveEnd, onPlayhead, onTogglePlay, onTogglePreview }: Props) {
  const data = animation ?? emptyAnimation();
  const [groups, setGroups] = useState<AnimationGroup[]>(['transform']);
  const [morphTarget, setMorphTarget] = useState('Hexagon');
  const selectedFrame = useMemo(() => data.keyframes.find(frame => Math.abs(frame.time - playhead) < 1), [data.keyframes, playhead]);
  const duration = Math.max(1, data.duration);

  const update = (next: ShapeAnimation, live = false) => (live ? onLiveChange : onChange)({
    ...next,
    duration: Math.max(100, Math.min(30000, Number.isFinite(next.duration) ? next.duration : 1800)),
    iterations: Math.max(1, Math.min(9999, Math.round(Number.isFinite(next.iterations) ? next.iterations! : 1))),
    keyframes: [...next.keyframes].map(frame => ({ ...frame, time: Math.max(0, Math.min(next.duration, frame.time)) })).sort((a, b) => a.time - b.time),
  });
  const setGroupValue = <K extends keyof AnimationValues>(group: K, value: NonNullable<AnimationValues[K]>, live = false) => {
    const time = selectedFrame?.time ?? Math.round(playhead);
    const frame = selectedFrame ?? { id: newId(), time, values: {} };
    update({
      ...data,
      keyframes: selectedFrame
        ? data.keyframes.map(item => item.id === frame.id ? { ...item, values: { ...item.values, [group]: { ...((item.values[group] ?? {}) as object), ...value } } } : item)
        : [...data.keyframes, { ...frame, values: { ...captureAnimationValues(shape, [group as AnimationGroup]), [group]: value } }],
    }, live);
  };

  const addKeyframe = () => {
    const time = Math.round(playhead);
    const values = captureAnimationValues(shape, groups);
    const existing = data.keyframes.find(frame => Math.abs(frame.time - time) < 1);
    update({
      ...data,
      keyframes: existing
        ? data.keyframes.map(frame => frame.id === existing.id ? { ...frame, values: { ...frame.values, ...values } } : frame)
        : [...data.keyframes, { id: newId(), time, values }],
    });
  };
  const setDuration = (next: number, live = false) => update({ ...data, duration: next, keyframes: data.keyframes.map(frame => ({ ...frame, time: Math.min(frame.time, next) })) }, live);
  const activeGroups = (selectedFrame ? GROUPS.filter(group => selectedFrame.values[group]) : []) as AnimationGroup[];

  return <div className="animation-panel">
    <h2 className="properties-title">Shape animation</h2>
    <p className="hint animation-safe-note">Keyframes are stored with this shape. Preview transforms a copy; your editable base geometry stays unchanged.</p>

    {shape.kind === 'polygon' && shape.closed && !shape.extra?.length && <Section title="Polygon morph" hint="resamples vertices for smooth topology changes">
      <label className="field-label" htmlFor="animation-morph-target">Morph target</label>
      <select id="animation-morph-target" className="generate-select" value={morphTarget} onChange={event => setMorphTarget(event.target.value)} data-testid="animation-morph-target">
        {MORPH_TARGETS.filter(kind => kind !== shape.name).map(kind => <option key={kind} value={kind}>{kind}</option>)}
      </select>
      <button type="button" className="btn primary" onClick={() => { update(createPolygonMorph(shape, morphTarget)); onPlayhead(0); }} data-testid="animation-create-polygon-morph">Create polygon morph</button>
    </Section>}

    <Section title="Presets" hint="editable starters">
      <div className="animation-presets">
        {['Pulse', 'Spin', 'Float', 'Morph', 'Reveal', 'Fill reveal', 'Stroke draw'].map(name => <button key={name} type="button" className="btn" onClick={() => { update(createAnimationPreset(name, shape)); onPlayhead(0); }} data-testid={`animation-preset-${name.toLowerCase().replaceAll(' ', '-')}`}>{name}</button>)}
      </div>
    </Section>

    <Section title="Timeline" hint={`${Math.round(playhead)} / ${duration} ms`}>
      <div className="field-row">
        <button type="button" className="btn primary" onClick={onTogglePlay} data-testid="animation-play">{playing ? <Pause /> : <Play />}{playing ? 'Pause' : 'Play'}</button>
        <button type="button" className={`btn ${previewing ? 'active' : ''}`} onClick={onTogglePreview} aria-pressed={previewing} data-testid="animation-preview">{previewing ? 'Exit preview' : 'Preview'}</button>
      </div>
      <ValueControl label="Duration" value={duration} min={500} max={10000} step={100} unit="ms" def={1800} onChange={value => setDuration(value, true)} onCommit={onLiveEnd} testId="animation-duration" />
      <label className="animation-check"><input type="checkbox" checked={data.loop} onChange={event => update({ ...data, loop: event.target.checked })} /> Loop playback</label>
      <label className="animation-number animation-repeat-count"><span>Repeat count</span><input type="number" min={1} max={9999} step={1} value={data.iterations ?? 1} disabled={data.loop} onChange={event => update({ ...data, iterations: Math.max(1, Math.min(9999, Math.floor(Number(event.target.value) || 1))) })} data-testid="animation-iterations" /></label>
      {data.loop && <p className="hint">Turn off looping to play the animation a fixed number of times.</p>}
      <label className="field-label" htmlFor="animation-playhead">Playhead <span>{Math.round(playhead)} ms</span></label>
      <input id="animation-playhead" className="vc-slider animation-scrubber" type="range" min={0} max={duration} step={10} value={Math.min(playhead, duration)} onChange={event => onPlayhead(Number(event.target.value))} data-testid="animation-playhead" />
      <div className="animation-ruler" aria-label="Keyframes">
        {data.keyframes.map(frame => <button key={frame.id} type="button" className={`animation-marker ${selectedFrame?.id === frame.id ? 'selected' : ''}`} style={{ left: `${100 * frame.time / duration}%` }} title={`${frame.time} ms · ${Object.keys(frame.values).join(', ')}`} onClick={() => onPlayhead(frame.time)} data-testid={`animation-keyframe-${frame.id}`} />)}
      </div>
      <div className="animation-group-list">
        {ANIMATION_GROUPS.map(group => <label key={group.id} className="animation-check"><input type="checkbox" checked={groups.includes(group.id)} onChange={event => setGroups(current => event.target.checked ? [...current, group.id] : current.filter(item => item !== group.id))} />{group.label}</label>)}
      </div>
      <button type="button" className="btn animation-add-key" onClick={addKeyframe} data-testid="animation-add-keyframe"><Plus />Set keyframe at playhead</button>
      {!data.keyframes.length && <p className="hint">Choose a preset or set one or more groups, then add keyframes to build an animation.</p>}
    </Section>

    <Section title="Selected keyframe" hint={selectedFrame ? `${Math.round(selectedFrame.time)} ms` : 'none'}>
      {!selectedFrame && <p className="hint">Move the playhead to a keyframe to edit it, or add a keyframe at the current time.</p>}
      {selectedFrame && <div className="animation-selected">
        {activeGroups.includes('transform') && selectedFrame.values.transform && <>
          <div className="animation-subhead">Transform</div>
          <div className="animation-number-grid">
            {([
              ['x', 'X offset', -1000, 1000, 'px'], ['y', 'Y offset', -1000, 1000, 'px'],
              ['scaleX', 'Scale X', 0.1, 4, '×'], ['scaleY', 'Scale Y', 0.1, 4, '×'],
              ['rotation', 'Rotation', -720, 720, '°'],
            ] as const).map(([property, label, min, max, unit]) => <label key={property} className="animation-number"><span>{label}</span><input type="number" min={min} max={max} step={property.startsWith('scale') ? 0.05 : 1} value={selectedFrame.values.transform?.[property] ?? 0} onChange={event => setGroupValue('transform', { ...selectedFrame.values.transform!, [property]: Number(event.target.value) })} /></label>)}
          </div>
        </>}
        {activeGroups.includes('stroke') && selectedFrame.values.stroke && <>
          <div className="animation-subhead">Stroke</div>
          <div className="animation-color-row"><input aria-label="Keyframe stroke color" type="color" value={/^#[\da-f]{6}$/i.test(selectedFrame.values.stroke.stroke) ? selectedFrame.values.stroke.stroke : '#ffffff'} onChange={event => setGroupValue('stroke', { ...selectedFrame.values.stroke!, stroke: event.target.value })} /><input aria-label="Keyframe stroke color value" value={selectedFrame.values.stroke.stroke} onChange={event => setGroupValue('stroke', { ...selectedFrame.values.stroke!, stroke: event.target.value })} /></div>
          <ValueControl label="Stroke width" value={selectedFrame.values.stroke.strokeWidth} min={0} max={100} step={0.5} onChange={value => setGroupValue('stroke', { ...selectedFrame.values.stroke!, strokeWidth: value }, true)} onCommit={onLiveEnd} testId="animation-stroke-width" />
          <ValueControl label="Stroke opacity" value={selectedFrame.values.stroke.opacity} min={0} max={1} step={0.01} onChange={value => setGroupValue('stroke', { ...selectedFrame.values.stroke!, opacity: value }, true)} onCommit={onLiveEnd} testId="animation-stroke-opacity" />
          <ValueControl label="Stroke draw progress" value={selectedFrame.values.stroke.draw ?? 1} min={0} max={1} step={0.01} onChange={value => setGroupValue('stroke', { ...selectedFrame.values.stroke!, draw: value }, true)} onCommit={onLiveEnd} testId="animation-stroke-draw" />
        </>}
        {activeGroups.includes('fill') && selectedFrame.values.fill && <>
          <div className="animation-subhead">Fill · reveal</div>
          <div className="animation-color-row"><input aria-label="Keyframe fill color" type="color" value={/^#[\da-f]{6}$/i.test(selectedFrame.values.fill.fill) ? selectedFrame.values.fill.fill : '#ffffff'} onChange={event => setGroupValue('fill', { ...selectedFrame.values.fill!, fill: event.target.value })} /><input aria-label="Keyframe fill color value" value={selectedFrame.values.fill.fill} onChange={event => setGroupValue('fill', { ...selectedFrame.values.fill!, fill: event.target.value })} /></div>
          <ValueControl label="Fill / reveal" value={selectedFrame.values.fill.opacity} min={0} max={1} step={0.01} onChange={value => setGroupValue('fill', { ...selectedFrame.values.fill!, opacity: value }, true)} onCommit={onLiveEnd} testId="animation-fill-opacity" />
        </>}
        {activeGroups.includes('geometry') && selectedFrame.values.geometry && <div className="animation-geometry-control">
          <span>Geometry snapshot · {selectedFrame.values.geometry.rings[0]?.length ?? 0} nodes</span>
          <button type="button" className="btn" onClick={() => setGroupValue('geometry', { rings: captureAnimationValues(shape, ['geometry']).geometry!.rings })}>Capture current geometry</button>
        </div>}
        <button type="button" className="btn danger animation-delete" onClick={() => { update({ ...data, keyframes: data.keyframes.filter(frame => frame.id !== selectedFrame.id) }); }} data-testid="animation-delete-keyframe"><Trash2 />Delete keyframe</button>
      </div>}
    </Section>
  </div>;
}

export function shapeAnimation(shape: ShapeModel): ShapeAnimation | undefined {
  return (shape as AnimatedShape).animation;
}
