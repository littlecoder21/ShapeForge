import { createContext, useContext, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { parseColor } from '../engine/color';
import type { StudioStore } from '../engine/store';

/* Small shared building blocks for Gradient Studio panels. */

export interface StudioCtxValue { store: StudioStore; announce: (m: string) => void }
export const StudioCtx = createContext<StudioCtxValue>(null as unknown as StudioCtxValue);
export const useStudio = () => useContext(StudioCtx);

const CHECKER = 'repeating-conic-gradient(#3a414a 0% 25%, #2a3037 0% 50%) 50% / 12px 12px';

/** Colour swatch (native picker) + hex field + optional alpha. Touch target ≥ 44px. */
export function ColorInput({ color, alpha, onChange, onCommit, showAlpha = true, label, testId }: {
  color: string; alpha: number; onChange: (c: string, a: number) => void; onCommit?: () => void; showAlpha?: boolean; label?: string; testId?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const p = parseColor(draft); setDraft(null);
    if (p) { onChange(p.hex, /^#?[0-9a-f]{8}$|rgba|transparent/i.test(draft) ? p.alpha : alpha); onCommit?.(); }
  };
  return <div className="gs-color">
    <label className="gs-swatch" style={{ background: CHECKER }} aria-label={label ?? 'Colour'}>
      <span style={{ background: color, opacity: Math.max(0.12, alpha) }} />
      <input type="color" value={color} onChange={e => onChange(e.target.value, alpha)} onBlur={() => onCommit?.()} onPointerUp={() => onCommit?.()} data-testid={testId} />
    </label>
    <input className="gs-hex" aria-label={`${label ?? 'Colour'} hex`} value={draft ?? color} spellCheck={false}
      onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} data-testid={testId ? `${testId}-hex` : undefined} />
    {showAlpha && <span className="gs-alpha-tag">{Math.round(alpha * 100)}%</span>}
  </div>;
}

/** Circular angle dial. Drag anywhere on it; snaps to 15° near multiples. */
export function Dial({ value, onChange, onCommit, size = 76, label = 'Angle' }: { value: number; onChange: (a: number) => void; onCommit?: () => void; size?: number; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    let a = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const snap = Math.round(a / 15) * 15; if (e.shiftKey || Math.abs(snap - a) < 3) a = snap % 360;
    onChange(Math.round(a * 10) / 10);
  };
  return <div ref={ref} className="gs-dial" style={{ width: size, height: size }} role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(value)} tabIndex={0}
    onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); move(e); }}
    onPointerMove={e => { if (e.buttons) move(e); }} onPointerUp={() => onCommit?.()}
    onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { onChange((value + 1) % 360); } if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { onChange((value + 359) % 360); } }} onKeyUp={() => onCommit?.()}>
    {[0, 90, 180, 270].map(t => <i key={t} className="gs-dial-tick" style={{ transform: `rotate(${t}deg)` }} />)}
    <i className="gs-dial-needle" style={{ transform: `rotate(${value}deg)` }}><b /></i>
    <span>{Math.round(value)}°</span>
  </div>;
}

export function Empty({ children }: { children: ReactNode }) { return <p className="gs-empty">{children}</p>; }
export { CHECKER };
