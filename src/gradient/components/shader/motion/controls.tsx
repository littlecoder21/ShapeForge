import { Switch } from '../../../../shared/controls';
import { MOTION_RANGE } from '../../../../motion/types';
import { Num } from '../parts';
import { MOTION_DEFAULTS, type MotionEditor } from './useMotion';

/** Groups whose numeric fields are all described by MOTION_RANGE; the slider bounds therefore always equal what the validator accepts. */
export type NumericGroup = 'physics' | 'organic' | 'turbulence' | 'interaction' | 'time';
type Bag = Record<string, number | boolean | string>;

export function Slider({ editor, group, field, label, step = 0.01, unit, testId }: { editor: MotionEditor; group: NumericGroup; field: string; label: string; step?: number; unit?: string; testId?: string }) {
  const range = (MOTION_RANGE[group] as Record<string, readonly [number, number]>)[field];
  if (!range) return null;
  const value = Number((editor.config[group] as unknown as Bag)[field]);
  const def = Number((MOTION_DEFAULTS[group] as unknown as Bag)[field]);
  return <Num
    label={label} value={Number.isFinite(value) ? value : def} min={range[0]} max={range[1]} step={step} def={def} {...(unit ? { unit } : {})}
    onChange={next => editor.edit(draft => { (draft[group] as unknown as Bag)[field] = next; }, `motion-${group}-${field}`)} {...(testId ? { testId } : {})}
  />;
}

export function Toggle({ editor, group, field, label, testId }: { editor: MotionEditor; group: 'organic' | 'turbulence' | 'interaction' | 'time' | 'physics'; field: string; label: string; testId?: string }) {
  const value = Boolean((editor.config[group] as unknown as Bag)[field]);
  return <Switch label={label} checked={value} onChange={next => editor.edit(draft => { (draft[group] as unknown as Bag)[field] = next; })} {...(testId ? { testId } : {})} />;
}

export const labelOf = (id: string) => id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
