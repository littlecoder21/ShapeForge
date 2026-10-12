import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Code2, Copy, Frame, Redo2, Settings2, Undo2, Wand2 } from 'lucide-react';
import { useMedia } from '../shared/useMedia';
import AnimationPanel from './components/AnimationPanel';
import ApplySheet, { type ApplyOptions } from './components/ApplySheet';
import ScenesPanel from './components/ScenesPanel';
import EffectsPanel from './components/EffectsPanel';
import GradientPanel from './components/GradientPanel';
import LayersPanel from './components/LayersPanel';
import OutputPanel, { type Fmt } from './components/OutputPanel';
import PreviewStage from './components/PreviewStage';
import PresetsPanel from './components/PresetsPanel';
import ProjectMenu from './components/ProjectMenu';
import TransformPanel from './components/TransformPanel';
import { StudioCtx, Empty } from './components/ui';
import { buildOutputs } from './engine/output';
import { normalizeProject, type GradientProject } from './engine/model';
import { loadProject, saveProject } from './engine/persist';
import { createStudioStore, useStore } from './engine/store';
import './studio.css';

type Tab = 'layers' | 'gradient' | 'transform' | 'fx' | 'animate' | 'scenes' | 'presets';
const TABS: { id: Tab; label: string }[] = [
  { id: 'layers', label: 'Layers' }, { id: 'gradient', label: 'Gradient' }, { id: 'transform', label: 'Transform' }, { id: 'fx', label: 'FX' },
  { id: 'animate', label: 'Animate' }, { id: 'scenes', label: 'Scenes' }, { id: 'presets', label: 'Presets' },
];

export interface GradientStudioProps {
  onClose: () => void;
  /** a gradient already applied to the current shape (so it can be re-edited) */
  initial?: GradientProject | null;
  /** name of the ShapeForge shape that "Apply to Shape" targets; null hides the action */
  shapeName?: string | null;
  hasPaint?: boolean;
  onApply?: (project: GradientProject, opts: ApplyOptions) => void;
  onRemovePaint?: () => void;
}

