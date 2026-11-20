import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Section, Seg, ValueControl } from '../../shared/controls';
import { useStore } from '../engine/store';
import { saveBlob } from '../export/download';
import { animationInfo, exportSlug, formatBytes, resolveBackground, resolveSizes, suggestedDuration } from '../export/exportPlan';
import { MAX_IMAGE_SIDE, loadImageSettings, saveImageSettings, type ImageFormat, type ImageSettings } from '../export/exportTypes';
import { isAbort } from '../export/frameCapture';
import { runImageExport, type ImageExportResult } from '../export/runImageExport';
import { BackgroundControls, Field, FramePreview, ProgressBar, SizeControls } from './ExportControls';
import { useStudio } from './ui';

const FORMATS: { id: ImageFormat; label: string }[] = [{ id: 'png', label: 'PNG' }, { id: 'jpeg', label: 'JPEG' }, { id: 'webp', label: 'WebP' }, { id: 'svg', label: 'SVG' }];

/** Image export: format, size(s), quality, background and, for moving projects, the exact moment to capture. */
export default function ImageExportPanel() {
  const { store, announce } = useStudio();
  const project = useStore(store, state => state.project);
  const [settings, setSettings] = useState<ImageSettings>(loadImageSettings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImageExportResult | null>(null);
  const [previewNotes, setPreviewNotes] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => { saveImageSettings(settings); }, [settings]);
  useEffect(() => () => controller.current?.abort(), []);
  const update = (patch: Partial<ImageSettings>) => setSettings(current => ({ ...current, ...patch }));

  const info = useMemo(() => animationInfo(project), [project]);
  const sizes = useMemo(() => resolveSizes(project.canvas, settings.size, { even: false, maxSide: MAX_IMAGE_SIDE, single: settings.format === 'svg' }), [project.canvas, settings.size, settings.format]);
  const alpha = settings.format !== 'jpeg';
  const background = resolveBackground(project, settings.background, alpha);
  const slug = exportSlug(project, settings.fileName);
  const maxTime = Math.max(10, Math.ceil(suggestedDuration(info) * 2));
  const lossy = settings.format === 'jpeg' || settings.format === 'webp';
  const tooBig = sizes.some(size => size.width * size.height > 100_000_000);

  const run = async (mode: 'download' | 'clipboard') => {
    const ac = new AbortController();
    controller.current = ac;
    setBusy(true);
    setError('');
    setResult(null);
    setMessage('Preparing…');
    try {
      const exported = await runImageExport(store.getState().project, settings, { signal: ac.signal, onProgress: progress => setMessage(progress.message) });
      setResult(exported);
      if (mode === 'clipboard') {
        if (settings.format !== 'png' || exported.files.length !== 1) throw new Error('Copying to the clipboard works for a single PNG.');
        if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('This browser cannot copy images to the clipboard.');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': exported.blob })]);
        announce('Image copied to the clipboard');
      } else {
        saveBlob(exported.fileName, exported.blob);
        announce(exported.files.length > 1 ? `${exported.files.length} images saved in ${exported.fileName}` : `Saved ${exported.fileName} · ${formatBytes(exported.blob.size)}`);
      }
    } catch (failure) {
      if (isAbort(failure)) announce('Export cancelled');
      else setError(failure instanceof Error ? failure.message : 'The export failed.');
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };

  const notes = [...new Set([...(result?.notes ?? []), ...previewNotes])];
  return <div className="gs-output xp" data-testid="image-export-panel">
    <div className="xp-head">
      <b>Image export</b>
      <small>{sizes.map(size => `${size.width}×${size.height}`).join(' · ')}{info.dynamic ? ` · frame at ${settings.time}s` : ''}</small>
    </div>
    <Seg value={settings.format} label="Image format" onChange={format => update({ format })} options={FORMATS} testId="image-format" />
    <div className="xp-cols">
      <FramePreview project={project} background={background} time={settings.time} dynamic={info.dynamic}
        width={sizes[0]?.width ?? project.canvas.w} height={sizes[0]?.height ?? project.canvas.h} fit={sizes[0]?.fit ?? 'stretch'}
        disabled={busy} onNotes={setPreviewNotes} />
      <div className="xp-options">
        <Section title="Size" hint={sizes.length > 1 ? `${sizes.length} files` : sizes[0] ? `${sizes[0].width}×${sizes[0].height}` : ''}>
          <SizeControls size={settings.size} onChange={size => update({ size })} canvas={project.canvas} multi={settings.format !== 'svg'} maxSide={MAX_IMAGE_SIDE} />
          {tooBig && <small className="xp-error">That is more than 100 megapixels: browsers cannot render it. Choose a smaller size.</small>}
          {sizes.length > 1 && <small className="xp-hint">Several sizes are saved together in one ZIP.</small>}
        </Section>
        {info.dynamic && <Section title="Moment" hint={`${settings.time}s`}>
          <ValueControl label="Capture at" value={settings.time} min={0} max={maxTime} step={0.1} unit="s" def={0} onChange={time => update({ time })} />
          <small className="xp-hint">Animation and shaders are advanced to this exact time. Pointer interaction is not captured.</small>
        </Section>}
        <Section title="Format options" hint={lossy ? `quality ${settings.quality}` : settings.format.toUpperCase()}>
          {lossy && <ValueControl label="Quality" value={settings.quality} min={1} max={100} step={1} unit="%" def={92} onChange={quality => update({ quality })} />}
          {settings.format === 'png' && <small className="xp-hint">PNG is lossless and keeps transparency.</small>}
          {settings.format === 'svg' && <small className="xp-hint">SVG is a vector still image: it scales to any size, animation and shaders are not included.</small>}
          <Field label="Background"><BackgroundControls value={settings.background} onChange={value => update({ background: value })}
            alphaNote={alpha ? 'Used when you choose Solid colour.' : 'JPEG has no transparency: transparent areas are filled with this colour.'} /></Field>
        </Section>
        <Section title="File" open={false}>
          <Field label="File name" hint="Size and moment are added to the name automatically.">
            <input className="xp-input" value={settings.fileName} placeholder={slug} maxLength={80} onChange={event => update({ fileName: event.target.value })} aria-label="File name" />
          </Field>
        </Section>
      </div>
    </div>
    {notes.length > 0 && <div className="gs-note" role="note">{notes.join(' · ')}</div>}
    {error && <div className="xp-failure" role="alert">{error}</div>}
    {busy && <ProgressBar value={0.4} label={message || 'Working…'} />}
    <div className="gs-copyrow xp-actions">
      {busy
        ? <button type="button" className="btn" onClick={() => controller.current?.abort()}>Cancel</button>
        : <>
          <button type="button" className="btn primary" disabled={tooBig} onClick={() => { void run('download'); }} data-testid="image-download"><Download />{sizes.length > 1 ? 'Download ZIP' : `Download ${settings.format === 'jpeg' ? 'JPG' : settings.format.toUpperCase()}`}</button>
          {settings.format === 'png' && sizes.length === 1 && <button type="button" className="btn" disabled={tooBig} onClick={() => { void run('clipboard'); }} data-testid="image-copy"><Copy />Copy image</button>}
        </>}
    </div>
    {result && !busy && <div className="xp-result" data-testid="image-result">
      <b>Saved {result.fileName}</b>
      <span>{result.files.map(file => `${file.name} · ${file.width}×${file.height} · ${formatBytes(file.blob.size)}`).join('\n')}</span>
      <button type="button" className="btn small" onClick={() => saveBlob(result.fileName, result.blob)}><Download />Download again</button>
    </div>}
  </div>;
}
