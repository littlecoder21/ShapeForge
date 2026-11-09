import { normalizeProcedural, type MeshComposite, type MeshRenderMode, type ProceduralConfig } from '../../../procedural/types';

/* Mesh rendering controls for the procedural panel: how the layer's mesh points are drawn by the WebGL engine.
 * Self-contained (plain elements, no panel components) so it can be dropped into ProceduralPanel.tsx as
 *     <MeshRenderControls value={config} onChange={commit} pointCount={layer.mesh.points.length} />
 * `commit` is whatever function the panel already uses to store a new ProceduralConfig. Changing a mode only edits
 * `config.mesh`; the layer's mesh points are never touched, so switching back and forth loses nothing. */

interface Props {
  value: ProceduralConfig;
  onChange: (next: ProceduralConfig) => void;
  /** number of points in the layer's mesh (shown in the summary) */
  pointCount?: number;
}

const MODES: ReadonlyArray<{ id: MeshRenderMode; label: string; hint: string }> = [
  { id: 'css-compatible', label: 'CSS-compatible', hint: 'The same stacked radial gradients as the CSS mesh, composited in one shader pass.' },
  { id: 'unified-field', label: 'Unified field', hint: 'Every point feeds one continuous field (the blend method under "Field").' },
];
const COMPOSITES: ReadonlyArray<{ id: MeshComposite; label: string; hint: string }> = [
  { id: 'background', label: 'Flat / export', hint: 'Source-over stack of radial gradients with the core hint (what the exported CSS does).' },
  { id: 'layered', label: 'Studio preview', hint: 'Screen-blended point boxes with a linear ramp (what the layered preview does).' },
];

export default function MeshRenderControls({ value, onChange, pointCount }: Props) {
  const mesh = value.mesh;
  const edit = (patch: Partial<ProceduralConfig['mesh']>) => onChange(normalizeProcedural({ ...value, mesh: { ...mesh, ...patch } }, value));
  const linked = mesh.source === 'layer';
  const mode = MODES.find(item => item.id === mesh.render) ?? MODES[1];
  return (
    <div className="gs-mesh-render" data-testid="gs-mesh-render">
      <div role="radiogroup" aria-label="Mesh render mode" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {MODES.map(item => (
          <button
            key={item.id} type="button" role="radio" aria-checked={mesh.render === item.id} title={item.hint}
            className={mesh.render === item.id ? 'on' : ''} onClick={() => edit({ render: item.id })}
          >{item.label}</button>
        ))}
      </div>
      <p style={{ margin: '6px 0', opacity: 0.7, fontSize: 12 }}>{mode.hint}</p>
      {mesh.render === 'css-compatible' && (
        <div role="radiogroup" aria-label="CSS stacking model" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {COMPOSITES.map(item => (
            <button
              key={item.id} type="button" role="radio" aria-checked={mesh.composite === item.id} title={item.hint}
              className={mesh.composite === item.id ? 'on' : ''} onClick={() => edit({ composite: item.id })}
            >{item.label}</button>
          ))}
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <input type="checkbox" checked={linked} onChange={event => edit({ source: event.target.checked ? 'layer' : 'snapshot' })} />
        Stay linked to the layer's mesh{typeof pointCount === 'number' ? ` (${pointCount} point${pointCount === 1 ? '' : 's'})` : ''}
      </label>
      <label style={{ display: 'block', marginTop: 8 }}>
        Default core · {Math.round(mesh.core)}
        <input type="range" min={0} max={100} step={1} value={mesh.core} onChange={event => edit({ core: Number(event.target.value) })} style={{ width: '100%' }} />
      </label>
      <label style={{ display: 'block', marginTop: 4 }}>
        Mesh opacity · {Math.round(mesh.opacity * 100)}%
        <input type="range" min={0} max={1} step={0.01} value={mesh.opacity} onChange={event => edit({ opacity: Number(event.target.value) })} style={{ width: '100%' }} />
      </label>
    </div>
  );
}
