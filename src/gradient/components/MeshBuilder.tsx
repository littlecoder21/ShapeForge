import { useState } from 'react';
import { Section, Seg, ValueControl } from '../../shared/controls';
import { applyBuilderLayers } from '../engine/builderLayers';
import { useStore } from '../engine/store';
import { MESH_PATTERNS, generateMesh, type MeshPattern } from '../engine/mesh';
import { newLayer } from '../engine/model';
import { ColorInput, useStudio } from './ui';

const PALETTES: [string, string[]][] = [
  ['Candy', ['#ff7ad9', '#7c5cff', '#22d3ee', '#fbbf24']], ['Aurora', ['#34f5a1', '#22d3ee', '#a78bfa', '#0ea5e9']], ['Sunset', ['#ff6b6b', '#ffb36b', '#c084fc', '#f472b6']],
  ['Ocean', ['#0ea5e9', '#22d3ee', '#6366f1', '#14b8a6']], ['Peach', ['#ffd1ba', '#ffb4a2', '#e5989b', '#b5838d']], ['Neon', ['#ff2fd1', '#2fe9ff', '#7c3aed', '#a3e635']],
];

/** Quick-start: palette + point count + layout → a new mesh layer with movable points. */
export default function MeshBuilder() {
  const { store, announce } = useStudio();
  const [pal, setPal] = useState(0), [count, setCount] = useState(5), [pattern, setPattern] = useState<MeshPattern>('scatter'), [seed, setSeed] = useState(11), [base, setBase] = useState('#0b1020');
  const create = (mode: 'add' | 'update') => {
    const layer = newLayer('mesh', { name: 'Mesh', mesh: generateMesh(PALETTES[pal][1], count, pattern, seed, base, 54), space: 'oklab' });
    if (applyBuilderLayers(store, 'mesh', [layer], mode)) announce(mode === 'update' ? 'Mesh layer updated — drag its points on the canvas' : 'Mesh layer added — drag its points on the canvas');
  };
  const selectedLayer = useStore(store, state => state.project.layers.find(layer => layer.id === state.layerId));
  const canUpdate = selectedLayer?.builderSource === 'mesh' && !!selectedLayer.builderGroup;
  return <div data-testid="mesh-builder">
    <Section title="Palette">
      <div className="gs-palettes">{PALETTES.map(([n, c], i) => <button key={n} type="button" className={`gs-pal ${pal === i ? 'on' : ''}`} onClick={() => setPal(i)} data-testid={`meshgen-pal-${n.toLowerCase()}`}><span>{c.map(x => <i key={x} style={{ background: x }} />)}</span>{n}</button>)}</div>
      <div className="field-label">Base colour</div><ColorInput color={base} alpha={1} showAlpha={false} onChange={setBase} label="Mesh base" />
    </Section>
    <Section title="Points">
      <ValueControl label="Points" value={count} min={2} max={12} def={5} onChange={setCount} testId="meshgen-count" />
      <Seg value={pattern} label="Layout" options={MESH_PATTERNS.map(p => ({ id: p.id, label: p.label }))} onChange={setPattern} />
      <ValueControl label="Seed" value={seed} min={1} max={999} def={11} onChange={setSeed} />
    </Section>
    <div className="gs-btnrow">
      <button type="button" className="btn primary" onClick={() => create('add')} data-testid="meshgen-create">Create mesh layer</button>
      <button type="button" className="btn" disabled={!canUpdate} onClick={() => create('update')} data-testid="meshgen-update">Update selected</button>
    </div>
    <p className="hint">Every point is draggable on the canvas and can have its own colour, size and drift animation.</p>
  </div>;
}
