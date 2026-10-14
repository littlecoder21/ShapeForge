import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Lock, Plus, Trash2, Unlock } from 'lucide-react';
import type { ShapeModel } from '../../lib/shape/geometry';
import type { Page } from '../state/document';
import { Section } from '../../shared/controls';

const LIBRARY = ['Rectangle', 'Rounded rectangle', 'Half circle', 'Ellipse', 'Triangle', 'Diamond', 'Pentagon', 'Hexagon', 'Octagon', 'Star', 'Heart', 'Arrow', 'Cross', 'Trapezoid', 'Parallelogram', 'Circle', 'Blob'];

export default function PagePanel({ page, shapeId, onSelect, onAdd, onPatch, onDuplicate, onDelete, onMove }: {
  page: Page; shapeId: string; onSelect: (id: string) => void; onAdd: (name: string) => void;
  onPatch: (id: string, patch: Partial<ShapeModel>) => void; onDuplicate: (id: string) => void;
  onDelete: (id: string) => void; onMove: (id: string, dir: -1 | 1) => void;
}) {
  return <div className="page-panel" data-testid="page-panel">
    <h2 className="properties-title">{page.name}</h2>
    <Section title="Shapes on page" hint={`${page.shapes.length} shapes`}>
      <ol className="page-shape-list">
        {[...page.shapes].reverse().map((shape, index) => {
          const actualIndex = page.shapes.length - index - 1;
          return <li key={shape.id} className={`page-shape ${shape.id === shapeId ? 'active' : ''} ${shape.hidden ? 'hidden' : ''}`}>
            <button type="button" className="page-shape-select" onClick={() => onSelect(shape.id!)} aria-current={shape.id === shapeId ? 'true' : undefined}>
              <i style={{ background: shape.fill }} /> <span>{shape.name}</span>
            </button>
            <button type="button" className="icon-btn" aria-label={`${shape.hidden ? 'Show' : 'Hide'} ${shape.name}`} title={shape.hidden ? 'Show shape' : 'Hide shape'}
              onClick={() => onPatch(shape.id!, { hidden: !shape.hidden })}>{shape.hidden ? <EyeOff /> : <Eye />}</button>
            <button type="button" className="icon-btn" aria-label={`${shape.locked ? 'Unlock' : 'Lock'} ${shape.name}`} title={shape.locked ? 'Unlock shape' : 'Lock shape'}
              onClick={() => onPatch(shape.id!, { locked: !shape.locked })}>{shape.locked ? <Lock /> : <Unlock />}</button>
            <button type="button" className="icon-btn" aria-label={`Move ${shape.name} forward`} title="Move forward" disabled={actualIndex === page.shapes.length - 1}
              onClick={() => onMove(shape.id!, 1)}><ArrowUp /></button>
            <button type="button" className="icon-btn" aria-label={`Move ${shape.name} backward`} title="Move backward" disabled={actualIndex === 0}
              onClick={() => onMove(shape.id!, -1)}><ArrowDown /></button>
            <button type="button" className="icon-btn" aria-label={`Duplicate ${shape.name}`} title="Duplicate" onClick={() => onDuplicate(shape.id!)}><Copy /></button>
            <button type="button" className="icon-btn danger" aria-label={`Delete ${shape.name}`} title="Delete"
              onClick={() => onDelete(shape.id!)}><Trash2 /></button>
          </li>;
        })}
      </ol>
    </Section>
    <Section title="Add from library">
      <div className="page-library">
        {LIBRARY.map(name => <button key={name} type="button" className="btn" onClick={() => onAdd(name)}><Plus />{name}</button>)}
      </div>
    </Section>
  </div>;
}
