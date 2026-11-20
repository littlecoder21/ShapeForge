import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link2, Link2Off } from 'lucide-react';
import { NumField, Seg } from '../../shared/controls';
import type { GradientProject } from '../engine/model';
import { LONG_EDGES, resolveSizes, type OutputSize } from '../export/exportPlan';
import type { BackgroundSettings, FitMode, SizeSettings } from '../export/exportTypes';
import { isAbort } from '../export/frameCapture';
import { renderPreviewCanvas } from '../export/runImageExport';
import '../export/export-panel.css';

/* Controls shared by the Image and Video export panels. */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="xp-field"><span className="xp-label">{label}</span>{children}{hint && <small className="xp-hint">{hint}</small>}</div>;
}

export function Chips<T extends string | number>({ value, options, onChange, label }: { value: T; options: { id: T; label: ReactNode; disabled?: boolean; title?: string }[]; onChange: (value: T) => void; label: string }) {
  return <div className="xp-chips" role="radiogroup" aria-label={label}>
    {options.map(option => <button key={String(option.id)} type="button" role="radio" aria-checked={value === option.id} disabled={option.disabled} title={option.title}
      className={`xp-chip ${value === option.id ? 'on' : ''}`} onClick={() => onChange(option.id)}>{option.label}</button>)}
  </div>;
}

export function MultiChips<T extends number>({ values, options, onChange, label }: { values: T[]; options: { id: T; label: ReactNode }[]; onChange: (values: T[]) => void; label: string }) {
  return <div className="xp-chips" role="group" aria-label={label}>
    {options.map(option => {
      const on = values.includes(option.id);
      return <button key={option.id} type="button" aria-pressed={on} className={`xp-chip ${on ? 'on' : ''}`}
        onClick={() => { const next = on ? values.filter(v => v !== option.id) : [...values, option.id].sort((a, b) => a - b); if (next.length) onChange(next as T[]); }}>{option.label}</button>;
    })}
  </div>;
}

const PRESETS: { label: string; width: number; height: number }[] = [
  { label: 'Landscape 1920×1080', width: 1920, height: 1080 }, { label: 'Portrait 1080×1920', width: 1080, height: 1920 },
  { label: 'Square 1080', width: 1080, height: 1080 }, { label: '4:5 1080×1350', width: 1080, height: 1350 }, { label: '4K 3840×2160', width: 3840, height: 2160 },
];

interface SizeControlsProps {
  size: SizeSettings;
  onChange: (size: SizeSettings) => void;
  canvas: { w: number; h: number };
  /** the Image panel can export several scales at once */
  multi: boolean;
  maxSide: number;
}

/** Output size: canvas multipliers, long-edge presets or an exact width × height with a fit mode. */
export function SizeControls({ size, onChange, canvas, multi, maxSide }: SizeControlsProps) {
  const scaleOptions = [0.5, 1, 1.5, 2, 3, 4].map(scale => ({ id: scale, label: `${scale}×` }));
  const aspect = canvas.w / canvas.h;
  const customWidth = (width: number) => onChange({ ...size, mode: 'custom', width, height: size.lock ? Math.max(16, Math.round(width / aspect)) : size.height });
  const customHeight = (height: number) => onChange({ ...size, mode: 'custom', height, width: size.lock ? Math.max(16, Math.round(height * aspect)) : size.width });
  const differs = size.mode === 'custom' && Math.abs(size.width / size.height - aspect) > 0.01;
  return <div className="xp-stack">
    <Seg value={size.mode} label="Size mode" onChange={mode => onChange({ ...size, mode })} options={[{ id: 'scale', label: 'Canvas ×' }, { id: 'preset', label: 'Long edge' }, { id: 'custom', label: 'Custom' }]} />
    {size.mode === 'scale' && (multi
      ? <MultiChips values={size.scales} options={scaleOptions} onChange={scales => onChange({ ...size, scales })} label="Scales (select several to export them together)" />
      : <Chips value={size.scales[0] ?? 1} options={scaleOptions} onChange={scale => onChange({ ...size, scales: [scale] })} label="Scale" />)}
    {size.mode === 'preset' && <Chips value={size.longEdge} options={LONG_EDGES.map(edge => ({ id: edge.value, label: edge.label }))} onChange={longEdge => onChange({ ...size, longEdge })} label="Long edge in pixels" />}
    {size.mode === 'custom' && <>
      <div className="xp-sizerow">
        <NumField label="Width" value={size.width} min={16} max={maxSide} step={2} dp={0} unit="px" onCommit={customWidth} />
        <button type="button" className={`xp-lock ${size.lock ? 'on' : ''}`} aria-pressed={size.lock} aria-label="Keep the canvas aspect ratio" onClick={() => onChange({ ...size, lock: !size.lock })}>{size.lock ? <Link2 /> : <Link2Off />}</button>
        <NumField label="Height" value={size.height} min={16} max={maxSide} step={2} dp={0} unit="px" onCommit={customHeight} />
      </div>
      <div className="xp-chips" aria-label="Common sizes">
        {PRESETS.map(preset => <button key={preset.label} type="button" className="xp-chip small" onClick={() => onChange({ ...size, mode: 'custom', width: Math.min(preset.width, maxSide), height: Math.min(preset.height, maxSide), lock: false })}>{preset.label}</button>)}
      </div>
      {differs && <Field label="Artwork fit" hint="The canvas is not this shape: choose how it fills the frame.">
        <Seg value={size.fit} label="Fit" onChange={(fit: FitMode) => onChange({ ...size, fit })} options={[{ id: 'contain', label: 'Contain' }, { id: 'cover', label: 'Cover' }, { id: 'stretch', label: 'Stretch' }]} />
      </Field>}
    </>}
  </div>;
}

