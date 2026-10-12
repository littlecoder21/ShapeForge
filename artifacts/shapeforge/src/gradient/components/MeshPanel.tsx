import { Copy, Plus, Shuffle, Trash2 } from 'lucide-react';
import { Section, Seg, ValueControl } from '../../shared/controls';
import { generateMesh, newMeshPoint, MESH_PATTERNS, meshLayout, type MeshPattern } from '../engine/mesh';
import { hslToHex } from '../engine/color';
import { uid, type GradientLayer, type MeshPoint } from '../engine/model';
import { useStore } from '../engine/store';
import { ColorInput, useStudio } from './ui';
import { useState } from 'react';

const PALETTES: [string, string[]][] = [
  ['Candy', ['#ff7ad9', '#7c5cff', '#22d3ee', '#fbbf24']], ['Aurora', ['#34f5a1', '#22d3ee', '#a78bfa', '#0ea5e9']], ['Sunset', ['#ff6b6b', '#ffb36b', '#c084fc', '#f472b6']],
  ['Ocean', ['#0ea5e9', '#22d3ee', '#6366f1', '#14b8a6']], ['Peach', ['#ffd1ba', '#ffb4a2', '#e5989b', '#b5838d']], ['Mono', ['#e5e7eb', '#9ca3af', '#4b5563', '#111827']],
];
const rndColor = () => hslToHex(Math.random() * 360, 80, 60);

