import { RotateCcw } from 'lucide-react';
import { Seg } from '../../../shared/controls';
import { DEFAULT_INTERACTIVE_SETTINGS, type InteractiveSettings, type ShaderQuality } from '../../interactive/types';
import { Num, Section, Select } from './parts';
import { useShader } from './context';

const QUALITY: { id: ShaderQuality; label: string }[] = [
  { id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }, { id: 'ultra', label: 'Ultra' },
];

export default function FinishPanel() {
  const { settings, update } = useShader();
  return <div data-testid="shader-panel-finish">
    <Section title="Finish" testId="shader-finish">
      <Num label="Tone mapping" value={settings.toneMapping} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.toneMapping} onChange={toneMapping => update({ toneMapping }, 'tone-mapping')} testId="shader-tone-mapping" />
      <Num label="Vignette" value={settings.vignette} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.vignette} onChange={vignette => update({ vignette }, 'vignette')} testId="shader-vignette" />
      <Num label="Sheen" value={settings.sheen} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.sheen} onChange={sheen => update({ sheen }, 'sheen')} testId="shader-sheen" />
      <Num label="Film grain" value={settings.filmGrain} min={0} max={1} def={DEFAULT_INTERACTIVE_SETTINGS.filmGrain} onChange={filmGrain => update({ filmGrain }, 'film-grain')} testId="shader-film-grain" />
      <Select id="shader-palette-wrap" label="Palette wrapping" value={settings.paletteWrap} options={[{ id: 'mirror', label: 'Mirror (seam-free)' }, { id: 'repeat', label: 'Repeat (legacy)' }]} onChange={paletteWrap => update({ paletteWrap })} />
    </Section>
    <Section title="Quality & performance">
      <Seg value={settings.quality} options={QUALITY} onChange={quality => update({ quality })} label="Shader quality" testId="shader-quality" />
      <Num label="Resolution scale" value={settings.resolutionScale} min={0.35} max={1.5} step={0.05} unit="×" def={DEFAULT_INTERACTIVE_SETTINGS.resolutionScale} onChange={resolutionScale => update({ resolutionScale }, 'resolution')} testId="shader-resolution" />
      <p className="hint">Quality sets how many noise octaves the shader computes; it is compiled in as a constant, so higher quality only costs time when you choose it. Adaptive resolution lowers the render size automatically if the preview ever drops below about 50 fps.</p>
    </Section>
    <button type="button" className="btn wide" onClick={() => update({ ...DEFAULT_INTERACTIVE_SETTINGS } as Partial<InteractiveSettings>)} data-testid="shader-reset"><RotateCcw />Reset shader settings</button>
  </div>;
}
