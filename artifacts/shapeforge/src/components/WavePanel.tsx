import { useMemo, useState } from 'react';
import { RotateCcw, Shuffle } from 'lucide-react';
import { UNITS, type Unit } from '../geometry';
import {
  ARCH_SHAPES, AUTO_STYLES, DEFAULT_WAVE, ENVELOPES, WAVE_RANGES, WAVE_TYPES, autoPointCount, autoWaveParams, waveLine, type WaveParams,
} from '../wave';
import { Section, Seg, Switch, ValueControl } from './controls';

type Props = {
  params: WaveParams; active: boolean;
  fill: string; setFill: (c: string) => void; unit: Unit; setUnit: (u: Unit) => void;
  /** live while a slider moves (no history) */ onLive: (p: WaveParams) => void;
  /** slider released → one history entry */ onLiveEnd: () => void;
  /** discrete change with its own history entry */ onApply: (p: WaveParams) => void;
};

const R = WAVE_RANGES;

function Spark({ params }: { params: WaveParams }) {
  const d = useMemo(() => {
    const ys = waveLine(params, 36);
    return ys.map((y, i) => `${i ? 'L' : 'M'}${(i / 36 * 56).toFixed(1)} ${(3 + y * 16).toFixed(1)}`).join('');
  }, [params]);
  return <svg viewBox="0 0 56 22" aria-hidden><path d={d} /></svg>;
}

