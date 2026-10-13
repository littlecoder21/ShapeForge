import { memo, useMemo } from 'react';
import { flatStyle, needsLayered } from '../engine/css';
import { freshIds } from '../engine/model';
import type { Preset } from '../engine/presets';
import { thumbProject } from '../engine/thumb';
import LayeredArt from './LayeredArt';

const THUMB_W = 132;

/** A small live card for one preset: light presets use a plain `background`, blurred / animated ones render the real layers. */
function PresetCard({ preset, active, onApply }: { preset: Preset; active: boolean; onApply: (p: Preset) => void }) {
  const thumb = useMemo(() => { const p = thumbProject(freshIds(preset.build()), THUMB_W); return { p, layered: needsLayered(p) }; }, [preset]);
  const style = useMemo(() => (thumb.layered ? undefined : flatStyle(thumb.p)), [thumb]);
  return <button type="button" className={`gs-card ${active ? 'on' : ''}`} onClick={() => onApply(preset)} aria-label={`Apply preset ${preset.name}, ${preset.category}`} data-testid="preset-card">
    <span className="gs-card-art" style={style}>
      {thumb.layered && <LayeredArt project={thumb.p} rootClass={`gt-${preset.id}`} className="gs-card-layers" />}
    </span>
    <span className="gs-card-name">{preset.name}</span>
    <small>{preset.category}</small>
  </button>;
}
export default memo(PresetCard);
