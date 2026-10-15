import { useDeferredValue, useMemo, useState } from 'react';
import { Download, ImageDown } from 'lucide-react';
import { Seg } from '../../shared/controls';
import { buildOutputs } from '../engine/output';
import { exportPng } from '../engine/raster';
import { normalizeProject, outputOf } from '../engine/model';
import { useStore } from '../engine/store';
import CodeBlock from './CodeBlock';
import OutputSettingsForm from './OutputSettingsForm';
import { useStudio } from './ui';

type Fmt = 'css' | 'html' | 'vars' | 'svg' | 'keyframes' | 'json';
const FORMATS: { id: Fmt; label: string }[] = [{ id: 'css', label: 'CSS' }, { id: 'html', label: 'HTML + CSS' }, { id: 'vars', label: 'Variables' }, { id: 'svg', label: 'SVG' }, { id: 'keyframes', label: 'Keyframes' }, { id: 'json', label: 'JSON' }];

const save = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Output panel — organised code, each format with its own copy actions. */
export default function OutputPanel({ fmt, setFmt }: { fmt: Fmt; setFmt: (f: Fmt) => void }) {
  const { store, announce } = useStudio();
  const project = useDeferredValue(useStore(store, s => s.project));
  const out = useMemo(() => buildOutputs(project), [project]);
  const [cssMode, setCssMode] = useState<'full' | 'properties'>('full');
  const [importText, setImportText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const configuredName = outputOf(project).downloadName.trim();
  const slug = (configuredName || project.name || 'gradient').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'gradient';
  const saveText = (extension: string, text: string, type = 'text/plain;charset=utf-8') => save(`${slug}.${extension}`, new Blob([text], { type }));
  const downloadButton = (extension: string, text: string, label = `.${extension}`) => <button type="button" className="btn small" onClick={() => saveText(extension, text)} data-testid={`download-${extension}`}><Download />{label}</button>;

  const png = async (scale: number) => {
    try {
      const r = await exportPng(project, scale);
      save(`${slug}${scale === 1 ? '' : `@${scale}x`}.png`, r.blob);
      announce(r.notes.length ? r.notes.join(' · ') : `PNG exported · ${project.canvas.w * scale}×${project.canvas.h * scale}`);
    } catch (error) {
      announce(error instanceof Error ? `PNG export failed: ${error.message}` : 'PNG export failed');
    }
  };
  const doImport = () => { try { store.replace(normalizeProject(JSON.parse(importText))); announce('Project imported'); setImportText(''); } catch (e) { announce(e instanceof Error ? e.message : 'Could not read that JSON'); } };

  return <div className="gs-output" data-testid="output-panel">
    <div className="gs-fmt" role="tablist" aria-label="Output format">
      {FORMATS.map(f => <button key={f.id} type="button" role="tab" aria-selected={fmt === f.id} className={`ptab ${fmt === f.id ? 'active' : ''}`} onClick={() => setFmt(f.id)} data-testid={`out-tab-${f.id}`}>{f.label}</button>)}
      <button type="button" className={`ptab gear ${showSettings ? 'active' : ''}`} onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings} data-testid="out-settings-toggle">Names &amp; size</button>
    </div>
    {showSettings && <OutputSettingsForm />}
    <div className="gs-copyrow gs-downloadbar" role="group" aria-label="Download PNG at output resolution">
      <span className="nf-label">Download preview</span>
      <button type="button" className="btn small" onClick={() => png(1)} data-testid="png-1"><ImageDown />PNG</button>
      <button type="button" className="btn small" onClick={() => png(2)} data-testid="png-2"><ImageDown />PNG @2×</button>
      <button type="button" className="btn small" onClick={() => png(3)} data-testid="png-3"><ImageDown />PNG @3×</button>
    </div>
    {out.analysis.needsLayers && (fmt === 'css' || fmt === 'vars') && <div className="gs-note" role="note" data-testid="flat-note">
      <b>Approximate:</b> {out.analysis.warnings.slice(0, 2).join(' · ')}{out.analysis.warnings.length > 2 ? ` · +${out.analysis.warnings.length - 2} more` : ''}.
      <button type="button" className="link" onClick={() => setFmt('html')}>Use HTML + CSS for the exact result</button>
    </div>}

    {fmt === 'css' && <>
      <Seg value={cssMode} label="CSS style" options={[{ id: 'full', label: 'Full rule' }, { id: 'properties', label: 'Properties only' }]} onChange={setCssMode} testId="css-mode" />
      <CodeBlock title={cssMode === 'full' ? 'CSS rule' : 'CSS properties'} text={cssMode === 'full' ? out.flat.full : out.flat.properties} testId="code-css" copyLabel="Copy CSS" actions={downloadButton('css', cssMode === 'full' ? out.flat.full : out.flat.properties)} />
    </>}
    {fmt === 'html' && <>
      <div className="gs-copyrow" role="group" aria-label="Copy options">
        <button type="button" className="btn primary" onClick={() => navigator.clipboard.writeText(out.layered.all).then(() => announce('HTML + CSS copied'), () => announce('Clipboard unavailable'))} data-testid="copy-all">Copy all</button>
        <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(out.layered.css).then(() => announce('CSS copied'), () => announce('Clipboard unavailable'))} data-testid="copy-css">Copy CSS</button>
        <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(out.layered.html).then(() => announce('HTML copied'), () => announce('Clipboard unavailable'))} data-testid="copy-html">Copy HTML</button>
        {downloadButton('html', out.layered.all, 'Download all')}
        {downloadButton('css', out.layered.css, 'Download CSS')}
      </div>
      <CodeBlock title="HTML" text={out.layered.html} lang="html" testId="code-html" copyLabel="Copy HTML" />
      <CodeBlock title="CSS" text={out.layered.css} testId="code-layered-css" copyLabel="Copy CSS" />
    </>}
    {fmt === 'vars' && <CodeBlock title="CSS variables" text={out.vars} testId="code-vars" actions={downloadButton('css', out.vars)} />}
    {fmt === 'svg' && <>
      <CodeBlock title="SVG" text={out.svg} lang="svg" testId="code-svg" copyLabel="Copy SVG" actions={<button type="button" className="btn small" onClick={() => save(`${slug}.svg`, new Blob([out.svg], { type: 'image/svg+xml' }))} data-testid="download-svg"><Download />.svg</button>} />
    </>}
    {fmt === 'keyframes' && <CodeBlock title="Animation CSS" text={out.keyframes} testId="code-keyframes" actions={downloadButton('css', out.keyframes)} />}
    {fmt === 'json' && <>
      <CodeBlock title="Project JSON" text={out.json} lang="json" testId="code-json" copyLabel="Copy JSON" actions={downloadButton('json', out.json, '.json')} />
      <label className="field-label" htmlFor="gs-import">Import project JSON</label>
      <textarea id="gs-import" className="boundary-input" rows={4} value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste a project exported from here" spellCheck={false} />
      <button type="button" className="btn wide" onClick={doImport} disabled={!importText.trim()}>Load project</button>
    </>}
  </div>;
}
export type { Fmt };
