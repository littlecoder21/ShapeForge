import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDownToLine, Check, ChevronUp, Code2, Copy, Download, Grid2X2, Hand, Magnet, MousePointer2, Move, PanelBottomClose, PanelBottomOpen, PenTool, Plus, Redo2, ScanLine, Shapes, SlidersHorizontal, Slash, Trash2,
  Palette, Sparkles, Undo2, Waves, X, Crosshair, Type,
} from 'lucide-react';
import { exportCode, exportPageSvg, makeShape, polygonOutputPoints, type Point, type ShapeModel, type TextShapeData, type TextVectorGlyph, type Unit } from './lib/shape/geometry';
import { animatedFillOpacity, animatedShapeAt, animatedStrokeDraw, combineAnimatedHtml, exportAnimatedHtmlParts, type AnimatedShape, type ShapeAnimation } from './lib/shape/animation';
import { NONE, nudgeNode, deleteNode, deleteNodes, moveNodesBy, selectAllNodes, selectedIndices, setNodesLocked, toggleInSelection, type Selection, type Tool } from './lib/shape/edit';
import { DEFAULT_WAVE, buildWaveShape, clampWave, type WaveParams } from './lib/shape/wave';
import { unifyShapes } from './lib/shape/union';
import { computeOuterPath, outerShape } from './lib/shape/compound';
import { loadSettings, saveSettings, type EditorSettings } from './lib/shape/settings';
import { addPage, addShape, clearPage, duplicateShape, moveShape, patchPage, patchShape, removePage, removeShape, renamePage, replaceShapesWithUnion, selectPage, selectShape } from './shape/state/document';
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
import AnimationPanel, { shapeAnimation } from './shape/panels/AnimationPanel';
import TextSvgPanel from './shape/panels/TextSvgPanel';
import { transformContourPoint } from './shape/panels/textSvgGeometry';
import './index.css';

/** Gradient Studio is a separate workspace: loaded on demand so ShapeForge itself stays light. */
const GradientStudio = lazy(() => import('./gradient/GradientStudio'));

