import type { ReactNode } from 'react';
import { CheckSquare, Lock, Spline, Square, Trash2, Unlock, X } from 'lucide-react';

/** Compact options for one node (double-tap / double-click): select, lock, corner↔smooth, delete. Icon-only to stay small. */
export interface NodeMenuProps {
  x: number; y: number; width: number; height: number;
  /** how many nodes the actions apply to */
  count: number;
  selected: boolean; locked: boolean; smooth: boolean | null;
  onSelect(): void; onLock(): void; onToggleType(): void; onDelete(): void; onClose(): void;
}

export default function NodeMenu({ x, y, width, height, count, selected, locked, smooth, onSelect, onLock, onToggleType, onDelete, onClose }: NodeMenuProps) {
  const w = smooth === null ? 150 : 190, left = Math.max(8, Math.min(width - w - 8, x - w / 2)), top = y > 90 ? y - 64 : Math.min(height - 52, y + 26);
  const btn = (label: string, on: () => void, icon: ReactNode, extra = '', testId?: string) => <button type="button" className={`nm-btn ${extra}`} onClick={on} aria-label={label} title={label} data-testid={testId}>{icon}</button>;
  return <div className="node-menu" style={{ left, top, width: w }} role="toolbar" aria-label={`Node options${count > 1 ? ` (${count} nodes)` : ''}`} onPointerDown={e => e.stopPropagation()} data-testid="node-menu">
    {btn(selected ? 'Unselect node' : 'Select node', onSelect, selected ? <CheckSquare /> : <Square />, selected ? 'on' : '', 'nm-select')}
    {btn(locked ? 'Unlock node' : 'Lock node', onLock, locked ? <Unlock /> : <Lock />, locked ? 'on' : '', 'nm-lock')}
    {smooth !== null && btn(smooth ? 'Make corner' : 'Make smooth', onToggleType, <Spline />, smooth ? 'on' : '', 'nm-type')}
    {btn('Delete node', onDelete, <Trash2 />, 'danger', 'nm-delete')}
    {count > 1 && <span className="nm-count">{count}</span>}
    {btn('Close', onClose, <X />, '', 'nm-close')}
  </div>;
}
