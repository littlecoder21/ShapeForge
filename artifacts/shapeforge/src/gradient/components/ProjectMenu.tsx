import { X } from 'lucide-react';
import { ColorInput } from './ui';
import { CANVAS_PRESETS, newProject } from '../engine/model';
import { useStore } from '../engine/store';
import { NumField } from '../../shared/controls';
import { useStudio } from './ui';

/** Project-level settings: name, canvas size (design size used for px values and PNG), background, reset. */
export default function ProjectMenu({ onClose }: { onClose: () => void }) {
  const { store, announce } = useStudio();
  const project = useStore(store, s => s.project);
  const set = (patch: Partial<typeof project>, key?: string) => store.update(p => ({ ...p, ...patch }), { coalesce: key });
  return <div className="gs-menu" role="dialog" aria-label="Project settings" data-testid="project-menu">
    <div className="gs-menu-head"><b>Project</b><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X /></button></div>
    <label className="field-label" htmlFor="gs-name">Name</label>
    <input id="gs-name" className="generate-select" value={project.name} onChange={e => set({ name: e.target.value }, 'pname')} data-testid="project-name" />
    <div className="field-label">Canvas size <span>{project.canvas.w} × {project.canvas.h} px</span></div>
    <div className="chips wrap">{CANVAS_PRESETS.map(c => <button key={c.id} type="button" className={`chip ${project.canvas.w === c.w && project.canvas.h === c.h ? 'active' : ''}`} onClick={() => set({ canvas: { w: c.w, h: c.h } })} data-testid={`canvas-${c.id.replace(':', 'x')}`}>{c.label}</button>)}</div>
    <div className="gs-two">
      <NumField label="Width" value={project.canvas.w} min={64} max={4096} dp={0} unit="px" onCommit={v => set({ canvas: { ...project.canvas, w: Math.round(v) } })} testId="canvas-w" />
      <NumField label="Height" value={project.canvas.h} min={64} max={4096} dp={0} unit="px" onCommit={v => set({ canvas: { ...project.canvas, h: Math.round(v) } })} testId="canvas-h" />
    </div>
    <p className="hint">The canvas is the design size: circle radii, blur and px repeats are measured in it, and PNG export uses it. Percent-based output scales to any element.</p>
    <div className="field-label">Background colour</div>
    <ColorInput color={project.background || '#000000'} alpha={1} showAlpha={false} onChange={c => set({ background: c }, 'bg')} label="Background" testId="project-bg" />
    <div className="gs-btnrow">
      <button type="button" className="btn" onClick={() => set({ background: '' })} data-testid="project-bg-clear">Transparent</button>
      <button type="button" className="btn danger" onClick={() => { store.replace(newProject()); announce('New project'); onClose(); }} data-testid="project-new">New project</button>
    </div>
  </div>;
}
