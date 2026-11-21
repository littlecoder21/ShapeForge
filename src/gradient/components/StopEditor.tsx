import { useMemo, useRef, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { ValueControl, Switch, Seg, Section } from '../../shared/controls';
import { STOP_EFFECTS, STOP_EFFECT_LIST, newStopEffect, reachOf } from '../engine/stopEffects';
import { gradientFn } from '../engine/css';
import { colorAtPos, CURVE_PRESETS, curvePreset, curveProgress, type CurvePreset } from '../engine/ramp';
import { rgbToHex } from '../engine/color';
import { sortedStops, stop as makeStop, uid, type ColorStop, type GradientLayer, type GradientProject } from '../engine/model';
import { useStore } from '../engine/store';
import { CHECKER, ColorInput, useStudio } from './ui';

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Expand hard stops into explicit duplicate stops, mirror, and reverse the order — the picture is an exact mirror image. */
export function reverseStops(stops: ColorStop[]): ColorStop[] {
  const st = sortedStops(stops), explicit: ColorStop[] = [];
  st.forEach((s, i) => { explicit.push({ ...s, hard: false }); const n = st[i + 1]; if (s.hard && n) explicit.push({ ...s, id: uid('s'), pos: n.pos, hard: false, mid: undefined }); });
  const mirrored = explicit.map((s, i) => { const prev = explicit[i - 1]; return { ...s, pos: r1(100 - s.pos), mid: prev?.mid !== undefined ? 100 - prev.mid : undefined }; }).reverse();
  return mirrored;
}

type StopEffect = NonNullable<ColorStop['effects']>[number];

export default function StopEditor({ layerId }: { layerId: string }) {
  const { store, announce } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  const canvas = useStore(store, s => s.project.canvas);
  const selId = useStore(store, s => s.stopId);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; offsetX: number } | null>(null), barTap = useRef<{ x: number; moved: boolean } | null>(null);

  const stops = layer?.stops ?? [];
  const sel = stops.find(s => s.id === selId) ?? null;
  const sorted = useMemo(() => sortedStops(stops), [stops]);
  const barBg = useMemo(() => (layer ? gradientFn({ ...layer, type: 'linear', repeating: false, angle: 90, anim: { ...layer.anim, enabled: false } }, { canvas } as GradientProject, { flat: true }) : ''), [layer, canvas]);
  if (!layer) return null;

  const patchStops = (fn: (s: ColorStop[]) => ColorStop[], coalesce?: string) => store.updateLayer(layerId, l => ({ ...l, stops: fn(l.stops) }), { coalesce });
  const patchStop = (id: string, p: Partial<ColorStop>, coalesce?: string) => patchStops(ss => ss.map(s => (s.id === id ? { ...s, ...p } : s)), coalesce);
  // computed from the latest stops inside the update, so quick slider moves never overwrite each other
  const setStopFx = (stopId: string, effectId: string, fn: (e: StopEffect) => StopEffect, coalesce?: string) => patchStops(
    ss => ss.map(s => (s.id === stopId ? { ...s, effects: (s.effects ?? []).map(effect => (effect.id === effectId ? fn(effect) : effect)) } : s)),
    coalesce,
  );
  const sliderGesture = { onBegin: () => store.begin(), onCommit: () => store.end() };
  const posOf = (e: { clientX: number }) => {
    const r = bar.current?.getBoundingClientRect();
    return r && r.width > 0 ? Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)) : 0;
  };
  const next = sel ? sorted[sorted.findIndex(s => s.id === sel.id) + 1] : undefined;
  const curveMode = sel ? curvePreset(sel) : 'linear';
  const curve = sel?.curve ?? CURVE_PRESETS.ease;
  const curvePath = sel ? Array.from({ length: 33 }, (_, i) => {
    const x = i / 32, y = curveProgress(sel, x);
    return `${i === 0 ? 'M' : 'L'}${(x * 100).toFixed(2)} ${(100 - y * 100).toFixed(2)}`;
  }).join(' ') : '';
  const setCurvePreset = (preset: CurvePreset) => {
    if (!sel) return;
    const nextCurve = preset === 'linear' || preset === 'midpoint' ? undefined : preset === 'custom' ? (sel.curve ?? CURVE_PRESETS.ease) : CURVE_PRESETS[preset];
    patchStop(sel.id, { curve: nextCurve, mid: preset === 'midpoint' ? (sel.mid ?? 65) : undefined }, `stop-curve-${sel.id}`);
  };

  const addAt = (pos: number) => {
    const c = colorAtPos(layer, pos), ns = makeStop(rgbToHex(c), r1(pos), c.a);
    patchStops(ss => [...ss, ns]);
    store.selectStop(ns.id);
  };
  const addGap = () => {
    let best = { gap: -1, pos: 50 };
    for (let i = 0; i < sorted.length - 1; i++) { const g = sorted[i + 1].pos - sorted[i].pos; if (g > best.gap) best = { gap: g, pos: (sorted[i].pos + sorted[i + 1].pos) / 2 }; }
    addAt(best.gap < 0 ? 50 : best.pos);
  };
  const remove = () => { if (!sel) return; if (stops.length <= 2) { announce('A gradient needs at least two stops'); return; } patchStops(ss => ss.filter(s => s.id !== sel.id)); store.selectStop(null); };
  const duplicate = () => {
    if (!sel) return;
    const id = uid('s');
    patchStops(ss => [...ss, { ...sel, id, pos: Math.min(100, r1(sel.pos + 4)), effects: sel.effects?.map(effect => ({ ...effect, id: uid('e'), params: { ...effect.params } })) }]);
    store.selectStop(id);
  };

  /** One slider that melts the whole ramp: a Blur on every stop (0 removes them). */
  const smoothAll = stops.reduce((max, s) => Math.max(max, (s.effects ?? []).find(effect => effect.type === 'blur' && effect.enabled)?.params.radius ?? 0), 0);
  const setSmoothAll = (radius: number) => patchStops(ss => ss.map(s => {
    const rest = (s.effects ?? []).filter(effect => effect.type !== 'blur'), prior = (s.effects ?? []).find(effect => effect.type === 'blur');
    if (radius <= 0) return { ...s, effects: rest.length ? rest : undefined };
    const blur: StopEffect = prior ? { ...prior, enabled: true, params: { ...prior.params, radius } } : { ...newStopEffect('blur'), params: { radius } };
    return { ...s, effects: [...rest, blur] };
  }), 'stops-smooth-all');

  const reach = sel ? reachOf(sel.effects) : 0;
  const reachLeft = sel ? Math.max(0, sel.pos - reach) : 0, reachRight = sel ? Math.min(100, sel.pos + reach) : 0;

  const markerDown = (e: RPointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLButtonElement).focus();
    const at = stops.find(s => s.id === id)?.pos;
    const coincident = at === undefined ? [] : sorted.filter(s => Math.abs(s.pos - at) < 0.2);
    const current = coincident.findIndex(s => s.id === selId);
    const selectedId = coincident.length > 1 && current >= 0 && coincident[current].id === id
      ? coincident[(current + 1) % coincident.length].id
      : id;
    const marker = e.currentTarget as HTMLElement, markerRect = marker.getBoundingClientRect();
    marker.setPointerCapture(e.pointerId);
    drag.current = { id: selectedId, offsetX: e.clientX - (markerRect.left + markerRect.width / 2) };
    store.selectStop(selectedId);
    store.begin();
  };
  const markerMove = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    patchStop(d.id, { pos: r1(posOf({ clientX: e.clientX - d.offsetX })) });
  };
  const markerUp = () => { if (!drag.current) return; drag.current = null; store.end(); };
  const markerKey = (e: RKeyboardEvent<HTMLButtonElement>, s: ColorStop) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    store.selectStop(s.id);
    store.updateLayer(layerId, l => ({
      ...l,
      stops: l.stops.map(x => x.id === s.id
        ? { ...x, pos: e.key === 'Home' ? 0 : e.key === 'End' ? 100 : Math.max(0, Math.min(100, Math.round((x.pos + (e.key === 'ArrowRight' ? 0.1 : -0.1)) * 10) / 10)) }
        : x),
    }), { coalesce: `stop-pos-${s.id}` });
  };

  const addEffectChips = (group: 'smooth' | 'colour') => STOP_EFFECT_LIST.filter(effect => effect.group === group).map(effect =>
    <button key={effect.id} type="button" className="chip" title={effect.hint} onClick={() => sel && patchStop(sel.id, { effects: [...(sel.effects ?? []), newStopEffect(effect.id)] })} data-testid={`stop-add-fx-${effect.id}`}>+ {effect.label}</button>);

  return <div className="gs-stops" data-testid="stop-editor">
    <div className="gs-stopbar-wrap">
      <div className="gs-stopbar" ref={bar} style={{ background: `${barBg}, ${CHECKER}` }}
        onPointerDown={e => { barTap.current = { x: e.clientX, moved: false }; }}
        onPointerMove={e => { if (barTap.current && Math.abs(e.clientX - barTap.current.x) > 6) barTap.current.moved = true; }}
        onPointerUp={e => { const t = barTap.current; barTap.current = null; if (t && !t.moved && e.target === e.currentTarget) addAt(posOf(e)); }} data-testid="stop-bar" aria-label="Gradient bar — tap to add a stop">
        {sorted.map((s, i) => <button key={s.id} type="button" className={`gs-marker ${s.id === selId ? 'sel' : ''}`} style={{ left: `${s.pos}%`, zIndex: s.id === selId ? 3 : i + 1 }} aria-label={`Colour stop ${i + 1} at ${s.pos}%. Arrow keys move by 0.1 percent`}
          onPointerDown={e => markerDown(e, s.id)} onPointerMove={markerMove} onPointerUp={markerUp} onPointerCancel={markerUp} onLostPointerCapture={markerUp} onKeyDown={e => markerKey(e, s)} data-testid="stop-marker">
          <span style={{ background: s.color, opacity: Math.max(0.25, s.alpha) }} />
        </button>)}
      </div>
    </div>
    {reach > 0 && <div aria-hidden="true" data-testid="stop-reach" title="How far this stop's smoothing reaches" style={{ position: 'relative', height: 6, margin: '2px 0 6px', borderRadius: 3, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      <i style={{ position: 'absolute', top: 0, bottom: 0, left: `${reachLeft}%`, width: `${Math.max(0, reachRight - reachLeft)}%`, borderRadius: 3, background: 'linear-gradient(90deg, transparent, rgba(117,228,188,0.85) 50%, transparent)' }} />
    </div>}
    <p className="gs-bar-hint">Tap the bar to add a stop · drag a handle or use arrow keys for 0.1% steps. Overlapping stops cycle on tap.</p>
    <ValueControl label="Smooth all stops" value={smoothAll} min={0} max={40} step={0.5} unit="%" def={0} onChange={setSmoothAll} testId="stops-smooth-all" {...sliderGesture} />
    <p className="hint">One slider that blurs every stop into its neighbours. Fine-tune a single stop under “Stop effects”.</p>
    <div className="gs-chips" role="listbox" aria-label="Stops">
      {sorted.map((s, i) => <button key={s.id} type="button" role="option" aria-selected={s.id === selId} className={`gs-stopchip ${s.id === selId ? 'sel' : ''}`} onClick={() => store.selectStop(s.id)} data-testid="stop-chip">
        <i style={{ background: s.color, opacity: Math.max(0.25, s.alpha) }} />{i + 1}<small>{s.pos}%</small>
      </button>)}
    </div>
    {sel ? <div className="gs-stopprops" data-testid="stop-props">
      <ColorInput color={sel.color} alpha={sel.alpha} onChange={(c, a) => patchStop(sel.id, { color: c, alpha: a }, `stop-color-${sel.id}`)} label="Stop colour" testId="stop-color" />
      <ValueControl label="Opacity" value={Math.round(sel.alpha * 100)} min={0} max={100} unit="%" def={100} onChange={v => patchStop(sel.id, { alpha: v / 100 }, `stop-a-${sel.id}`)} testId="stop-alpha" {...sliderGesture} />
      <ValueControl label="Position" value={sel.pos} min={0} max={100} step={0.1} unit="%" onChange={v => patchStop(sel.id, { pos: v }, `stop-p-${sel.id}`)} testId="stop-pos" {...sliderGesture} />
      {next && !sel.hard && <div className="gs-curve-editor" data-testid="stop-curve">
        <div className="field-label">Transition curve</div>
        <Seg value={curveMode} label="Transition curve" options={[
          { id: 'linear', label: 'Linear' }, { id: 'ease-in', label: 'Ease in' }, { id: 'ease-out', label: 'Ease out' },
          { id: 'ease-in-out', label: 'In / out' }, { id: 'ease', label: 'Ease' }, { id: 'custom', label: 'Custom' }, { id: 'midpoint', label: 'Midpoint' },
        ]} onChange={v => setCurvePreset(v as CurvePreset)} testId="stop-curve-preset" />
        <svg viewBox="0 0 100 100" role="img" aria-label="Transition curve preview" style={{ width: '100%', height: 64, borderRadius: 6, background: '#11151a' }}>
          <path d="M0 100L100 0" fill="none" stroke="#59616c" strokeDasharray="3 3" />
          <path d={curvePath} fill="none" stroke="#75e4bc" strokeWidth="3" />
        </svg>
        {curveMode === 'midpoint' && <ValueControl label="Transition midpoint" value={sel.mid ?? 65} min={5} max={95} unit="%" def={65} onChange={v => patchStop(sel.id, { mid: v === 50 ? undefined : v }, `stop-m-${sel.id}`)} testId="stop-mid" {...sliderGesture} />}
        {curveMode === 'custom' && <>
          <p className="hint">Control points shape the colour blend from this stop to the next.</p>
          <ValueControl label="Control 1 X" value={curve.x1} min={0} max={1} step={0.01} onChange={v => patchStop(sel.id, { curve: { ...curve, x1: v } }, `stop-curve-x1-${sel.id}`)} testId="stop-curve-x1" {...sliderGesture} />
          <ValueControl label="Control 1 Y" value={curve.y1} min={0} max={1} step={0.01} onChange={v => patchStop(sel.id, { curve: { ...curve, y1: v } }, `stop-curve-y1-${sel.id}`)} testId="stop-curve-y1" {...sliderGesture} />
          <ValueControl label="Control 2 X" value={curve.x2} min={0} max={1} step={0.01} onChange={v => patchStop(sel.id, { curve: { ...curve, x2: v } }, `stop-curve-x2-${sel.id}`)} testId="stop-curve-x2" {...sliderGesture} />
          <ValueControl label="Control 2 Y" value={curve.y2} min={0} max={1} step={0.01} onChange={v => patchStop(sel.id, { curve: { ...curve, y2: v } }, `stop-curve-y2-${sel.id}`)} testId="stop-curve-y2" {...sliderGesture} />
        </>}
        <p className="hint">Custom curves are approximated with sampled CSS colour mixes and rendered directly for PNG/SVG.</p>
      </div>}
      <Section title="Stop effects" hint={`${(sel.effects ?? []).filter(effect => effect.enabled).length} active`}>
        <p className="hint">Effects act on this stop only. Smooth effects soften the blend with its neighbours; Colour effects change the stop’s own colour.</p>
        <div className="field-label">Smooth</div>
        <div className="gs-chips gs-addchips" role="group" aria-label="Add smoothing effect">{addEffectChips('smooth')}</div>
        <div className="field-label">Colour</div>
        <div className="gs-chips gs-addchips" role="group" aria-label="Add colour effect">{addEffectChips('colour')}</div>
        {(sel.effects ?? []).map(effect => {
          const def = STOP_EFFECTS[effect.type];
          if (!def) {
            // an effect saved before stops were limited to the ones above (e.g. grain): it never did anything on a stop
            return <div key={effect.id} className="gs-fxcard off" data-testid="stop-fx-card-unsupported">
              <div className="gs-fxhead">
                <b>{effect.type}</b>
                <button type="button" className="icon-btn" aria-label={`Remove stop ${effect.type}`} onClick={() => patchStop(sel.id, { effects: (sel.effects ?? []).filter(current => current.id !== effect.id) })}><Trash2 /></button>
              </div>
              <p className="hint">This effect works on pixels, so it cannot change a colour stop. Remove it, or add it to the whole layer under Effects.</p>
            </div>;
          }
          return <div key={effect.id} className={`gs-fxcard ${effect.enabled ? '' : 'off'}`} data-testid="stop-fx-card">
            <div className="gs-fxhead">
              <b>{def.label}</b>
              <Switch label="" checked={effect.enabled} onChange={enabled => setStopFx(sel.id, effect.id, current => ({ ...current, enabled }))} testId={`stop-fx-on-${effect.type}`} />
              <button type="button" className="icon-btn" aria-label={`Remove stop ${def.label}`} onClick={() => patchStop(sel.id, { effects: (sel.effects ?? []).filter(current => current.id !== effect.id) })} data-testid={`stop-fx-del-${effect.type}`}><Trash2 /></button>
            </div>
            {def.params.map(param => <ValueControl key={param.key} label={param.label} value={effect.params[param.key] ?? param.def} min={param.min} max={param.max} step={param.step} unit={param.unit} def={param.def} onChange={value => setStopFx(sel.id, effect.id, current => ({ ...current, params: { ...current.params, [param.key]: value } }), `stop-fx-${effect.id}-${param.key}`)} testId={`stop-fx-${effect.type}-${param.key}`} {...sliderGesture} />)}
            <p className="hint">{def.hint}</p>
          </div>;
        })}
      </Section>
      <Switch label="Hard edge after this stop" checked={!!sel.hard} onChange={v => patchStop(sel.id, { hard: v || undefined })} testId="stop-hard" />
      <div className="gs-btnrow">
        <button type="button" className="btn" onClick={duplicate} data-testid="stop-duplicate"><Copy />Duplicate</button>
        <button type="button" className="btn danger" onClick={remove} data-testid="stop-delete"><Trash2 />Delete</button>
      </div>
    </div> : <p className="gs-empty">Select a stop to edit its colour, opacity and position.</p>}
    <div className="gs-btnrow">
      <button type="button" className="btn" onClick={addGap} data-testid="stop-add"><Plus />Add stop</button>
      <button type="button" className="btn" onClick={() => patchStops(reverseStops)} data-testid="stop-reverse">Reverse</button>
      <button type="button" className="btn" onClick={() => patchStops(ss => { const o = sortedStops(ss); return o.map((s, i) => ({ ...s, pos: r1((i / Math.max(1, o.length - 1)) * 100) })); })} data-testid="stop-distribute">Distribute</button>
    </div>
  </div>;
}
export type { GradientLayer };
