import { useDeferredValue, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Section, Switch } from '../../shared/controls';
import { useStore } from '../engine/store';
import { buildCodeExportPackage, codeExportSlug, codeExportZip, type WebsiteExportFileNames } from '../engine/codeExport';
import { sanitizeHostSelector } from '../engine/backgroundOutput';
import CodeBlock from './CodeBlock';
import OutputSettingsForm from './OutputSettingsForm';
import { useStudio } from './ui';

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export the gradient as a background for a section that already exists on a site (hero, main, footer …). */
export default function BackgroundExportPanel() {
  const { store, announce } = useStudio();
  const project = useDeferredValue(useStore(store, state => state.project));
  const [includeTrailFx, setIncludeTrailFx] = useState(true);
  const [hostSelector, setHostSelector] = useState('');
  const [zipError, setZipError] = useState('');
  const [fileNames, setFileNames] = useState<WebsiteExportFileNames>({
    html: 'gradient-background.html',
    css: 'gradient-background.css',
    javascript: 'gradient-background.js',
    effectJson: 'effect.json',
  });
  const packageFiles = useMemo(
    () => buildCodeExportPackage(project, { mode: 'background', includeTrailFx, hostSelector, websiteFileNames: fileNames }),
    [project, includeTrailFx, hostSelector, fileNames],
  );
  const slug = codeExportSlug(project);
  const hasTrailFx = !!project.shader?.trailFx?.enabled;
  const effectJson = packageFiles.effectJson;
  const names = packageFiles.websiteFileNames ?? fileNames;
  const hostInvalid = hostSelector.trim() !== '' && sanitizeHostSelector(hostSelector) === '';
  const setFileName = (key: keyof WebsiteExportFileNames, value: string) => setFileNames(current => ({ ...current, [key]: value }));
  const downloadFile = (name: string, content: string, type: string) => save(name, new Blob([content], { type }));
  const downloadZip = async () => {
    setZipError('');
    try {
      save(`${slug}-section-background.zip`, await codeExportZip(slug, packageFiles.files));
      announce('Section background ZIP downloaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create the section background ZIP.';
      setZipError(message);
      announce(`Section background export failed: ${message}`);
    }
  };

  return <div className="gs-output" data-testid="background-export-panel">
    <p className="hint">Use the gradient as the background of a section that already exists on your site — a hero, <code>main</code>, a footer or a card. Paste the HTML as the <b>first child</b> of that section: it is <code>position: absolute; inset: 0</code> behind your content and never changes the section's size or layout.</p>
    <Section title="Install" hint="3 steps">
      <ol className="gs-steps">
        <li>Paste the HTML fragment as the first child of your section.</li>
        <li>Add the CSS to your stylesheet.</li>
        <li>{packageFiles.javascript ? <>Keep the script line (<code>{names.javascript}</code>); it is already at the end of the fragment.</> : 'No JavaScript is needed for this gradient.'}</li>
      </ol>
      <p className="gs-bar-hint">The download also contains <code>demo.html</code>, a sample hero with the gradient already in place, and a README that explains each rule.</p>
    </Section>
    <Section title="Your section" hint="optional">
      <label className="nf">
        <span className="nf-label">My section's selector</span>
        <input className="generate-select" value={hostSelector} maxLength={200} spellCheck={false} placeholder=".hero" onChange={event => setHostSelector(event.target.value)} aria-label="My section's selector" aria-invalid={hostInvalid || undefined} data-testid="background-host-selector" />
        <small className="gs-bar-hint">{hostInvalid ? 'That is not a plain selector, so it was ignored.' : 'Adds the same zero-specificity rule for it, so browsers without :has() work too. Leave empty if you only paste the fragment.'}</small>
      </label>
      <details className="gs-export-settings">
        <summary className="btn small">Class and ID names</summary>
        <OutputSettingsForm variant="names" />
      </details>
      {hasTrailFx && <Switch label="Include Trail FX from the project preview" checked={includeTrailFx} onChange={setIncludeTrailFx} testId="background-include-trailfx" />}
    </Section>
    <Section title="File names" hint="Extensions are added or corrected automatically.">
      <div className="gs-two">
        <label className="nf">
          <span className="nf-label">HTML file name</span>
          <input className="generate-select" value={fileNames.html} maxLength={120} spellCheck={false} onChange={event => setFileName('html', event.target.value)} data-testid="background-filename-html" />
          <small className="gs-bar-hint">Download: {names.html}</small>
        </label>
        <label className="nf">
          <span className="nf-label">CSS file name</span>
          <input className="generate-select" value={fileNames.css} maxLength={120} spellCheck={false} onChange={event => setFileName('css', event.target.value)} data-testid="background-filename-css" />
          <small className="gs-bar-hint">Download: {names.css}</small>
        </label>
        {packageFiles.javascript && <label className="nf">
          <span className="nf-label">JavaScript file name</span>
          <input className="generate-select" value={fileNames.javascript} maxLength={120} spellCheck={false} onChange={event => setFileName('javascript', event.target.value)} data-testid="background-filename-js" />
          <small className="gs-bar-hint">Download: {names.javascript}</small>
        </label>}
      </div>
    </Section>
    <div className="gs-copyrow" role="group" aria-label="Section background downloads">
      <button type="button" className="btn primary" onClick={() => { void downloadZip(); }} data-testid="background-download-zip"><Download />Download all as ZIP</button>
      <button type="button" className="btn" onClick={() => downloadFile('demo.html', packageFiles.files['demo.html'] ?? '', 'text/html;charset=utf-8')} data-testid="background-download-demo"><Download />Download demo page</button>
      {packageFiles.javascript && <button type="button" className="btn" onClick={() => downloadFile(names.javascript, packageFiles.javascript, 'text/javascript;charset=utf-8')} data-testid="background-download-js"><Download />Download JS</button>}
    </div>
    {zipError && <p className="xp-failure" role="alert">{zipError}</p>}
    <CodeBlock title="1 · HTML — first child of your section" text={packageFiles.html} lang="html" testId="background-html" copyLabel="Copy HTML" />
    <CodeBlock title="2 · CSS — add to your stylesheet" text={packageFiles.css} testId="background-css" copyLabel="Copy CSS" />
    {packageFiles.javascript
      ? <CodeBlock title="3 · JavaScript" text={packageFiles.javascript} lang="js" testId="background-js" copyLabel="Copy JavaScript" actions={<button type="button" className="btn small" onClick={() => downloadFile(names.javascript, packageFiles.javascript, 'text/javascript;charset=utf-8')}><Download />.js</button>} />
      : <p className="gs-note" role="note">This gradient needs no JavaScript: its layers, scaling and animation are plain CSS.</p>}
    {effectJson && <p className="gs-note" role="note">Trail FX settings are embedded in <code>{names.javascript}</code>; <code>{names.effectJson}</code> is included in the ZIP for reference.</p>}
    <p className="gs-bar-hint">Why it does not interfere: it takes no space (out of flow), sits at <code>z-index: -1</code> in a stacking context the section creates, uses a zero-specificity <code>:where()</code> rule on the section (anything you already set there wins), ignores pointer events and uses namespaced class names.</p>
  </div>;
}
