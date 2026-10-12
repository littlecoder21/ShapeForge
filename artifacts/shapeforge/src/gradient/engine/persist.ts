import { newProject, normalizeProject, type GradientProject } from './model';

const KEY = 'shapeforge.gradient.v1';
export function loadProject(): GradientProject {
  try { const raw = localStorage.getItem(KEY); if (raw) return normalizeProject(JSON.parse(raw)); } catch { /* ignore corrupt data */ }
  return newProject();
}
let timer: ReturnType<typeof setTimeout> | undefined;
export function saveProject(p: GradientProject) {
  clearTimeout(timer);
  timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full / unavailable */ } }, 500);
}
