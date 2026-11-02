import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { ChevronDown, Copy, Download, ImageDown, Upload } from 'lucide-react';
import { Seg } from '../../shared/controls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { buildOutputs } from '../engine/output';
import { exportPng } from '../engine/raster';
import { outputOf } from '../engine/model';
import { parseProjectFile } from '../engine/projectFile';
import { interactiveExports } from '../interactive/export';
import { useStore } from '../engine/store';
import CodeBlock from './CodeBlock';
import OutputSettingsForm from './OutputSettingsForm';
import { useStudio } from './ui';

type Fmt = 'css' | 'html' | 'interactive' | 'vars' | 'svg' | 'keyframes' | 'json';
const FORMATS: { id: Fmt; label: string }[] = [{ id: 'css', label: 'CSS' }, { id: 'html', label: 'HTML + CSS' }, { id: 'interactive', label: 'Interactive' }, { id: 'vars', label: 'Variables' }, { id: 'svg', label: 'SVG' }, { id: 'keyframes', label: 'Keyframes' }, { id: 'json', label: 'JSON' }];

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
  const interactive = useMemo(() => interactiveExports(project), [project]);
  const [cssMode, setCssMode] = useState<'full' | 'properties'>('full');
  const [interactiveMode, setInteractiveMode] = useState<'html' | 'javascript' | 'glsl' | 'react'>('html');
  const [importText, setImportText] = useState('');
  const [recoveryBackup, setRecoveryBackup] = useState('');
  const [recoveryWarnings, setRecoveryWarnings] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const configuredName = outputOf(project).downloadName.trim();
  const slug = (configuredName || project.name || 'gradient').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'gradient';
  const saveText = (extension: string, text: string, type = 'text/plain;charset=utf-8') => save(`${slug}.${extension}`, new Blob([text], { type }));
  const saveStandaloneHtml = () => save(`${slug}.standalone.html`, new Blob([interactive.html], { type: 'text/html;charset=utf-8' }));
  const saveStandaloneJs = () => save(`${slug}.standalone.js`, new Blob([interactive.javascript], { type: 'text/javascript;charset=utf-8' }));
  const standaloneHtmlButton = <button type="button" className="btn small" onClick={saveStandaloneHtml} aria-label="Download standalone interactive HTML" data-testid="download-interactive-standalone-html-direct"><Download />.html</button>;
  const standaloneJsButton = <button type="button" className="btn small" onClick={saveStandaloneJs} aria-label="Download standalone interactive JavaScript" data-testid="download-interactive-standalone-js-direct"><Download />.js</button>;
  const downloadButton = (extension: string, text: string, label = `.${extension}`) => <button type="button" className="btn small" onClick={() => saveText(extension, text)} data-testid={`download-${extension}`}><Download />{label}</button>;
  const copyInteractiveAsset = async (label: string, text: string) => {
    try { await navigator.clipboard.writeText(text); announce(`${label} copied`); }
    catch { announce('Clipboard unavailable'); }
  };

  const png = async (scale: number) => {
    try {
      const r = await exportPng(project, scale);
      save(`${slug}${scale === 1 ? '' : `@${scale}x`}.png`, r.blob);
      announce(r.notes.length ? r.notes.join(' · ') : `PNG exported · ${project.canvas.w * scale}×${project.canvas.h * scale}`);
    } catch (error) {
      announce(error instanceof Error ? `PNG export failed: ${error.message}` : 'PNG export failed');
    }
  };
  const doImport = (text = importText) => {
    try {
      const imported = parseProjectFile(text);
      store.replace(imported.project);
      setRecoveryBackup(imported.warnings.length ? text : '');
      setRecoveryWarnings(imported.warnings);
      announce(imported.warnings.length ? `Project imported with ${imported.warnings.length} compatibility adjustment${imported.warnings.length === 1 ? '' : 's'}` : 'Project imported');
      setImportText('');
    } catch (e) {
      announce(e instanceof Error ? e.message : 'Could not read that JSON');
    }
  };
  const readProjectFile = async (file?: File) => {
    if (!file) return;
    try { doImport(await file.text()); }
    catch (error) { announce(error instanceof Error ? `Could not read file: ${error.message}` : 'Could not read project file'); }
    if (fileInput.current) fileInput.current.value = '';
  };
  const downloadRecoveryBackup = () => save(`${slug}.recovery-backup.json`, new Blob([recoveryBackup], { type: 'application/json;charset=utf-8' }));

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
    {fmt === 'interactive' && <>
      <div className="gs-fmt" role="tablist" aria-label="Interactive export format">
        {([
          { id: 'html', label: 'HTML + JS' },
          { id: 'javascript', label: 'JavaScript' },
          { id: 'glsl', label: 'GLSL' },
          { id: 'react', label: 'React + TS' },
        ] as const).map(format => (
          <button key={format.id} type="button" role="tab" aria-selected={interactiveMode === format.id} className={`ptab ${interactiveMode === format.id ? 'active' : ''}`} onClick={() => setInteractiveMode(format.id)} data-testid={`interactive-out-${format.id}`}>
            {format.label}
          </button>
        ))}
      </div>
      {interactiveMode === 'html' && <CodeBlock
        title="Interactive HTML markup"
        text={interactive.markup}
        lang="html"
        testId="code-interactive-html"
        hideCopy
        actions={<>{standaloneHtmlButton}<DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="btn small" aria-label="HTML, CSS, and JavaScript copy and download options" data-testid="interactive-assets-menu">
              <Copy />Assets<ChevronDown />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" style={{ zIndex: 100 }}>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Copy />Copy standalone</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent style={{ zIndex: 101 }}>
                  <DropdownMenuItem onSelect={() => { void copyInteractiveAsset('Standalone HTML', interactive.html); }} data-testid="copy-interactive-standalone-html"><Copy />HTML</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { void copyInteractiveAsset('Standalone JavaScript', interactive.javascript); }} data-testid="copy-interactive-standalone-js"><Copy />JavaScript</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Copy />Copy separate assets</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent style={{ zIndex: 101 }}>
                  <DropdownMenuItem onSelect={() => { void copyInteractiveAsset('HTML markup', interactive.markup); }} data-testid="copy-interactive-html"><Copy />HTML markup</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { void copyInteractiveAsset('CSS', interactive.stylesheet); }} data-testid="copy-interactive-css"><Copy />CSS</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { void copyInteractiveAsset('Shader runtime JavaScript', interactive.runtime); }} data-testid="copy-interactive-js"><Copy />Shader runtime JS</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Download />Download standalone</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent style={{ zIndex: 101 }}>
                  <DropdownMenuItem onSelect={saveStandaloneHtml} data-testid="download-interactive-standalone-html"><Download />HTML file</DropdownMenuItem>
                  <DropdownMenuItem onSelect={saveStandaloneJs} data-testid="download-interactive-standalone-js"><Download />JavaScript file</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Download />Download separate assets</DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent style={{ zIndex: 101 }}>
                  <DropdownMenuItem onSelect={() => saveText('markup.html', interactive.markup, 'text/html;charset=utf-8')} data-testid="download-interactive-html"><Download />HTML markup</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => saveText('css', interactive.stylesheet, 'text/css;charset=utf-8')} data-testid="download-interactive-css"><Download />CSS</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => saveText('shader-runtime.js', interactive.runtime, 'text/javascript;charset=utf-8')} data-testid="download-interactive-js"><Download />Shader runtime JS</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu></>}
      />}
      {interactiveMode === 'javascript' && <CodeBlock title="Standalone interactive JavaScript" text={interactive.javascript} lang="js" testId="code-interactive-javascript" copyLabel="Copy JavaScript" actions={standaloneJsButton} />}
      {interactiveMode === 'glsl' && <CodeBlock title="Shader sources and uniforms" text={interactive.glsl} lang="glsl" testId="code-interactive-glsl" copyLabel="Copy GLSL" actions={downloadButton('glsl', interactive.glsl, 'Download GLSL')} />}
      {interactiveMode === 'react' && <CodeBlock title="Self-contained React + TypeScript component" text={interactive.react} lang="tsx" testId="code-interactive-react" copyLabel="Copy React component" actions={downloadButton('tsx', interactive.react, 'Download TSX')} />}
    </>}
    {fmt === 'json' && <>
      <CodeBlock title="Project JSON" text={out.json} lang="json" testId="code-json" copyLabel="Copy JSON" actions={downloadButton('json', out.json, '.json')} />
      <p className="hint">This project file includes every editable layer, gradient, effect, animation, canvas setting, and shader option. Older project JSON files can still be imported.</p>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => { void readProjectFile(event.currentTarget.files?.[0]); }} data-testid="project-json-file" />
      <button type="button" className="btn" onClick={() => fileInput.current?.click()}><Upload />Choose project JSON file</button>
      <label className="field-label" htmlFor="gs-import">Import project JSON</label>
      <textarea id="gs-import" className="boundary-input" rows={4} value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste a project JSON file here" spellCheck={false} />
      <button type="button" className="btn wide" onClick={() => doImport()} disabled={!importText.trim()}>Load project</button>
      {recoveryBackup && <div className="gs-note" role="status" data-testid="project-recovery">
        <b>Compatibility recovery applied.</b> The imported project is available in Undo; download the original file to keep an untouched backup.
        <ul>{recoveryWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        <button type="button" className="btn small" onClick={downloadRecoveryBackup} data-testid="download-recovery-backup"><Download />Download original JSON backup</button>
      </div>}
    </>}
  </div>;
}
export type { Fmt };
