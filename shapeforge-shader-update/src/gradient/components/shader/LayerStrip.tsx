import { useMemo } from 'react';
import type { GradientLayer } from '../../engine/model';
import { SHADER_STYLE_MAP } from '../../interactive/styles';
import { useShader } from './context';

function swatch(layer: GradientLayer): string {
  const colors = layer.type === 'mesh' && layer.mesh?.points?.length
    ? layer.mesh.points.slice(0, 4).map(point => point.color)
    : layer.solidColor !== undefined ? [layer.solidColor, layer.solidColor]
      : (layer.stops ?? []).slice(0, 5).map(stop => stop.color);
  const list = colors.length > 1 ? colors : [colors[0] ?? '#7c5cff', colors[0] ?? '#7c5cff'];
  return `linear-gradient(135deg, ${list.join(', ')})`;
}

/** Every layer in one minimal list: pick several, flip shader on / off, select all. No trips back to the Layers panel. */
export default function LayerStrip() {
  const { layers, primary, selected, setSelected, patchLayers, focusLayer } = useShader();
  const allIds = useMemo(() => layers.map(layer => layer.id), [layers]);
  const enabledCount = layers.filter(layer => layer.shader?.enabled).length;
  const allSelected = layers.length > 0 && selected.length === layers.length;
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
  return <section className="gs-layer-strip" aria-label="Shader layers" data-testid="shader-layer-strip">
    <div className="gs-layer-strip-head">
      <b>Layers</b>
      <span className="gs-layer-strip-count">{enabledCount} shader · {selected.length ? `${selected.length} selected` : 'none selected'}</span>
    </div>
    <div className="gs-layer-strip-actions" role="group" aria-label="Layer selection">
      <button type="button" className="chip" onClick={() => setSelected(allSelected ? [] : allIds)} data-testid="shader-select-all">{allSelected ? 'Select none' : 'Select all'}</button>
      <button type="button" className="chip" onClick={() => patchLayers({ enabled: true }, selected.length ? selected : allIds)} data-testid="shader-all-on">Shader on</button>
      <button type="button" className="chip" onClick={() => patchLayers({ enabled: false }, selected.length ? selected : allIds)} data-testid="shader-all-off">Shader off</button>
    </div>
    <ul className="gs-layer-strip-list">
      {layers.map(layer => {
        const on = !!layer.shader?.enabled;
        const isSelected = selected.includes(layer.id);
        return <li key={layer.id} className={`gs-layer-row ${primary?.id === layer.id ? 'primary' : ''} ${isSelected ? 'selected' : ''}`}>
          <input type="checkbox" checked={isSelected} onChange={() => toggle(layer.id)} aria-label={`Edit ${layer.name || layer.type}`} data-testid={`shader-select-${layer.id}`} />
          <span className="gs-layer-swatch" style={{ background: swatch(layer) }} aria-hidden="true" />
          <button type="button" className="gs-layer-name" onClick={() => { focusLayer(layer.id); setSelected([layer.id]); }} title="Edit only this layer">
            <span>{layer.name || layer.type}</span>
            <small>{on ? SHADER_STYLE_MAP[layer.shader?.style ?? 'flow'].label : 'CSS only'}{layer.visible ? '' : ' · hidden'}</small>
          </button>
          <button type="button" role="switch" aria-checked={on} aria-label={`Shader on ${layer.name || layer.type}`} className={`gs-mini-switch ${on ? 'on' : ''}`} onClick={() => patchLayers({ enabled: !on }, [layer.id])} data-testid={`shader-layer-toggle-${layer.id}`}><i /></button>
        </li>;
      })}
    </ul>
    {!selected.length && <p className="hint">Tick layers to edit several at once; with nothing ticked, edits go to the highlighted layer.</p>}
  </section>;
}
