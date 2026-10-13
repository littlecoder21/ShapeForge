import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, Check, ChevronUp, Code2, Copy, Download, Grid2X2, Hand, Magnet, MousePointer2, Move, PanelBottomClose, PanelBottomOpen, PenTool, Plus, Redo2, ScanLine, Shapes, SlidersHorizontal,
  Palette, Sparkles, Undo2, Waves, X, Crosshair,
} from 'lucide-react';
import { exportCode, exportPageSvg, makeShape, samplePath, simplify, type ShapeModel, type Unit } from './lib/shape/geometry';
import { NONE, nudgeNode, deleteNode, deleteNodes, moveNodesBy, selectAllNodes, selectedIndices, setNodesLocked, toggleInSelection, type Selection, type Tool } from './lib/shape/edit';
import { DEFAULT_WAVE, buildWaveShape, clampWave, type WaveParams } from './lib/shape/wave';
import { unifyShapes } from './lib/shape/union';
import { loadSettings, saveSettings, type EditorSettings } from './lib/shape/settings';
import { addPage, addShape, duplicateShape, moveShape, patchPage, patchShape, removePage, removeShape, renamePage, replaceShapesWithUnion, selectPage, selectShape } from './shape/state/document';
import { useDocument } from './shape/state/useDocument';
import Stage, { type StageHandle } from './shape/canvas/Stage';
import PageTabs from './shape/layout/PageTabs';
import PagePanel from './shape/panels/PagePanel';
import PageSettings from './shape/panels/PageSettings';
import PrecisionPanel from './shape/panels/PrecisionPanel';
import ShapePanel from './shape/panels/ShapePanel';
import WavePanel from './shape/panels/WavePanel';
import BoundaryPanel from './shape/panels/BoundaryPanel';
import EditorPanel from './shape/panels/EditorPanel';
import './index.css';

/** Gradient Studio is a separate workspace: loaded on demand so ShapeForge itself stays light. */
const GradientStudio = lazy(() => import('./gradient/GradientStudio'));

const FORMATS = ['SVG', 'PAGE SVG', 'SVG PATH', 'CSS PATH', 'POLYGON', 'REACT', 'HTML + CSS', 'JSON'];
const LIBRARY = ['Rectangle', 'Rounded rectangle', 'Half circle', 'Ellipse', 'Triangle', 'Diamond', 'Pentagon', 'Hexagon', 'Octagon', 'Star', 'Heart', 'Arrow', 'Cross', 'Trapezoid', 'Parallelogram', 'Circle'];
type Tab = 'page' | 'node' | 'shape' | 'wave' | 'outer' | 'editor';
const TABS: { id: Tab; label: string }[] = [{ id: 'page', label: 'Page' }, { id: 'node', label: 'Node' }, { id: 'shape', label: 'Shape' }, { id: 'wave', label: 'Wave' }, { id: 'outer', label: 'Outer' }, { id: 'editor', label: 'Editor' }];

function useMedia(query: string) {
  const [m, setM] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query), on = () => setM(mq.matches);
    on(); mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

