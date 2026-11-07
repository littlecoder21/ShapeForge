import { useMemo, useState } from 'react';
import { DEFAULT_TEXTURE, type TextureData } from '../../engine/model';
import { CONTROLS, normalizeTexture, type TextureControlId } from '../../engine/textureControls';
import { TEXTURES, resolveTextureId, textureSupport } from '../../engine/textures';
import { ValueControl } from '../../../shared/controls';

export default function RuleTextureEditor({ texture, onChange }: { texture: TextureData; onChange: (texture: TextureData) => void }) {
  const [query, setQuery] = useState('');
  const selected = resolveTextureId(texture.pattern);
  const support = useMemo(() => textureSupport(texture), [texture]);
  const options = TEXTURES.filter(item => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const patch = (change: Partial<TextureData>) => onChange(normalizeTexture({ ...texture, ...change }));
  const renderControl = (item: (typeof support.controls)[number]) => {
    const { control, label, options: selectOptions } = item;
    const value = texture[control.id];
    if (control.type === 'select') {
      return <div key={control.id}>
        <label className="field-label" htmlFor={`rig-texture-${control.id}`}>{label}</label>
        <select
          id={`rig-texture-${control.id}`}
          className="generate-select"
          value={String(value)}
          onChange={event => patch({ [control.id]: event.target.value } as Partial<TextureData>)}
        >
          {(selectOptions ?? []).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>;
    }
    return <ValueControl
      key={control.id}
      label={label}
      value={Number(value)}
      min={control.min ?? 0}
      max={control.max ?? 100}
      step={control.step ?? 1}
      unit={control.unit}
      def={Number(control.def)}
      onChange={next => patch({ [control.id as TextureControlId]: next } as Partial<TextureData>)}
    />;
  };

  return <div className="gs-rule-texture" data-testid="rig-rule-texture">
    <label className="field-label" htmlFor="rig-texture-search">Find CSS texture</label>
    <input id="rig-texture-search" className="gs-custom-preset-name" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search texture presets" />
    <label className="field-label" htmlFor="rig-texture-preset">Texture preset</label>
    <select id="rig-texture-preset" className="generate-select" value={selected} onChange={event => patch({ pattern: event.target.value })} data-testid="rig-texture-preset">
      {options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      {!options.some(item => item.id === selected) && <option value={selected}>{selected}</option>}
    </select>
    <ValueControl label="Tile scale" value={texture.scale} min={4} max={240} step={1} unit="px" def={DEFAULT_TEXTURE.scale} onChange={scale => patch({ scale })} />
    <ValueControl label="Density" value={texture.density} min={1} max={100} step={1} unit="%" def={DEFAULT_TEXTURE.density} onChange={density => patch({ density })} />
    <ValueControl label="Opacity" value={texture.opacity} min={0} max={100} step={1} unit="%" def={DEFAULT_TEXTURE.opacity} onChange={opacity => patch({ opacity })} />
    <ValueControl label="Rotation" value={texture.angle} min={0} max={360} step={1} unit="°" def={DEFAULT_TEXTURE.angle} onChange={angle => patch({ angle })} />
    <ValueControl label="Offset X" value={texture.offsetX} min={-120} max={120} step={1} unit="px" def={DEFAULT_TEXTURE.offsetX} onChange={offsetX => patch({ offsetX })} />
    <ValueControl label="Offset Y" value={texture.offsetY} min={-120} max={120} step={1} unit="px" def={DEFAULT_TEXTURE.offsetY} onChange={offsetY => patch({ offsetY })} />
    <ValueControl label="Seed" value={texture.seed} min={1} max={999} step={1} def={DEFAULT_TEXTURE.seed} onChange={seed => patch({ seed })} />
    <label className="field-label" htmlFor="rig-texture-color">Pattern color</label>
    <input id="rig-texture-color" type="color" className="gs-interaction-color" value={texture.color} onChange={event => patch({ color: event.target.value })} />
    <details>
      <summary className="field-label">Advanced CSS texture controls</summary>
      <div className="gs-rule-texture-advanced">{support.controls.map(renderControl)}</div>
    </details>
  </div>;
}
