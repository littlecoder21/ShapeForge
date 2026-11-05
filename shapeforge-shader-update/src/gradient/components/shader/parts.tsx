import type { ReactNode } from 'react';
import { ValueControl } from '../../../shared/controls';
import { RIG_FALLOFF_FN, type RigFalloffId } from '../../interactive/rig/model';

export function Num({ label, value, min, max, step = 0.01, def, unit, onChange, testId }: {
  label: string; value: number; min: number; max: number; step?: number; def: number; unit?: string;
  onChange: (value: number) => void; testId?: string;
}) {
  return <ValueControl label={label} value={value} min={min} max={max} step={step} def={def} {...(unit ? { unit } : {})} onChange={onChange} {...(testId ? { testId } : {})} />;
}

export function Select<T extends string>({ label, value, options, onChange, id, groups }: {
  label: string; value: T; options: { id: T; label: string; group?: string }[]; onChange: (value: T) => void; id: string; groups?: boolean;
}) {
  const grouped = groups ? [...new Set(options.map(option => option.group ?? ''))] : null;
  return <div className="gs-field">
    <label className="field-label" htmlFor={id}>{label}</label>
    <select id={id} className="generate-select" value={value} onChange={event => onChange(event.target.value as T)} data-testid={id}>
      {grouped
        ? grouped.map(group => <optgroup key={group} label={group}>{options.filter(option => (option.group ?? '') === group).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</optgroup>)
        : options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </div>;
}

export function Section({ title, aside, children, open = true, testId }: { title: string; aside?: ReactNode; children: ReactNode; open?: boolean; testId?: string }) {
  return <details className="gs-interactive-section gs-sh-section" open={open} {...(testId ? { 'data-testid': testId } : {})}>
    <summary className="gs-section-title"><b>{title}</b>{aside !== undefined && <span>{aside}</span>}</summary>
    <div className="gs-sh-section-body">{children}</div>
  </details>;
}

/** Tiny plot of a falloff curve; the same functions the shader uses. */
export function FalloffChart({ falloff }: { falloff: RigFalloffId }) {
  const fn = RIG_FALLOFF_FN[falloff];
  const points: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const q = i / 48 * 1.6;
    points.push(`${(i / 48 * 120).toFixed(1)},${(34 - Math.max(0, Math.min(1, fn(q))) * 30).toFixed(1)}`);
  }
  return <svg className="gs-falloff-chart" viewBox="0 0 120 38" role="img" aria-label={`${falloff} falloff curve`}>
    <line x1="0" y1="34" x2="120" y2="34" className="axis" />
    <line x1={(1 / 1.6 * 120).toFixed(1)} y1="2" x2={(1 / 1.6 * 120).toFixed(1)} y2="34" className="radius" />
    <polyline points={points.join(' ')} className="curve" />
  </svg>;
}
