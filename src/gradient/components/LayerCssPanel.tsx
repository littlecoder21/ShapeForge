import { useDeferredValue, useMemo, useState } from 'react';
import { Seg } from '../../shared/controls';
import { layerCssBlocks } from '../engine/output';
import { useStore } from '../engine/store';
import CodeBlock from './CodeBlock';
import { useStudio } from './ui';

/** Live CSS for each layer — updates as you drag, identical to the HTML + CSS export. */
export default function LayerCssPanel() {
  const { store } = useStudio();
  const project = useDeferredValue(useStore(store, s => s.project));
  const layerId = useStore(store, s => s.layerId);
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const blocks = useMemo(() => layerCssBlocks(project), [project]);
  const shown = scope === 'all' ? blocks : blocks.filter(b => b.id === layerId);
  return <div className="gs-layercss" data-testid="layer-css">
    <div className="gs-lc-head"><b>Live CSS</b><Seg value={scope} label="Which layers" options={[{ id: 'selected', label: 'Selected' }, { id: 'all', label: 'All layers' }]} onChange={setScope} testId="layercss-scope" /></div>
    {shown.length ? shown.map(b => <CodeBlock key={b.id} title={`.${b.cls} — ${b.name}`} text={b.css} testId="layercss-block" copyLabel="Copy" />) : <p className="gs-empty">The selected layer is hidden — show it to see its CSS.</p>}
  </div>;
}
