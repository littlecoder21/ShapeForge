import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Switch } from '../../shared/controls';
import { freshIds } from '../engine/model';
import { CATEGORIES, getPresets, type Preset } from '../engine/presets';
import PresetCard from './PresetCard';
import { useStudio } from './ui';

const PAGE = 30;

export default function PresetsPanel({ onApplied }: { onApplied?: () => void }) {
  const { store, announce } = useStudio();
  const all = useMemo(() => getPresets(), []);
  const [cat, setCat] = useState<string>('All');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [add, setAdd] = useState(false);
  const [last, setLast] = useState('');

  const counts = useMemo(() => { const m: Record<string, number> = { All: all.length }; all.forEach(p => { m[p.category] = (m[p.category] ?? 0) + 1; }); return m; }, [all]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter(p => (cat === 'All' || p.category === cat) && (!s || p.name.toLowerCase().includes(s) || p.tags.some(t => t.includes(s))));
  }, [all, cat, q]);

  const apply = (p: Preset) => {
    const project = freshIds(p.build());
    store.update(cur => ({ ...cur, name: add ? cur.name : project.name, background: add ? cur.background : project.background, layers: add ? [...project.layers, ...cur.layers] : project.layers }));
    store.select((project.layers.find(l => l.type !== 'noise') ?? project.layers[0]).id); setLast(p.id); announce(`${add ? 'Added' : 'Applied'} “${p.name}”`); onApplied?.();
  };

  return <div className="gs-presets" data-testid="presets-panel">
    <label className="gs-search"><Search /><input value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE); }} placeholder={`Search ${all.length} presets`} aria-label="Search presets" data-testid="preset-search" /></label>
    <div className="gs-chips gs-cats" role="tablist" aria-label="Preset categories">
      {['All', ...CATEGORIES].map(c => <button key={c} type="button" role="tab" aria-selected={cat === c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => { setCat(c); setLimit(PAGE); }} data-testid={`preset-cat-${c.toLowerCase()}`}>{c} <small>{counts[c] ?? 0}</small></button>)}
    </div>
    <Switch label="Add as layers instead of replacing" checked={add} onChange={setAdd} testId="preset-add" />
    <div className="gs-cardgrid">{list.slice(0, limit).map(p => <PresetCard key={p.id} preset={p} active={p.id === last} onApply={apply} />)}</div>
    {list.length > limit && <button type="button" className="btn wide" onClick={() => setLimit(l => l + PAGE)} data-testid="preset-more">Show {Math.min(PAGE, list.length - limit)} more · {list.length - limit} left</button>}
    {!list.length && <p className="gs-empty">No presets match “{q}”.</p>}
  </div>;
}
