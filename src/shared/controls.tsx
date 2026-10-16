import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';

/* Small touch-friendly form controls shared by every panel. */

type DirectionAwareRangeProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'onChange'> & {
  onValueChange: (value: string) => void;
  onTouchIntentStart?: () => void;
  onTouchIntentEnd?: () => void;
};

type RangeTouch = {
  pointerId: number;
  startX: number;
  startY: number;
  initialValue: string;
  candidateValue: string;
  direction: 'pending' | 'horizontal' | 'vertical';
  notifiedValue: string;
};

export function DirectionAwareRange({
  onValueChange,
  onTouchIntentStart,
  onTouchIntentEnd,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  ...props
}: DirectionAwareRangeProps) {
  const touch = useRef<RangeTouch | null>(null);

  const publishCandidate = (input: HTMLInputElement, gesture: RangeTouch) => {
    if (gesture.candidateValue !== gesture.initialValue && gesture.notifiedValue !== gesture.candidateValue) {
      input.value = gesture.candidateValue;
      gesture.notifiedValue = gesture.candidateValue;
      onValueChange(gesture.candidateValue);
    }
  };

  const finishTouch = (input: HTMLInputElement, gesture: RangeTouch, cancelled: boolean) => {
    if (gesture.direction === 'horizontal') {
      publishCandidate(input, gesture);
      onTouchIntentEnd?.();
    } else if (!cancelled && gesture.direction === 'pending') {
      onTouchIntentStart?.();
      publishCandidate(input, gesture);
      onTouchIntentEnd?.();
    }
    input.value = gesture.direction === 'vertical' || (cancelled && gesture.direction !== 'horizontal')
      ? gesture.initialValue
      : gesture.candidateValue;
    touch.current = null;
  };

  return <input
    {...props}
    type="range"
    onChange={event => {
      const gesture = touch.current;
      if (gesture) {
        gesture.candidateValue = event.currentTarget.value;
        if (gesture.direction !== 'horizontal') {
          event.currentTarget.value = gesture.initialValue;
          return;
        }
        gesture.notifiedValue = gesture.candidateValue;
      }
      onValueChange(event.currentTarget.value);
    }}
    onPointerDown={event => {
      if (event.pointerType === 'touch') {
        touch.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          initialValue: event.currentTarget.value,
          candidateValue: event.currentTarget.value,
          direction: 'pending',
          notifiedValue: event.currentTarget.value,
        };
        return;
      }
      onPointerDown?.(event);
    }}
    onPointerMove={event => {
      const gesture = touch.current;
      if (gesture?.pointerId === event.pointerId && gesture.direction === 'pending') {
        const dx = Math.abs(event.clientX - gesture.startX);
        const dy = Math.abs(event.clientY - gesture.startY);
        if (Math.max(dx, dy) >= 8) {
          gesture.direction = dx > dy ? 'horizontal' : 'vertical';
          if (gesture.direction === 'horizontal') {
            onTouchIntentStart?.();
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            publishCandidate(event.currentTarget, gesture);
          } else {
            event.currentTarget.value = gesture.initialValue;
          }
        }
      }
      onPointerMove?.(event);
    }}
    onPointerUp={event => {
      const gesture = touch.current;
      if (gesture?.pointerId === event.pointerId) finishTouch(event.currentTarget, gesture, false);
      else onPointerUp?.(event);
    }}
    onPointerCancel={event => {
      const gesture = touch.current;
      if (gesture?.pointerId === event.pointerId) finishTouch(event.currentTarget, gesture, true);
      else onPointerCancel?.(event);
    }}
    onLostPointerCapture={event => {
      const gesture = touch.current;
      if (gesture?.pointerId === event.pointerId) finishTouch(event.currentTarget, gesture, true);
      else onLostPointerCapture?.(event);
    }}
  />;
}

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
  const beginSlider = (e?: RPointerEvent<HTMLInputElement>) => {
    if (!sliderActive.current) { sliderActive.current = true; onBegin?.(); }
    if (e && e.currentTarget.hasPointerCapture(e.pointerId) === false) e.currentTarget.setPointerCapture(e.pointerId);
  };
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
      <DirectionAwareRange className="vc-slider" aria-label={`${label} slider`} min={min} max={max} step={step} value={value}
        onValueChange={v => onChange(Number(v))}
        onPointerDown={beginSlider}
        onPointerUp={endSlider}
        onPointerCancel={endSlider}
        onLostPointerCapture={endSlider}
        onTouchIntentStart={() => {
          if (!sliderActive.current) { sliderActive.current = true; onBegin?.(); }
        }}
        onTouchIntentEnd={endSlider}
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
