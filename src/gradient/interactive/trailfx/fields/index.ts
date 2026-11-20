import type { TrailFxColorDef, TrailFxParamDef } from '../model';
import { buildFieldSources } from './chunks';
import { FINISH_SPECS } from './finish';
import { INK_SPECS } from './gens.ink';
import { FLOW_SPECS } from './gens.flow';
import { AGE_SPECS, GROWTH_SPECS, WAVE_SPECS } from './gens.rest';
import type { FieldSpec } from './spec';

/* The 25 field generators + 4 finish passes, in the shape model.ts and shaders.generated.ts want them. */

export const FIELD_SPECS: FieldSpec[] = [...INK_SPECS, ...FLOW_SPECS, ...WAVE_SPECS, ...GROWTH_SPECS, ...AGE_SPECS];

export interface FieldKindDef {
  id: string; label: string; icon: string; blurb: string; family: string;
  params: TrailFxParamDef[]; colors?: TrailFxColorDef;
}

export const FIELD_KIND_DEFS: FieldKindDef[] = [
  ...FIELD_SPECS.map(spec => ({ id: spec.id, label: spec.label, icon: spec.icon, blurb: spec.blurb, family: spec.family, params: spec.params, colors: spec.colors })),
  ...FINISH_SPECS.map(spec => ({ id: spec.id, label: spec.label, icon: spec.icon, blurb: spec.blurb, family: 'Finish', params: spec.params, ...(spec.colors ? { colors: spec.colors } : {}) })),
];

/** shader sources keyed by pass kind: field generators have a feedback ("trail") shader and a render shader; finish passes only a render shader */
export const FIELD_SOURCES: Record<string, { frag: string[]; trail?: string; steps?: number }> = Object.fromEntries([
  ...FIELD_SPECS.map(spec => [spec.id, buildFieldSources(spec)] as const),
  ...FINISH_SPECS.map(spec => [spec.id, { frag: [spec.frag] }] as const),
]);

/** one ready-made look per generator, grouped by family, each followed by a finish pass where it helps */
export interface FieldPresetRow {
  id: string; label: string; group: string; description: string;
  opacity?: number; blend?: string; palette?: string[];
  passes: { kind: string; p?: Record<string, number>; colors?: string[]; text?: string }[];
}
export const FIELD_PRESET_ROWS: FieldPresetRow[] = FIELD_SPECS.map(spec => ({
  id: `fx-${spec.id}`,
  label: spec.preset.label,
  group: spec.family,
  description: spec.preset.description,
  ...(spec.preset.opacity !== undefined ? { opacity: spec.preset.opacity } : {}),
  ...(spec.preset.blend ? { blend: spec.preset.blend } : {}),
  passes: [
    { kind: spec.id, ...(spec.preset.p ? { p: spec.preset.p } : {}), ...(spec.preset.colors ? { colors: spec.preset.colors } : {}) },
    ...(spec.preset.after ?? []),
  ],
}));

export const FIELD_FAMILIES = [...new Set(FIELD_SPECS.map(spec => spec.family))];