export default function GradientStudio({ onClose, initial, shapeName, hasPaint = false, onApply, onRemovePaint }: GradientStudioProps) {
  const [store] = useState(() => createStudioStore(initial ? normalizeProject(JSON.parse(JSON.stringify(initial))) : loadProject()));
  const wide = useMedia('(min-width: 1000px)');
  const [tab, setTab] = useState<Tab>('presets');
  const [dockOpen, setDockOpen] = useState(true), [dockTall, setDockTall] = useState(false);
  const [outOpen, setOutOpen] = useState(false), [fmt, setFmt] = useState<Fmt>('css');
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState<'project' | 'apply' | null>(null);
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((m: string) => { setToast(m); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setToast(''), 2200); }, []);
  const ctx = useMemo(() => ({ store, announce }), [store, announce]);

  useEffect(() => store.subscribe(() => saveProject(store.getState().project)), [store]);
  const layerId = useStore(store, s => s.layerId);
  const canUndo = useStore(store, s => s.past.length > 0), canRedo = useStore(store, s => s.future.length > 0);
  const project = useStore(store, s => s.project);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
      else if (mod && k === 'y') { e.preventDefault(); store.redo(); }
      else if (k === 'escape') { if (menu) setMenu(null); else if (outOpen) setOutOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, menu, outOpen]);

  const copyBest = async () => {
    const o = buildOutputs(store.getState().project);
    const text = o.analysis.needsLayers ? o.layered.css : o.flat.full;
    try { await navigator.clipboard.writeText(text); announce(o.analysis.needsLayers ? 'Copied exact layered CSS (blur / effects need layers)' : 'CSS copied'); } catch { announce('Clipboard unavailable'); }
  };
  const copySvg = async () => { try { await navigator.clipboard.writeText(buildOutputs(store.getState().project).svg); announce('SVG copied'); } catch { announce('Clipboard unavailable'); } };

  const body = (t: Tab) => {
    if (t === 'presets') return <PresetsPanel onApplied={() => { if (!wide) setDockTall(false); }} />;
    if (t === 'scenes') return <ScenesPanel />;
    if (!layerId) return <Empty>Select a layer in the Layers tab.</Empty>;
    if (t === 'layers') return <LayersPanel />;
    if (t === 'gradient') return <GradientPanel layerId={layerId} />;
    if (t === 'transform') return <TransformPanel layerId={layerId} />;
    if (t === 'fx') return <EffectsPanel layerId={layerId} />;
    return <AnimationPanel layerId={layerId} />;
  };
  const tabs = wide ? TABS.filter(t => t.id !== 'layers') : TABS;
  const activeTab = wide && tab === 'layers' ? 'gradient' : tab;
  const tabBar = (cls: string) => <div className={cls} role="tablist" aria-label="Gradient tools">
    {tabs.map(t => <button key={t.id} type="button" role="tab" aria-selected={activeTab === t.id} className={`ptab ${activeTab === t.id ? 'active' : ''}`} onClick={() => { setTab(t.id); setDockOpen(true); }} data-testid={`gs-tab-${t.id}`}>{t.label}</button>)}
  </div>;

  const apply = (o: ApplyOptions) => { onApply?.(store.snapshot(), o); setMenu(null); };
  const showApply = !!onApply && !!shapeName;

  const header = <header className="gs-top">
    <button type="button" className="icon-btn" onClick={onClose} aria-label="Back to ShapeForge" data-testid="gs-back"><ArrowLeft /></button>
    <div className="gs-title"><b>Gradient Studio</b><small>{project.name} · {project.canvas.w}×{project.canvas.h}</small></div>
    <button type="button" className="icon-btn" onClick={() => store.undo()} disabled={!canUndo} aria-label="Undo" data-testid="gs-undo"><Undo2 /></button>
    <button type="button" className="icon-btn" onClick={() => store.redo()} disabled={!canRedo} aria-label="Redo" data-testid="gs-redo"><Redo2 /></button>
    <button type="button" className="icon-btn" onClick={() => setMenu(menu === 'project' ? null : 'project')} aria-label="Project settings" aria-expanded={menu === 'project'} data-testid="gs-menu"><Settings2 /></button>
  </header>;

  const outbar = <footer className="gs-outbar">
    <button type="button" className="btn primary big" onClick={copyBest} data-testid="copy-css-bar"><Copy />Copy CSS</button>
    <button type="button" className="btn big" onClick={copySvg} data-testid="copy-svg-bar"><Copy />Copy SVG</button>
    {showApply && <button type="button" className="btn big" onClick={() => setMenu(menu === 'apply' ? null : 'apply')} data-testid="gs-apply"><Wand2 />Shape</button>}
    <button type="button" className={`btn big icon ${outOpen ? 'on' : ''}`} onClick={() => setOutOpen(!outOpen)} aria-expanded={outOpen} aria-label="Show code" data-testid="gs-code"><Code2 />{outOpen ? <ChevronDown /> : <ChevronUp />}</button>
  </footer>;

  const overlays = <>
    {menu === 'project' && <div className="gs-pop"><ProjectMenu onClose={() => setMenu(null)} /></div>}
    {menu === 'apply' && showApply && <div className="gs-pop"><ApplySheet shapeName={shapeName!} hasPaint={hasPaint} onApply={apply} onRemove={() => { onRemovePaint?.(); setMenu(null); }} onClose={() => setMenu(null)} /></div>}
    {toast && <div className="toast-note" role="status" data-testid="gs-toast">{toast}</div>}
  </>;

  return <StudioCtx.Provider value={ctx}>
    <div className={`gs ${wide ? 'gs-wide' : ''}`} data-testid="gradient-studio" role="application" aria-label="Gradient Studio">
      {header}
      {wide ? <>
        <aside className="gs-left" aria-label="Layers"><div className="gs-panelhead">Layers</div><div className="gs-panelbody"><LayersPanel /></div></aside>
        <section className="gs-center"><PreviewStage store={store} mode={activeTab === 'transform' ? 'transform' : 'gradient'} playing={playing} onTogglePlay={() => setPlaying(p => !p)} /></section>
        <aside className="gs-right" aria-label="Tools">{tabBar('panel-tabs')}<div className="gs-panelbody">{body(activeTab)}</div></aside>
        <section className={`gs-bottom ${outOpen ? 'open' : ''}`} aria-label="Output">
          <div className="gs-bottom-bar"><b>Output</b>{outbar}</div>
          {outOpen && <div className="gs-bottom-body"><OutputPanel fmt={fmt} setFmt={setFmt} /></div>}
        </section>
      </> : <>
        <div className="gs-main">
          <PreviewStage store={store} mode={activeTab === 'transform' ? 'transform' : 'gradient'} playing={playing} onTogglePlay={() => setPlaying(p => !p)} />
          <div className="gs-tabrow">{tabBar('gs-tabs')}
            <button type="button" className="icon-btn" onClick={() => setDockOpen(!dockOpen)} aria-label={dockOpen ? 'Collapse panel' : 'Expand panel'} data-testid="gs-dock-toggle">{dockOpen ? <ChevronDown /> : <ChevronUp />}</button>
            {dockOpen && <button type="button" className="icon-btn" onClick={() => setDockTall(!dockTall)} aria-label="Resize panel" data-testid="gs-dock-size"><Frame /></button>}
          </div>
          {dockOpen && <div className={`gs-dock ${dockTall ? 'tall' : ''}`} data-testid="gs-dock">{body(activeTab)}</div>}
        </div>
        {outbar}
        {outOpen && <section className="gs-outsheet" aria-label="Output"><div className="gs-sheet-grab" onClick={() => setOutOpen(false)} /><OutputPanel fmt={fmt} setFmt={setFmt} /></section>}
      </>}
      {overlays}
    </div>
  </StudioCtx.Provider>;
}
