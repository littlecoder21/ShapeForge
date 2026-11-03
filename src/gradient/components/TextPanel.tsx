import { Section, Seg, ValueControl } from '../../shared/controls';
import { DEFAULT_TEXT, TEXT_FONT_FAMILIES, type TextLayerData } from '../engine/model';
import { useStore } from '../engine/store';
import { useStudio } from './ui';

const WEIGHTS = [400, 500, 600, 700, 800, 900];

export default function TextPanel({ layerId }: { layerId: string }) {
  const { store } = useStudio();
  const layer = useStore(store, state => state.project.layers.find(item => item.id === layerId) ?? null);
  if (!layer) return <div data-testid="text-panel" />;

  const update = (patch: Partial<TextLayerData>, coalesce?: string) => store.updateLayer(
    layerId,
    current => ({ ...current, text: { ...DEFAULT_TEXT, ...current.text, ...patch } }),
    { coalesce },
  );
  const text = layer.text ?? { ...DEFAULT_TEXT, content: '' };

  return <div data-testid="text-panel">
    <Section title="Text content" hint={layer.text ? 'Editable layer' : 'Type to add text to this layer'}>
      <label className="nf">
        <span className="nf-label">Content</span>
        <textarea
          className="boundary-input"
          rows={4}
          value={text.content}
          onChange={event => update({ content: event.target.value }, 'text-content')}
          aria-label="Text content"
          data-testid="text-content"
        />
      </label>
      {!layer.text && <p className="hint">Typing here turns this layer into a text layer and keeps its current gradient, shader, and effects.</p>}
      {layer.text && <>
      <label className="nf">
        <span className="nf-label">Font family</span>
        <select className="generate-select" value={text.fontFamily} onChange={event => update({ fontFamily: event.target.value })} data-testid="text-font-family">
          {TEXT_FONT_FAMILIES.map(font => <option key={font} value={font}>{font.split(',')[0]}</option>)}
        </select>
      </label>
      <label className="nf">
        <span className="nf-label">Font weight</span>
        <select className="generate-select" value={text.fontWeight} onChange={event => update({ fontWeight: Number(event.target.value) })} data-testid="text-font-weight">
          {WEIGHTS.map(weight => <option key={weight} value={weight}>{weight}</option>)}
        </select>
      </label>
      <ValueControl label="Font size" value={text.fontSize} min={8} max={1200} unit="px" def={160} onChange={value => update({ fontSize: value }, 'text-size')} testId="text-font-size" />
      <ValueControl label="Letter spacing" value={text.letterSpacing} min={-20} max={100} step={0.5} unit="px" def={0} onChange={value => update({ letterSpacing: value }, 'text-spacing')} testId="text-letter-spacing" />
      <ValueControl label="Line height" value={text.lineHeight} min={0.5} max={3} step={0.05} def={1.1} onChange={value => update({ lineHeight: value }, 'text-line-height')} testId="text-line-height" />
      </>}
    </Section>
    {layer.text && <Section title="Alignment">
      <div className="field-label">Horizontal</div>
      <Seg value={text.align} label="Text alignment" options={[
        { id: 'left', label: 'Left' }, { id: 'center', label: 'Center' }, { id: 'right', label: 'Right' },
      ]} onChange={align => update({ align })} testId="text-align" />
      <div className="field-label">Vertical</div>
      <Seg value={text.verticalAlign} label="Vertical alignment" options={[
        { id: 'top', label: 'Top' }, { id: 'middle', label: 'Middle' }, { id: 'bottom', label: 'Bottom' },
      ]} onChange={verticalAlign => update({ verticalAlign })} testId="text-vertical-align" />
      <p className="hint">Text keeps the selected layer's gradient or shader paint, blend mode, transforms, effects, and texture.</p>
    </Section>}
    {layer.text && <Section title="Merge & depth" hint="Camouflage text color with layers underneath">
      <div className="field-label">Text merge</div>
      <Seg value={text.mergeStyle} label="Text merge style" options={[
        { id: 'none', label: 'Off' },
        { id: 'color', label: 'Color' },
        { id: 'depth', label: 'Depth' },
        { id: 'both', label: 'Both' },
      ]} onChange={mergeStyle => update({ mergeStyle })} testId="text-merge-style" />
      {text.mergeStyle !== 'none' && <p className="hint">
        {text.mergeStyle === 'color' && 'Multiply the glyph gradient with visible layers below so its colors adapt to the artwork.'}
        {text.mergeStyle === 'depth' && 'Use soft-light blending with raised highlights and shadowed character edges.'}
        {text.mergeStyle === 'both' && 'Adapt glyph colors to the layers below, with raised highlights and shadowed character edges.'}
      </p>}
      {(text.mergeStyle === 'depth' || text.mergeStyle === 'both') && <ValueControl
        label="Character depth"
        value={text.depth}
        min={0}
        max={24}
        step={0.5}
        unit="px"
        def={4}
        onChange={depth => update({ depth }, 'text-depth')}
        testId="text-depth"
      />}
    </Section>}
  </div>;
}
