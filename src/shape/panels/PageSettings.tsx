import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { Page, PageUnit } from '../state/document';

const PRESETS = [
  { label: 'Custom', width: 0, height: 0 },
  { label: 'Landscape · 16:9', width: 1600, height: 900 },
  { label: 'Square', width: 1000, height: 1000 },
  { label: 'Portrait · 3:4', width: 900, height: 1200 },
  { label: 'Classic · 4:3', width: 1200, height: 900 },
];

export default function PageSettings({ page, onSave, onClose }: {
  page: Page;
  onSave: (settings: Pick<Page, 'width' | 'height' | 'unit' | 'background'>) => void;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(String(page.width));
  const [height, setHeight] = useState(String(page.height));
  const [unit, setUnit] = useState<PageUnit>(page.unit);
  const [background, setBackground] = useState(page.background);
  const [preset, setPreset] = useState('Custom');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const w = Number(width), h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 100000 || h > 100000) return;
    onSave({ width: w, height: h, unit, background });
    onClose();
  };
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="page-settings" role="dialog" aria-modal="true" aria-labelledby="page-settings-title" onSubmit={submit}>
      <div className="page-settings-head">
        <div><h2 id="page-settings-title">Page settings</h2><p>{page.name} · canvas coordinates start at 0, 0</p></div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Close page settings"><X /></button>
      </div>
      <label className="field-label" htmlFor="page-preset">Size preset</label>
      <select id="page-preset" className="generate-select" value={preset} onChange={event => {
        const next = PRESETS.find(item => item.label === event.target.value);
        if (!next) return;
        setPreset(next.label);
        if (next.width) { setWidth(String(next.width)); setHeight(String(next.height)); }
      }}>
        {PRESETS.map(item => <option key={item.label}>{item.label}</option>)}
      </select>
      <div className="nf-grid two">
        <label className="nf"><span className="nf-label">Width</span><input aria-label="Page width" type="number" min="1" max="100000" step="1" required value={width} onChange={event => { setWidth(event.target.value); setPreset('Custom'); }} /></label>
        <label className="nf"><span className="nf-label">Height</span><input aria-label="Page height" type="number" min="1" max="100000" step="1" required value={height} onChange={event => { setHeight(event.target.value); setPreset('Custom'); }} /></label>
      </div>
      <label className="field-label" htmlFor="page-unit">Output units</label>
      <select id="page-unit" className="generate-select" value={unit} onChange={event => setUnit(event.target.value as PageUnit)}>
        <option value="px">Pixels (px)</option><option value="mm">Millimetres (mm)</option><option value="cm">Centimetres (cm)</option><option value="in">Inches (in)</option>
      </select>
      <div className="page-background-row">
        <label className="field-label" htmlFor="page-background">Page background</label>
        <div className="swatch-row">
          <input aria-label="Transparent page background" type="checkbox" checked={background === 'transparent'} onChange={event => setBackground(event.target.checked ? 'transparent' : '#21262d')} />
          <span className="hint">Transparent</span>
          <input aria-label="Page background color" type="color" value={background === 'transparent' ? '#21262d' : background} disabled={background === 'transparent'} onChange={event => setBackground(event.target.value)} />
          <code>{background}</code>
        </div>
      </div>
      <p className="hint">Coordinates remain in the 1000 × 600 editing grid; output dimensions control the exported page size.</p>
      <div className="page-settings-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Apply settings</button></div>
    </form>
  </div>;
}
