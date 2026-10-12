import { useMemo, useRef, type PointerEvent as RPointerEvent } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { ValueControl, Switch } from '../../shared/controls';
import { gradientFn } from '../engine/css';
import { colorAtPos } from '../engine/ramp';
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

export default function StopEditor({ layerId }: { layerId: string }) {
  const { store, announce } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  const canvas = useStore(store, s => s.project.canvas);
  const selId = useStore(store, s => s.stopId);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null), barTap = useRef<{ x: number; moved: boolean } | null>(null);

  const stops = layer?.stops ?? [];
  const sel = stops.find(s => s.id === selId) ?? null;
  const sorted = useMemo(() => sortedStops(stops), [stops]);
  const barBg = useMemo(() => (layer ? gradientFn({ ...layer, type: 'linear', repeating: false, angle: 90, anim: { ...layer.anim, enabled: false } }, { canvas } as GradientProject, { flat: true }) : ''), [layer, canvas]);
  if (!layer) return null;

  const patchStops = (fn: (s: ColorStop[]) => ColorStop[], coalesce?: string) => store.updateLayer(layerId, l => ({ ...l, stops: fn(l.stops) }), { coalesce });
  const patchStop = (id: string, p: Partial<ColorStop>, coalesce?: string) => patchStops(ss => ss.map(s => (s.id === id ? { ...s, ...p } : s)), coalesce);
  const posOf = (e: { clientX: number }) => { const r = bar.current!.getBoundingClientRect(); return Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)); };
  const next = sel ? sorted[sorted.findIndex(s => s.id === sel.id) + 1] : undefined;

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
  const duplicate = () => { if (!sel) return; const id = uid('s'); patchStops(ss => [...ss, { ...sel, id, pos: Math.min(100, r1(sel.pos + 4)) }]); store.selectStop(id); };

  const markerDown = (e: RPointerEvent, id: string) => {
    e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, moved: false }; store.selectStop(id); store.begin();
  };
  const markerMove = (e: RPointerEvent) => {
    const d = drag.current; if (!d || !e.buttons) return;
    d.moved = true;
    let pos = r1(posOf(e));
    for (const o of stops) if (o.id !== d.id && Math.abs(o.pos - pos) < 1.2) pos = o.pos;
    if (Math.abs(pos - 50) < 1) pos = 50;
    patchStop(d.id, { pos });
  };
  const markerUp = () => { drag.current = null; store.end(); };

  return <div className="gs-stops" data-testid="stop-editor">
    <div className="gs-stopbar-wrap">
      <div className="gs-stopbar" ref={bar} style={{ background: `${barBg}, ${CHECKER}` }}
        onPointerDown={e => { barTap.current = { x: e.clientX, moved: false }; }}
        onPointerMove={e => { if (barTap.current && Math.abs(e.clientX - barTap.current.x) > 6) barTap.current.moved = true; }}
        onPointerUp={e => { const t = barTap.current; barTap.current = null; if (t && !t.moved && e.target === e.currentTarget) addAt(posOf(e)); }} data-testid="stop-bar" aria-label="Gradient bar — tap to add a stop">
        {sorted.map(s => <button key={s.id} type="button" className={`gs-marker ${s.id === selId ? 'sel' : ''}`} style={{ left: `${s.pos}%` }} aria-label={`Colour stop at ${s.pos}%`}
          onPointerDown={e => markerDown(e, s.id)} onPointerMove={markerMove} onPointerUp={markerUp} onPointerCancel={markerUp} data-testid="stop-marker">
          <span style={{ background: s.color, opacity: Math.max(0.25, s.alpha) }} />
        </button>)}
      </div>
    </div>
    <p className="gs-bar-hint">Tap the bar to add a stop · drag markers to move</p>
    <div className="gs-chips" role="listbox" aria-label="Stops">
      {sorted.map((s, i) => <button key={s.id} type="button" role="option" aria-selected={s.id === selId} className={`gs-stopchip ${s.id === selId ? 'sel' : ''}`} onClick={() => store.selectStop(s.id)} data-testid="stop-chip">
        <i style={{ background: s.color, opacity: Math.max(0.25, s.alpha) }} />{i + 1}<small>{s.pos}%</small>
      </button>)}
    </div>
    {sel ? <div className="gs-stopprops" data-testid="stop-props">
      <ColorInput color={sel.color} alpha={sel.alpha} onChange={(c, a) => patchStop(sel.id, { color: c, alpha: a }, `stop-color-${sel.id}`)} label="Stop colour" testId="stop-color" />
      <ValueControl label="Opacity" value={Math.round(sel.alpha * 100)} min={0} max={100} unit="%" def={100} onChange={v => patchStop(sel.id, { alpha: v / 100 }, `stop-a-${sel.id}`)} testId="stop-alpha" />
      <ValueControl label="Position" value={sel.pos} min={0} max={100} step={0.5} unit="%" onChange={v => patchStop(sel.id, { pos: v }, `stop-p-${sel.id}`)} testId="stop-pos" />
      {next && !sel.hard && <ValueControl label="Transition midpoint" value={sel.mid ?? 50} min={5} max={95} unit="%" def={50} onChange={v => patchStop(sel.id, { mid: v === 50 ? undefined : v }, `stop-m-${sel.id}`)} testId="stop-mid" />}
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
