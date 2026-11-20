import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Section, Switch } from '../../shared/controls';
import { useStore } from '../engine/store';
import { buildCodeExportPackage, codeExportSlug, codeExportZip, type WebsiteExportFileNames, type WebsiteTag } from '../engine/codeExport';
import { outputOf } from '../engine/model';
import CodeBlock from './CodeBlock';
import OutputSettingsForm from './OutputSettingsForm';
import { useStudio } from './ui';

const TAGS: { id: WebsiteTag; label: string }[] = [
  { id: 'section', label: '<section>' }, { id: 'div', label: '<div>' }, { id: 'article', label: '<article>' },
  { id: 'header', label: '<header>' }, { id: 'main', label: '<main>' }, { id: 'aside', label: '<aside>' }, { id: 'figure', label: '<figure>' },
];

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function WebsiteExportPanel() {
  const { store, announce } = useStudio();
  const project = useStore(store, state => state.project);
  const [tag, setTag] = useState<WebsiteTag>('section');
  const [includeTrailFx, setIncludeTrailFx] = useState(true);
  const [zipError, setZipError] = useState('');
  const [fileNames, setFileNames] = useState<WebsiteExportFileNames>({
    html: 'snippet.html',
    css: 'styles.css',
    javascript: 'script.js',
    effectJson: 'effect.json',
  });
  const packageFiles = useMemo(
    () => buildCodeExportPackage(project, { mode: 'website', tag, includeTrailFx, websiteFileNames: fileNames }),
    [project, tag, includeTrailFx, fileNames],
  );
  const slug = codeExportSlug(project);
  const hasTrailFx = !!project.shader?.trailFx?.enabled;
  const effectJson = packageFiles.effectJson;
  const resolvedFileNames = packageFiles.websiteFileNames ?? fileNames;
  const setFileName = (key: keyof WebsiteExportFileNames, value: string) => {
    setFileNames(current => ({ ...current, [key]: value }));
  };
  const downloadZip = async () => {
    setZipError('');
    try {
      save(`${slug}-website-integration.zip`, await codeExportZip(slug, packageFiles.files));
      announce('Website integration ZIP downloaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create the website export ZIP.';
      setZipError(message);
      announce(`Website export failed: ${message}`);
    }
  };
  const downloadFile = (name: string, content: string, type: string) => save(name, new Blob([content], { type }));

  return <div className="gs-output" data-testid="website-export-panel">
    <p className="hint">Copy just the markup and styles for one part of your site. Download the optional runtime and effect data separately, or get everything in one ZIP.</p>
    <Section title="Website element" hint={tag}>
      <label className="nf">
        <span className="nf-label">HTML tag</span>
        <select className="generate-select" value={tag} onChange={event => setTag(event.target.value as WebsiteTag)} aria-label="Website HTML tag" data-testid="website-tag">
          {TAGS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <details className="gs-export-settings">
        <summary className="btn small">Class, ID and size settings</summary>
        <OutputSettingsForm />
      </details>
      {hasTrailFx && <Switch label="Include Trail FX from the project preview" checked={includeTrailFx} onChange={setIncludeTrailFx} testId="website-include-trailfx" />}
    </Section>
    <Section title="Website file names" hint="Extensions are added or corrected automatically.">
      <div className="gs-two">
        <label className="nf">
          <span className="nf-label">HTML file name</span>
          <input className="generate-select" value={fileNames.html} maxLength={120} spellCheck={false} onChange={event => setFileName('html', event.target.value)} data-testid="website-filename-html" />
          <small className="gs-bar-hint">Download: {resolvedFileNames.html}</small>
        </label>
        <label className="nf">
          <span className="nf-label">CSS file name</span>
          <input className="generate-select" value={fileNames.css} maxLength={120} spellCheck={false} onChange={event => setFileName('css', event.target.value)} data-testid="website-filename-css" />
          <small className="gs-bar-hint">Download: {resolvedFileNames.css}</small>
        </label>
        {packageFiles.javascript && <label className="nf">
          <span className="nf-label">JavaScript file name</span>
          <input className="generate-select" value={fileNames.javascript} maxLength={120} spellCheck={false} onChange={event => setFileName('javascript', event.target.value)} data-testid="website-filename-js" />
          <small className="gs-bar-hint">Download: {resolvedFileNames.javascript}</small>
        </label>}
        {effectJson && <label className="nf">
          <span className="nf-label">Effect JSON file name</span>
          <input className="generate-select" value={fileNames.effectJson} maxLength={120} spellCheck={false} onChange={event => setFileName('effectJson', event.target.value)} data-testid="website-filename-json" />
          <small className="gs-bar-hint">Download: {resolvedFileNames.effectJson}</small>
        </label>}
      </div>
    </Section>
    <div className="gs-copyrow" role="group" aria-label="Website integration downloads">
      <button type="button" className="btn primary" onClick={() => { void downloadZip(); }} data-testid="website-download-zip"><Download />Download all as ZIP</button>
      {packageFiles.javascript && <button type="button" className="btn" onClick={() => downloadFile(resolvedFileNames.javascript, packageFiles.javascript, 'text/javascript;charset=utf-8')} data-testid="website-download-js"><Download />Download JS</button>}
      {effectJson && <button type="button" className="btn" onClick={() => downloadFile(resolvedFileNames.effectJson, effectJson, 'application/json;charset=utf-8')} data-testid="website-download-json"><Download />Download effect JSON</button>}
    </div>
    {zipError && <p className="xp-failure" role="alert">{zipError}</p>}
    <CodeBlock title="HTML fragment" text={packageFiles.html} lang="html" testId="website-html" copyLabel="Copy HTML" />
    <CodeBlock title="Scoped CSS" text={packageFiles.css} testId="website-css" copyLabel="Copy CSS" />
    {packageFiles.javascript
      ? <CodeBlock title="Standalone JavaScript" text={packageFiles.javascript} lang="js" testId="website-js" copyLabel="Copy JavaScript" actions={<button type="button" className="btn small" onClick={() => downloadFile(resolvedFileNames.javascript, packageFiles.javascript, 'text/javascript;charset=utf-8')}><Download />.js</button>} />
      : <p className="gs-note" role="note">This project does not need JavaScript. Its layers and animation are handled by CSS.</p>}
    {effectJson
      ? <CodeBlock title={`Trail FX effect JSON (also embedded in ${resolvedFileNames.javascript})`} text={effectJson} lang="json" testId="website-json" copyLabel="Copy effect JSON" actions={<button type="button" className="btn small" onClick={() => downloadFile(resolvedFileNames.effectJson, effectJson, 'application/json;charset=utf-8')}><Download />.json</button>} />
      : <p className="gs-note" role="note">This project does not need a separate JSON file. The editable project JSON remains available under Custom → JSON.</p>}
    <p className="gs-bar-hint">HTML and CSS include paste-in comments. The HTML links script.js only when the project needs JavaScript. Use the README in the ZIP for setup guidance. Project filename: {outputOf(project).downloadName || project.name}.</p>
  </div>;
}
