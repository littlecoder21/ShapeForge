import { useEffect, useState } from 'react';
import { ArrowLeftRight, Dices, Plus, Shuffle, X } from 'lucide-react';
import {
  HARMONIES, TRAILFX_PALETTES, harmony, normalizeHex, randomPalette, rampCss, reversePalette, shufflePalette, sortByLightness,
  type HarmonyId,
} from '../../interactive/trailfx/palette';

/** A hex field that lets you type freely and commits only once the text is a valid colour. */
function HexField({ value, id, label, onCommit }: { value: string; id: string; label: string; onCommit: (hex: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = (text: string) => {
    const hex = normalizeHex(text, '');
    if (hex) { if (hex !== value) onCommit(hex); setDraft(hex); } else setDraft(value);
  };
  return <input
    id={id} className="gs-tf-hex" type="text" value={draft} spellCheck={false} maxLength={7} aria-label={label}
    onChange={event => { setDraft(event.target.value); if (/^#?[0-9a-f]{6}$/i.test(event.target.value.trim())) commit(event.target.value); }}
    onBlur={() => commit(draft)}
    onKeyDown={event => { if (event.key === 'Enter') commit(draft); }}
  />;
}

/** The colour combination editor used by every pass that reads a palette, and by the shared palette in the Colours section.
 *  Pick each colour, type a hex, add or remove colours (within what the pass accepts), or start from a curated palette or a
 *  colour-wheel rule. `tools` can be switched off for single-colour tints. */
export default function ColorEditor({ colors, min, max, label, idBase, onChange, sorted = false }: {
  colors: string[]; min: number; max: number; label: string; idBase: string;
  onChange: (colors: string[], coalesce?: string) => void;
  /** a colour map reads dark → light: offer "Sort dark → light" */
  sorted?: boolean;
}) {
  const single = max <= 1;
  const set = (next: string[], coalesce?: string) => onChange(next.slice(0, max), coalesce);
  const addColor = () => {
    if (colors.length >= max) return;
    // the new colour sits between the last two, so a ramp stays smooth
    const last = colors[colors.length - 1] ?? '#ffffff';
    const prev = colors[colors.length - 2] ?? last;
    set([...colors, normalizeHex(rampMid(prev, last), last)]);
  };
  return <div className="gs-tf-colors" data-testid={`${idBase}-colors`}>
    <span className="field-label">{label}</span>
    {!single && <div className="gs-tf-ramp" style={{ background: rampCss(colors) }} aria-hidden="true" />}
    <div className="gs-tf-stops">
      {colors.map((color, i) => <div className="gs-tf-stop" key={`${idBase}-${i}`}>
        <input
          id={`${idBase}-c${i}`} className="gs-interaction-color gs-tf-swatch-input" type="color" value={color} aria-label={`${label} ${i + 1}`}
          onChange={event => set(colors.map((c, j) => (j === i ? event.target.value : c)), `${idBase}-c${i}`)}
        />
        <HexField id={`${idBase}-h${i}`} value={color} label={`${label} ${i + 1} hex`} onCommit={hex => set(colors.map((c, j) => (j === i ? hex : c)))} />
        {!single && <button type="button" className="gs-tf-x" onClick={() => set(colors.filter((_, j) => j !== i))} disabled={colors.length <= min} aria-label={`Remove colour ${i + 1}`}><X /></button>}
      </div>)}
    </div>
    {!single && <>
      <div className="gs-chip-row">
        <button type="button" className="btn small" onClick={addColor} disabled={colors.length >= max} data-testid={`${idBase}-add`}><Plus />Colour</button>
        <button type="button" className="btn small" onClick={() => set(reversePalette(colors))}><ArrowLeftRight />Reverse</button>
        <button type="button" className="btn small" onClick={() => set(shufflePalette(colors))}><Shuffle />Shuffle</button>
        <button type="button" className="btn small" onClick={() => set(randomPalette(colors.length))} data-testid={`${idBase}-random`}><Dices />Random</button>
        {sorted && <button type="button" className="btn small" onClick={() => set(sortByLightness(colors))}>Dark → light</button>}
      </div>
      <div className="gs-field">
        <label className="field-label" htmlFor={`${idBase}-harmony`}>Build from the first colour</label>
        <select id={`${idBase}-harmony`} className="generate-select" value="" onChange={event => { if (event.target.value) set(harmony(colors[0] ?? '#7c5cff', event.target.value as HarmonyId, colors.length)); }}>
          <option value="">Colour-wheel rule…</option>
          {HARMONIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <details className="gs-tf-library">
        <summary className="field-label">Palette library</summary>
        <div className="gs-tf-swatches">
          {TRAILFX_PALETTES.map(palette => <button
            key={palette.id} type="button" className="gs-tf-swatch" title={palette.label} aria-label={`Use the ${palette.label} palette`}
            style={{ background: rampCss(palette.colors) }} onClick={() => set(palette.colors.slice(0, max))} data-testid={`${idBase}-palette-${palette.id}`}
          ><span>{palette.label}</span></button>)}
        </div>
      </details>
    </>}
  </div>;
}

/** midpoint of two hex colours, for "+ Colour" */
function rampMid(a: string, b: string): string {
  const pa = /^#([0-9a-f]{6})$/i.exec(a), pb = /^#([0-9a-f]{6})$/i.exec(b);
  if (!pa || !pb) return b;
  const mix = [0, 2, 4].map(i => Math.round((parseInt(pa[1].slice(i, i + 2), 16) + parseInt(pb[1].slice(i, i + 2), 16)) / 2).toString(16).padStart(2, '0')).join('');
  return `#${mix}`;
}
