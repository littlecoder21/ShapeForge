import { useState } from 'react';
import { Seg } from '../../shared/controls';
import AtmospherePanel from './AtmospherePanel';
import AuroraPanel from './AuroraPanel';
import MeshBuilder from './MeshBuilder';

type Scene = 'aurora' | 'atmosphere' | 'mesh';
/** Scene builders: each one assembles a stack of ordinary, editable layers. */
export default function ScenesPanel() {
  const [scene, setScene] = useState<Scene>('aurora');
  return <div data-testid="scenes-panel">
    <Seg value={scene} label="Scene type" options={[{ id: 'aurora', label: 'Aurora' }, { id: 'atmosphere', label: 'Atmosphere' }, { id: 'mesh', label: 'Mesh' }]} onChange={setScene} testId="scene-type" />
    <div style={{ height: 10 }} />
    {scene === 'aurora' && <AuroraPanel />}
    {scene === 'atmosphere' && <AtmospherePanel />}
    {scene === 'mesh' && <MeshBuilder />}
  </div>;
}
