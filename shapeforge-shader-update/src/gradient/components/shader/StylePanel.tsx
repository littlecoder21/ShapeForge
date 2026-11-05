import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { SHADER_STYLE_GROUPS, SHADER_STYLE_LIST, SHADER_STYLE_MAP, defaultStyleParams, resolveStyleParams, type InteractiveStyle, type ShaderStyleGroup } from '../../interactive/styles';
import { Num, Section } from './parts';
import { useShader } from './context';

/** All shader styles live here and only here, with the customisable parameters of the selected one underneath. */
export default function StylePanel() {
  const { primary, targets, patchLayers, settings } = useShader();
  const current: InteractiveStyle = primary?.shader?.style ?? settings.style;
  const [group, setGroup] = useState<ShaderStyleGroup | 'All'>('All');
  const def = SHADER_STYLE_MAP[current];
  const values = resolveStyleParams(current, primary?.shader?.styleParams);
  const visible = SHADER_STYLE_LIST.filter(style => group === 'All' || style.group === group);
  const sameStyle = targets.filter(layer => (layer.shader?.style ?? settings.style) === current).map(layer => layer.id);

  return <div data-testid="shader-panel-style">
    <Section title="Style library" aside={`${SHADER_STYLE_LIST.length} styles`}>
      <div className="gs-chip-row" role="tablist" aria-label="Style groups">
        {(['All', ...SHADER_STYLE_GROUPS] as const).map(item => <button key={item} type="button" role="tab" aria-selected={group === item} className={`chip ${group === item ? 'active' : ''}`} onClick={() => setGroup(item)}>{item}</button>)}
      </div>
      <div className="gs-style-grid" data-testid="shader-style-grid">
        {visible.map(style => <button
          key={style.id}
          type="button"
          className={`gs-style-card ${style.id === current ? 'active' : ''}`}
          onClick={() => patchLayers({ style: style.id, enabled: true, styleParams: undefined }, undefined, 'style')}
          title={style.blurb}
          aria-pressed={style.id === current}
          data-testid={`shader-style-${style.id}`}
        >
          <b>{style.label}</b>
          <small>{style.blurb}</small>
          {style.isNew && <i className="gs-new-badge">new</i>}
        </button>)}
      </div>
      <p className="hint">Applies to {targets.length > 1 ? `the ${targets.length} selected layers` : 'the highlighted layer'}. Switching style turns the shader on for those layers.</p>
    </Section>
    <Section title={`Customize ${def.label}`} aside={def.params.length ? `${def.params.length} controls` : 'built-in look'}>
      {def.params.length === 0 && <p className="hint">{def.label} has no extra controls. Use Motion and Finish for speed, distortion and tone, or pick one of the new styles for deeper customization.</p>}
      {def.params.map((param, index) => <Num
        key={`${current}-${param.label}`}
        label={param.label}
        value={values[index]}
        min={param.min}
        max={param.max}
        step={param.step}
        def={param.def}
        {...(param.unit ? { unit: param.unit } : {})}
        onChange={value => {
          const next = [...values];
          next[index] = value;
          patchLayers({ styleParams: next }, sameStyle, `style-param-${index}`);
        }}
        testId={`shader-style-param-${index}`}
      />)}
      {def.params.length > 0 && <button type="button" className="btn wide" onClick={() => patchLayers({ styleParams: defaultStyleParams(current) }, sameStyle)} data-testid="shader-style-reset"><RotateCcw />Reset {def.label}</button>}
    </Section>
  </div>;
}
