import { Shuffle } from 'lucide-react';
import { useState } from 'react';
import { Seg, Section, Switch, ValueControl } from '../../shared/controls';
import { ATMOSPHERES, DEFAULT_ATMOSPHERE, buildAtmosphere, type AtmosphereOptions } from '../engine/atmosphere';
import { mixColors, rgbToHex, toRgba } from '../engine/color';
import { ColorInput, useStudio } from './ui';

/** Atmosphere = sky ramp + sun glow + haze + clouds (+ rays, grain). Builds ordinary, editable layers. */
export default function AtmospherePanel() {
  const { store, announce } = useStudio();
  const [o, setO] = useState<AtmosphereOptions>(DEFAULT_ATMOSPHERE);
  const [active, setActive] = useState('golden');
  const set = (p: Partial<AtmosphereOptions>) => { setActive(''); setO(prev => ({ ...prev, ...p })); };
  const addSkyStop = () => {
    const last = o.sky[o.sky.length - 1], before = o.sky[o.sky.length - 2];
    const blended = rgbToHex(mixColors(toRgba(before, 1), toRgba(last, 1), 0.5, 'oklab'));
    set({ sky: [...o.sky.slice(0, -1), blended, last] });
  };
  const build = (mode: 'replace' | 'add') => {
    const layers = buildAtmosphere(o);
    store.update(p => ({ ...p, layers: mode === 'replace' ? layers : [...layers, ...p.layers] }));
    store.select((layers.find(l => l.type !== 'noise') ?? layers[0]).id); announce(`${mode === 'replace' ? 'Built' : 'Added'} atmosphere · ${layers.length} editable layers`);
  };
  return <div data-testid="atmosphere-panel">
    <Section title="Time of day">
      <div className="gs-chips wrap" role="radiogroup" aria-label="Atmosphere preset">
        {ATMOSPHERES.map(a => <button key={a.id} type="button" role="radio" aria-checked={active === a.id} className={`chip ${active === a.id ? 'active' : ''}`} onClick={() => { setActive(a.id); setO(a.opts); }} data-testid={`atmo-${a.id}`}>{a.name}</button>)}
      </div>
      <div className="field-label">Sky colours (top → bottom)</div>
      {o.sky.map((c, i) => <ColorInput key={i} color={c} alpha={1} showAlpha={false} onChange={v => set({ sky: o.sky.map((x, k) => (k === i ? v : x)) })} label={`Sky colour ${i + 1}`} />)}
      <div className="gs-btnrow">
        <button type="button" className="btn" disabled={o.sky.length >= 6} onClick={addSkyStop}>Add sky stop</button>
        <button type="button" className="btn" disabled={o.sky.length <= 2} onClick={() => set({ sky: o.sky.slice(0, -1) })}>Remove stop</button>
      </div>
      <Seg value={o.skyDistribution ?? 'even'} label="Sky colour distribution" options={[{ id: 'even', label: 'Even' }, { id: 'upper', label: 'Upper sky' }, { id: 'horizon', label: 'Horizon' }]} onChange={skyDistribution => set({ skyDistribution })} />
    </Section>
    <Section title="Sun & light">
      <ValueControl label="Sun X" value={o.sunX} min={0} max={100} unit="%" def={72} onChange={v => set({ sunX: v })} testId="atmo-sunx" />
      <ValueControl label="Sun height" value={100 - o.sunY} min={-10} max={100} unit="%" def={18} onChange={v => set({ sunY: 100 - v })} testId="atmo-suny" />
      <ValueControl label="Sun size" value={o.sunSize} min={8} max={90} unit="%" def={40} onChange={v => set({ sunSize: v })} />
      <ValueControl label="Glow" value={o.glow} min={0} max={100} unit="%" def={95} onChange={v => set({ glow: v })} testId="atmo-glow" />
      <ValueControl label="Glow softness" value={o.glowSoftness ?? 16} min={0} max={48} unit="px" def={16} onChange={glowSoftness => set({ glowSoftness })} />
      <div className="field-label">{o.moon ? 'Moon colour' : 'Sun colour'}</div><ColorInput color={o.moon ? o.moonColor ?? o.sunColor : o.sunColor} alpha={1} showAlpha={false} onChange={v => set(o.moon ? { moonColor: v } : { sunColor: v })} label={o.moon ? 'Moon colour' : 'Sun colour'} />
      <Switch label="Add sun / moon disc" checked={!!o.sunDisc} onChange={sunDisc => set({ sunDisc })} />
      {o.sunDisc && <ValueControl label="Disc size" value={o.sunDiscSize ?? 4} min={0.5} max={12} step={0.5} unit="%" def={4} onChange={sunDiscSize => set({ sunDiscSize })} />}
      <Switch label="Moonlight tint" checked={!!o.moon} onChange={moon => set({ moon, sunDisc: moon || !!o.sunDisc })} />
    </Section>
    <Section title="Haze & clouds">
      <ValueControl label="Horizon haze" value={o.haze} min={0} max={100} unit="%" def={50} onChange={v => set({ haze: v })} />
      <ValueControl label="Clouds" value={o.clouds} min={0} max={6} def={2} onChange={v => set({ clouds: v })} testId="atmo-clouds" />
      <ValueControl label="Cloud density" value={o.cloudDensity ?? 70} min={0} max={100} unit="%" def={70} onChange={cloudDensity => set({ cloudDensity })} />
      <ValueControl label="Distance fog" value={o.fog ?? 0} min={0} max={100} unit="%" def={0} onChange={fog => set({ fog })} />
      <ValueControl label="Edge vignette" value={o.vignette ?? 0} min={0} max={60} unit="%" def={0} onChange={vignette => set({ vignette })} />
      <div className="field-label">Haze / cloud colour</div><ColorInput color={o.hazeColor} alpha={1} showAlpha={false} onChange={v => set({ hazeColor: v })} label="Haze colour" />
      <Switch label="Light rays (slow spin)" checked={o.rays} onChange={v => set({ rays: v })} testId="atmo-rays" />
      {o.rays && <>
        <ValueControl label="Ray count" value={o.rayCount ?? 18} min={3} max={48} def={18} onChange={rayCount => set({ rayCount })} />
        <ValueControl label="Ray intensity" value={o.rayIntensity ?? 45} min={0} max={100} unit="%" def={45} onChange={rayIntensity => set({ rayIntensity })} />
      </>}
      <Switch label="Film grain" checked={o.grain} onChange={v => set({ grain: v })} testId="atmo-grain" />
      <div className="seed-row"><ValueControl label="Seed" value={o.seed} min={1} max={999} def={3} onChange={v => set({ seed: v })} /><button type="button" className="btn" aria-label="Random seed" onClick={() => set({ seed: 1 + Math.floor(Math.random() * 998) })}><Shuffle /></button></div>
    </Section>
    <div className="gs-btnrow">
      <button type="button" className="btn primary" onClick={() => build('replace')} data-testid="atmo-build">Build atmosphere</button>
      <button type="button" className="btn" onClick={() => build('add')} data-testid="atmo-add">Add on top</button>
    </div>
  </div>;
}
