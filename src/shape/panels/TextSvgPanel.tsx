import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Font } from 'opentype.js';
import { ArrowDown, ArrowUp, Clipboard, Download, Link2, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Section, Switch, ValueControl } from '../../shared/controls';
import type { ShapeModel, TextGlyphShape, TextShapeData, TextStrokePath, TextVectorGlyph } from '../../lib/shape/geometry';
import { createVectorGlyphs, isValidPathData, makePresetStrokes, mergeStrokePaths, transformContourPoint, variantStrokePath } from './textSvgGeometry';

const FONT_OPTIONS = [
  'Arial', 'Georgia', 'Verdana', 'Times New Roman', 'Trebuchet MS', 'Courier New',
  'Impact', 'Comic Sans MS', 'system-ui', 'serif', 'sans-serif', 'monospace', 'cursive',
];

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, character => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

function buildTextSvg(value: string, font: string, fontSize: number, weight: string, italic: boolean, fill: string, stroke: string, strokeWidth: number, draw: boolean, duration: number, letterSpacing: number, lineSpacing: number, glyphShapes: TextGlyphShape[], advances: number[], vectorGlyphs: TextVectorGlyph[], strokePaths: TextStrokePath[]): TextShapeData {
  const lines = value.split(/\r?\n/);
  const lineHeight = fontSize * lineSpacing / 100;
  let measuringIndex = 0;
  const lineWidths = lines.map((line, index) => {
    const width = [...line].reduce((sum, char) => sum + (advances[measuringIndex++] ?? fontSize * 0.6), 0);
    if (index < lines.length - 1) measuringIndex++;
    return width;
  });
  const width = Math.ceil(Math.max(1, ...lineWidths) + 64);
  const height = Math.ceil(lines.length * lineHeight + 48);
  const defaultPaths = vectorGlyphs.flatMap(glyph => glyph.contourPaths.map((d, contourIndex) => ({
    id: `glyph-${glyph.index}-${contourIndex}`, name: `${glyph.char} · contour ${contourIndex + 1}`, d, glyphIndex: glyph.index, transform: glyph.transform,
    reverse: false, startPercent: 0, duration: duration / Math.max(1, vectorGlyphs.reduce((sum, item) => sum + item.contourPaths.length, 0)), pauseAfter: 0, overlapNext: 0, closed: true,
  })));
  const paths = strokePaths.length ? strokePaths : defaultPaths;
  const vectorMarkup = vectorGlyphs.map(glyph => `<path d="${escapeXml(glyph.d)}" transform="${glyph.transform}" data-glyph="${glyph.index}" fill-rule="nonzero"/>`).join('');
  let charIndex = 0;
  const textMarkup = lines.map((line, lineIndex) => {
    let cursorX = 32;
    const baseline = 24 + fontSize + lineIndex * lineHeight;
    const rendered = [...line].map(char => {
      const advance = advances[charIndex] ?? fontSize * 0.6;
      const shape = glyphShapes[charIndex] ?? { x: 0, y: 0, rotation: 0, scaleX: 100, scaleY: 100 };
      const x = cursorX + advance / 2, y = baseline;
      const transform = `translate(${shape.x} ${shape.y}) translate(${x} ${y}) rotate(${shape.rotation}) scale(${shape.scaleX / 100} ${shape.scaleY / 100}) translate(${-x} ${-y})`;
      const markup = `<text x="${cursorX}" y="${baseline}" transform="${transform}" data-glyph="${charIndex}">${escapeXml(char)}</text>`;
      cursorX += advance;
      charIndex++;
      return markup;
    }).join('');
    if (lineIndex < lines.length - 1) charIndex++;
    return rendered;
  }).join('');
  let time = 0;
  const animatedPaths = paths.map((path, index) => {
    const delay = time;
    time += Math.max(0.02, path.duration) + Math.max(0, path.pauseAfter) - Math.min(Math.max(0, path.overlapNext), Math.max(0, path.duration));
    const d = variantStrokePath(path.d, path.reverse, path.startPercent, path.closed);
    const transform = path.transform ? ` transform="${path.transform}"` : '';
    return `<path d="${escapeXml(d)}"${transform} fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" style="animation:text-stroke ${Math.max(0.02, path.duration)}s linear ${Math.max(0, delay)}s both" data-stroke-id="${escapeXml(path.id)}" data-stroke-order="${index + 1}"/>`;
  }).join('');
  const style = draw
    ? '<style>@keyframes text-stroke{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}@media(prefers-reduced-motion:reduce){[data-stroke-id]{animation-duration:.01ms!important;animation-delay:0s!important}}</style>'
    : '';
  const typographyMarkup = vectorGlyphs.length
    ? `<g fill="${draw ? 'none' : fill}">${vectorMarkup}</g>`
    : `<g font-family="${escapeXml(font.trim() || 'sans-serif')}" font-size="${fontSize}" font-weight="${weight}" font-style="${italic ? 'italic' : 'normal'}" fill="${draw && paths.length ? 'none' : fill}">${textMarkup}</g>`;
  return {
    value, font, fontSize, weight, italic, fill, stroke, strokeWidth, draw, duration, letterSpacing, lineSpacing, glyphShapes, width, height,
    vectorGlyphs, strokePaths: paths, content: `${style}${typographyMarkup}${draw ? animatedPaths : ''}`,
  };
}

