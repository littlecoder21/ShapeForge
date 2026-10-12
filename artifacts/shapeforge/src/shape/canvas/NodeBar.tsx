import { CheckSquare, Lock, Trash2, Unlock, X } from 'lucide-react';

/** Small floating bar while nodes are selected: multi-select mode, select all, lock, delete, clear. */
export interface NodeBarProps { count: number; multi: boolean; allLocked: boolean; onMulti(): void; onAll(): void; onLock(): void; onDelete(): void; onClear(): void }

export default function NodeBar({ count, multi, allLocked, onMulti, onAll, onLock, onDelete, onClear }: NodeBarProps) {
  return <div className="node-bar" role="toolbar" aria-label="Selected nodes" onPointerDown={e => e.stopPropagation()} data-testid="node-bar">
    <span className="nb-count" aria-live="polite">{count}</span>
    <button type="button" className={`nm-btn ${multi ? 'on' : ''}`} onClick={onMulti} aria-pressed={multi} aria-label="Multi-select mode: tap nodes to add or remove" title="Multi-select" data-testid="nb-multi"><CheckSquare /></button>
    <button type="button" className="nm-btn txt" onClick={onAll} aria-label="Select all nodes" title="Select all" data-testid="nb-all">All</button>
    <button type="button" className={`nm-btn ${allLocked ? 'on' : ''}`} onClick={onLock} aria-label={allLocked ? 'Unlock selected nodes' : 'Lock selected nodes'} title={allLocked ? 'Unlock' : 'Lock'} data-testid="nb-lock">{allLocked ? <Unlock /> : <Lock />}</button>
    <button type="button" className="nm-btn danger" onClick={onDelete} aria-label="Delete selected nodes" title="Delete" data-testid="nb-delete"><Trash2 /></button>
    <button type="button" className="nm-btn" onClick={onClear} aria-label="Clear selection" title="Clear" data-testid="nb-clear"><X /></button>
  </div>;
}