function App() {
  const documentState = useDocument();
  const { doc, page, shape } = documentState;
  const [format, setFormat] = useState('SVG');
  const [tool, setTool] = useState<Tool>('Select');
  const [selection, setSelection] = useState<Selection>(NONE);
  const [seed, setSeed] = useState(23);
  const [tolerance, setTolerance] = useState(3);
  const [precision, setPrecision] = useState(1);
  const [unit, setUnit] = useState<Unit>('%');
  const [grid, setGrid] = useState(true);
  const [settings, setSettingsState] = useState<EditorSettings>(loadSettings);
  const [waveParams, setWaveParams] = useState<WaveParams>(DEFAULT_WAVE);
  const [tab, setTab] = useState<Tab>('page');
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTall, setDockTall] = useState(false);
  const [sheet, setSheet] = useState<'tools' | 'code' | null>(null);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState(false);
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [studio, setStudio] = useState(() => typeof location !== 'undefined' && location.hash === '#gradient');

  const isNarrow = useMedia('(max-width: 900px)');
  const isPhone = useMedia('(max-width: 640px)');
  const stageRef = useRef<StageHandle>(null);
  const waveAddedPreview = useRef(false);
  const autoDock = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSettings = useCallback((patch: Partial<EditorSettings>) => setSettingsState(s => ({ ...s, ...patch })), []);
  useEffect(() => saveSettings(settings), [settings]);

  const announce = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  /* ───── Gradient Studio navigation (browser back closes it) ───── */
  useEffect(() => {
    const sync = () => setStudio(location.hash === '#gradient');
    window.addEventListener('popstate', sync); window.addEventListener('hashchange', sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync); };
  }, []);
  const openStudio = () => { try { window.history.pushState({ gs: 1 }, '', '#gradient'); } catch { /* sandboxed */ } setStudio(true); };
  const closeStudio = () => { if (window.history.state && window.history.state.gs) window.history.back(); else { setStudio(false); try { window.history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } } };

  /* ───── history ───── */
  const commit = useCallback((next: ShapeModel, sel?: Selection) => {
    documentState.commit(next);
    if (sel) setSelection(sel);
  }, [documentState.commit]);
  const live = useCallback((next: ShapeModel) => documentState.live(next, shape), [documentState.live, shape]);
  const liveEnd = documentState.liveEnd;
  const finishGesture = useCallback((before: ShapeModel) => {
    if (before.id !== documentState.shape.id) return;
    documentState.pushGesture(before);
  }, [documentState.pushGesture, documentState.shape.id]);
  const undo = useCallback(() => { documentState.undo(); setSelection(NONE); }, [documentState.undo]);
  const redo = useCallback(() => { documentState.redo(); setSelection(NONE); }, [documentState.redo]);
  const canUndo = documentState.canUndo, canRedo = documentState.canRedo;

  const setFill = useCallback((fill: string) => commit({ ...shape, fill }), [commit, shape]);

  // a wave regenerated elsewhere (undo / redo) keeps the wave controls in sync
  useEffect(() => { if (shape.wave) setWaveParams(shape.wave); }, [shape.wave]);

  /* ───── selection → open the precision panel ───── */
  useEffect(() => {
    if (selection.kind === 'none') return;
    if (isNarrow) {
      if (!dockOpen && autoDock.current) { setTab('node'); setDockOpen(true); }
      else if (dockOpen && tab === 'shape') setTab('node');
    } else if (tab === 'shape') setTab('node');
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ───── keyboard ───── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'a') { e.preventDefault(); setSelection(selectAllNodes(shape)); setMultiSelect(true); return; }
      if (mod) return;
      if (k === 'v') setTool('Select'); else if (k === 'p') setTool('Pen'); else if (k === 'h') setTool('Hand');
      else if (k === '0') stageRef.current?.fit(); else if (k === '1') stageRef.current?.reset();
      else if (k === '=' || k === '+') stageRef.current?.zoomIn(); else if (k === '-') stageRef.current?.zoomOut();
      else if (k === 'escape') setSelection(NONE);
      else if ((k === 'backspace' || k === 'delete') && selectedIndices(selection).length > 0) {
        const indices = selectedIndices(selection);
        if (indices.length > 1) {
          const result = deleteNodes(shape, indices);
          if (!result.shape) announce('A shape needs at least ' + (shape.closed ? 3 : 2) + ' nodes');
          else {
            if (result.removed) commit(result.shape, NONE);
            if (result.skipped) announce(`${result.skipped} locked node${result.skipped > 1 ? 's' : ''} kept`);
          }
        } else {
          const next = deleteNode(shape, indices[0]);
          if (next) commit(next, NONE);
          else announce('A shape needs at least ' + (shape.closed ? 3 : 2) + ' nodes');
        }
      } else if (k.startsWith('arrow') && selectedIndices(selection).length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
        const indices = selectedIndices(selection);
        commit(indices.length > 1 ? moveNodesBy(shape, shape, indices, dx, dy) : nudgeNode(shape, indices[0], dx, dy), selection);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selection, shape, commit, announce]);

  const pickShape = (id: string) => {
    const target = page.shapes.find(s => s.id === id);
    if (target?.hidden) documentState.apply(d => patchShape(d, id, { hidden: false }));
    documentState.navigate(d => selectShape(d, id));
    setSelection(NONE);
  };
  const openPage = (id: string) => {
    documentState.navigate(d => selectPage(d, id));
    setSelection(NONE);
  };

  /* ───── generators ───── */
  const applyWave = useCallback((p: WaveParams, mode: 'live' | 'apply') => {
    const w = clampWave(p);
    setWaveParams(w);
    const next = buildWaveShape(w, shape.fill);
    if (mode === 'live') {
      if (waveAddedPreview.current) documentState.preview(next);
      else if (!shape.wave) {
        documentState.apply(d => addShape(d, next));
        waveAddedPreview.current = true;
        setSelection(NONE);
      } else live(next);
      return;
    }
    waveAddedPreview.current = false;
    if (shape.wave) commit(next);
    else documentState.apply(d => addShape(d, next));
    setSelection(NONE);
  }, [shape, live, commit, documentState.apply, documentState.preview]);

  const openTab = (t: Tab) => { setTab(t); if (isNarrow) { setDockOpen(true); autoDock.current = true; } };
  const generate = (name: string) => {
    if (name === 'Wave') {
      const params = shape.wave ?? DEFAULT_WAVE;
      setWaveParams(params);
      documentState.apply(d => addShape(d, buildWaveShape(params, shape.fill)));
      setTolerance(t => Math.min(t, 1)); openTab('wave'); setSheet(null); setTool('Select'); setSelection(NONE); return;
    }
    const next = makeShape(name, seed);
    documentState.apply(d => addShape(d, next)); setSelection(NONE); setTool('Select'); setSheet(null);
  };
  const mergeSelectedShapes = (ids: string[]) => {
    const selected = page.shapes.filter(item => ids.includes(item.id ?? ''));
    if (selected.some(item => !item.closed || item.derived)) {
      announce('Only closed, non-derived shapes can be unified');
      return;
    }
    try {
      const merged = unifyShapes(selected);
      if (!merged) { announce('Select at least two closed shapes to unify'); return; }
      documentState.apply(d => replaceShapesWithUnion(d, selected.map(item => item.id!), merged));
      setSelection(NONE);
      announce(`Unified ${selected.length} shapes`);
    } catch (error) {
      console.error('Could not unify selected shapes', error);
      announce('Could not unify these shapes. Check for invalid geometry and try again.');
    }
  };
  const randomize = () => { const n = seed + 17; setSeed(n); documentState.apply(d => addShape(d, makeShape('Blob', n))); setSelection(NONE); setSheet(null); announce('New seed · ' + n); };
  const reset = () => { documentState.apply(d => addShape(d, makeShape('Blob', 23))); setFormat('SVG'); setSelection(NONE); announce('New shape added to page'); };
  const convert = () => {
    if (shape.kind === 'polygon') { commit({ ...shape, kind: 'path', name: `${shape.name} · path`, points: shape.points.map(p => ({ ...p, mode: 'corner' as const })) }); announce('Polygon converted to an exact path'); }
    else { commit({ ...shape, kind: 'polygon', points: simplify(samplePath(shape.points, shape.closed), tolerance), name: `${shape.name} · polygon`, wave: undefined }); announce('Path converted to editable polygon'); }
    setSelection(NONE);
  };

  /* ───── export ───── */
  const deferredShape = useDeferredValue(shape);
  const deferredPage = useDeferredValue(page);
  const wantCode = !isPhone || sheet === 'code';
  const code = useMemo(() => (wantCode ? format === 'PAGE SVG'
    ? exportPageSvg(deferredPage.shapes, precision, deferredPage)
    : exportCode(deferredShape, format, precision, tolerance, unit, deferredPage) : ''), [wantCode, deferredPage, deferredShape, format, precision, tolerance, unit]);
  const polygonPoints = useMemo(() => (format === 'POLYGON' && deferredShape.kind === 'path' ? simplify(samplePath(deferredShape.points, deferredShape.closed, 12), tolerance).map(p => `${p.x},${p.y}`).join(' ') : null), [format, deferredShape, tolerance]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); announce('Copied to clipboard'); setTimeout(() => setCopied(false), 1500); }
    catch { announce('Clipboard unavailable in this browser'); }
  };
  const download = () => {
    const ext = format === 'JSON' ? 'json' : format === 'SVG' || format === 'PAGE SVG' ? 'svg' : format === 'REACT' ? 'tsx' : format === 'HTML + CSS' ? 'html' : 'txt';
    const blob = new Blob([code], { type: ext === 'json' ? 'application/json' : 'text/plain' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `shapeforge.${ext}`; link.click(); URL.revokeObjectURL(link.href);
    announce('Export downloaded');
  };
  const saveJson = () => {
    const content = exportCode(shape, 'JSON', precision, tolerance, unit);
    const blob = new Blob([content], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'shapeforge-shape.json'; link.click(); URL.revokeObjectURL(link.href);
    announce('Shape saved as JSON');
  };
  const showCode = () => { if (isPhone) setSheet('code'); else document.getElementById('output-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };

  /* ───── panels ───── */
  const panelProps = { shape, settings, setSettings, onCommit: commit, announce };
  const renderTab = (t: Tab) => {
    if (t === 'page') return <PagePanel page={page} shapeId={shape.id!}
      onSelect={pickShape}
      onAdd={name => generate(name)}
      onPatch={(id, patch) => documentState.apply(d => patchShape(d, id, patch))}
      onDuplicate={id => documentState.apply(d => duplicateShape(d, id))}
      onDelete={id => { documentState.apply(d => removeShape(d, id)); setSelection(NONE); }}
      onMove={(id, dir) => documentState.apply(d => moveShape(d, id, dir))} />;
    if (t === 'node') return <PrecisionPanel {...panelProps} selection={selection} onSelect={setSelection} />;
    if (t === 'shape') return <ShapePanel {...panelProps} fill={shape.fill} setFill={setFill} tolerance={tolerance} setTolerance={setTolerance} precision={precision} setPrecision={setPrecision} unit={unit} setUnit={setUnit} shapes={page.shapes} onUnify={mergeSelectedShapes} />;
    if (t === 'wave') return <WavePanel params={waveParams} active={!!shape.wave} fill={shape.fill} setFill={setFill} unit={unit} setUnit={setUnit} onLive={p => applyWave(p, 'live')} onLiveEnd={() => { if (waveAddedPreview.current) waveAddedPreview.current = false; else liveEnd(); }} onApply={p => applyWave(p, 'apply')} />;
    if (t === 'outer') return <BoundaryPanel shape={shape} precision={precision} onApply={s => { commit(s); setSelection(NONE); }} onLive={s => { live(s); setSelection(NONE); }} onLiveEnd={liveEnd} announce={announce} />;
    return <EditorPanel settings={settings} set={setSettings} />;
  };
  const tabBar = (cls: string) => <div className={cls} role="tablist" aria-label="Editor panels">
    {TABS.map(x => <button key={x.id} role="tab" aria-selected={tab === x.id} className={`ptab ${tab === x.id ? 'active' : ''}`} onClick={() => setTab(x.id)} data-testid={`tab-panel-${x.id}`}>{x.label}</button>)}
  </div>;

  const outputContent = <>
    <div className="output-top">
      <div className="tabs" role="tablist" aria-label="Export format">{FORMATS.map(item => <button key={item} role="tab" aria-selected={format === item} className={`tab ${format === item ? 'active' : ''}`} onClick={() => setFormat(item)} data-testid={`tab-${item.toLowerCase().replaceAll(' ', '-')}`}>{item}</button>)}</div>
      <div className="output-actions">
        <button className="btn" onClick={download} title="Download current export" data-testid="button-download"><Download /> <span className="desktop-action">Download</span></button>
        <button className="btn primary" onClick={copyCode} data-testid="button-copy">{copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}</button>
        <button type="button" className="icon-btn output-collapse" aria-label={outputCollapsed ? 'Expand output panel' : 'Collapse output panel'} aria-expanded={!outputCollapsed} title={outputCollapsed ? 'Expand output' : 'Collapse output'} onClick={() => setOutputCollapsed(value => !value)} data-testid="button-collapse-output">
          {outputCollapsed ? <PanelBottomOpen /> : <PanelBottomClose />}
        </button>
      </div>
    </div>
    <div className="output-body"><pre className="code" data-testid="code-output">{code}</pre></div>
  </>;

  const toolsContent = <div>
    <div className="panel-heading">Tools <span>01—04</span></div>
    <div className="section-label">DRAW</div>
    <div className="tool-list">
      {([['Select', MousePointer2], ['Pen', PenTool], ['Hand', Hand]] as const).map(([name, Icon]) => <button key={name} className={`tool-button ${tool === name ? 'active' : ''}`} onClick={() => { setTool(name); setSheet(null); }} data-testid={`tool-${name.toLowerCase()}`}><Icon /><span className="tool-label">{name}</span></button>)}
    </div>
    <div className="section-label">GENERATE</div>
    <div className="tool-list">
      <button className="tool-button" onClick={() => generate('Wave')} data-testid="tool-wave"><Waves /><span className="tool-label">Wave maker</span></button>
      <button className="tool-button" onClick={randomize} data-testid="tool-random-blob"><Sparkles /><span className="tool-label">Random blob</span></button>
      <button className="tool-button" onClick={() => { openTab('outer'); setSheet(null); }} data-testid="tool-outer"><ScanLine /><span className="tool-label">Outer shape</span></button>
    </div>
    <div className="section-label">SHAPE LIBRARY</div>
    <div className="library-grid">{LIBRARY.map(item => <button key={item} className="library-item" onClick={() => generate(item)} data-testid={`library-${item.toLowerCase().replaceAll(' ', '-')}`}><svg viewBox="0 0 1000 600" aria-hidden="true"><path d={makeShape(item).points.map((point, i) => `${i ? 'L' : 'M'}${point.x} ${point.y}`).join(' ') + ' Z'} /></svg>{item}</button>)}</div>
    <div className="section-label">MODIFY</div>
    <div className="tool-list">
      <button className="tool-button" onClick={() => { setSelection({ kind: 'shape' }); setTool('Select'); setSheet(null); }} data-testid="tool-transform"><Move /><span className="tool-label">Transform shape</span></button>
      <button className="tool-button" onClick={() => { convert(); setSheet(null); }} data-testid="tool-convert"><Crosshair /><span className="tool-label">Path ↔ polygon</span></button>
      <button className="tool-button" onClick={() => { commit({ ...shape, closed: !shape.closed, name: shape.closed ? 'Open path' : shape.name }); setSheet(null); }} data-testid="tool-close-path"><Plus /><span className="tool-label">{shape.closed ? 'Open path' : 'Close path'}</span></button>
    </div>
    <p className="hint" style={{ margin: '16px 8px' }}>Add and edit shapes across pages. Geometry stays editable as you work.</p>
  </div>;

  const hint = tool === 'Hand' ? 'DRAG TO PAN' : tool === 'Pen' ? 'TAP = NODE · DRAG = CURVE' : isNarrow ? 'PINCH ZOOM · TWO FINGERS PAN' : 'CTRL+WHEEL ZOOM · SPACE+DRAG PAN';

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Shapes /></div>ShapeForge<span className="brand-tag">SHAPE STUDIO / 01</span></div>
      <div className="top-actions">
        <div className="action-group">
          <button className="btn quiet desktop-action" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" data-testid="button-undo"><Undo2 /></button>
          <button className="btn quiet desktop-action" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" data-testid="button-redo"><Redo2 /></button>
            <button className="btn quiet page-settings-trigger" onClick={() => setPageSettingsOpen(true)} aria-label="Page settings" title="Page settings" data-testid="button-page-settings"><SlidersHorizontal /></button>
        </div>
        <button className="btn desktop-action" onClick={reset} data-testid="button-new"><Plus /> New</button>
        <button className="btn desktop-action" onClick={saveJson} data-testid="button-save"><ArrowDownToLine /> Save</button>
        <button className="btn gradient-btn" onClick={openStudio} data-testid="button-create-gradient"><Palette /><span><span className="cg-long">Create </span>Gradient</span></button>
        <button className="btn primary" onClick={showCode} data-testid="button-export"><Code2 /> Export</button>
      </div>
    </header>
    <section className="workspace">
      {!isPhone && <aside className="left-panel" aria-label="Shape tools">{toolsContent}</aside>}
      <section className="canvas-column" aria-label="Shape preview">
        <div className="canvas-toolbar">
          <div className="canvas-meta"><span className="live-dot" /><span>ARTBOARD</span><span style={{ color: '#58636e' }}>/</span><span>{page.width} × {page.height} {page.unit}</span></div>
          <div className="canvas-actions">
            <button className={`icon-btn ${settings.snapOn ? 'active' : ''}`} aria-label="Toggle snapping" aria-pressed={settings.snapOn} title="Snapping" onClick={() => setSettings({ snapOn: !settings.snapOn })} data-testid="button-toggle-snap"><Magnet /></button>
            <button className={`icon-btn ${grid ? 'active' : ''}`} aria-label="Toggle grid" title="Toggle grid" onClick={() => setGrid(!grid)} data-testid="button-toggle-grid"><Grid2X2 /></button>
            <button className={`icon-btn ${selection.kind === 'shape' ? 'active' : ''}`} aria-label="Transform whole shape" title="Transform shape" onClick={() => { setSelection(selection.kind === 'shape' ? NONE : { kind: 'shape' }); setTool('Select'); }} data-testid="button-transform"><Move /></button>
            <button className="icon-btn" aria-label="Undo" title="Undo" onClick={undo} disabled={!canUndo} data-testid="button-undo-canvas"><Undo2 /></button>
            <button className="icon-btn" aria-label="Redo" title="Redo" onClick={redo} disabled={!canRedo} data-testid="button-redo-canvas"><Redo2 /></button>
          </div>
        </div>
        <PageTabs pages={doc.pages} pageId={page.id} onSelect={openPage}
          onAdd={() => { documentState.apply(d => addPage(d)); setSelection(NONE); }}
          onRename={(id, name) => documentState.apply(d => renamePage(d, id, name))}
          onDelete={id => { documentState.apply(d => removePage(d, id)); setSelection(NONE); }} />
        <div className="artboard-wrap">
          <Stage ref={stageRef} shape={shape} others={page.shapes.filter(s => s.id !== shape.id)} shapeOrder={page.shapes.map(s => s.id!)} tool={tool} selection={selection} settings={settings} showGrid={grid} polygonPoints={polygonPoints} multiSelect={multiSelect} onMultiSelect={setMultiSelect} pageBackground={page.background}
            onSelect={setSelection} onPreview={documentState.preview} onGestureEnd={finishGesture} onCommit={commit}
            onPickShape={pickShape} onAddShape={(next, sel) => { documentState.apply(d => addShape(d, next)); if (sel) setSelection(sel); }} onAnnounce={announce} />
        </div>
        <div className="canvas-foot"><span>{hint}</span><span>{shape.kind.toUpperCase()} · {shape.points.length} POINTS</span></div>
      </section>
      {!isNarrow && <aside className="right-panel" aria-label="Shape properties">{tabBar('panel-tabs')}<div className="panel-body">{renderTab(tab)}</div></aside>}
    </section>
    {isNarrow && dockOpen && <section className={`dock ${dockTall ? 'tall' : ''}`} aria-label="Editor panel">
      <div className="dock-bar">
        {tabBar('dock-tabs')}
        <button className="icon-btn" onClick={() => setDockTall(!dockTall)} aria-label={dockTall ? 'Shrink panel' : 'Expand panel'} data-testid="dock-size"><ChevronUp style={{ transform: dockTall ? 'rotate(180deg)' : undefined }} /></button>
        <button className="icon-btn" onClick={() => { setDockOpen(false); autoDock.current = false; }} aria-label="Close panel" data-testid="dock-close"><X /></button>
      </div>
      <div className="dock-body">{renderTab(tab)}</div>
    </section>}
    <nav className="mobile-tools" aria-label="Editing controls">
      {([['Select', MousePointer2], ['Pen', PenTool], ['Hand', Hand]] as const).map(([name, Icon]) => <button key={name} className={`mt-btn ${tool === name ? 'active' : ''}`} onClick={() => setTool(name)} aria-pressed={tool === name} data-testid={`mobile-tool-${name.toLowerCase()}`}><Icon /><span>{name}</span></button>)}
      <i className="mt-sep" />
      <button className="mt-btn" onClick={undo} disabled={!canUndo} data-testid="button-mobile-undo"><Undo2 /><span>Undo</span></button>
      <button className="mt-btn" onClick={redo} disabled={!canRedo} data-testid="button-mobile-redo"><Redo2 /><span>Redo</span></button>
      <i className="mt-sep" />
      <button className={`mt-btn ${dockOpen && tab === 'node' ? 'active' : ''}`} onClick={() => { if (dockOpen && tab === 'node') { setDockOpen(false); autoDock.current = false; } else { setTab('node'); setDockOpen(true); autoDock.current = true; } }} data-testid="button-open-node"><Crosshair /><span>Node</span></button>
      <button className="mt-btn" onClick={() => setSheet(sheet === 'tools' ? null : 'tools')} data-testid="button-open-tools"><Shapes /><span>Shapes</span></button>
      <button className={`mt-btn ${dockOpen && tab !== 'node' ? 'active' : ''}`} onClick={() => { if (dockOpen && tab !== 'node') { setDockOpen(false); autoDock.current = false; } else { setTab(tab === 'node' ? 'shape' : tab); setDockOpen(true); } }} data-testid="button-open-properties"><SlidersHorizontal /><span>Edit</span></button>
      <button className="mt-btn accent" onClick={() => setSheet(sheet === 'code' ? null : 'code')} data-testid="button-mobile-copy"><Code2 /><span>Code</span></button>
    </nav>
    {!isPhone && <section className={`output-panel ${outputCollapsed ? 'is-collapsed' : ''}`} id="output-panel" aria-label="Code output">{outputContent}</section>}
    {sheet && <div className="sheet-backdrop" onClick={() => setSheet(null)} role="presentation"><section className={`mobile-sheet ${sheet === 'code' ? 'code-sheet' : ''}`} role="dialog" aria-modal="true" aria-label={sheet === 'tools' ? 'Shape tools' : 'Code output'} onClick={e => e.stopPropagation()}><div className="sheet-grab" /><button className="icon-btn sheet-close" onClick={() => setSheet(null)} aria-label="Close panel" data-testid="button-close-sheet"><X /></button>{sheet === 'tools' ? toolsContent : <div className="mobile-code-sheet">{outputContent}</div>}</section></div>}
    {toast && <div className="toast-note" role="status" data-testid="status-toast">{toast}</div>}
    {pageSettingsOpen && <PageSettings key={page.id} page={page} onClose={() => setPageSettingsOpen(false)} onSave={settings => documentState.apply(d => patchPage(d, page.id, settings))} />}
    {studio && <Suspense fallback={<div className="gs-loading" role="status">Loading Gradient Studio…</div>}>
      <GradientStudio onClose={closeStudio} initial={shape.paint?.project ?? null} shapeName={shape.name} hasPaint={!!shape.paint}
        onApply={(project, o) => { commit({ ...shape, paint: { project, ...o } }); announce(`Gradient applied to “${shape.name}”`); closeStudio(); }}
        onRemovePaint={() => { commit({ ...shape, paint: undefined }); announce('Gradient removed'); closeStudio(); }} />
    </Suspense>}
  </main>;
}

export default App;
