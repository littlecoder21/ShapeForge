import { useState } from 'react';
import { Shuffle } from 'lucide-react';
import { Section, Switch, ValueControl } from '../../shared/controls';
import { applyBuilderLayers } from '../engine/builderLayers';
import { useStore } from '../engine/store';
import { AURORA_PRESETS, DEFAULT_AURORA, auroraPalette, auroraSky, buildAurora, type AuroraOptions } from '../engine/aurora';
import { useStudio, ColorInput } from './ui';

const PALETTES: { name: string; colors: string[]; sky: string }[] = [
  { name: 'Boreal', colors: auroraPalette(140, 170, 200), sky: auroraSky(215) }, { name: 'Violet', colors: auroraPalette(160, 270, 300), sky: auroraSky(260) },
  { name: 'Polar teal', colors: auroraPalette(170, 190, 220), sky: auroraSky(205) }, { name: 'Pink dawn', colors: auroraPalette(320, 170, 280), sky: auroraSky(245) },
  { name: 'Solar', colors: auroraPalette(120, 60, 170), sky: auroraSky(210) }, { name: 'Crimson', colors: auroraPalette(340, 300, 20), sky: auroraSky(300) },
  { name: 'Ice', colors: auroraPalette(195, 175, 260), sky: auroraSky(215) }, { name: 'Golden', colors: auroraPalette(90, 150, 50), sky: auroraSky(150) },
];

/** Aurora mode only *assembles ordinary layers* — blurred radial curtains, ribbons, horizon glow and a sky — which you then edit like any other. */
export default function AuroraPanel({ onBuilt }: { onBuilt?: () => void }) {
  const { store, announce } = useStudio();
  const [o, setO] = useState<AuroraOptions>(DEFAULT_AURORA);
  const [activePreset, setActivePreset] = useState('');
  const set = (p: Partial<AuroraOptions>) => { setActivePreset(''); setO(prev => ({ ...prev, ...p })); };
  const build = (mode: 'replace' | 'add' | 'update') => {
    const layers = buildAurora(o);
    if (!applyBuilderLayers(store, 'aurora', layers, mode)) return;
    announce(`${mode === 'replace' ? 'Built' : mode === 'update' ? 'Updated' : 'Added'} aurora · ${layers.length} editable layers`); onBuilt?.();
  };
  const selectedLayer = useStore(store, state => state.project.layers.find(layer => layer.id === state.layerId));
  const canUpdate = selectedLayer?.builderSource === 'aurora' && !!selectedLayer.builderGroup;
  return <div data-testid="aurora-panel">
    <Section title="Aurora presets" open={false}>
      <div className="gs-chips wrap" role="radiogroup" aria-label="Aurora presets">
        {AURORA_PRESETS.map(preset => <button key={preset.id} type="button" role="radio" aria-checked={activePreset === preset.id} className={`chip ${activePreset === preset.id ? 'active' : ''}`} onClick={() => { setActivePreset(preset.id); setO({ ...preset.options }); }} data-testid={`aurora-preset-${preset.id}`}>{preset.name}</button>)}
      </div>
    </Section>
    <Section title="Palette">
      <div className="gs-palettes" role="radiogroup" aria-label="Aurora palette">
        {PALETTES.map(p => <button key={p.name} type="button" role="radio" aria-checked={o.palette.join() === p.colors.join()} className={`gs-pal ${o.palette.join() === p.colors.join() ? 'on' : ''}`} onClick={() => set({ palette: p.colors, sky: p.sky })} data-testid={`aurora-pal-${p.name.toLowerCase().replace(/\s/g, '-')}`}>
          <span>{p.colors.map(c => <i key={c} style={{ background: c }} />)}</span>{p.name}</button>)}
      </div>
      {o.palette.map((c, i) => <div key={i}><div className="field-label">Colour {i + 1}</div><ColorInput color={c} alpha={1} showAlpha={false} onChange={v => set({ palette: o.palette.map((x, k) => (k === i ? v : x)) })} label={`Aurora colour ${i + 1}`} /></div>)}
      <div className="field-label">Night sky</div><ColorInput color={o.sky} alpha={1} showAlpha={false} onChange={v => set({ sky: v })} label="Sky colour" />
    </Section>
    <Section title="Shape">
      <ValueControl label="Curtains" value={o.curtains} min={1} max={7} def={4} onChange={v => set({ curtains: v })} testId="aurora-curtains" />
      <ValueControl label="Ribbons" value={o.ribbons} min={0} max={3} def={1} onChange={v => set({ ribbons: v })} testId="aurora-ribbons" />
      <ValueControl label="Intensity" value={o.intensity} min={10} max={100} unit="%" def={70} onChange={v => set({ intensity: v })} testId="aurora-intensity" />
      <ValueControl label="Softness (blur)" value={o.blur} min={10} max={140} unit="px" def={55} onChange={v => set({ blur: v })} testId="aurora-blur" />
      <ValueControl label="Motion intensity" value={o.motionIntensity ?? 55} min={0} max={100} unit="%" def={55} onChange={motionIntensity => set({ motionIntensity })} />
      <div className="seed-row"><ValueControl label="Seed" value={o.seed} min={1} max={999} def={5} onChange={v => set({ seed: v })} /><button type="button" className="btn" aria-label="Random seed" onClick={() => set({ seed: 1 + Math.floor(Math.random() * 998) })}><Shuffle /></button></div>
    </Section>
    <Section title="Extras">
      <Switch label="Horizon glow" checked={o.glow} onChange={v => set({ glow: v })} testId="aurora-glow" />
      <Switch label="Star dust" checked={o.stars} onChange={v => set({ stars: v })} />
      {o.stars && <ValueControl label="Star density" value={o.starDensity ?? 38} min={0} max={100} unit="%" def={38} onChange={starDensity => set({ starDensity })} />}
      <Switch label="Fine aurora filaments" checked={!!o.strands} onChange={strands => set({ strands })} />
      {o.strands && <ValueControl label="Filament density" value={o.strandDensity ?? 42} min={0} max={100} unit="%" def={42} onChange={strandDensity => set({ strandDensity })} />}
      <Switch label="Slow drift animation" checked={o.movement} onChange={v => set({ movement: v })} testId="aurora-move" />
      <Switch label="Distortion (SVG turbulence)" checked={o.distortion} onChange={v => set({ distortion: v })} testId="aurora-distort" />
    </Section>
    <div className="gs-btnrow">
      <button type="button" className="btn primary" onClick={() => build('replace')} data-testid="aurora-build">Build aurora</button>
      <button type="button" className="btn" onClick={() => build('add')} data-testid="aurora-add">Create layers</button>
      <button type="button" className="btn" disabled={!canUpdate} onClick={() => build('update')} data-testid="aurora-update">Update selected</button>
    </div>
    <p className="hint">To update this scene, select one of its generated layers first. The full generated layer group will be refreshed in place.</p>
    <p className="hint">Result: ordinary layers you can restyle, reorder, animate or delete one by one.</p>
  </div>;
}
