import { useState } from 'react';
import { Switch } from '../../../../shared/controls';
import { isMotionActive } from '../../../../motion/glsl';
import { starterMotion } from '../../../../motion/presets';
import DebugTab from './DebugTab';
import { ModulationTab, OrganicTab, PhysicsTab, PointerTab, TimeTab } from './DynamicsTabs';
import FieldEditor from './FieldEditor';
import FlowTab from './FlowTab';
import ProfileBar from './ProfileBar';
import { useMotion } from './useMotion';

const TABS = [
  { id: 'flow', label: 'Flow' },
  { id: 'field', label: 'Field' },
  { id: 'physics', label: 'Physics' },
  { id: 'organic', label: 'Organic' },
  { id: 'pointer', label: 'Pointer' },
  { id: 'modulation', label: 'Modulate' },
  { id: 'time', label: 'Time' },
  { id: 'debug', label: 'Debug' },
] as const;
type TabId = typeof TABS[number]['id'];

/** The motion engine workspace. Everything here edits `settings.motion`, which the live renderer and the exported page both run. */
export default function MotionEngine() {
  const editor = useMotion();
  const { config, edit, replace } = editor;
  const [tab, setTab] = useState<TabId>('flow');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = isMotionActive(config);
  const partsOn = config.sources.some(s => s.enabled) || config.turbulence.enabled || config.organic.enabled || config.interaction.enabled || config.modulators.some(m => m.enabled);

  return <div className="gs-mot" data-testid="motion-engine">
    <Switch
      label="Motion engine"
      checked={config.enabled}
      onChange={enabled => { if (enabled && config.sources.length === 0 && !partsOn) replace(starterMotion(config)); else edit(d => { d.enabled = enabled; }); }}
      testId="motion-engine-enabled"
    />
    <p className="hint" data-testid="motion-engine-status">
      {!config.enabled
        ? 'Off: the shader runs exactly as before. Switch on to drive the artwork with flow fields, physics and pointer interaction.'
        : active
          ? `Running: ${config.sources.filter(s => s.enabled).length} flow source${config.sources.filter(s => s.enabled).length === 1 ? '' : 's'}${config.turbulence.enabled ? ' + turbulence' : ''}${config.organic.enabled ? ' + organic' : ''}${config.interaction.enabled ? ' + pointer' : ''}.`
          : 'On, but nothing is driving the motion yet. Pick a scene below or add a flow source.'}
    </p>
    <ProfileBar editor={editor} />
    <div className="gs-chip-row gs-mot-tabs" role="tablist" aria-label="Motion engine sections">
      {TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`chip ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)} data-testid={`motion-tab-${item.id}`}>{item.label}</button>)}
    </div>
    <div role="tabpanel" className="gs-mot-panel">
      {tab === 'flow' && <FlowTab editor={editor} selectedId={selectedId} onSelect={setSelectedId} />}
      {tab === 'field' && <FieldEditor editor={editor} selectedId={selectedId} onSelect={setSelectedId} />}
      {tab === 'physics' && <PhysicsTab editor={editor} />}
      {tab === 'organic' && <OrganicTab editor={editor} />}
      {tab === 'pointer' && <PointerTab editor={editor} />}
      {tab === 'modulation' && <ModulationTab editor={editor} />}
      {tab === 'time' && <TimeTab editor={editor} />}
      {tab === 'debug' && <DebugTab editor={editor} />}
    </div>
  </div>;
}
