import { useState } from 'react';
import { X } from 'lucide-react';
import { Switch } from '../../shared/controls';

export interface ApplyOptions { fill: boolean; stroke: boolean; css: boolean }

/** "Apply to Shape" — choose how the gradient is used by the current ShapeForge shape. */
export default function ApplySheet({ shapeName, hasPaint, onApply, onRemove, onClose }: { shapeName: string; hasPaint: boolean; onApply: (o: ApplyOptions) => void; onRemove: () => void; onClose: () => void }) {
  const [o, setO] = useState<ApplyOptions>({ fill: true, stroke: false, css: true });
  return <div className="gs-menu" role="dialog" aria-label="Apply to shape" data-testid="apply-sheet">
    <div className="gs-menu-head"><b>Apply to “{shapeName}”</b><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X /></button></div>
    <Switch label="SVG fill — paint the shape interior" checked={o.fill} onChange={v => setO({ ...o, fill: v })} testId="apply-fill" />
    <Switch label="SVG stroke — paint the outline" checked={o.stroke} onChange={v => setO({ ...o, stroke: v })} testId="apply-stroke" />
    <Switch label="CSS background — HTML + CSS / React exports" checked={o.css} onChange={v => setO({ ...o, css: v })} testId="apply-css" />
    <p className="hint">The gradient stays editable: reopen Create Gradient to adjust it, or remove it to go back to a solid colour.</p>
    <div className="gs-btnrow">
      <button type="button" className="btn primary" onClick={() => onApply(o)} disabled={!o.fill && !o.stroke && !o.css} data-testid="apply-confirm">Apply</button>
      {hasPaint && <button type="button" className="btn danger" onClick={onRemove} data-testid="apply-remove">Remove gradient</button>}
    </div>
  </div>;
}
