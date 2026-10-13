import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';

/* Small touch-friendly form controls shared by every panel. */

export function Section({ title, hint, open = true, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  const [isOpen, setOpen] = useState(open);
  return <div className={`sec ${isOpen ? 'open' : ''}`}>
    <button type="button" className="sec-head" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}><span>{title}</span>{hint && <small>{hint}</small>}<i aria-hidden /></button>
    {isOpen && <div className="sec-body">{children}</div>}
  </div>;
}

export function Switch({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return <button type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} data-testid={testId}>
    <span>{label}</span><i aria-hidden />
  </button>;
}

export function Seg<T extends string | number>({ value, options, onChange, label, testId }: { value: T; options: { id: NoInfer<T>; label: ReactNode; disabled?: boolean }[]; onChange: (v: NoInfer<T>) => void; label?: string; testId?: string }) {
  return <div className="seg" role="radiogroup" aria-label={label} data-testid={testId}>
    {options.map(o => <button key={String(o.id)} type="button" role="radio" aria-checked={value === o.id} disabled={o.disabled} className={value === o.id ? 'active' : ''} onClick={() => onChange(o.id)}>{o.label}</button>)}
  </div>;
}

const decimals = (step: number) => (String(step).split('.')[1] ?? '').length;

/** Range slider + exact number box + reset. onChange streams while dragging, onCommit fires once when the gesture ends. */
export function ValueControl({ label, value, min, max, step = 1, unit = '', def, onChange, onBegin, onCommit, testId, hideRange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; def?: number;
  onChange: (v: number) => void; onBegin?: () => void; onCommit?: () => void; testId?: string; hideRange?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const sliderActive = useRef(false);
  const dp = decimals(step);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const beginSlider = () => { if (!sliderActive.current) { sliderActive.current = true; onBegin?.(); } };
  const endSlider = () => { if (sliderActive.current) { sliderActive.current = false; onCommit?.(); } };
  const commitDraft = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(',', '.'));
    setDraft(null);
    if (Number.isFinite(v)) { onChange(clamp(step >= 1 ? Math.round(v) : Math.round(v / step) * step)); onCommit?.(); }
  };
  const bump = (dir: 1 | -1) => { onChange(clamp(Math.round((value + dir * step) / step) * step)); onCommit?.(); };
  return <div className="vc">
    <div className="vc-head">
      <label className="vc-label" onDoubleClick={() => { if (def !== undefined) { onChange(def); onCommit?.(); } }}>{label}</label>
      <div className="vc-num">
        <button type="button" className="vc-step" aria-label={`Decrease ${label}`} onClick={() => bump(-1)}><Minus /></button>
        <input aria-label={label} inputMode="decimal" value={draft ?? String(Number(value.toFixed(dp)))} onChange={e => setDraft(e.target.value)} onBlur={commitDraft}
          onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); } if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); } }} data-testid={testId ? `${testId}-num` : undefined} />
        {unit && <span className="vc-unit">{unit}</span>}
        <button type="button" className="vc-step" aria-label={`Increase ${label}`} onClick={() => bump(1)}><Plus /></button>
        {def !== undefined && <button type="button" className="vc-reset" aria-label={`Reset ${label}`} disabled={value === def} onClick={() => { onChange(def); onCommit?.(); }}><RotateCcw /></button>}
      </div>
    </div>
    {!hideRange && <>
      <input className="vc-slider" type="range" aria-label={`${label} slider`} min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerDown={beginSlider}
        onPointerUp={endSlider}
        onPointerCancel={endSlider}
        onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) beginSlider(); }}
        onKeyUp={endSlider}
        onBlur={endSlider}
        data-testid={testId} />
      <div className="vc-range"><span>{min}{unit}</span><span>{max}{unit}</span></div>
    </>}
  </div>;
}

/** Exact numeric field: edit freely, commit on Enter/blur. */
export function NumField({ label, value, onCommit, step = 1, min = -5000, max = 5000, unit, disabled, dp = 1, testId, wide }: {
  label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; disabled?: boolean; dp?: number; testId?: string; wide?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = String(Number(value.toFixed(dp)));
  const prev = useRef(shown);
  useEffect(() => { if (prev.current !== shown) { prev.current = shown; setDraft(null); } }, [shown]);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commit = (raw?: string) => {
    const txt = raw ?? draft;
    setDraft(null);
    if (txt === null) return;
    const v = parseFloat(txt.replace(',', '.'));
    if (Number.isFinite(v)) onCommit(clamp(v));
  };
  const bump = (dir: number) => onCommit(clamp(Math.round((value + dir * step) * 1000) / 1000));
  return <label className={`nf ${wide ? 'wide' : ''} ${disabled ? 'disabled' : ''}`}>
    <span className="nf-label">{label}</span>
    <span className="nf-box">
      <button type="button" tabIndex={-1} aria-label={`Decrease ${label}`} disabled={disabled} onClick={() => bump(-1)}><Minus /></button>
      <input inputMode="decimal" disabled={disabled} value={draft ?? shown} onChange={e => setDraft(e.target.value)} onFocus={e => e.target.select()} onBlur={() => commit()}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'ArrowUp') { e.preventDefault(); bump(e.shiftKey ? step * 10 : step); } if (e.key === 'ArrowDown') { e.preventDefault(); bump(-(e.shiftKey ? step * 10 : step)); } }} data-testid={testId} />
      {unit && <em>{unit}</em>}
      <button type="button" tabIndex={-1} aria-label={`Increase ${label}`} disabled={disabled} onClick={() => bump(1)}><Plus /></button>
    </span>
  </label>;
}