export default function WavePanel({ params, active, fill, setFill, unit, setUnit, onLive, onLiveEnd, onApply }: Props) {
  const [tab, setTab] = useState<'auto' | 'manual'>('auto');
  const [style, setStyle] = useState('calm');
  const [intensity, setIntensity] = useState(50);
  const [complexity, setComplexity] = useState(40);
  const [seed, setSeed] = useState(7);

  const live = (patch: Partial<WaveParams>) => onLive({ ...params, ...patch });
  const num = (key: keyof typeof R, label: string, opts: { unit?: string; testId?: string } = {}) => {
    const [min, max, step] = R[key];
    return <ValueControl label={label} value={params[key] as number} min={min} max={max} step={step} def={DEFAULT_WAVE[key] as number} unit={opts.unit}
      onChange={v => live({ [key]: v } as Partial<WaveParams>)} onCommit={onLiveEnd} testId={opts.testId ?? `wave-${key}`} />;
  };
  const auto = (over: Partial<{ style: string; intensity: number; complexity: number; seed: number }>) => {
    const s = over.style ?? style, i = over.intensity ?? intensity, c = over.complexity ?? complexity, sd = over.seed ?? seed;
    return autoWaveParams(s, i, c, sd, params);
  };
  const type = params.type;
  const pts = params.autoPoints ? autoPointCount(params) : params.points;

  return <div className="wave-panel">
    <div className="prop-title-row">
      <h2 className="properties-title">Wave maker</h2>
      <span className={`pill ${active ? 'on' : ''}`}>{active ? 'live' : 'not applied'}</span>
    </div>
    <Seg<'auto' | 'manual'> value={tab} label="Wave mode" testId="wave-tabs" options={[{ id: 'auto', label: 'Auto' }, { id: 'manual', label: 'Manual' }]} onChange={setTab} />

    {tab === 'auto' && <div className="wave-auto">
      <div className="style-grid" role="radiogroup" aria-label="Wave style">
        {AUTO_STYLES.map(s => {
          const p = auto({ style: s.id });
          return <button key={s.id} role="radio" aria-checked={style === s.id && active} className={`style-chip ${style === s.id && active ? 'active' : ''}`}
            onClick={() => { setStyle(s.id); onApply(auto({ style: s.id })); }} data-testid={`wave-style-${s.id}`}>
            <Spark params={p} /><span>{s.label}</span>
          </button>;
        })}
      </div>
      <ValueControl label="Intensity" value={intensity} min={0} max={100} def={50} onChange={v => { setIntensity(v); onLive(auto({ intensity: v })); }} onCommit={onLiveEnd} testId="auto-intensity" />
      <ValueControl label="Complexity" value={complexity} min={0} max={100} def={40} onChange={v => { setComplexity(v); onLive(auto({ complexity: v })); }} onCommit={onLiveEnd} testId="auto-complexity" />
      <ValueControl label="Width" value={params.width} min={R.width[0]} max={R.width[1]} step={R.width[2]} def={1000} onChange={v => live({ width: v })} onCommit={onLiveEnd} testId="auto-width" />
      <ValueControl label="Height" value={params.height} min={R.height[0]} max={R.height[1]} step={R.height[2]} def={300} onChange={v => live({ height: v })} onCommit={onLiveEnd} testId="auto-height" />
      <Switch label="Invert clip" checked={params.invert} onChange={v => onApply({ ...params, invert: v })} testId="auto-invert" />
      <div className="btn-row">
        <button className="btn" onClick={() => { const n = (seed % 998) + 1 + Math.floor(Math.random() * 40); setSeed(n); onApply(auto({ seed: n })); }} data-testid="wave-new-seed"><RotateCcw />New variation</button>
        <button className="btn primary" onClick={() => { const s = AUTO_STYLES[Math.floor(Math.random() * AUTO_STYLES.length)].id, n = 1 + Math.floor(Math.random() * 998); setStyle(s); setSeed(n); setIntensity(30 + Math.round(Math.random() * 50)); onApply(autoWaveParams(s, 30 + Math.round(Math.random() * 50), complexity, n, params)); }} data-testid="wave-surprise"><Shuffle />Surprise me</button>
      </div>
      <button className="btn wide" onClick={() => setTab('manual')} data-testid="wave-edit-manual">Fine-tune in Manual →</button>
    </div>}

    {tab === 'manual' && <div className="wave-manual">
      <Section title="Size" hint="frame">
        {num('width', 'Width', { unit: 'px' })}
        {num('height', 'Height', { unit: 'px' })}
      </Section>
      <Section title="Wave shape">
        <div className="chips wrap" role="radiogroup" aria-label="Wave shape">
          {WAVE_TYPES.map(t => <button key={t.id} role="radio" aria-checked={type === t.id} className={`chip ${type === t.id ? 'active' : ''}`} onClick={() => onApply({ ...params, type: t.id, curve: ['sine', 'arches', 'noise'].includes(t.id) ? 'smooth' : params.curve })} data-testid={`wave-type-${t.id}`}>{t.label}</button>)}
        </div>
        {num('offset', 'Offset', { unit: '%' })}
        {(type === 'sine' || type === 'triangle' || type === 'square' || type === 'sawtooth') && num('skew', type === 'square' ? 'Duty / skew' : 'Skew')}
        {(type === 'square' || type === 'sawtooth' || type === 'steps') && num('softness', 'Edge softness', { unit: '%' })}
        {type === 'steps' && num('steps', 'Steps')}
        {type === 'noise' && <div className="seed-row">{num('seed', 'Seed')}<button className="btn" onClick={() => onApply({ ...params, seed: 1 + Math.floor(Math.random() * 998) })} aria-label="Random seed"><Shuffle /></button></div>}
      </Section>
      <hr className="rule" />
      <Section title="Motion">
        {num('amplitude', 'Amplitude', { unit: '%' })}
        {num('frequency', 'Frequency', { unit: '×' })}
        {num('phase', 'Phase', { unit: '°' })}
        <Switch label={`Auto points (${pts})`} checked={params.autoPoints} onChange={v => onApply({ ...params, autoPoints: v, points: v ? params.points : Math.max(params.points, pts) })} testId="wave-auto-points" />
        {!params.autoPoints && num('points', 'Points')}
        <div className="field-label">Curve</div>
        <Seg value={params.curve} label="Curve type" options={[{ id: 'smooth', label: 'Smooth (Bézier)' }, { id: 'linear', label: 'Linear (polygon)' }]} onChange={v => onApply({ ...params, curve: v })} testId="wave-curve" />
      </Section>
      <Section title="Options">
        <Switch label="Invert clip" checked={params.invert} onChange={v => onApply({ ...params, invert: v })} testId="wave-invert" />
        <div className="switch-row">
          <Switch label="Vertical left" checked={params.leftWall} onChange={v => onApply({ ...params, leftWall: v })} testId="wave-left" />
          <Switch label="Vertical right" checked={params.rightWall} onChange={v => onApply({ ...params, rightWall: v })} testId="wave-right" />
        </div>
        {(!params.leftWall || !params.rightWall) && num('sideTaper', 'Side taper', { unit: '%' })}
        <div className="field-label">Preview colour <span>{fill}</span></div>
        <div className="swatch-row"><input aria-label="Preview colour" type="color" value={fill} onChange={e => setFill(e.target.value)} data-testid="wave-fill" /><input className="generate-select" value={fill} onChange={e => setFill(e.target.value)} aria-label="Preview colour hex" /></div>
        <Switch label="Centre arch" checked={params.arch} onChange={v => onApply({ ...params, arch: v })} testId="wave-arch" />
        {params.arch && <div className="subgroup">
          {num('archHeight', 'Arch height', { unit: '%' })}
          {num('archWidth', 'Arch width', { unit: '%' })}
          <Seg value={params.archShape} label="Arch shape" options={ARCH_SHAPES.map(a => ({ id: a.id, label: a.label }))} onChange={v => onApply({ ...params, archShape: v })} testId="wave-arch-shape" />
        </div>}
        <div className="field-label">Output units</div>
        <Seg value={unit} label="Output units" options={UNITS.map(u => ({ id: u, label: u }))} onChange={setUnit} testId="wave-units" />
        <p className="hint">% scales with the element. px / rem / em are absolute at the wave's size. vw / vh fill the viewport.</p>
      </Section>
      <Section title="Shaping" open={false} hint="more">
        {num('harmonic', 'Harmonic mix', { unit: '%' })}
        {params.harmonic > 0 && num('harmonicRatio', 'Harmonic ratio', { unit: '×' })}
        {num('tilt', 'Baseline tilt', { unit: '%' })}
        <div className="field-label">Amplitude envelope</div>
        <Seg value={params.envelope} label="Envelope" options={ENVELOPES.map(e => ({ id: e.id, label: e.label }))} onChange={v => onApply({ ...params, envelope: v })} testId="wave-envelope" />
        {params.envelope !== 'none' && num('envelopeAmount', 'Envelope amount', { unit: '%' })}
        <Switch label="Mirror (symmetric)" checked={params.mirror} onChange={v => onApply({ ...params, mirror: v })} testId="wave-mirror" />
        <Switch label="Clamp to frame" checked={params.clamp} onChange={v => onApply({ ...params, clamp: v })} testId="wave-clamp" />
      </Section>
      <button className="btn wide" onClick={() => onApply({ ...DEFAULT_WAVE, width: params.width, height: params.height })} data-testid="wave-reset"><RotateCcw />Reset wave controls</button>
    </div>}
  </div>;
}
