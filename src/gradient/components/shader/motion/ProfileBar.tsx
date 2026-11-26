import { useRef, useState } from 'react';
import { Copy, Download, Trash2, Upload } from 'lucide-react';
import {
  FLOW_PRESETS, MOTION_PROFILES, deleteUserProfile, duplicateUserProfile, exportUserProfile, importUserProfile, loadUserProfiles, renameUserProfile, saveUserProfile, type UserProfile,
} from '../../../../motion/presets';
import { cloneMotion, defaultMotion, parseMotion, serializeMotion } from '../../../../motion/types';
import { Section } from '../parts';
import type { MotionEditor } from './useMotion';

type Notice = { kind: 'ok' | 'error' | 'warn'; text: string } | null;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Flow scenes, motion profiles, saved profiles and JSON import / export. Every path goes through the validator, so a bad file
 *  produces a readable message and leaves the current motion untouched. */
export default function ProfileBar({ editor }: { editor: MotionEditor }) {
  const { config, replace } = editor;
  const [profiles, setProfiles] = useState<UserProfile[]>(() => loadUserProfiles());
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const file = useRef<HTMLInputElement | null>(null);

  const apply = (jsonText: string, source: string) => {
    const result = parseMotion(jsonText);
    if (!result.ok) { setNotice({ kind: 'error', text: `${source}: ${result.error}` }); return; }
    replace(result.config);
    setNotice(result.warnings.length ? { kind: 'warn', text: `${source} imported with ${result.warnings.length} fix${result.warnings.length === 1 ? '' : 'es'}: ${result.warnings.slice(0, 4).join('; ')}${result.warnings.length > 4 ? '…' : ''}` } : { kind: 'ok', text: `${source} imported.` });
  };

  return <>
    <Section title="Flow scenes" aside={`${FLOW_PRESETS.length}`} open={false} testId="motion-scenes">
      <div className="gs-mot-grid">
        {FLOW_PRESETS.map(preset => <button key={preset.id} type="button" className="gs-mot-card" title={preset.description} onClick={() => replace(preset.apply(config))} data-testid={`motion-scene-${preset.id}`}><b>{preset.label}</b><span>{preset.description}</span></button>)}
      </div>
      <p className="hint">A scene replaces the flow sources. Your physics, turbulence and pointer settings are kept.</p>
    </Section>
    <Section title="Motion profiles" aside={config.profile && config.profile !== 'custom' ? config.profile : `${MOTION_PROFILES.length}`} open={false} testId="motion-profiles">
      <div className="gs-chip-row" aria-label="Motion profiles">
        {MOTION_PROFILES.map(preset => <button key={preset.id} type="button" className={`chip ${config.profile === preset.id ? 'active' : ''}`} title={preset.description} onClick={() => replace(preset.apply(config))} data-testid={`motion-profile-${preset.id}`}>{preset.label}</button>)}
      </div>
      <p className="hint">A profile changes the character (physics, speed, organic drift, time) and keeps your flow sources.</p>
    </Section>
    <Section title="My profiles & JSON" aside={`${profiles.length}`} open={false} testId="motion-json">
      <div className="gs-mot-seed">
        <input type="text" className="generate-select" placeholder="Profile name" maxLength={60} value={name} onChange={event => setName(event.target.value)} aria-label="Profile name" data-testid="motion-profile-name" />
        <button type="button" className="chip" onClick={() => { setProfiles(saveUserProfile(name, config)); setNotice({ kind: 'ok', text: `Saved “${name.trim() || 'My profile'}” in this browser.` }); setName(''); }} data-testid="motion-profile-save">Save</button>
      </div>
      {profiles.length === 0 && <p className="hint">Saved profiles live in this browser. Export one to share it or move it to another machine.</p>}
      <ul className="gs-mot-list">
        {profiles.map(profile => <li key={profile.id} className="gs-mot-row">
          <button type="button" className="gs-mot-pick" onClick={() => { replace(cloneMotion(profile.config)); setNotice({ kind: 'ok', text: `Loaded “${profile.name}”.` }); }}><b>{profile.name}</b><span>{profile.config.sources.length} source{profile.config.sources.length === 1 ? '' : 's'}</span></button>
          <button type="button" className="gs-mot-icon" aria-label={`Rename ${profile.name}`} onClick={() => { const next = window.prompt('Rename profile', profile.name); if (next !== null) setProfiles(renameUserProfile(profile.id, next)); }}>Aa</button>
          <button type="button" className="gs-mot-icon" aria-label={`Duplicate ${profile.name}`} onClick={() => setProfiles(duplicateUserProfile(profile.id))}><Copy size={13} /></button>
          <button type="button" className="gs-mot-icon" aria-label={`Export ${profile.name}`} onClick={() => download(`${profile.name.replace(/[^\w-]+/g, '-') || 'motion'}.motion.json`, exportUserProfile(profile))}><Download size={13} /></button>
          <button type="button" className="gs-mot-icon danger" aria-label={`Delete ${profile.name}`} onClick={() => setProfiles(deleteUserProfile(profile.id))}><Trash2 size={13} /></button>
        </li>)}
      </ul>
      <div className="gs-chip-row">
        <button type="button" className="chip" onClick={() => download('shapeforge.motion.json', serializeMotion(config))} data-testid="motion-json-download"><Download size={12} /> Download JSON</button>
        <button type="button" className="chip" onClick={() => { const json = serializeMotion(config); setText(json); navigator.clipboard?.writeText(json).then(() => setNotice({ kind: 'ok', text: 'Copied to the clipboard and shown below.' }), () => setNotice({ kind: 'warn', text: 'Clipboard blocked: the JSON is shown below, copy it from there.' })); }} data-testid="motion-json-copy"><Copy size={12} /> Copy JSON</button>
        <button type="button" className="chip" onClick={() => file.current?.click()} data-testid="motion-json-upload"><Upload size={12} /> Import file</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={event => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (!picked) return;
          if (picked.size > 1_000_000) { setNotice({ kind: 'error', text: 'That file is too large to be a motion profile.' }); return; }
          picked.text().then(content => apply(content, picked.name), () => setNotice({ kind: 'error', text: 'The file could not be read.' }));
        }} />
      </div>
      <label className="field-label" htmlFor="motion-json-text">Paste JSON</label>
      <textarea id="motion-json-text" className="gs-mot-json" rows={6} spellCheck={false} value={text} onChange={event => setText(event.target.value)} placeholder='{ "format": "shapeforge-motion", … }' data-testid="motion-json-text" />
      <div className="gs-chip-row">
        <button type="button" className="chip" disabled={!text.trim()} onClick={() => apply(text, 'Pasted JSON')} data-testid="motion-json-apply">Apply</button>
        <button type="button" className="chip" disabled={!text.trim()} onClick={() => { const result = importUserProfile(text, name.trim() || 'Imported'); if (result.ok) { setProfiles(result.profiles); setNotice({ kind: 'ok', text: 'Added to My profiles.' }); } else setNotice({ kind: 'error', text: result.error }); }}>Add to my profiles</button>
        <button type="button" className="chip" onClick={() => { replace(defaultMotion()); setNotice({ kind: 'ok', text: 'Motion engine reset to defaults.' }); }} data-testid="motion-reset">Reset engine</button>
      </div>
      {notice && <p className={`gs-mot-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} data-testid="motion-notice">{notice.text}</p>}
    </Section>
  </>;
}