export function BackgroundControls({ value, onChange, alphaNote }: { value: BackgroundSettings; onChange: (value: BackgroundSettings) => void; alphaNote: string }) {
  return <div className="xp-stack">
    <Seg value={value.mode} label="Background" onChange={mode => onChange({ ...value, mode })} options={[{ id: 'project', label: 'Project' }, { id: 'transparent', label: 'Transparent' }, { id: 'color', label: 'Solid colour' }]} />
    <div className="xp-colorrow">
      <input type="color" className="xp-color" aria-label="Fill colour" value={value.color} onChange={event => onChange({ ...value, color: event.target.value })} />
      <small className="xp-hint">{alphaNote}</small>
    </div>
  </div>;
}

export function ProgressBar({ value, label, detail }: { value: number; label: string; detail?: string }) {
  return <div className="xp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}>
    <div className="xp-progress-bar"><i style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} /></div>
    <div className="xp-progress-text"><span>{label}</span>{detail && <span>{detail}</span>}</div>
  </div>;
}

export function SizeSummary({ sizes }: { sizes: OutputSize[] }) {
  return <>{sizes.map(size => `${size.width}×${size.height}`).join(' · ')}</>;
}

export { resolveSizes };

/** A small rendering of the frame the export will contain. Still projects update automatically, moving ones on request. */
export function FramePreview({ project, background, time, dynamic, width, height, fit, disabled, onNotes }: {
  project: GradientProject; background: string; time: number; dynamic: boolean; width: number; height: number; fit: FitMode; disabled?: boolean; onNotes?: (notes: string[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const run = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ status: 'idle' | 'busy' | 'ready' | 'error'; message?: string }>({ status: 'idle' });
  const aspect = width / height;

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    const id = ++run.current;
    setState({ status: 'busy' });
    try {
      const { canvas, notes } = await renderPreviewCanvas(project, { background, timeSec: time, width, height, fit, maxSide: 640, signal: ac.signal });
      if (id !== run.current) return;
      const target = canvasRef.current;
      if (target) {
        target.width = canvas.width;
        target.height = canvas.height;
        target.getContext('2d')?.drawImage(canvas, 0, 0);
      }
      onNotes?.(notes);
      setState({ status: 'ready' });
    } catch (error) {
      if (isAbort(error) || id !== run.current) return;
      setState({ status: 'error', message: error instanceof Error ? error.message : 'The preview could not be rendered.' });
    }
  }, [project, background, time, width, height, fit, onNotes]);

  useEffect(() => {
    if (dynamic || disabled) return;
    const timer = window.setTimeout(() => { void refresh(); }, 250);
    return () => window.clearTimeout(timer);
  }, [dynamic, disabled, refresh]);
  useEffect(() => () => { controller.current?.abort(); run.current++; }, []);

  return <div className="xp-preview">
    <div className={`xp-preview-box ${background ? '' : 'checker'}`} style={{ aspectRatio: String(aspect) }}>
      <canvas ref={canvasRef} aria-label="Preview of the export" />
      {state.status === 'busy' && <span className="xp-preview-badge">Rendering…</span>}
      {state.status === 'idle' && dynamic && <span className="xp-preview-badge">Press Preview frame</span>}
    </div>
    <div className="xp-preview-actions">
      {dynamic && <button type="button" className="btn small" onClick={() => { void refresh(); }} disabled={disabled || state.status === 'busy'}>Preview frame</button>}
      {state.status === 'error' && <small className="xp-error">{state.message}</small>}
    </div>
  </div>;
}