const FORMATS = ['SVG', 'PAGE SVG', 'SVG PATH', 'CSS PATH', 'POLYGON', 'REACT', 'HTML + CSS', 'JSON'];
const LIBRARY = ['Rectangle', 'Rounded rectangle', 'Half circle', 'Ellipse', 'Triangle', 'Diamond', 'Pentagon', 'Hexagon', 'Octagon', 'Star', 'Heart', 'Arrow', 'Cross', 'Trapezoid', 'Parallelogram', 'Circle'];
type Tab = 'page' | 'node' | 'shape' | 'wave' | 'outer' | 'text-svg' | 'animation' | 'editor';
const TABS: { id: Tab; label: string }[] = [{ id: 'page', label: 'Page' }, { id: 'node', label: 'Node' }, { id: 'shape', label: 'Shape' }, { id: 'wave', label: 'Wave' }, { id: 'outer', label: 'Import' }, { id: 'text-svg', label: 'Text SVG' }, { id: 'animation', label: 'Animate' }, { id: 'editor', label: 'Editor' }];
const POLYGON_SAMPLE_STEPS = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128];

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
  const [polygonSamples, setPolygonSamples] = useState(48);
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
  const [animationPlayhead, setAnimationPlayhead] = useState(0);
  const [animationPlaying, setAnimationPlaying] = useState(false);
  const [animationPreviewing, setAnimationPreviewing] = useState(false);
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [studio, setStudio] = useState(() => typeof location !== 'undefined' && location.hash === '#gradient');

  const isNarrow = useMedia('(max-width: 900px)');
  const isPhone = useMedia('(max-width: 640px)');
  const stageRef = useRef<StageHandle>(null);
  const waveAddedPreview = useRef(false);
  const autoDock = useRef(true);
  const animationElapsed = useRef(0);
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
  const clearCurrentPage = () => {
    if (!page.shapes.length) return;
    documentState.apply(clearPage);
    setSelection(NONE);
    setAnimationPlaying(false);
    setAnimationPreviewing(false);
    setAnimationPlayhead(0);
    animationElapsed.current = 0;
    announce(`${page.name} cleared · Undo to restore`);
  };
  const deleteShapeFromPage = (id: string) => {
    const deletedShape = page.shapes.find(item => item.id === id);
    if (!deletedShape) return;
    documentState.apply(d => removeShape(d, id));
    setSelection(NONE);
    if (shape.id === id) {
      setAnimationPlaying(false);
      setAnimationPreviewing(false);
      setAnimationPlayhead(0);
      animationElapsed.current = 0;
      announce(`${deletedShape.name} deleted · Undo to restore`);
    }
  };
  const canUndo = documentState.canUndo, canRedo = documentState.canRedo;

  const setFill = useCallback((fill: string) => commit({ ...shape, fill }), [commit, shape]);
  const animation = shapeAnimation(shape);
  const setAnimation = useCallback((next: ShapeAnimation) => commit({ ...shape, animation: next } as AnimatedShape as ShapeModel), [commit, shape]);
  const liveAnimation = useCallback((next: ShapeAnimation) => documentState.live({ ...shape, animation: next } as AnimatedShape as ShapeModel, shape), [documentState.live, shape]);

  useEffect(() => {
    if (!animationPlaying || !animation) return;
    const started = performance.now() - animationElapsed.current;
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - started;
      const duration = Math.max(1, animation.duration);
      const totalDuration = duration * Math.max(1, Math.floor(animation.iterations ?? 1));
      animationElapsed.current = elapsed;
      if (animation.loop) setAnimationPlayhead(elapsed % duration);
      else if (elapsed >= totalDuration) {
        setAnimationPlayhead(animation.duration);
        setAnimationPlaying(false);
      } else setAnimationPlayhead(elapsed % duration);
      if (animation.loop || elapsed < totalDuration) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animationPlaying, animation?.duration, animation?.iterations, animation?.loop]);

  const toggleAnimationPlay = () => {
    if (!animation?.keyframes.length) return;
    if (animationPlaying) setAnimationPlaying(false);
    else {
      if (animationPlayhead >= animation.duration) {
        animationElapsed.current = 0;
        setAnimationPlayhead(0);
      }
      setAnimationPreviewing(true);
      setAnimationPlaying(true);
    }
  };
  const animationPreviewShape = useMemo(() => animationPreviewing && animation
    ? animatedShapeAt(shape, animation, animationPlayhead)
    : shape, [shape, animation, animationPlayhead, animationPreviewing]);
  const isAnimationPreview = animationPreviewing && !!animation?.keyframes.length;
  const stagePolygonPoints = format === 'POLYGON' && animationPreviewShape.kind === 'path'
    ? polygonOutputPoints(animationPreviewShape.points, animationPreviewShape.closed, true, polygonSamples, tolerance).map(point => `${point.x},${point.y}`).join(' ')
    : null;

  useEffect(() => {
    setAnimationPlaying(false);
    setAnimationPreviewing(false);
    setAnimationPlayhead(0);
    animationElapsed.current = 0;
  }, [shape.id]);

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
      if (isAnimationPreview) {
        if (e.key === 'Escape') { setAnimationPlaying(false); setAnimationPreviewing(false); }
        e.preventDefault();
        return;
      }
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
  }, [undo, redo, selection, shape, commit, announce, isAnimationPreview]);

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
  const addImportedShapes = (imported: ShapeModel[]) => {
      documentState.apply(d => imported.reduce((next, item) => addShape(next, item), d));
      setSelection(NONE);
      setTool('Select');
  };
  const addTextToArtboard = (text: TextShapeData) => {
    const scale = Math.min(1, 880 / text.width, 480 / text.height);
    const width = text.width * scale, height = text.height * scale;
    const x = (1000 - width) / 2, y = (600 - height) / 2;
    const next: ShapeModel = {
      name: `Text · ${text.value.slice(0, 24) || 'Untitled'}`,
      kind: 'polygon',
      points: [
        { x, y, mode: 'corner' }, { x: x + width, y, mode: 'corner' },
        { x: x + width, y: y + height, mode: 'corner' }, { x, y: y + height, mode: 'corner' },
      ],
      closed: true, fill: 'none', stroke: 'none', strokeWidth: 0, text,
    };
    documentState.apply(d => addShape(d, next, false));
    setSelection({ kind: 'shape' });
    setTool('Select');
  };
  const updateArtboardText = (text: TextShapeData) => commit({ ...shape, text, name: `Text · ${text.value.slice(0, 24) || 'Untitled'}` });
  const addTextGlyphShapes = (text: TextShapeData) => {
    const glyphs = text.vectorGlyphs ?? [];
    const scale = Math.min(1, 880 / text.width, 480 / text.height);
    const offsetX = (1000 - text.width * scale) / 2, offsetY = (600 - text.height * scale) / 2;
    const mapPoint = (point: Point, glyph: TextVectorGlyph): Point => {
      const transformed = transformContourPoint(point, glyph);
      return {
        ...transformed,
        x: offsetX + transformed.x * scale,
        y: offsetY + transformed.y * scale,
        ...(point.in ? { in: mapPoint(point.in, glyph) } : {}),
        ...(point.out ? { out: mapPoint(point.out, glyph) } : {}),
      };
    };
    const shapes = glyphs.flatMap((glyph, index) => {
      const contours = glyph.contours.map(contour => contour.map(point => mapPoint(point, glyph))).filter(contour => contour.length >= 2);
      if (!contours.length) return [];
      return [{
        name: `Glyph ${index + 1} · ${glyph.char}`,
        kind: 'path' as const, points: contours[0], extra: contours.slice(1), closed: true,
        fill: text.fill, stroke: 'none', strokeWidth: 0, fillRule: 'nonzero' as const,
      }];
    });
    if (!shapes.length) {
      announce('No editable glyph outlines are available. Import a font file first.');
      return;
    }
    documentState.apply(current => shapes.reduce((next, glyph) => addShape(next, glyph, false), current));
    setSelection(NONE);
    setTool('Select');
  };
  const extractOuter = () => {
    try {
      const result = computeOuterPath(page.shapes);
      const extracted = outerShape(result, 'Outside area mask', '#ffffff');
      if (!extracted) { announce(result.notes.join(' ') || 'Could not extract the outside area'); return; }
      documentState.apply(d => addShape(d, { ...extracted, stroke: 'none', strokeWidth: 0 }, false));
      setSelection(NONE);
      setTool('Select');
      announce(result.notes[0] || 'Added an editable page mask');
    } catch (error) {
      console.error('Could not extract the outside area', error);
      announce('Could not extract the outside area. Check the page geometry and try again.');
    }
  };
  const randomize = () => { const n = seed + 17; setSeed(n); documentState.apply(d => addShape(d, makeShape('Blob', n))); setSelection(NONE); setSheet(null); announce('New seed · ' + n); };
  const reset = () => { documentState.apply(d => addShape(d, makeShape('Blob', 23))); setFormat('SVG'); setSelection(NONE); announce('New shape added to page'); };
  const convert = () => {
    if (shape.kind === 'polygon') { commit({ ...shape, kind: 'path', name: `${shape.name} · path`, points: shape.points.map(p => ({ ...p, mode: 'corner' as const })) }); announce('Polygon converted to an exact path'); }
    else { commit({ ...shape, kind: 'polygon', points: polygonOutputPoints(shape.points, shape.closed, true, polygonSamples, tolerance), name: `${shape.name} · polygon`, wave: undefined }); announce(`Path converted to polygon with ${polygonSamples} nodes`); }
    setSelection(NONE);
  };

  /* ───── export ───── */
  const deferredShape = useDeferredValue(shape);
  const deferredPage = useDeferredValue(page);
  const wantCode = !isPhone || sheet === 'code';
  const animatedParts = useMemo(() => {
    const deferredAnimation = shapeAnimation(deferredShape);
    return format === 'HTML + CSS' && deferredAnimation?.keyframes.length
      ? exportAnimatedHtmlParts(deferredShape, deferredAnimation, precision)
      : null;
  }, [format, deferredShape, precision]);
  const code = useMemo(() => {
    if (!wantCode) return '';
    if (format === 'PAGE SVG') return exportPageSvg(deferredPage.shapes, precision, deferredPage);
    if (animatedParts) return combineAnimatedHtml(animatedParts);
    return exportCode(deferredShape, format, precision, tolerance, unit, deferredPage, polygonSamples);
  }, [wantCode, deferredPage, deferredShape, format, precision, tolerance, unit, polygonSamples, animatedParts]);
  const polygonPoints = useMemo(() => (format === 'POLYGON' && deferredShape.kind === 'path' ? polygonOutputPoints(deferredShape.points, deferredShape.closed, true, polygonSamples, tolerance).map(p => `${p.x},${p.y}`).join(' ') : null), [format, deferredShape, tolerance, polygonSamples]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); announce('Copied to clipboard'); setTimeout(() => setCopied(false), 1500); }
    catch { announce('Clipboard unavailable in this browser'); }
  };
  const copyCodePart = async (part: string, label: string) => {
    try { await navigator.clipboard.writeText(part); announce(`Copied ${label}`); }
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
      onDelete={deleteShapeFromPage}
      onMove={(id, dir) => documentState.apply(d => moveShape(d, id, dir))} />;
    if (t === 'node') return <PrecisionPanel {...panelProps} selection={selection} onSelect={setSelection} />;
    if (t === 'shape') return <ShapePanel {...panelProps} fill={shape.fill} setFill={setFill} tolerance={tolerance} setTolerance={setTolerance} precision={precision} setPrecision={setPrecision} unit={unit} setUnit={setUnit} shapes={page.shapes} onUnify={mergeSelectedShapes}
      polygonSamples={polygonSamples} setPolygonSamples={setPolygonSamples} />;
    if (t === 'wave') return <WavePanel params={waveParams} active={!!shape.wave} fill={shape.fill} setFill={setFill} unit={unit} setUnit={setUnit} onLive={p => applyWave(p, 'live')} onLiveEnd={() => { if (waveAddedPreview.current) waveAddedPreview.current = false; else liveEnd(); }} onApply={p => applyWave(p, 'apply')} />;
    if (t === 'outer') return <BoundaryPanel onAddShapes={addImportedShapes} onExtractOuter={extractOuter} announce={announce} />;
    if (t === 'text-svg') return <TextSvgPanel announce={announce} selectedShape={shape} onAddText={addTextToArtboard} onUpdateText={updateArtboardText} onAddGlyphShapes={addTextGlyphShapes} />;
    if (t === 'animation') return <AnimationPanel shape={shape} animation={animation} playhead={animationPlayhead} playing={animationPlaying} previewing={animationPreviewing}
      onChange={setAnimation} onLiveChange={liveAnimation} onLiveEnd={liveEnd} onPlayhead={time => { animationElapsed.current = time; setAnimationPlayhead(time); setAnimationPlaying(false); }} onTogglePlay={toggleAnimationPlay}
      onTogglePreview={() => { setAnimationPreviewing(value => !value); setAnimationPlaying(false); }} />;
    return <EditorPanel settings={settings} set={setSettings} />;
  };
  const tabBar = (cls: string) => <div className={cls} role="tablist" aria-label="Editor panels">
    {TABS.map(x => <button key={x.id} role="tab" aria-selected={tab === x.id} className={`ptab ${tab === x.id ? 'active' : ''}`} onClick={() => setTab(x.id)} data-testid={`tab-panel-${x.id}`}>{x.label}</button>)}
  </div>;

  const outputContent = <>
    <div className="output-top">
      <div className="tabs" role="tablist" aria-label="Export format">{FORMATS.map(item => <button key={item} role="tab" aria-selected={format === item} className={`tab ${format === item ? 'active' : ''}`} onClick={() => setFormat(item)} data-testid={`tab-${item.toLowerCase().replaceAll(' ', '-')}`}>{item === 'HTML + CSS' && animatedParts ? 'HTML + CSS + JS' : item}</button>)}</div>
      <div className="output-actions">
        <button className="btn" onClick={download} title="Download current export" data-testid="button-download"><Download /> <span className="desktop-action">Download</span></button>
        <button className="btn primary" onClick={copyCode} aria-label={animatedParts ? 'Copy all HTML, CSS, and JavaScript' : 'Copy code'} title={animatedParts ? 'Copy all HTML, CSS, and JavaScript' : 'Copy code'} data-testid="button-copy">{copied ? <Check /> : <Copy />} {copied ? 'Copied' : animatedParts ? 'Copy all' : 'Copy'}</button>
        <button type="button" className="icon-btn output-collapse" aria-label={outputCollapsed ? 'Expand output panel' : 'Collapse output panel'} aria-expanded={!outputCollapsed} title={outputCollapsed ? 'Expand output' : 'Collapse output'} onClick={() => setOutputCollapsed(value => !value)} data-testid="button-collapse-output">
          {outputCollapsed ? <PanelBottomOpen /> : <PanelBottomClose />}
        </button>
      </div>
    </div>
    <div className="output-body">{animatedParts ? <div className="code-sections">
      {([
        ['html', 'HTML', animatedParts.html],
        ['css', 'CSS', animatedParts.css],
        ['javascript', 'JavaScript', animatedParts.javascript],
      ] as const).map(([id, label, content]) => <section className="code-section" key={id}>
        <div className="code-section-head"><strong>{label}</strong><button type="button" className="btn" onClick={() => copyCodePart(content, label)} data-testid={`button-copy-${id}`}>Copy {label}</button></div>
        <pre className="code" data-testid={`code-section-${id}`}>{content}</pre>
      </section>)}
    </div> : <pre className="code" data-testid="code-output">{code}</pre>}</div>
  </>;

  const toolsContent = <div>
    <div className="panel-heading">Tools <span>01—04</span></div>
    <div className="section-label">DRAW</div>
    <div className="tool-list">
      {([['Select', MousePointer2], ['Pen', PenTool], ['Line', Slash], ['Hand', Hand]] as const).map(([name, Icon]) => <button key={name} className={`tool-button ${tool === name ? 'active' : ''}`} onClick={() => { setTool(name); setSheet(null); }} data-testid={`tool-${name.toLowerCase()}`}><Icon /><span className="tool-label">{name}</span></button>)}
    </div>
    <div className="section-label">GENERATE</div>
    <div className="tool-list">
      <button className="tool-button" onClick={() => generate('Wave')} data-testid="tool-wave"><Waves /><span className="tool-label">Wave maker</span></button>
      <button className="tool-button" onClick={randomize} data-testid="tool-random-blob"><Sparkles /><span className="tool-label">Random blob</span></button>
      <button className="tool-button" onClick={() => { openTab('outer'); setSheet(null); }} data-testid="tool-import-shape"><ScanLine /><span className="tool-label">Import shape</span></button>
      <button className="tool-button" onClick={() => { openTab('text-svg'); setSheet(null); }} data-testid="tool-text-svg"><Type /><span className="tool-label">Text to SVG</span></button>
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

  const hint = tool === 'Hand' ? 'DRAG TO PAN' : tool === 'Pen' ? 'TAP = NODE · DRAG = CURVE' : tool === 'Line' ? 'DRAG TO DRAW A LINE' : isNarrow ? 'PINCH ZOOM · TWO FINGERS PAN' : 'CTRL+WHEEL ZOOM · SPACE+DRAG PAN';

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Shapes /></div>ShapeForge<span className="brand-tag">SHAPE STUDIO / 01</span></div>
      <div className="top-actions">
        <div className="action-group">
          <button className="btn quiet desktop-action" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" data-testid="button-undo"><Undo2 /></button>
          <button className="btn quiet desktop-action" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" data-testid="button-redo"><Redo2 /></button>
          <button className="btn quiet danger" onClick={() => deleteShapeFromPage(shape.id!)} disabled={!page.shapes.some(item => item.id === shape.id)} aria-label="Delete current shape" title="Delete current shape" data-testid="button-delete-shape"><Trash2 /></button>
          <button className="btn quiet desktop-action" onClick={clearCurrentPage} disabled={!page.shapes.length} aria-label="Reset page (clear shapes)" title="Reset page · clear current page" data-testid="button-reset-page"><Trash2 /></button>
          <button className="btn quiet page-settings-trigger" onClick={() => setPageSettingsOpen(true)} aria-label="Page settings" title="Page settings" data-testid="button-page-settings"><SlidersHorizontal /></button>
        </div>
        <button className="btn desktop-action" onClick={reset} data-testid="button-new"><Plus /> New</button>
        <button className="btn desktop-action" onClick={saveJson} data-testid="button-save"><ArrowDownToLine /> Save</button>
        <button className="btn gradient-btn" onClick={openStudio} aria-label="Open Gradient Studio" title="Open Gradient Studio" data-testid="button-create-gradient"><Palette /><span><span className="cg-long">Create </span>Gradient</span></button>
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
        <div className="artboard-wrap" id="artboard-wrap" style={{
          '--animation-fill-opacity': String(isAnimationPreview ? animatedFillOpacity(animation, animationPlayhead) : 1),
          '--animation-stroke-color': isAnimationPreview ? animationPreviewShape.stroke : 'none',
          '--animation-stroke-width': isAnimationPreview ? String(animationPreviewShape.strokeWidth) : '0',
        } as CSSProperties}>
          <Stage ref={stageRef} shape={animationPreviewShape} others={page.shapes.filter(s => s.id !== shape.id)} shapeOrder={page.shapes.map(s => s.id!)} tool={tool} selection={selection} settings={settings} showGrid={grid} polygonPoints={stagePolygonPoints ?? polygonPoints} strokeDraw={isAnimationPreview ? animatedStrokeDraw(animation, animationPlayhead) : null} multiSelect={multiSelect} onMultiSelect={setMultiSelect} pageBackground={page.background}
            onSelect={setSelection} onPreview={documentState.preview} onGestureEnd={finishGesture} onCommit={commit}
            onPickShape={pickShape} onAddShape={(next, sel) => { documentState.apply(d => addShape(d, next)); if (sel) setSelection(sel); }} onAnnounce={announce} />
          {isAnimationPreview && <div className="animation-preview-shield" role="status" aria-label="Animation preview is active" data-testid="animation-preview-shield">
            <span>{animationPlaying ? 'Playing animation' : 'Animation preview · editing paused'}</span>
          </div>}
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
      {([['Select', MousePointer2], ['Pen', PenTool], ['Line', Slash], ['Hand', Hand]] as const).map(([name, Icon]) => <button key={name} className={`mt-btn ${tool === name ? 'active' : ''}`} onClick={() => setTool(name)} aria-pressed={tool === name} data-testid={`mobile-tool-${name.toLowerCase()}`}><Icon /><span>{name}</span></button>)}
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
