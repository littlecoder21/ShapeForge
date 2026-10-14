import { useState, type ChangeEvent } from 'react';
import { FileUp, ScanLine } from 'lucide-react';
import { importShapeText } from '../../lib/shape/svgImport';
import type { ShapeModel } from '../../lib/shape/geometry';

type Props = {
  onAddShapes: (shapes: ShapeModel[]) => void;
  onExtractOuter: () => void;
  announce: (message: string) => void;
};

export default function BoundaryPanel({ onAddShapes, onExtractOuter, announce }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const importShapes = () => {
    try {
      const shapes = importShapeText(text);
      onAddShapes(shapes);
      setError('');
      announce(`Imported ${shapes.length} editable shape${shapes.length === 1 ? '' : 's'}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import this shape');
    }
  };
  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const contents = await file.text();
      setText(contents);
      setFileName(file.name);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read this SVG file');
    } finally {
      event.currentTarget.value = '';
    }
  };

  return <div className="boundary-panel" data-testid="import-shape-panel">
    <h2 className="properties-title">Import Shape</h2>
    <p className="hint" style={{ marginTop: -8 }}>Import SVG files or paste SVG markup, path data, <code>polygon()</code>, <code>polyline()</code>, or point coordinates. Imported geometry becomes editable nodes on the page.</p>
    <label className="btn" htmlFor="shape-svg-file"><FileUp />{fileName || 'Choose SVG file'}</label>
    <input id="shape-svg-file" type="file" accept=".svg,image/svg+xml" onChange={loadFile} data-testid="shape-svg-file" hidden />
    <textarea className="boundary-input" value={text} onChange={event => setText(event.target.value)} spellCheck={false} rows={10} aria-label="SVG or path data" data-testid="shape-import-input" />
    {error && <p className="boundary-error" role="alert" data-testid="shape-import-error">{error}</p>}
    <button className="btn primary wide" onClick={importShapes} disabled={!text.trim()} data-testid="shape-import-submit"><FileUp />Import as editable shapes</button>
    <hr className="rule" />
    <h3 className="prec-sub">Extract Outer Shape</h3>
    <p className="hint">Create an editable full-page mask with all visible filled shapes on this page cut out of it.</p>
    <button className="btn wide" onClick={onExtractOuter} data-testid="extract-outer-shape"><ScanLine />Extract Outer Shape</button>
  </div>;
}
