import { useRef, useSyncExternalStore } from 'react';
import { cloneProject, type GradientLayer, type GradientProject } from './model';

/* External store: the project lives outside React so that dragging a handle re-renders only the components
 * that read the changed slice, and so history (undo / redo) is a plain data structure. */

export interface StudioState { project: GradientProject; layerId: string | null; stopId: string | null; past: GradientProject[]; future: GradientProject[] }
type Listener = () => void;

const LIMIT = 80;

export function createStudioStore(initial: GradientProject) {
  let state: StudioState = { project: initial, layerId: initial.layers[0]?.id ?? null, stopId: null, past: [], future: [] };
  const listeners = new Set<Listener>();
  let gesture: GradientProject | null = null;
  let lastKey = '', lastAt = 0;
  const emit = () => listeners.forEach(l => l());
  const set = (patch: Partial<StudioState>) => { state = { ...state, ...patch }; emit(); };
  const pushPast = (before: GradientProject) => ({ past: [...state.past.slice(-(LIMIT - 1)), before], future: [] as GradientProject[] });

  const api = {
    getState: () => state,
    subscribe: (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; },
    select(layerId: string | null, stopId: string | null = null) { if (layerId !== state.layerId || stopId !== state.stopId) set({ layerId, stopId }); },
    selectStop(stopId: string | null) { if (stopId !== state.stopId) set({ stopId }); },
    /** Apply a change. `coalesce` merges rapid consecutive changes with the same key into one undo step. */
    update(fn: (p: GradientProject) => GradientProject, opts: { coalesce?: string } = {}) {
      const next = fn(state.project);
      if (next === state.project) return;
      const now = performance.now();
      if (gesture) { set({ project: next }); return; }
      const merge = opts.coalesce && opts.coalesce === lastKey && now - lastAt < 700;
      lastKey = opts.coalesce ?? ''; lastAt = now;
      set(merge ? { project: next } : { project: next, ...pushPast(state.project) });
    },
    updateLayer(id: string, patch: Partial<GradientLayer> | ((l: GradientLayer) => GradientLayer), opts: { coalesce?: string } = {}) {
      api.update(p => ({ ...p, layers: p.layers.map(l => (l.id === id ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l)) }), opts);
    },
    /** Group many updates (a drag) into one undo step. */
    begin() { if (!gesture) gesture = state.project; },
    end() { if (gesture) { const g = gesture; gesture = null; if (g !== state.project) set(pushPast(g)); } },
    replace(project: GradientProject, layerId?: string | null) { gesture = null; lastKey = ''; set({ project, layerId: layerId === undefined ? project.layers[0]?.id ?? null : layerId, stopId: null, ...pushPast(state.project) }); },
    reset(project: GradientProject) { gesture = null; lastKey = ''; state = { project, layerId: project.layers[0]?.id ?? null, stopId: null, past: [], future: [] }; emit(); },
    undo() {
      if (!state.past.length) return;
      const prev = state.past[state.past.length - 1]; lastKey = '';
      const layerId = prev.layers.some(l => l.id === state.layerId) ? state.layerId : prev.layers[0]?.id ?? null;
      set({ project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future], layerId });
    },
    redo() {
      if (!state.future.length) return;
      const next = state.future[0]; lastKey = '';
      const layerId = next.layers.some(l => l.id === state.layerId) ? state.layerId : next.layers[0]?.id ?? null;
      set({ project: next, future: state.future.slice(1), past: [...state.past, state.project], layerId });
    },
    snapshot: () => cloneProject(state.project),
  };
  return api;
}
export type StudioStore = ReturnType<typeof createStudioStore>;

/** Subscribe to a slice of the store. Re-renders only when the selected value changes. */
export function useStore<T>(store: StudioStore, selector: (s: StudioState) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const cache = useRef<{ v: T } | null>(null);
  const get = () => {
    const next = selector(store.getState());
    if (cache.current && eq(cache.current.v, next)) return cache.current.v;
    cache.current = { v: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, get, get);
}
