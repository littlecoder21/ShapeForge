import { Section, Switch, ValueControl } from '../../shared/controls';
import { DEFAULT_NOISE, type NoiseData } from '../engine/model';
import { useStore } from '../engine/store';
import { useStudio } from './ui';

const PRESETS: [string, NoiseData, number][] = [
  ['Fine film', { frequency: 90, octaves: 3, seed: 4, mono: true, contrast: 125, tile: 220 }, 0.3],
  ['Paper', { frequency: 45, octaves: 4, seed: 9, mono: true, contrast: 105, tile: 260 }, 0.35],
  ['Coarse', { frequency: 22, octaves: 2, seed: 2, mono: true, contrast: 140, tile: 300 }, 0.28],
  ['Colour dust', { frequency: 70, octaves: 3, seed: 6, mono: false, contrast: 120, tile: 240 }, 0.22],
];

export default function NoisePanel({ layerId }: { layerId: string }) {
  const { store } = useStudio();
  const layer = useStore(store, s => s.project.layers.find(l => l.id === layerId) ?? null);
  if (!layer || layer.type !== 'noise') return null;
  const n = layer.noise;
  const set = (patch: Partial<NoiseData>, key?: string) => store.updateLayer(layerId, l => ({ ...l, noise: { ...l.noise, ...patch } }), { coalesce: key });
  return <div data-testid="noise-panel">
    <Section title="Grain presets">
      <div className="gs-chips">{PRESETS.map(([name, d, op]) => <button key={name} type="button" className="chip" onClick={() => store.updateLayer(layerId, l => ({ ...l, noise: d, opacity: op, blend: 'overlay' }))} data-testid={`noise-preset-${name.toLowerCase().replace(/\s/g, '-')}`}>{name}</button>)}</div>
      <p className="hint">Grain is an SVG turbulence tile. Use <b>overlay</b> or <b>soft-light</b> at 20–40% opacity (Transform tab) for the film look.</p>
    </Section>
    <Section title="Texture">
      <ValueControl label="Frequency" value={n.frequency} min={5} max={200} unit="‰" def={DEFAULT_NOISE.frequency} onChange={v => set({ frequency: v }, 'nf')} testId="noise-freq" />
      <ValueControl label="Detail (octaves)" value={n.octaves} min={1} max={5} def={3} onChange={v => set({ octaves: v })} testId="noise-oct" />
      <ValueControl label="Contrast" value={n.contrast} min={50} max={250} unit="%" def={120} onChange={v => set({ contrast: v }, 'nc')} testId="noise-contrast" />
      <ValueControl label="Tile size" value={n.tile} min={64} max={600} unit="px" def={220} onChange={v => set({ tile: v }, 'nt')} testId="noise-tile" />
      <ValueControl label="Seed" value={n.seed} min={1} max={99} def={4} onChange={v => set({ seed: v })} testId="noise-seed" />
      <Switch label="Monochrome" checked={n.mono} onChange={v => set({ mono: v })} testId="noise-mono" />
    </Section>
  </div>;
}
