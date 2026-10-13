import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Page } from '../state/document';

export default function PageTabs({ pages, pageId, onSelect, onAdd, onRename, onDelete }: {
  pages: Page[]; pageId: string; onSelect: (id: string) => void; onAdd: () => void;
  onRename: (id: string, name: string) => void; onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const editingRef = useRef<string | null>(null);
  const finishRename = () => {
    const id = editingRef.current;
    editingRef.current = null;
    if (id && name.trim()) onRename(id, name.trim());
    setEditing(null);
  };
  return <nav className="page-tabs" aria-label="Pages" role="tablist">
    {pages.map(page => <div key={page.id} className={`page-tab ${page.id === pageId ? 'active' : ''}`}>
      {editing === page.id
        ? <input autoFocus aria-label="Page name" value={name} onChange={e => setName(e.target.value)} onBlur={finishRename}
            onKeyDown={e => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') { editingRef.current = null; setEditing(null); } }} />
        : <button type="button" role="tab" aria-selected={page.id === pageId} onClick={() => onSelect(page.id)}
            onDoubleClick={() => { setName(page.name); editingRef.current = page.id; setEditing(page.id); }} title="Double-click to rename page">{page.name}</button>}
      {pages.length > 1 && <button type="button" className="page-delete" aria-label={`Delete ${page.name}`} title={`Delete ${page.name}`} onClick={() => onDelete(page.id)}><X /></button>}
    </div>)}
    <button type="button" className="page-add" onClick={onAdd} aria-label="Add page" title="Add page" data-testid="page-add"><Plus /></button>
  </nav>;
}
