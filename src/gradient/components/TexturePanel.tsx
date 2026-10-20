import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Section, Seg, Switch, ValueControl } from '../../shared/controls';
import { BLEND_MODES, DEFAULT_TEXTURE, newLayer, stop, type TextureData } from '../engine/model';
import { FALLOFF_OPTIONS, type ControlGroup } from '../engine/textureControls';
import { TEXTURES, resolveTextureId, textureDataUri, textureSupport, type ResolvedControl } from '../engine/textures';
import { useStore } from '../engine/store';
import { ColorInput, Empty, useStudio } from './ui';

const FAMILIES = ['all', ...new Set(TEXTURES.map(texture => texture.family))] as const;
type FamilyFilter = (typeof FAMILIES)[number];

/** Thumbnails are built on demand (the library has 200+ patterns) and drawn at full strength, whatever the opacity setting is. */
const THUMBNAILS = new Map<string, string>();
const thumbnail = (id: string) => {
  let uri = THUMBNAILS.get(id);
  if (!uri) {
    uri = textureDataUri({ ...DEFAULT_TEXTURE, pattern: id, color: '#f4f7fb', density: 58 }, 100);
    THUMBNAILS.set(id, uri);
  }
  return uri;
};

const kebab = (name: string) => name.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);

/** Advanced controls are grouped into collapsible sections; a section only appears when the selected texture has controls for it. */
const ADVANCED_SECTIONS: { group: ControlGroup; title: string; hint: string }[] = [
  { group: 'geometry', title: 'Geometry', hint: 'stroke, dash, aspect, weave' },
  { group: 'distribution', title: 'Distribution & variation', hint: 'coverage, jitter, random variation' },
  { group: 'distortion', title: 'Distortion', hint: 'seamless domain warp' },
  { group: 'spatial', title: 'Spatial falloff', hint: 'fade a property across the tile' },
  { group: 'detail', title: 'Detail', hint: 'a second, finer layer' },
  { group: 'rendering', title: 'Noise field', hint: 'threshold and octaves' },
];

export default function TexturePanel({ layerId }: { layerId: string }) {
  const { store, announce } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  const [family, setFamily] = useState<FamilyFilter>('all');
  const [query, setQuery] = useState('');
  const visibleTextures = useMemo(() => TEXTURES.filter(item =>
    (family === 'all' || item.family === family) && item.label.toLowerCase().includes(query.trim().toLowerCase()),
  ), [family, query]);
  if (!layer) return <Empty>Select a layer first.</Empty>;
  const texture = layer.texture;
  const selectedId = resolveTextureId(texture.pattern);
  const set = (patch: Partial<TextureData>, key?: string) => store.updateLayer(layerId, l => ({
    ...l,
    texture: { ...DEFAULT_TEXTURE, ...l.texture, ...patch },
  }), { coalesce: key });
  const choose = (pattern: string, label: string) => {
    const textureLayer = newLayer('linear', {
      name: `${label} Texture`,
      stops: [stop('#ffffff', 0, 0), stop('#ffffff', 100, 0)],
      texture: { ...DEFAULT_TEXTURE, pattern, enabled: true },
    });
    store.update(project => ({ ...project, layers: [textureLayer, ...project.layers] }));
    store.select(textureLayer.id);
    announce(`Added ${textureLayer.name}`);
  };

  // which advanced controls the selected texture actually supports (driven by the control metadata, not by the preset name)
  const support = textureSupport(texture);
  const renderControl = ({ control, label, options }: ResolvedControl) => {
    const testId = `texture-${kebab(control.id)}`;
    const value = texture[control.id];
    if (control.id === 'falloff') {
      return <div key={control.id} title={control.hint}>
        <div className="field-label">{label}</div>
        <Seg value={texture.falloff} label="Falloff" testId={testId} options={FALLOFF_OPTIONS} onChange={falloff => set({ falloff })} />
      </div>;
    }
    if (control.type === 'select') {
      return <div key={control.id} title={control.hint}>
        <label className="field-label" htmlFor={testId}>{label}</label>
        <select id={testId} className="generate-select" value={String(value)} onChange={e => set({ [control.id]: e.target.value } as Partial<TextureData>)} data-testid={testId}>
          {(options ?? []).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>;
    }
    return <div key={control.id} title={control.hint}>
      <ValueControl
        label={label}
        value={Number(value)}
        min={control.min ?? 0}
        max={control.max ?? 100}
        step={control.step ?? 1}
        unit={control.unit}
        def={Number(control.def)}
        onChange={v => set({ [control.id]: v } as Partial<TextureData>, testId)}
        testId={testId}
      />
    </div>;
  };
  const basicControls = support.controls.filter(item => item.control.tier === 'basic');
  const advancedSections = ADVANCED_SECTIONS
    .map(section => ({ ...section, controls: support.controls.filter(item => item.control.tier === 'advanced' && item.control.group === section.group) }))
    .filter(section => section.controls.length);
  const noteStyle = { margin: '6px 2px 0', fontSize: 11, lineHeight: 1.45, opacity: 0.7 } as const;

  return <div data-testid="texture-panel">
    <Section title="Texture library" hint={`${TEXTURES.length} patterns · click a card to add as a layer`}>
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
            className={`gs-texture-card ${selectedId === item.id ? 'on' : ''}`}
            aria-pressed={selectedId === item.id}
            onClick={() => choose(item.id, item.label)}
            data-testid={`texture-card-${item.id}`}
            title={`Add ${item.label} as a layer`}
          >
            <span className="gs-texture-thumb" style={{ backgroundImage: thumbnail(item.id) }} aria-hidden="true" />
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
    {basicControls.length > 0 && <Section title="Shape & spacing" hint="size, spacing and placement of the motifs">
      {basicControls.map(renderControl)}
    </Section>}
    {advancedSections.map(section => (
      <Section key={section.group} title={section.title} hint={section.hint} open={false}>
        {section.controls.map(renderControl)}
      </Section>
    ))}
    {support.notes.length > 0 && <div data-testid="texture-notes">
      {support.notes.map(note => <p key={note} style={noteStyle}>{note}</p>)}
    </div>}
  </div>;
}
