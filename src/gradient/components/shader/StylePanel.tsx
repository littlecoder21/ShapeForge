import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { newLayer, uid } from '../../engine/model';
import { normalizeInteractiveSettings } from '../../interactive/types';
import { SHADER_STYLE_GROUPS, SHADER_STYLE_LIST, SHADER_STYLE_MAP, defaultStyleParams, resolveStyleParams, type InteractiveStyle, type ShaderStyleGroup } from '../../interactive/styles';
import { Num, Section } from './parts';
import { useShader } from './context';
import { useStudio } from '../ui';

/** All shader styles live here and only here, with the customisable parameters of the selected one underneath. */
export default function StylePanel() {
  const { primary, targets, patchLayers, settings, setSelected } = useShader();
  const { store, announce } = useStudio();
  const current: InteractiveStyle = primary?.shader?.style ?? settings.style;
  const [group, setGroup] = useState<ShaderStyleGroup | 'All'>('All');
  const def = SHADER_STYLE_MAP[current];
  const values = resolveStyleParams(current, primary?.shader?.styleParams);
  const visible = SHADER_STYLE_LIST.filter(style => group === 'All' || style.group === group);
  const sameStyle = targets.filter(layer => (layer.shader?.style ?? settings.style) === current).map(layer => layer.id);
  const addMidnightInk = () => {
    const controls = {
      speed: 0.8, intensity: 1, distortion: 0.45, distortionScale: 1.8, turbulence: 0.45,
      timeOffset: 0, flowAngle: 0, flowDrift: 0, breath: 0, breathRate: 0.25, rotation: 0, zoom: 1,
      meshDrift: 0.8, meshSpread: 0.75, meshBlend: 1,
    };
    const layer = newLayer('mesh', {
      name: 'Midnight Ink',
      mesh: {
        base: '#05060f',
        core: 40,
        seed: 7,
        points: [
          { id: uid('m'), x: 18, y: 22, color: '#b5caff', alpha: 1, size: 74 },
          { id: uid('m'), x: 50, y: 42, color: '#141a52', alpha: 1, size: 76 },
          { id: uid('m'), x: 82, y: 34, color: '#3a4fd6', alpha: 1, size: 78 },
          { id: uid('m'), x: 30, y: 84, color: '#e5edff', alpha: 1, size: 70 },
          { id: uid('m'), x: 77, y: 79, color: '#4964ec', alpha: 1, size: 82 },
        ],
      },
      shader: { enabled: true, style: 'flow', controls },
    });
    store.update(project => ({
      ...project,
      shader: normalizeInteractiveSettings({
        ...project.shader,
        enabled: true,
        style: 'flow',
        shaderMix: 1,
        quality: 'high',
        speed: controls.speed,
        distortion: controls.distortion,
        distortionScale: controls.distortionScale,
        turbulence: controls.turbulence,
        interactionRadius: 0.33,
        interactionStrength: 0.65,
        glow: 0.2,
        ripplesEnabled: true,
        rippleStrength: 0.55,
        vignette: 0.45,
        filmGrain: 0.2,
      }),
      layers: [layer, ...project.layers],
    }));
    setSelected([]);
    store.select(layer.id);
    announce('Added Midnight Ink. Edit its five mesh points in Gradient > Mesh and tune their motion in Shader > Motion.');
  };

  return <div data-testid="shader-panel-style">
    <Section title="Starter scene">
      <button type="button" className="btn wide" onClick={addMidnightInk} data-testid="shader-starter-midnight-ink">Add Midnight Ink mesh</button>
      <p className="hint">Adds a new editable mesh layer with moving color clouds, pointer interaction, vignette and grain. Existing layers are kept.</p>
    </Section>
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