export default function TextSvgPanel({ announce, selectedShape, onAddText, onUpdateText, onAddGlyphShapes }: {
  announce: (message: string) => void;
  selectedShape: ShapeModel;
  onAddText: (text: TextShapeData) => void;
  onUpdateText: (text: TextShapeData) => void;
  onAddGlyphShapes: (text: TextShapeData) => void;
}) {
  const [text, setText] = useState(selectedShape.text?.value ?? 'ShapeForge');
  const [font, setFont] = useState(selectedShape.text?.font ?? 'cursive');
  const [fontSize, setFontSize] = useState(selectedShape.text?.fontSize ?? 96);
  const [weight, setWeight] = useState(selectedShape.text?.weight ?? '600');
  const [italic, setItalic] = useState(selectedShape.text?.italic ?? false);
  const [fill, setFill] = useState(selectedShape.text?.fill ?? '#69dfb5');
  const [drawColor, setDrawColor] = useState(selectedShape.text?.stroke ?? '#69dfb5');
  const [drawWidth, setDrawWidth] = useState(selectedShape.text?.strokeWidth ?? 3);
  const [draw, setDraw] = useState(selectedShape.text?.draw ?? false);
  const [duration, setDuration] = useState(selectedShape.text?.duration ?? 3);
  const [letterSpacing, setLetterSpacing] = useState(selectedShape.text?.letterSpacing ?? 0);
  const [lineSpacing, setLineSpacing] = useState(selectedShape.text?.lineSpacing ?? 130);
  const [selectedGlyph, setSelectedGlyph] = useState(0);
  const [glyphShapes, setGlyphShapes] = useState<TextGlyphShape[]>(selectedShape.text?.glyphShapes ?? []);
  const [strokePaths, setStrokePaths] = useState<TextStrokePath[]>(selectedShape.text?.strokePaths ?? []);
  const [pathDrafts, setPathDrafts] = useState<Record<string, string>>({});
  const [pathError, setPathError] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [drawingPreview, setDrawingPreview] = useState('');
  const drawPointer = useRef<number | null>(null);
  const drawPoints = useRef<{ x: number; y: number }[]>([]);
  const [loadedFont, setLoadedFont] = useState<Font | null>(null);
  const selectedId = selectedShape.id;
  useEffect(() => {
    const data = selectedShape.text;
    setText(data?.value ?? 'ShapeForge');
    setFont(data?.font ?? 'cursive');
    setFontSize(data?.fontSize ?? 96);
    setWeight(data?.weight ?? '600');
    setItalic(data?.italic ?? false);
    setFill(data?.fill ?? '#69dfb5');
    setDrawColor(data?.stroke ?? '#69dfb5');
    setDrawWidth(data?.strokeWidth ?? 3);
    setDraw(data?.draw ?? false);
    setDuration(data?.duration ?? 3);
    setLetterSpacing(data?.letterSpacing ?? 0);
    setLineSpacing(data?.lineSpacing ?? 130);
    setGlyphShapes(data?.glyphShapes ?? []);
    setStrokePaths(data?.strokePaths ?? []);
    setPathDrafts({});
    setPathError('');
    setLoadedFont(null);
    setSelectedGlyph(0);
  }, [selectedId]);
  const advances = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d');
    if (context) context.font = `${italic ? 'italic ' : ''}${weight} ${fontSize}px ${font}`;
    return [...text].map(char => char === '\n' || char === '\r' ? 0 : (loadedFont
      ? loadedFont.getAdvanceWidth(char, fontSize) + letterSpacing
      : context?.measureText(char).width ?? fontSize * (/\s/.test(char) ? 0.33 : 0.6)) + (loadedFont ? 0 : letterSpacing));
  }, [text, font, fontSize, weight, italic, letterSpacing, loadedFont]);
  const chars = [...text].flatMap((char, index) => char === '\n' || char === '\r' ? [] : [{ char, index }]);
  const activeGlyph = glyphShapes[selectedGlyph] ?? { x: 0, y: 0, rotation: 0, scaleX: 100, scaleY: 100 };
  const updateGlyph = (patch: Partial<TextGlyphShape>) => setGlyphShapes(current => {
    const next = [...current];
    const previous = next[selectedGlyph] ?? { x: 0, y: 0, rotation: 0, scaleX: 100, scaleY: 100 };
    next[selectedGlyph] = { ...previous, ...patch };
    return next;
  });
  const vectorGlyphs = useMemo(() => {
    if (loadedFont) return createVectorGlyphs(loadedFont, text, fontSize, letterSpacing, lineSpacing, glyphShapes);
    const saved = selectedShape.text;
    return saved?.value === text && saved.font === font ? saved.vectorGlyphs ?? [] : [];
  }, [loadedFont, text, fontSize, letterSpacing, lineSpacing, glyphShapes, selectedShape.text, font]);
  const data = useMemo(() => buildTextSvg(text, font, fontSize, weight, italic, fill, drawColor, drawWidth, draw, duration, letterSpacing, lineSpacing, glyphShapes, advances, vectorGlyphs, strokePaths), [text, font, fontSize, weight, italic, fill, drawColor, drawWidth, draw, duration, letterSpacing, lineSpacing, glyphShapes, advances, vectorGlyphs, strokePaths]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${data.width}" height="${data.height}" viewBox="0 0 ${data.width} ${data.height}">${data.content}</svg>`;

  const importFont = async (file?: File) => {
    if (!file) return;
    try {
      const opentype = await import('opentype.js');
      const parsed = opentype.parse(await file.arrayBuffer());
      setLoadedFont(parsed);
      setFont(parsed.getEnglishName('family') || file.name.replace(/\.[^.]+$/, ''));
      setGlyphShapes([]);
      setStrokePaths([]);
      setDraw(true);
      announce(`Loaded ${parsed.getEnglishName('family') || file.name}; glyphs are now editable SVG paths`);
    } catch (error) {
      console.error('Could not parse the selected font', error);
      announce('Could not read that font. Choose a valid TTF, OTF, WOFF, or WOFF2 file.');
    }
  };
  const addDecoration = () => {
    const item: TextStrokePath = {
      id: `decoration-${Date.now()}`, name: `Decoration ${strokePaths.length + 1}`,
      d: 'M 32 32 C 48 8 64 8 80 32', reverse: false, startPercent: 0,
      duration: duration / Math.max(1, animationStrokes.length + 1), pauseAfter: 0, overlapNext: 0, closed: false,
    };
    setStrokePaths(paths => [...(paths.length ? paths : animationStrokes), item]);
    setDraw(true);
  };
  const animationStrokes = data.strokePaths ?? [];
  const updateStroke = (index: number, patch: Partial<TextStrokePath>) => setStrokePaths(paths => (paths.length ? paths : animationStrokes).map((path, i) => i === index ? { ...path, ...patch } : path));
  const moveStroke = (index: number, offset: -1 | 1) => setStrokePaths(current => {
    const paths = current.length ? current : animationStrokes;
    const target = index + offset;
    if (target < 0 || target >= paths.length) return paths;
    const next = [...paths];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const joinStrokeWithPrevious = (index: number) => {
    const paths = strokePaths.length ? strokePaths : animationStrokes;
    if (index <= 0) return;
    const next = [...paths];
    const previous = next[index - 1];
    try {
      next[index - 1] = { ...previous, d: mergeStrokePaths(previous.d, paths[index].d, previous.transform, paths[index].transform), transform: undefined, name: `${previous.name} + ${paths[index].name}`, closed: false };
    } catch (error) {
      setPathError(error instanceof Error ? error.message : 'Could not join these SVG paths.');
      return;
    }
    next.splice(index, 1);
    setStrokePaths(next);
    setPathError('');
  };
  const commitPathDraft = (path: TextStrokePath) => {
    const draft = pathDrafts[path.id];
    if (draft === undefined) return;
    if (!isValidPathData(draft)) {
      setPathError('Invalid SVG path data. Correct the path before applying it.');
      return;
    }
    updateStroke(animationStrokes.findIndex(item => item.id === path.id), { d: draft });
    setPathDrafts(current => { const next = { ...current }; delete next[path.id]; return next; });
    setPathError('');
  };
  const useHandwritingPreset = () => {
    const preset = makePresetStrokes(text, fontSize, lineSpacing, advances, glyphShapes);
    if (!preset.length) {
      announce('No handwriting presets match these characters. Import a font outline or add a manual SVG path.');
      return;
    }
    setStrokePaths(preset.map(path => ({ ...path, duration: duration / preset.length })));
    setDraw(true);
    announce(`Created ${preset.length} ordered handwriting strokes`);
  };
  const editGlyphShapes = () => {
    if (!data.vectorGlyphs?.length) return;
    onAddGlyphShapes(data);
    announce(`Added ${data.vectorGlyphs.length} editable character shapes to the artboard`);
  };
  const pointInPreview = (event: ReactPointerEvent<HTMLDivElement>) => {
    const svgElement = event.currentTarget.querySelector('svg');
    if (!svgElement) return null;
    const rect = svgElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: (event.clientX - rect.left) / rect.width * data.width, y: (event.clientY - rect.top) / rect.height * data.height };
  };
  const freehandPath = (points: { x: number; y: number }[]) => {
    if (points.length < 2) return '';
    let d = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const before = points[Math.max(0, i - 1)], start = points[i], end = points[i + 1], after = points[Math.min(points.length - 1, i + 2)];
      d += ` C${(start.x + (end.x - before.x) / 6).toFixed(2)} ${(start.y + (end.y - before.y) / 6).toFixed(2)} ${(end.x - (after.x - start.x) / 6).toFixed(2)} ${(end.y - (after.y - start.y) / 6).toFixed(2)} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
    }
    return d;
  };
  const drawDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing || drawPointer.current !== null) return;
    const point = pointInPreview(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawPointer.current = event.pointerId;
    drawPoints.current = [point];
    setDrawingPreview(`M${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
  };
  const drawMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drawPointer.current !== event.pointerId) return;
    const point = pointInPreview(event);
    const previous = drawPoints.current[drawPoints.current.length - 1];
    if (!point || !previous || Math.hypot(point.x - previous.x, point.y - previous.y) < 1) return;
    drawPoints.current = [...drawPoints.current, point];
    setDrawingPreview(freehandPath(drawPoints.current));
  };
  const drawUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drawPointer.current !== event.pointerId) return;
    drawMove(event);
    const d = freehandPath(drawPoints.current);
    if (d) {
      const item: TextStrokePath = {
        id: `hand-${Date.now()}`, name: `Hand-drawn stroke ${animationStrokes.length + 1}`, d,
        reverse: false, startPercent: 0, duration: duration / Math.max(1, animationStrokes.length + 1), pauseAfter: 0, overlapNext: 0, closed: false,
      };
      setStrokePaths(current => [...(current.length ? current : animationStrokes), item]);
      setDraw(true);
    }
    drawPointer.current = null;
    drawPoints.current = [];
    setDrawingPreview('');
    setDrawing(false);
  };

  const copySvg = async () => {
    try {
      await navigator.clipboard.writeText(svg);
      announce('SVG copied to clipboard');
    } catch {
      announce('Clipboard unavailable in this browser');
    }
  };
  const downloadSvg = () => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'shapeforge-text.svg';
    link.click();
    URL.revokeObjectURL(url);
    announce('Text SVG downloaded');
  };
  const applyToArtboard = () => {
    if (selectedShape.text) {
      onUpdateText(data);
      announce('Updated selected text on the artboard');
    } else {
      onAddText(data);
      announce('Text added to the artboard — drag, scale, and rotate it there');
    }
  };

  return <div className="text-svg-panel" data-testid="text-svg-panel">
    <h2 className="properties-title">Text to SVG</h2>
    <p className="hint" style={{ marginTop: -8 }}>Keep live typography, or import a font to create real editable glyph outlines. Build ordered pen strokes, tune timing, and convert glyphs into ordinary ShapeForge paths for node editing.</p>
    <Section title="Text & typography">
      <label className="field-label" htmlFor="text-svg-content">Text</label>
      <textarea id="text-svg-content" className="boundary-input" value={text} onChange={event => setText(event.target.value)} maxLength={300} rows={4} data-testid="text-svg-content" />
      <label className="field-label" htmlFor="text-svg-font">Font family</label>
      <input id="text-svg-font" className="generate-select" list="text-svg-font-options" value={font} onChange={event => setFont(event.target.value)} data-testid="text-svg-font" />
      <datalist id="text-svg-font-options">{FONT_OPTIONS.map(option => <option key={option} value={option} />)}</datalist>
      <label className="field-label" htmlFor="text-svg-font-file">Font file for vector outlines</label>
      <input id="text-svg-font-file" className="generate-select" type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={event => { void importFont(event.target.files?.[0]); event.currentTarget.value = ''; }} data-testid="text-svg-font-file" />
      <p className="hint">{loadedFont ? `Vector outlines loaded: ${loadedFont.getEnglishName('family')}` : vectorGlyphs.length ? `${vectorGlyphs.length} saved vector glyphs available` : 'Import a TTF/OTF/WOFF font to extract real SVG glyph paths. Live system-font text remains available without conversion.'}</p>
      <div className="field-row">
        <label className="field-label text-svg-weight" htmlFor="text-svg-weight">Weight
          <select id="text-svg-weight" className="generate-select" value={weight} onChange={event => setWeight(event.target.value)} data-testid="text-svg-weight">
            <option value="400">Regular</option><option value="600">Semibold</option><option value="700">Bold</option><option value="900">Black</option>
          </select>
        </label>
        <label className="field-label text-svg-weight" htmlFor="text-svg-size">Size
          <input id="text-svg-size" className="generate-select" type="number" min={12} max={320} value={fontSize} onChange={event => setFontSize(Math.max(12, Math.min(320, Number(event.target.value) || 12)))} data-testid="text-svg-size" />
        </label>
      </div>
      <Switch label="Italic" checked={italic} onChange={setItalic} testId="text-svg-italic" />
      <ValueControl label="Letter spacing" value={letterSpacing} min={-10} max={40} unit="px" onChange={setLetterSpacing} testId="text-svg-letter-spacing" />
      <ValueControl label="Line spacing" value={lineSpacing} min={80} max={240} unit="%" onChange={setLineSpacing} testId="text-svg-line-spacing" />
      <label className="field-label" htmlFor="text-svg-fill">Fill color</label>
      <input id="text-svg-fill" className="text-svg-color" type="color" value={fill} disabled={draw} onChange={event => setFill(event.target.value)} data-testid="text-svg-fill" />
    </Section>
    <Section title="Shape individual characters">
      <p className="hint">Choose a character and adjust its position, rotation, and proportions independently.</p>
      <label className="field-label" htmlFor="text-svg-glyph">Character</label>
      <select id="text-svg-glyph" className="generate-select" value={selectedGlyph} onChange={event => setSelectedGlyph(Number(event.target.value))} data-testid="text-svg-glyph">
        {chars.map(({ char, index }, ordinal) => <option key={`${index}-${char}`} value={index}>{ordinal + 1}: {char === ' ' ? 'Space' : char}</option>)}
      </select>
      {chars.length > 0 && <>
        <ValueControl label="Horizontal offset" value={activeGlyph.x} min={-160} max={160} unit="px" onChange={x => updateGlyph({ x })} testId="text-svg-glyph-x" />
        <ValueControl label="Baseline offset" value={activeGlyph.y} min={-160} max={160} unit="px" onChange={y => updateGlyph({ y })} testId="text-svg-glyph-y" />
        <ValueControl label="Rotation" value={activeGlyph.rotation} min={-180} max={180} unit="°" onChange={rotation => updateGlyph({ rotation })} testId="text-svg-glyph-rotation" />
        <ValueControl label="Horizontal scale" value={activeGlyph.scaleX} min={25} max={200} unit="%" onChange={scaleX => updateGlyph({ scaleX })} testId="text-svg-glyph-scale-x" />
        <ValueControl label="Vertical scale" value={activeGlyph.scaleY} min={25} max={200} unit="%" onChange={scaleY => updateGlyph({ scaleY })} testId="text-svg-glyph-scale-y" />
      </>}
    </Section>
    <Section title="Preview & drawing">
      <div className="field-row">
        <button type="button" className={`btn ${drawing ? 'primary' : ''}`} onClick={() => { setDrawing(value => !value); setDrawingPreview(''); }} data-testid="text-svg-draw-stroke">{drawing ? 'Cancel drawing' : 'Draw stroke'}</button>
        {drawing && <span className="hint">Draw a continuous stroke over the preview.</span>}
      </div>
      <div className={`text-svg-preview ${drawing ? 'drawing' : ''}`} data-testid="text-svg-preview" onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawUp} onPointerCancel={drawUp}>
        <div dangerouslySetInnerHTML={{ __html: svg }} />
        {drawingPreview && <svg className="text-svg-drawing-overlay" viewBox={`0 0 ${data.width} ${data.height}`} aria-hidden="true"><path d={drawingPreview} /></svg>}
      </div>
      <div className="field-row">
        <button type="button" className="btn" onClick={copySvg} data-testid="text-svg-copy"><Clipboard />Copy SVG</button>
        <button type="button" className="btn primary" onClick={downloadSvg} data-testid="text-svg-download"><Download />Download SVG</button>
      </div>
      <button type="button" className="btn primary wide" onClick={applyToArtboard} data-testid="text-svg-add-to-artboard">{selectedShape.text ? <RefreshCw /> : <Plus />}{selectedShape.text ? 'Update text on artboard' : 'Add text to artboard'}</button>
      <button type="button" className="btn wide" disabled={!data.vectorGlyphs?.length} onClick={editGlyphShapes} data-testid="text-svg-edit-glyphs">Convert characters to editable artboard paths</button>
      {(data.vectorGlyphs?.length ?? 0) > 0 && <p className="hint">Each converted character becomes a separate editable path object. Select it on the artboard to move nodes or handles.</p>}
      <label className="field-label" htmlFor="text-svg-output">SVG markup</label>
      <textarea id="text-svg-output" className="boundary-input text-svg-output" value={svg} readOnly rows={8} spellCheck={false} data-testid="text-svg-output" />
    </Section>
    <Section title="Handwriting draw animation">
      <Switch label="Animate real SVG strokes" checked={draw} onChange={setDraw} testId="text-svg-draw" />
      <p className="hint">Text is never animated with a reveal mask. Imported font outlines and hand-drawn paths use SVG strokes with dasharray/dashoffset.</p>
      <div className="field-row">
        <button type="button" className="btn" onClick={useHandwritingPreset} data-testid="text-svg-smart-presets"><Upload />Smart letter strokes</button>
        <button type="button" className="btn" onClick={addDecoration} data-testid="text-svg-add-stroke"><Plus />Add SVG path</button>
      </div>
      {draw && !vectorGlyphs.length && !animationStrokes.length && <p className="boundary-note">Import a font outline or choose a handwriting preset. Live SVG text alone has no vector path to draw.</p>}
      {draw && <>
        <label className="field-label" htmlFor="text-svg-draw-color">Stroke color</label>
        <input id="text-svg-draw-color" className="text-svg-color" type="color" value={drawColor} onChange={event => setDrawColor(event.target.value)} data-testid="text-svg-draw-color" />
        <ValueControl label="Stroke width" value={drawWidth} min={1} max={12} step={0.5} unit="px" onChange={setDrawWidth} testId="text-svg-draw-width" />
        <ValueControl label="Default total draw duration" value={duration} min={0.1} max={12} step={0.1} unit="s" onChange={setDuration} testId="text-svg-duration" />
        <p className="hint">Stroke order runs top to bottom. Move paths to reorder; positive overlap starts the next stroke before the current one ends.</p>
        <div className="text-svg-strokes" data-testid="text-svg-stroke-list">
          {animationStrokes.map((path, index) => <div className="text-svg-stroke" key={path.id} data-testid="text-svg-stroke">
            <div className="text-svg-stroke-head">
              <input className="generate-select" aria-label={`Stroke ${index + 1} name`} value={path.name} onChange={event => updateStroke(index, { name: event.target.value })} />
              <button type="button" className="icon-btn" aria-label={`Move stroke ${index + 1} up`} disabled={index === 0} onClick={() => moveStroke(index, -1)}><ArrowUp /></button>
              <button type="button" className="icon-btn" aria-label={`Move stroke ${index + 1} down`} disabled={index === animationStrokes.length - 1} onClick={() => moveStroke(index, 1)}><ArrowDown /></button>
              <button type="button" className="icon-btn danger" aria-label={`Delete stroke ${index + 1}`} onClick={() => setStrokePaths(current => (current.length ? current : animationStrokes).filter((_, i) => i !== index))}><Trash2 /></button>
            </div>
            <label className="field-label" htmlFor={`text-svg-path-${index}`}>SVG path data</label>
            <textarea id={`text-svg-path-${index}`} className="boundary-input" rows={2} value={pathDrafts[path.id] ?? path.d} onChange={event => setPathDrafts(current => ({ ...current, [path.id]: event.target.value }))} onBlur={() => commitPathDraft(path)} aria-label={`Stroke ${index + 1} SVG path`} data-testid="text-svg-stroke-path" />
            <div className="field-row">
              <Switch label="Reverse direction" checked={path.reverse} onChange={reverse => updateStroke(index, { reverse })} testId={`text-svg-stroke-reverse-${index}`} />
              <Switch label="Closed path" checked={path.closed} onChange={closed => updateStroke(index, { closed })} testId={`text-svg-stroke-closed-${index}`} />
            </div>
            <ValueControl label="Start point" value={path.startPercent} min={0} max={99} step={1} unit="%" onChange={startPercent => updateStroke(index, { startPercent })} testId={`text-svg-stroke-start-${index}`} />
            <div className="field-row text-svg-stroke-timing">
              <ValueControl label="Duration" value={path.duration} min={0.05} max={12} step={0.05} unit="s" onChange={strokeDuration => updateStroke(index, { duration: strokeDuration })} testId={`text-svg-stroke-duration-${index}`} />
              <ValueControl label="Pause after" value={path.pauseAfter} min={0} max={5} step={0.05} unit="s" onChange={pauseAfter => updateStroke(index, { pauseAfter })} testId={`text-svg-stroke-pause-${index}`} />
            </div>
            <ValueControl label="Overlap next stroke" value={path.overlapNext} min={0} max={2} step={0.05} unit="s" onChange={overlapNext => updateStroke(index, { overlapNext })} testId={`text-svg-stroke-overlap-${index}`} />
            {index > 0 && <button type="button" className="btn" onClick={() => joinStrokeWithPrevious(index)} data-testid={`text-svg-stroke-join-${index}`}><Link2 />Connect to previous stroke</button>}
          </div>)}
        </div>
        {pathError && <p className="boundary-error" role="alert">{pathError}</p>}
      </>}
    </Section>
  </div>;
}