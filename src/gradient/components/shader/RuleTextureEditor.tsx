import { useMemo, useState } from 'react';
import { DEFAULT_TEXTURE, type TextureData } from '../../engine/model';
import { normalizeTexture, type TextureControlId } from '../../engine/textureControls';
import { TEXTURES, resolveTextureId, textureSupport } from '../../engine/textures';
import { ValueControl } from '../../../shared/controls';
import type { RigRule } from '../../interactive/rig/model';
import { TEXFX_CONTROLS, normalizeTexFx, type RigTextureFx } from '../../interactive/rig/textureFx';
import { TEXTURE_RECIPES, applyTextureRecipe } from '../../interactive/rig/textureRecipes';

interface Props {
  rule: RigRule;
  /** `coalesce` groups the many changes of one slider drag into a single undo step */
  onChange: (rule: RigRule, coalesce?: string) => void;
}

export default function RuleTextureEditor({ rule, onChange }: Props) {
  const texture = rule.texture;
  const fx = rule.texFx;
  const [query, setQuery] = useState('');
  const selected = resolveTextureId(texture.pattern);
  const support = useMemo(() => textureSupport(texture), [texture]);
  const options = TEXTURES.filter(item => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const patch = (change: Partial<TextureData>, coalesce?: string) => onChange({ ...rule, texture: normalizeTexture({ ...texture, ...change }) }, coalesce);
  const patchFx = (change: Partial<RigTextureFx>, coalesce?: string) => onChange({ ...rule, texFx: normalizeTexFx({ ...fx, ...change }) }, coalesce);
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
      onChange={next => patch({ [control.id as TextureControlId]: next } as Partial<TextureData>, `t-${control.id}`)}
    />;
  };

  return <div className="gs-rule-texture" data-testid="rig-rule-texture">
    <label className="field-label">Texture recipes</label>
    <p className="hint">One tap sets the texture, its motion, the source and the blend for a ready-made look. Everything stays editable below.</p>
    <div className="gs-custom-shape-tools" data-testid="rig-texture-recipes">
      {TEXTURE_RECIPES.map(recipe => <button
        key={recipe.id}
        type="button"
        className="btn small"
        title={recipe.blurb}
        onClick={() => onChange(applyTextureRecipe(rule, recipe))}
        data-testid={`rig-texture-recipe-${recipe.id}`}
      >{recipe.label}</button>)}
    </div>

    <label className="field-label" htmlFor="rig-texture-search">Find CSS texture</label>
    <input id="rig-texture-search" className="gs-custom-preset-name" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search texture presets" />
    <label className="field-label" htmlFor="rig-texture-preset">Texture preset</label>
    <select id="rig-texture-preset" className="generate-select" value={selected} onChange={event => patch({ pattern: event.target.value })} data-testid="rig-texture-preset">
      {options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      {!options.some(item => item.id === selected) && <option value={selected}>{selected}</option>}
    </select>
    <ValueControl label="Tile scale" value={texture.scale} min={4} max={240} step={1} unit="px" def={DEFAULT_TEXTURE.scale} onChange={scale => patch({ scale }, 't-scale')} />
    <ValueControl label="Density" value={texture.density} min={1} max={100} step={1} unit="%" def={DEFAULT_TEXTURE.density} onChange={density => patch({ density }, 't-density')} />
    <ValueControl label="Opacity" value={texture.opacity} min={0} max={100} step={1} unit="%" def={DEFAULT_TEXTURE.opacity} onChange={opacity => patch({ opacity }, 't-opacity')} />
    <ValueControl label="Rotation" value={texture.angle} min={0} max={360} step={1} unit="°" def={DEFAULT_TEXTURE.angle} onChange={angle => patch({ angle }, 't-angle')} />
    <ValueControl label="Offset X" value={texture.offsetX} min={-120} max={120} step={1} unit="px" def={DEFAULT_TEXTURE.offsetX} onChange={offsetX => patch({ offsetX }, 't-offsetX')} />
    <ValueControl label="Offset Y" value={texture.offsetY} min={-120} max={120} step={1} unit="px" def={DEFAULT_TEXTURE.offsetY} onChange={offsetY => patch({ offsetY }, 't-offsetY')} />
    <ValueControl label="Seed" value={texture.seed} min={1} max={999} step={1} def={DEFAULT_TEXTURE.seed} onChange={seed => patch({ seed }, 't-seed')} />
    <label className="field-label" htmlFor="rig-texture-color">Pattern color</label>
    <input id="rig-texture-color" type="color" className="gs-interaction-color" value={texture.color} onChange={event => patch({ color: event.target.value }, 't-color')} />

    <label className="field-label" style={{ marginTop: 10 }}>Motion & shading</label>
    <p className="hint">Brings the texture to life: let it drift, spin, sway and twinkle, or pin it to the canvas so the pointer reveals it like a torch.</p>
    <label className="field-label" htmlFor="rig-texture-anchor">Pattern follows</label>
    <select id="rig-texture-anchor" className="generate-select" value={fx.anchor} onChange={event => patchFx({ anchor: event.target.value === 'screen' ? 'screen' : 'pointer' })} data-testid="rig-texture-anchor">
      <option value="pointer">The pointer (moves with it)</option>
      <option value="screen">The canvas (revealed by the pointer)</option>
    </select>
    {TEXFX_CONTROLS.filter(control => !control.when || control.when(fx)).map(control => <ValueControl
      key={control.id}
      label={control.label}
      value={fx[control.id]}
      min={control.min}
      max={control.max}
      step={control.step}
      unit={control.unit}
      def={control.def}
      onChange={next => patchFx({ [control.id]: next } as Partial<RigTextureFx>, `fx-${control.id}`)}
    />)}
    <details>
      <summary className="field-label">Advanced CSS texture controls</summary>
      <div className="gs-rule-texture-advanced">{support.controls.map(renderControl)}</div>
    </details>
  </div>;
}