/** Mesh layer controls — the points themselves are dragged on the canvas (double-tap empty space to add one). */
export default function MeshPanel({ layerId }: { layerId: string }) {
  const { store, announce } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  const selId = useStore(store, s => s.stopId);
  const [pattern, setPattern] = useState<MeshPattern>('scatter');
  const [seed, setSeed] = useState(7);
  if (!layer || layer.type !== 'mesh') return null;
  const pts = layer.mesh.points, sel = pts.find(p => p.id === selId) ?? null;

  const setMesh = (fn: (m: GradientLayer['mesh']) => GradientLayer['mesh'], key?: string) => store.updateLayer(layerId, l => ({ ...l, mesh: fn(l.mesh) }), { coalesce: key });
  const setPt = (id: string, p: Partial<MeshPoint>, key?: string) => setMesh(m => ({ ...m, points: m.points.map(x => (x.id === id ? { ...x, ...p } : x)) }), key);
  const add = () => { const np = newMeshPoint(15 + Math.random() * 70, 15 + Math.random() * 70, rndColor(), 1, 46); setMesh(m => ({ ...m, points: [...m.points, np] })); store.selectStop(np.id); };
  const remove = () => { if (!sel) return; if (pts.length <= 1) { announce('Keep at least one point'); return; } setMesh(m => ({ ...m, points: m.points.filter(x => x.id !== sel.id) })); store.selectStop(null); };
  const dup = () => { if (!sel) return; const c = { ...sel, id: uid('m'), x: Math.min(100, sel.x + 6), y: Math.min(100, sel.y + 6) }; setMesh(m => ({ ...m, points: [...m.points, c] })); store.selectStop(c.id); };
  const palette = (cols: string[]) => setMesh(m => ({ ...m, points: m.points.map((p, i) => ({ ...p, color: cols[i % cols.length] })) }));
  const relayout = (pat: MeshPattern, sd: number) => { const pos = meshLayout(pts.length, pat, sd); setMesh(m => ({ ...m, points: m.points.map((p, i) => ({ ...p, x: Math.round(pos[i].x * 10) / 10, y: Math.round(pos[i].y * 10) / 10 })) })); };
  const regenerate = (count: number) => { const cols = pts.map(p => p.color); setMesh(m => ({ ...generateMesh(cols.length ? cols : ['#7c5cff', '#22d3ee'], count, pattern, seed, m.base, 50), core: m.core })); };

  return <div data-testid="mesh-panel">
    <Section title="Colour points" hint={`${pts.length} points`}>
      <p className="hint">Drag points on the canvas. Drag the square handle to resize. Double-tap empty canvas to add a point.</p>
      <div className="gs-chips" role="listbox" aria-label="Mesh points">
        {pts.map((p, i) => <button key={p.id} type="button" role="option" aria-selected={p.id === selId} className={`gs-stopchip ${p.id === selId ? 'sel' : ''}`} onClick={() => store.selectStop(p.id)} data-testid="mesh-chip"><i style={{ background: p.color, opacity: Math.max(0.25, p.alpha) }} />{i + 1}</button>)}
      </div>
      {sel ? <div className="gs-stopprops" data-testid="mesh-point">
        <ColorInput color={sel.color} alpha={sel.alpha} onChange={(c, a) => setPt(sel.id, { color: c, alpha: a }, `mc-${sel.id}`)} label="Point colour" testId="mesh-color" />
        <ValueControl label="Opacity" value={Math.round(sel.alpha * 100)} min={0} max={100} unit="%" def={100} onChange={v => setPt(sel.id, { alpha: v / 100 }, `ma-${sel.id}`)} testId="mesh-alpha" />
        <ValueControl label="Position X" value={sel.x} min={-20} max={120} step={0.5} unit="%" onChange={v => setPt(sel.id, { x: v }, `mx-${sel.id}`)} testId="mesh-x" />
        <ValueControl label="Position Y" value={sel.y} min={-20} max={120} step={0.5} unit="%" onChange={v => setPt(sel.id, { y: v }, `my-${sel.id}`)} testId="mesh-y" />
        <ValueControl label="Size" value={sel.size} min={4} max={160} step={0.5} unit="%" def={48} onChange={v => setPt(sel.id, { size: v }, `ms-${sel.id}`)} testId="mesh-size" />
        <div className="gs-btnrow"><button type="button" className="btn" onClick={dup}><Copy />Duplicate</button><button type="button" className="btn danger" onClick={remove} data-testid="mesh-delete"><Trash2 />Delete</button></div>
      </div> : <p className="gs-empty">Select a point to edit its colour, position and size.</p>}
      <button type="button" className="btn wide" onClick={add} data-testid="mesh-add"><Plus />Add point</button>
    </Section>
    <Section title="Blend">
      <ValueControl label="Core (hold colour)" value={layer.mesh.core} min={0} max={100} unit="%" def={40} onChange={v => setMesh(m => ({ ...m, core: v }), 'core')} testId="mesh-core" />
      <div className="field-label">Base colour</div>
      <ColorInput color={layer.mesh.base || '#000000'} alpha={1} showAlpha={false} onChange={c => setMesh(m => ({ ...m, base: c }), 'mbase')} label="Mesh base" testId="mesh-base" />
      <button type="button" className="btn wide" onClick={() => setMesh(m => ({ ...m, base: '' }))}>No base (transparent)</button>
      <div className="field-label">Colour interpolation</div>
      <Seg value={layer.space} label="Colour space" options={[{ id: 'srgb', label: 'sRGB' }, { id: 'oklab', label: 'OKLab' }, { id: 'oklch', label: 'OKLCH' }]} onChange={v => store.updateLayer(layerId, { space: v })} />
    </Section>
    <Section title="Colours & layout" open={false}>
      <div className="gs-palettes">{PALETTES.map(([n, c]) => <button key={n} type="button" className="gs-pal" onClick={() => palette(c)} data-testid={`mesh-pal-${n.toLowerCase()}`}><span>{c.map(x => <i key={x} style={{ background: x }} />)}</span>{n}</button>)}</div>
      <button type="button" className="btn wide" onClick={() => setMesh(m => ({ ...m, points: m.points.map(p => ({ ...p, color: rndColor() })) }))}><Shuffle />Random colours</button>
      <div className="field-label">Layout</div>
      <Seg value={pattern} label="Layout pattern" options={MESH_PATTERNS.map(p => ({ id: p.id, label: p.label }))} onChange={p => { setPattern(p); relayout(p, seed); }} testId="mesh-pattern" />
      <ValueControl label="Points" value={pts.length} min={2} max={12} def={4} onChange={v => regenerate(v)} testId="mesh-count" />
      <div className="seed-row"><ValueControl label="Seed" value={seed} min={1} max={999} def={7} onChange={v => { setSeed(v); relayout(pattern, v); }} /></div>
    </Section>
  </div>;
}
