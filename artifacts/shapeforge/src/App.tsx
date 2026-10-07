import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Check, Code2, Copy, Download, Grid2X2, MousePointer2, Pentagon, Plus, Redo2, RotateCcw, Scissors, Shapes, SlidersHorizontal, Sparkles, Undo2, Waves, X } from 'lucide-react';
import { exportCode, getHandles, makeShape, pathFromPoints, samplePath, simplify, W, H, type Point, type ShapeModel } from './geometry';
import './index.css';

const FORMATS = ['SVG', 'SVG PATH', 'CSS PATH', 'POLYGON', 'REACT', 'HTML + CSS', 'JSON'];
const LIBRARY = ['Triangle', 'Diamond', 'Pentagon', 'Hexagon', 'Octagon', 'Star', 'Circle'];

function App() {
  const [shape, setShape] = useState<ShapeModel>(() => makeShape('Blob', 23));
  const [format, setFormat] = useState('SVG');
  const [tool, setTool] = useState('Select');
  const [selected, setSelected] = useState<number | null>(null);
  const [history, setHistory] = useState<ShapeModel[]>([]);
  const [future, setFuture] = useState<ShapeModel[]>([]);
  const [seed, setSeed] = useState(23);
  const [amplitude, setAmplitude] = useState(115);
  const [cycles, setCycles] = useState(2);
  const [tolerance, setTolerance] = useState(6);
  const [precision, setPrecision] = useState(1);
  const [fill, setFill] = useState('#69dfb5');
  const [grid, setGrid] = useState(true);
  const [sheet, setSheet] = useState<'tools' | 'properties' | 'code' | null>(null);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIndex = useRef<number | null>(null);
  const dragHandle = useRef<{ index: number; side: 'in' | 'out' } | null>(null);
  const dragStart = useRef<ShapeModel | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const code = useMemo(() => exportCode({ ...shape, fill }, format, precision, tolerance), [shape, fill, format, precision, tolerance]);
  const sampledShape = useMemo(() => shape.kind === 'path' ? samplePath(shape.points, shape.closed) : shape.points, [shape]);
  const simplified = useMemo(() => simplify(sampledShape, tolerance), [sampledShape, tolerance]);

  const announce = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1900);
  }, []);
  const commit = useCallback((next: ShapeModel) => {
    setHistory(items => [...items.slice(-39), shape]);
    setFuture([]);
    setShape(next);
  }, [shape]);
  const update = useCallback((patch: Partial<ShapeModel>) => commit({ ...shape, ...patch }), [commit, shape]);
  const undo = useCallback(() => {
    if (!history.length) return;
    setFuture(items => [shape, ...items]);
    setShape(history[history.length - 1]);
    setHistory(items => items.slice(0, -1));
    setSelected(null);
  }, [history, shape]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setHistory(items => [...items, shape]);
    setShape(future[0]);
    setFuture(items => items.slice(1));
    setSelected(null);
  }, [future, shape]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selected !== null && shape.points.length > 3) {
        commit({ ...shape, points: shape.points.filter((_, i) => i !== selected) });
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selected, shape, commit]);

  const generate = (name: string, nextSeed = seed) => {
    const next = makeShape(name, nextSeed);
    if (name === 'Wave') next.points = Array.from({ length: 13 }, (_, i) => ({ x: 35 + i * 77.5, y: 300 + Math.sin(i / 12 * Math.PI * 2 * cycles) * amplitude }));
    commit(next); setFill(next.fill); setSelected(null); setTool('Select'); setSheet(null);
  };
  const randomize = () => { const next = seed + 17; setSeed(next); generate('Blob', next); announce('New seed · ' + next); };
  const pointAt = (e: React.PointerEvent<SVGSVGElement>): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(W, (e.clientX - rect.left) / rect.width * W)), y: Math.max(0, Math.min(H, (e.clientY - rect.top) / rect.height * H)) };
  };
  const startDrag = (e: React.PointerEvent<SVGCircleElement>, index: number) => {
    e.stopPropagation(); e.preventDefault(); setSelected(index);
    dragIndex.current = index; dragStart.current = shape;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const movePoint = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragHandle.current !== null) {
      const { index, side } = dragHandle.current, p = pointAt(e);
      setShape(current => ({ ...current, points: current.points.map((pt, i) => {
        if (i !== index) return pt;
        const opposite = side === 'in' ? 'out' : 'in';
        return { ...pt, [side]: p, [opposite]: { x: 2 * pt.x - p.x, y: 2 * pt.y - p.y } };
      }) }));
      return;
    }
    if (dragIndex.current === null) return;
    const p = pointAt(e);
    setShape(current => ({ ...current, points: current.points.map((pt, i) => {
      if (i !== dragIndex.current) return pt;
      const dx = p.x - pt.x, dy = p.y - pt.y;
      return { ...pt, x: p.x, y: p.y, ...(pt.in ? { in: { x: pt.in.x + dx, y: pt.in.y + dy } } : {}), ...(pt.out ? { out: { x: pt.out.x + dx, y: pt.out.y + dy } } : {}) };
    }) }));
  };
  const endDrag = () => {
    if ((dragIndex.current !== null || dragHandle.current !== null) && dragStart.current) {
      setHistory(items => [...items.slice(-39), dragStart.current!]); setFuture([]);
    }
    dragIndex.current = null; dragHandle.current = null; dragStart.current = null;
  };
  const startHandleDrag = (e: React.PointerEvent<SVGCircleElement>, index: number, side: 'in' | 'out') => {
    e.stopPropagation(); e.preventDefault(); setSelected(index);
    dragHandle.current = { index, side }; dragStart.current = shape;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onBoardDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool !== 'Pen') return;
    const p = pointAt(e);
    const continuing = shape.name === 'Custom path' && shape.kind === 'path' && !shape.closed;
    const points = continuing ? [...shape.points, p] : [p];
    const index = points.length - 1;
    dragStart.current = shape;
    dragHandle.current = { index, side: 'out' };
    setShape({ ...shape, name: 'Custom path', kind: 'path', points, closed: false });
    setSelected(index);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
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
  const convert = () => {
    if (shape.kind === 'polygon') {
      update({ kind: 'path', name: `${shape.name} · smoothed` });
      announce('Polygon converted to a smooth path');
    } else {
      update({ kind: 'polygon', points: simplify(samplePath(shape.points, shape.closed), tolerance), name: `${shape.name} · polygon` });
      announce('Path converted to editable polygon');
    }
  };
  const toggleClosed = () => update({ closed: !shape.closed, name: shape.closed ? 'Open path' : shape.name });
  const mirror = (axis: 'x' | 'y') => {
    const reflect = (p: Point): Point => axis === 'x' ? { x: W - p.x, y: p.y } : { x: p.x, y: H - p.y };
    const pts = shape.points.map(p => ({ ...p, ...reflect(p), ...(p.out ? { in: reflect(p.out) } : {}), ...(p.in ? { out: reflect(p.in) } : {}) })).reverse();
    commit({ ...shape, points: pts });
  };
  const rotate = () => {
    const cx = shape.points.reduce((a, p) => a + p.x, 0) / shape.points.length, cy = shape.points.reduce((a, p) => a + p.y, 0) / shape.points.length;
    const turn = (p: Point): Point => ({ x: cx - (p.y - cy), y: cy + (p.x - cx) });
    commit({ ...shape, points: shape.points.map(p => ({ ...turn(p), ...(p.in ? { in: turn(p.in) } : {}), ...(p.out ? { out: turn(p.out) } : {}) })) });
  };
  const reset = () => { commit(makeShape('Blob', 23)); setFill('#69dfb5'); setFormat('SVG'); announce('New shape created'); };
  const addPoint = () => { const pts = [...shape.points]; const a = pts[0], b = pts[1] || { x: 700, y: 300 }; pts.splice(1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); commit({ ...shape, points: pts }); setSelected(1); };
  const saveJson = () => {
    const content = exportCode({ ...shape, fill }, 'JSON', precision, tolerance);
    const blob = new Blob([content], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'shapeforge-shape.json'; link.click(); URL.revokeObjectURL(link.href);
    announce('Shape saved as JSON');
  };
  const adjustWave = (key: 'amplitude' | 'cycles', value: number) => {
    if (key === 'amplitude') setAmplitude(value); else setCycles(value);
    const amp = key === 'amplitude' ? value : amplitude, cycleCount = key === 'cycles' ? value : cycles;
    if (shape.name.toLowerCase().includes('wave')) update({ points: Array.from({ length: 13 }, (_, i) => ({ x: 35 + i * 77.5, y: 300 + Math.sin(i / 12 * Math.PI * 2 * cycleCount) * amp })) });
  };

  const showCode = () => {
    if (window.matchMedia('(max-width: 640px)').matches) {
      setSheet('code');
    } else {
      document.getElementById('output-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

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

  const propertyPanel = <div>
    <h2 className="properties-title">Shape properties</h2>
    <div className="property-block">
      <div className="property-head"><span>Geometry</span><small>{shape.points.length} nodes</small></div>
      <label className="field-label" htmlFor="shape-name">Name</label>
      <input className="generate-select" id="shape-name" value={shape.name} onChange={e => update({ name: e.target.value })} data-testid="input-shape-name" />
      <div className="field-row">
        <button className="btn" onClick={convert} data-testid="button-convert">{shape.kind === 'path' ? <Pentagon /> : <Waves />}{shape.kind === 'path' ? 'To polygon' : 'To path'}</button>
        <button className="btn" onClick={toggleClosed} data-testid="button-close-path">{shape.closed ? 'Open path' : 'Close path'}</button>
      </div>
      <p className="hint">Drag an anchor on the artboard to edit geometry. Press Delete to remove a selected node.</p>
    </div>
    {shape.name.toLowerCase().includes('wave') && <div className="property-block">
      <div className="property-head"><span>Wave generator</span><small>procedural</small></div>
      <label className="field-label" htmlFor="wave-amplitude">Amplitude <span>{amplitude}px</span></label>
      <input id="wave-amplitude" type="range" min="20" max="220" value={amplitude} onChange={e => adjustWave('amplitude', Number(e.target.value))} data-testid="range-wave-amplitude" />
      <label className="field-label" htmlFor="wave-cycles" style={{ marginTop: 12 }}>Cycles <span>{cycles}</span></label>
      <input id="wave-cycles" type="range" min="1" max="5" value={cycles} onChange={e => adjustWave('cycles', Number(e.target.value))} data-testid="range-wave-cycles" />
    </div>}
    <div className="property-block">
      <div className="property-head"><span>Transform</span><small>normalized</small></div>
      <div className="field-row">
        <button className="btn" onClick={() => mirror('x')} data-testid="button-flip-x">Flip horizontal</button>
        <button className="btn" onClick={() => mirror('y')} data-testid="button-flip-y">Flip vertical</button>
      </div>
      <div className="field-row">
        <button className="btn" onClick={rotate} data-testid="button-rotate">Rotate 90°</button>
        <button className="btn" onClick={addPoint} data-testid="button-add-node"><Plus /> Add node</button>
      </div>
    </div>
    <div className="property-block">
      <div className="property-head"><span>Appearance</span><small>live preview</small></div>
      <div className="field-label">Fill color <span>{fill}</span></div>
      <div className="swatch-row"><input aria-label="Shape fill color" type="color" value={fill} onChange={e => { setFill(e.target.value); }} data-testid="input-fill-color" /><input className="generate-select" value={fill} onChange={e => setFill(e.target.value)} data-testid="input-fill-hex" /></div>
    </div>
    <div className="property-block">
      <div className="property-head"><span>Polygon conversion</span><small>{shape.points.length} → {simplified.length}</small></div>
      <label className="field-label" htmlFor="tolerance">Simplify tolerance <span>{tolerance}</span></label>
      <input id="tolerance" type="range" min="0" max="30" value={tolerance} onChange={e => setTolerance(Number(e.target.value))} data-testid="range-tolerance" />
      <label className="field-label" htmlFor="precision" style={{ marginTop: 12 }}>Code precision</label>
      <select id="precision" className="generate-select" value={precision} onChange={e => setPrecision(Number(e.target.value))} data-testid="select-precision"><option value="0">0 decimals</option><option value="1">1 decimal</option><option value="2">2 decimals</option><option value="3">3 decimals</option></select>
    </div>
  </div>;

  const toolsContent = <div>
    <div className="panel-heading">Tools <span>01—03</span></div>
    <div className="section-label">DRAW</div>
    <div className="tool-list">
      {[['Select', MousePointer2], ['Pen', Plus]].map(([name, Icon]: any) => <button key={name} className={`tool-button ${tool === name ? 'active' : ''}`} onClick={() => setTool(name)} data-testid={`tool-${String(name).toLowerCase()}`}><Icon /><span className="tool-label">{name}</span></button>)}
    </div>
    <div className="section-label">GENERATE</div>
    <div className="tool-list">
      <button className="tool-button" onClick={() => generate('Wave')} data-testid="tool-wave"><Waves /><span className="tool-label">Wave generator</span></button>
      <button className="tool-button" onClick={randomize} data-testid="tool-random-blob"><Sparkles /><span className="tool-label">Random blob</span></button>
    </div>
    <div className="section-label">SHAPE LIBRARY</div>
    <div className="library-grid">{LIBRARY.map((item, i) => <button key={item} className="library-item" onClick={() => generate(item)} data-testid={`library-${item.toLowerCase()}`}><Shapes style={{ transform: `rotate(${i * 9}deg)` }} />{item}</button>)}</div>
    <div className="section-label">MODIFY</div>
    <div className="tool-list">
      <button className="tool-button" onClick={convert} data-testid="tool-convert"><Scissors /><span className="tool-label">Path ↔ polygon</span></button>
      <button className="tool-button" onClick={addPoint} data-testid="tool-add-node"><Plus /><span className="tool-label">Add node</span></button>
      <button className="tool-button" onClick={toggleClosed} data-testid="tool-close-path"><RotateCcw /><span className="tool-label">{shape.closed ? 'Open path' : 'Close path'}</span></button>
    </div>
    <p className="hint" style={{ margin: '16px 8px' }}>One shape. Every format. Geometry stays editable as you work.</p>
  </div>;

  const svgD = pathFromPoints(shape.points, shape.closed, shape.kind === 'path');
  const polygonOverlay = shape.kind === 'path' && format === 'POLYGON';

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
      <aside className="left-panel" aria-label="Shape tools">{toolsContent}</aside>
      <section className="canvas-column" aria-label="Shape preview">
        <div className="canvas-toolbar">
          <div className="canvas-meta"><span className="live-dot" /><span>ARTBOARD</span><span style={{ color: '#58636e' }}>/</span><span>1000 × 600</span></div>
          <div className="canvas-actions">
            <button className={`icon-btn ${grid ? 'active' : ''}`} aria-label="Toggle grid" title="Toggle grid" onClick={() => setGrid(!grid)} data-testid="button-toggle-grid"><Grid2X2 /></button>
            <button className="icon-btn" aria-label="Undo" title="Undo" onClick={undo} disabled={!history.length} data-testid="button-undo-canvas"><Undo2 /></button>
            <button className="icon-btn" aria-label="Redo" title="Redo" onClick={redo} disabled={!future.length} data-testid="button-redo-canvas"><Redo2 /></button>
          </div>
        </div>
        <div className="artboard-wrap">
          <div className="artboard" style={{ backgroundImage: grid ? undefined : 'none' }}>
            <svg ref={svgRef} className="shape-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${shape.name} shape preview`} onPointerMove={movePoint} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={onBoardDown} data-testid="shape-preview">
              {polygonOverlay ? <polygon className="shape-fill" style={{ fill }} points={simplified.map(p => `${p.x},${p.y}`).join(' ')} /> :
                <path className="shape-fill" d={svgD} style={{ fill }} />}
              {shape.points.map((p, i) => <g key={i}>
                {selected === i && <circle cx={p.x} cy={p.y} r="12" fill="none" stroke="#83edc8" strokeDasharray="2 3" opacity=".8" />}
                {selected === i && shape.kind === 'path' && (() => {
                  const handles = getHandles(shape.points, i, shape.closed);
                  return <g>
                    <line className="node-line" x1={p.x} y1={p.y} x2={handles.in.x} y2={handles.in.y} />
                    <line className="node-line" x1={p.x} y1={p.y} x2={handles.out.x} y2={handles.out.y} />
                    <circle cx={handles.in.x} cy={handles.in.y} r="4" fill="#283b34" stroke="#b8f6df" strokeWidth="1.5" onPointerDown={e => startHandleDrag(e, i, 'in')} data-testid={`handle-in-${i}`} />
                    <circle cx={handles.out.x} cy={handles.out.y} r="4" fill="#283b34" stroke="#b8f6df" strokeWidth="1.5" onPointerDown={e => startHandleDrag(e, i, 'out')} data-testid={`handle-out-${i}`} />
                  </g>;
                })()}
                <circle className={`node ${selected === i ? 'selected' : ''}`} cx={p.x} cy={p.y} r="5.5" onPointerDown={e => startDrag(e, i)} onClick={() => setSelected(i)} data-testid={`node-${i}`} />
              </g>)}
            </svg>
          </div>
        </div>
        <div className="canvas-foot"><span>↗ DRAG NODES TO EDIT</span><span>{shape.kind.toUpperCase()} · {shape.points.length} POINTS</span></div>
      </section>
      <aside className="right-panel" aria-label="Shape properties">{propertyPanel}</aside>
    </section>
    <nav className="mobile-tools" aria-label="Mobile editing controls">
      <button className="btn" onClick={() => setSheet(sheet === 'tools' ? null : 'tools')} data-testid="button-open-tools"><Shapes /> Shapes</button>
      <button className="btn" onClick={() => setSheet(sheet === 'properties' ? null : 'properties')} data-testid="button-open-properties"><SlidersHorizontal /> Edit</button>
      <button className="btn" onClick={undo} disabled={!history.length} data-testid="button-mobile-undo"><Undo2 /> Undo</button>
      <button className="btn primary" onClick={() => setSheet(sheet === 'code' ? null : 'code')} data-testid="button-mobile-copy"><Copy /> Code</button>
    </nav>
    <section className="output-panel" id="output-panel" aria-label="Code output">
      {outputContent}
    </section>
    {sheet && <div className="sheet-backdrop" onClick={() => setSheet(null)} role="presentation"><section className={`mobile-sheet ${sheet === 'code' ? 'code-sheet' : ''}`} role="dialog" aria-modal="true" aria-label={sheet === 'tools' ? 'Shape tools' : sheet === 'properties' ? 'Shape properties' : 'Code output'} onClick={e => e.stopPropagation()}><div className="sheet-grab" /><button className="icon-btn sheet-close" onClick={() => setSheet(null)} aria-label="Close panel" data-testid="button-close-sheet"><X /></button>{sheet === 'tools' ? toolsContent : sheet === 'properties' ? propertyPanel : <div className="mobile-code-sheet">{outputContent}</div>}</section></div>}
    {toast && <div className="toast-note" role="status" data-testid="status-toast">{toast}</div>}
  </main>;
}

export default App;
