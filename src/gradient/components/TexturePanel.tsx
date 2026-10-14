import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Section, Seg, Switch, ValueControl } from '../../shared/controls';
import { BLEND_MODES, DEFAULT_TEXTURE, type TextureData } from '../engine/model';
import { TEXTURES, textureDataUri } from '../engine/textures';
import { useStore } from '../engine/store';
import { ColorInput, Empty, useStudio } from './ui';

const FAMILIES = ['all', ...new Set(TEXTURES.map(texture => texture.family))] as const;
type FamilyFilter = (typeof FAMILIES)[number];
const THUMBNAILS = new Map(TEXTURES.map(item => [item.id, textureDataUri({
  ...DEFAULT_TEXTURE,
  pattern: item.id,
  color: '#f4f7fb',
  density: 58,
})]));

export default function TexturePanel({ layerId }: { layerId: string }) {
  const { store } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  const [family, setFamily] = useState<FamilyFilter>('all');
  const [query, setQuery] = useState('');
  const visibleTextures = useMemo(() => TEXTURES.filter(item =>
    (family === 'all' || item.family === family) && item.label.toLowerCase().includes(query.trim().toLowerCase()),
  ), [family, query]);
  if (!layer) return <Empty>Select a layer first.</Empty>;
  const texture = layer.texture;
  const set = (patch: Partial<TextureData>, key?: string) => store.updateLayer(layerId, l => ({
    ...l,
    texture: { ...DEFAULT_TEXTURE, ...l.texture, ...patch },
  }), { coalesce: key });
  const choose = (pattern: string) => set({ pattern, enabled: true });
  return <div data-testid="texture-panel">
    <Section title="Texture library" hint={`${TEXTURES.length} patterns · click a card to apply`}>
      <label className="gs-search">
        <Search aria-hidden="true" />
        <input aria-label="Search textures" placeholder="Search textures" value={query} onChange={e => setQuery(e.target.value)} data-testid="texture-search" />
      </label>
      <Seg
        value={family}
        label="Texture family"
        testId="texture-family"
        options={FAMILIES.map(id => ({ id, label: id === 'all' ? 'All' : id[0].toUpperCase() + id.slice(1) }))}
        onChange={setFamily}
      />
      <div className="gs-texture-grid" role="group" aria-label="Texture patterns" data-testid="texture-list">
        {visibleTextures.map(item => (
          <button
            key={item.id}
            type="button"
            className={`gs-texture-card ${texture.pattern === item.id ? 'on' : ''}`}
            aria-pressed={texture.pattern === item.id}
            onClick={() => choose(item.id)}
            data-testid={`texture-card-${item.id}`}
            title={`Use ${item.label}`}
          >
            <span className="gs-texture-thumb" style={{ backgroundImage: THUMBNAILS.get(item.id) }} aria-hidden="true" />
            <span className="gs-texture-name">{item.label}</span>
          </button>
        ))}
        {!visibleTextures.length && <Empty>No textures match this search.</Empty>}
      </div>
    </Section>
    <Section title="Texture controls" hint="customize the selected texture">
      <Switch label="Enable texture overlay" checked={texture.enabled} onChange={enabled => set({ enabled })} testId="texture-on" />
      <ValueControl label="Tile scale" value={texture.scale} min={4} max={240} step={1} unit="px" def={DEFAULT_TEXTURE.scale} onChange={v => set({ scale: v }, 'texture-scale')} testId="texture-scale" />
      <ValueControl label="Density" value={texture.density} min={1} max={100} step={1} unit="%" def={DEFAULT_TEXTURE.density} onChange={v => set({ density: v }, 'texture-density')} testId="texture-density" />
      <ValueControl label="Opacity" value={texture.opacity} min={0} max={100} step={1} unit="%" def={DEFAULT_TEXTURE.opacity} onChange={v => set({ opacity: v }, 'texture-opacity')} testId="texture-opacity" />
      <ValueControl label="Rotation" value={texture.angle} min={0} max={360} step={1} unit="°" def={DEFAULT_TEXTURE.angle} onChange={v => set({ angle: v }, 'texture-angle')} testId="texture-angle" />
      <ValueControl label="Contrast" value={texture.contrast} min={0} max={250} step={1} unit="%" def={DEFAULT_TEXTURE.contrast} onChange={v => set({ contrast: v }, 'texture-contrast')} testId="texture-contrast" />
      <ValueControl label="Softness" value={texture.softness} min={0} max={8} step={0.1} unit="px" def={DEFAULT_TEXTURE.softness} onChange={v => set({ softness: v }, 'texture-softness')} testId="texture-softness" />
      <ValueControl label="Offset X" value={texture.offsetX} min={-120} max={120} step={1} unit="px" def={DEFAULT_TEXTURE.offsetX} onChange={v => set({ offsetX: v }, 'texture-offset-x')} testId="texture-offset-x" />
      <ValueControl label="Offset Y" value={texture.offsetY} min={-120} max={120} step={1} unit="px" def={DEFAULT_TEXTURE.offsetY} onChange={v => set({ offsetY: v }, 'texture-offset-y')} testId="texture-offset-y" />
      <ValueControl label="Seed" value={texture.seed} min={1} max={999} step={1} def={DEFAULT_TEXTURE.seed} onChange={v => set({ seed: v })} testId="texture-seed" />
      <div className="gs-texture-color">
        <div className="field-label">Pattern color</div>
        <ColorInput color={texture.color} alpha={1} showAlpha={false} onChange={color => set({ color }, 'texture-color')} label="Pattern color" testId="texture-color" />
      </div>
      <Switch label="Add a solid tile color" checked={texture.backgroundEnabled} onChange={backgroundEnabled => set({ backgroundEnabled })} testId="texture-background-on" />
      {texture.backgroundEnabled && <>
        <div className="gs-texture-color">
          <div className="field-label">Tile color</div>
          <ColorInput color={texture.backgroundColor} alpha={1} showAlpha={false} onChange={backgroundColor => set({ backgroundColor }, 'texture-background-color')} label="Tile background color" testId="texture-background-color" />
        </div>
        <ValueControl label="Tile color opacity" value={texture.backgroundOpacity} min={0} max={100} step={1} unit="%" def={DEFAULT_TEXTURE.backgroundOpacity} onChange={v => set({ backgroundOpacity: v }, 'texture-background-opacity')} testId="texture-background-opacity" />
      </>}
      <label className="field-label" htmlFor="texture-blend">Blend mode</label>
      <select id="texture-blend" className="generate-select" value={texture.blend} onChange={e => set({ blend: e.target.value as TextureData['blend'] })} data-testid="texture-blend">
        {BLEND_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
      </select>
    </Section>
  </div>;
}
