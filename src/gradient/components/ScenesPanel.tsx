import { useState } from 'react';
import AtmospherePanel from './AtmospherePanel';
import AuroraPanel from './AuroraPanel';
import MeshBuilder from './MeshBuilder';
import VisualBuilderPanel, { AdvancedBuilderIndex } from './VisualBuilderPanel';
import type { VisualBuilderId } from '../engine/visualBuilders';

type Scene = 'aurora' | 'atmosphere' | 'mesh' | VisualBuilderId;
/** Scene builders: each one assembles a stack of ordinary, editable layers. */
export default function ScenesPanel() {
  const [scene, setScene] = useState<Scene>('aurora');
  const options: { id: Scene; label: string }[] = [
    { id: 'aurora', label: 'Aurora' }, { id: 'atmosphere', label: 'Atmosphere' }, { id: 'mesh', label: 'Mesh' },
    ...AdvancedBuilderIndex(),
  ];
  return <div data-testid="scenes-panel">
    <label className="field-label" htmlFor="scene-type">Builder</label>
    <select id="scene-type" className="generate-select" aria-label="Builder" value={scene} onChange={event => {
      const selected = options.find(option => option.id === event.target.value);
      if (selected) setScene(selected.id);
    }} data-testid="scene-type">
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
    <div style={{ height: 10 }} />
    {scene === 'aurora' && <AuroraPanel />}
    {scene === 'atmosphere' && <AtmospherePanel />}
    {scene === 'mesh' && <MeshBuilder />}
    {scene !== 'aurora' && scene !== 'atmosphere' && scene !== 'mesh' && <VisualBuilderPanel id={scene} />}
  </div>;
}
