import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, Check, ChevronUp, Code2, Copy, Download, Grid2X2, Hand, Magnet, MousePointer2, Move, PenTool, Plus, Redo2, ScanLine, Shapes, SlidersHorizontal,
  Sparkles, Undo2, Waves, X, Crosshair,
} from 'lucide-react';
import { exportCode, makeShape, samplePath, simplify, type ShapeModel, type Unit } from './geometry';
import { NONE, nudgeNode, deleteNode, type Selection, type Tool } from './edit';
import { DEFAULT_WAVE, buildWaveShape, clampWave, type WaveParams } from './wave';
import { loadSettings, saveSettings, type EditorSettings } from './settings';
import Stage, { type StageHandle } from './components/Stage';
import PrecisionPanel from './components/PrecisionPanel';
import ShapePanel from './components/ShapePanel';
import WavePanel from './components/WavePanel';
import BoundaryPanel from './components/BoundaryPanel';
import EditorPanel from './components/EditorPanel';
import './index.css';

const FORMATS = ['SVG', 'SVG PATH', 'CSS PATH', 'POLYGON', 'REACT', 'HTML + CSS', 'JSON'];
const LIBRARY = ['Triangle', 'Diamond', 'Pentagon', 'Hexagon', 'Octagon', 'Star', 'Circle'];
type Tab = 'node' | 'shape' | 'wave' | 'outer' | 'editor';
const TABS: { id: Tab; label: string }[] = [{ id: 'node', label: 'Node' }, { id: 'shape', label: 'Shape' }, { id: 'wave', label: 'Wave' }, { id: 'outer', label: 'Outer' }, { id: 'editor', label: 'Editor' }];

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
  const [shape, setShape] = useState<ShapeModel>(() => makeShape('Blob', 23));
  const [format, setFormat] = useState('SVG');
  const [tool, setTool] = useState<Tool>('Select');
  const [selection, setSelection] = useState<Selection>(NONE);
  const [history, setHistory] = useState<ShapeModel[]>([]);
  const [future, setFuture] = useState<ShapeModel[]>([]);
  const [seed, setSeed] = useState(23);
  const [tolerance, setTolerance] = useState(3);
  const [precision, setPrecision] = useState(1);
  const [fill, setFill] = useState('#69dfb5');
  const [unit, setUnit] = useState<Unit>('%');
  const [grid, setGrid] = useState(true);
  const [settings, setSettingsState] = useState<EditorSettings>(loadSettings);
  const [waveParams, setWaveParams] = useState<WaveParams>(DEFAULT_WAVE);
  const [tab, setTab] = useState<Tab>('shape');
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTall, setDockTall] = useState(false);
  const [sheet, setSheet] = useState<'tools' | 'code' | null>(null);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState(false);

  const isNarrow = useMedia('(max-width: 900px)');
  const isPhone = useMedia('(max-width: 640px)');
  const stageRef = useRef<StageHandle>(null);
  const shapeRef = useRef(shape); shapeRef.current = shape;
  const liveBefore = useRef<ShapeModel | null>(null);
  const autoDock = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSettings = useCallback((patch: Partial<EditorSettings>) => setSettingsState(s => ({ ...s, ...patch })), []);
  useEffect(() => saveSettings(settings), [settings]);

  const announce = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  /* ───── history ───── */
  const pushHistory = useCallback((before: ShapeModel) => { setHistory(h => [...h.slice(-39), before]); setFuture([]); }, []);
  const commit = useCallback((next: ShapeModel, sel?: Selection) => {
    setHistory(h => [...h.slice(-39), shapeRef.current]); setFuture([]); setShape(next);
    if (sel) setSelection(sel);
  }, []);
  /** Streaming edits (sliders): one history entry when the gesture ends. */
  const live = useCallback((next: ShapeModel) => { if (!liveBefore.current) liveBefore.current = shapeRef.current; setShape(next); }, []);
  const liveEnd = useCallback(() => { if (liveBefore.current) { pushHistory(liveBefore.current); liveBefore.current = null; } }, [pushHistory]);

  const undo = useCallback(() => {
    if (!history.length) return;
    setFuture(items => [shape, ...items]); setShape(history[history.length - 1]); setHistory(items => items.slice(0, -1)); setSelection(NONE);
  }, [history, shape]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setHistory(items => [...items, shape]); setShape(future[0]); setFuture(items => items.slice(1)); setSelection(NONE);
  }, [future, shape]);

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
      if (mod) return;
      if (k === 'v') setTool('Select'); else if (k === 'p') setTool('Pen'); else if (k === 'h') setTool('Hand');
      else if (k === '0') stageRef.current?.fit(); else if (k === '1') stageRef.current?.reset();
      else if (k === '=' || k === '+') stageRef.current?.zoomIn(); else if (k === '-') stageRef.current?.zoomOut();
      else if (k === 'escape') setSelection(NONE);
      else if ((k === 'backspace' || k === 'delete') && (selection.kind === 'node' || selection.kind === 'handle')) {
        const next = deleteNode(shape, selection.index);
        if (next) { commit(next, NONE); } else announce('A shape needs at least ' + (shape.closed ? 3 : 2) + ' nodes');
      } else if (k.startsWith('arrow') && (selection.kind === 'node' || selection.kind === 'handle')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
        commit(nudgeNode(shape, selection.index, dx, dy), selection);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selection, shape, commit, announce]);

  /* ───── generators ───── */
  const applyWave = useCallback((p: WaveParams, mode: 'live' | 'apply') => {
    const w = clampWave(p);
    setWaveParams(w); setSelection(NONE);
    const next = buildWaveShape(w, fill);
    mode === 'live' ? live(next) : commit(next);
  }, [fill, live, commit]);

  const openTab = (t: Tab) => { setTab(t); if (isNarrow) { setDockOpen(true); autoDock.current = true; } };
  const generate = (name: string) => {
    if (name === 'Wave') { applyWave(shape.wave ?? DEFAULT_WAVE, 'apply'); setTolerance(t => Math.min(t, 1)); openTab('wave'); setSheet(null); setTool('Select'); return; }
    const next = makeShape(name, seed);
    commit(next); setFill(next.fill); setSelection(NONE); setTool('Select'); setSheet(null);
  };
  const randomize = () => { const n = seed + 17; setSeed(n); commit(makeShape('Blob', n)); setSelection(NONE); setSheet(null); announce('New seed · ' + n); };
  const reset = () => { commit(makeShape('Blob', 23)); setFill('#69dfb5'); setFormat('SVG'); setSelection(NONE); announce('New shape created'); };
  const convert = () => {
    if (shape.kind === 'polygon') { commit({ ...shape, kind: 'path', name: `${shape.name} · path`, points: shape.points.map(p => ({ ...p, mode: 'corner' as const })) }); announce('Polygon converted to an exact path'); }
    else { commit({ ...shape, kind: 'polygon', points: simplify(samplePath(shape.points, shape.closed), tolerance), name: `${shape.name} · polygon`, wave: undefined }); announce('Path converted to editable polygon'); }
    setSelection(NONE);
  };

  /* ───── export ───── */
  const deferredShape = useDeferredValue(shape);
  const wantCode = !isPhone || sheet === 'code';
  const code = useMemo(() => (wantCode ? exportCode({ ...deferredShape, fill }, format, precision, tolerance, unit) : ''), [wantCode, deferredShape, fill, format, precision, tolerance, unit]);
  const polygonPoints = useMemo(() => (format === 'POLYGON' && deferredShape.kind === 'path' ? simplify(samplePath(deferredShape.points, deferredShape.closed, 12), tolerance).map(p => `${p.x},${p.y}`).join(' ') : null), [format, deferredShape, tolerance]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); announce('Copied to clipboard'); setTimeout(() => setCopied(false), 1500); }
    catch { announce('Clipboard unavailable in this browser'); }
  };
  const download = () => {
    const ext = format === 'JSON' ? 'json' : format === 'SVG' ? 'svg' : format === 'REACT' ? 'tsx' : format === 'HTML + CSS' ? 'html' : 'txt';
    const blob = new Blob([code], { type: ext === 'json' ? 'application/json' : 'text/plain' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `shapeforge.${ext}`; link.click(); URL.revokeObjectURL(link.href);
    announce('Export downloaded');
  };
  const saveJson = () => {
    const content = exportCode({ ...shape, fill }, 'JSON', precision, tolerance, unit);
    const blob = new Blob([content], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'shapeforge-shape.json'; link.click(); URL.revokeObjectURL(link.href);
    announce('Shape saved as JSON');
  };
  const showCode = () => { if (isPhone) setSheet('code'); else document.getElementById('output-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };

  /* ───── panels ───── */
  const panelProps = { shape, settings, setSettings, onCommit: commit, announce };
  const renderTab = (t: Tab) => {
    if (t === 'node') return <PrecisionPanel {...panelProps} selection={selection} onSelect={setSelection} />;
    if (t === 'shape') return <ShapePanel {...panelProps} fill={fill} setFill={setFill} tolerance={tolerance} setTolerance={setTolerance} precision={precision} setPrecision={setPrecision} unit={unit} setUnit={setUnit} />;
    if (t === 'wave') return <WavePanel params={waveParams} active={!!shape.wave} fill={fill} setFill={setFill} unit={unit} setUnit={setUnit} onLive={p => applyWave(p, 'live')} onLiveEnd={liveEnd} onApply={p => applyWave(p, 'apply')} />;
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
    <div className="library-grid">{LIBRARY.map((item, i) => <button key={item} className="library-item" onClick={() => generate(item)} data-testid={`library-${item.toLowerCase()}`}><Shapes style={{ transform: `rotate(${i * 9}deg)` }} />{item}</button>)}</div>
    <div className="section-label">MODIFY</div>
    <div className="tool-list">
      <button className="tool-button" onClick={() => { setSelection({ kind: 'shape' }); setTool('Select'); setSheet(null); }} data-testid="tool-transform"><Move /><span className="tool-label">Transform shape</span></button>
      <button className="tool-button" onClick={() => { convert(); setSheet(null); }} data-testid="tool-convert"><Crosshair /><span className="tool-label">Path ↔ polygon</span></button>
      <button className="tool-button" onClick={() => { commit({ ...shape, closed: !shape.closed, name: shape.closed ? 'Open path' : shape.name }); setSheet(null); }} data-testid="tool-close-path"><Plus /><span className="tool-label">{shape.closed ? 'Open path' : 'Close path'}</span></button>
    </div>
    <p className="hint" style={{ margin: '16px 8px' }}>One shape. Every format. Geometry stays editable as you work.</p>
  </div>;

  const hint = tool === 'Hand' ? 'DRAG TO PAN' : tool === 'Pen' ? 'TAP = NODE · DRAG = CURVE' : isNarrow ? 'PINCH ZOOM · TWO FINGERS PAN' : 'CTRL+WHEEL ZOOM · SPACE+DRAG PAN';

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Shapes /></div>ShapeForge<span className="brand-tag">SHAPE STUDIO / 01</span></div>
      <div className="top-actions">
        <div className="action-group">
          <button className="btn quiet desktop-action" onClick={undo} disabled={!history.length} aria-label="Undo" title="Undo (Ctrl+Z)" data-testid="button-undo"><Undo2 /></button>
          <button className="btn quiet desktop-action" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" data-testid="button-redo"><Redo2 /></button>
        </div>
        <button className="btn desktop-action" onClick={reset} data-testid="button-new"><Plus /> New</button>
        <button className="btn desktop-action" onClick={saveJson} data-testid="button-save"><ArrowDownToLine /> Save</button>
        <button className="btn primary" onClick={showCode} data-testid="button-export"><Code2 /> Export</button>
      </div>
    </header>
    <section className="workspace">
      {!isPhone && <aside className="left-panel" aria-label="Shape tools">{toolsContent}</aside>}
      <section className="canvas-column" aria-label="Shape preview">
        <div className="canvas-toolbar">
          <div className="canvas-meta"><span className="live-dot" /><span>ARTBOARD</span><span style={{ color: '#58636e' }}>/</span><span>1000 × 600</span></div>
          <div className="canvas-actions">
            <button className={`icon-btn ${settings.snapOn ? 'active' : ''}`} aria-label="Toggle snapping" aria-pressed={settings.snapOn} title="Snapping" onClick={() => setSettings({ snapOn: !settings.snapOn })} data-testid="button-toggle-snap"><Magnet /></button>
            <button className={`icon-btn ${grid ? 'active' : ''}`} aria-label="Toggle grid" title="Toggle grid" onClick={() => setGrid(!grid)} data-testid="button-toggle-grid"><Grid2X2 /></button>
            <button className={`icon-btn ${selection.kind === 'shape' ? 'active' : ''}`} aria-label="Transform whole shape" title="Transform shape" onClick={() => { setSelection(selection.kind === 'shape' ? NONE : { kind: 'shape' }); setTool('Select'); }} data-testid="button-transform"><Move /></button>
            <button className="icon-btn" aria-label="Undo" title="Undo" onClick={undo} disabled={!history.length} data-testid="button-undo-canvas"><Undo2 /></button>
            <button className="icon-btn" aria-label="Redo" title="Redo" onClick={redo} disabled={!future.length} data-testid="button-redo-canvas"><Redo2 /></button>
          </div>
        </div>
        <div className="artboard-wrap">
          <Stage ref={stageRef} shape={shape} fill={fill} tool={tool} selection={selection} settings={settings} showGrid={grid} polygonPoints={polygonPoints}
            onSelect={setSelection} onPreview={setShape} onGestureEnd={pushHistory} onCommit={commit} />
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
      <button className="mt-btn" onClick={undo} disabled={!history.length} data-testid="button-mobile-undo"><Undo2 /><span>Undo</span></button>
      <button className="mt-btn" onClick={redo} disabled={!future.length} data-testid="button-mobile-redo"><Redo2 /><span>Redo</span></button>
      <i className="mt-sep" />
      <button className={`mt-btn ${dockOpen && tab === 'node' ? 'active' : ''}`} onClick={() => { if (dockOpen && tab === 'node') { setDockOpen(false); autoDock.current = false; } else { setTab('node'); setDockOpen(true); autoDock.current = true; } }} data-testid="button-open-node"><Crosshair /><span>Node</span></button>
      <button className="mt-btn" onClick={() => setSheet(sheet === 'tools' ? null : 'tools')} data-testid="button-open-tools"><Shapes /><span>Shapes</span></button>
      <button className={`mt-btn ${dockOpen && tab !== 'node' ? 'active' : ''}`} onClick={() => { if (dockOpen && tab !== 'node') { setDockOpen(false); autoDock.current = false; } else { setTab(tab === 'node' ? 'shape' : tab); setDockOpen(true); } }} data-testid="button-open-properties"><SlidersHorizontal /><span>Edit</span></button>
      <button className="mt-btn accent" onClick={() => setSheet(sheet === 'code' ? null : 'code')} data-testid="button-mobile-copy"><Code2 /><span>Code</span></button>
    </nav>
    {!isPhone && <section className="output-panel" id="output-panel" aria-label="Code output">{outputContent}</section>}
    {sheet && <div className="sheet-backdrop" onClick={() => setSheet(null)} role="presentation"><section className={`mobile-sheet ${sheet === 'code' ? 'code-sheet' : ''}`} role="dialog" aria-modal="true" aria-label={sheet === 'tools' ? 'Shape tools' : 'Code output'} onClick={e => e.stopPropagation()}><div className="sheet-grab" /><button className="icon-btn sheet-close" onClick={() => setSheet(null)} aria-label="Close panel" data-testid="button-close-sheet"><X /></button>{sheet === 'tools' ? toolsContent : <div className="mobile-code-sheet">{outputContent}</div>}</section></div>}
    {toast && <div className="toast-note" role="status" data-testid="status-toast">{toast}</div>}
  </main>;
}

export default App;
