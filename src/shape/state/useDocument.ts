import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ShapeModel } from '../../lib/shape/geometry';
import { newDoc, pageOf, replaceShape, reviveDoc, shapeOf, type Doc } from './document';

interface State { doc: Doc; past: Doc[]; future: Doc[] }
type Action =
  | { t: 'commit'; fn: (d: Doc) => Doc }                 // change + history entry
  | { t: 'preview'; fn: (d: Doc) => Doc }                // change, no history (live drags)
  | { t: 'push'; snap: (d: Doc) => Doc }                 // history entry for a change that was previewed
  | { t: 'navigate'; fn: (d: Doc) => Doc }
  | { t: 'undo' } | { t: 'redo' } | { t: 'reset'; doc: Doc };

const LIMIT = 60;
function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'commit': { const doc = a.fn(s.doc); return doc === s.doc ? s : { doc, past: [...s.past.slice(-(LIMIT - 1)), s.doc], future: [] }; }
    case 'preview': { const doc = a.fn(s.doc); return doc === s.doc ? s : { ...s, doc }; }
    case 'push': return { ...s, past: [...s.past.slice(-(LIMIT - 1)), a.snap(s.doc)], future: [] };
    case 'navigate': { const doc = a.fn(s.doc); return doc === s.doc ? s : { ...s, doc }; }
    case 'undo': return s.past.length ? { doc: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.doc, ...s.future] } : s;
    case 'redo': return s.future.length ? { doc: s.future[0], past: [...s.past, s.doc], future: s.future.slice(1) } : s;
    case 'reset': return { doc: a.doc, past: [...s.past.slice(-(LIMIT - 1)), s.doc], future: [] };
  }
}

const KEY = 'shapeforge.doc.v1';
function load(): Doc {
  try { const raw = localStorage.getItem(KEY); const d = raw ? reviveDoc(JSON.parse(raw)) : null; if (d) return d; } catch { /* ignore */ }
  return newDoc();
}

/** Document state with undo/redo. Every update is a reducer action, so several updates in one event apply in order. */
export function useDocument() {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ doc: load(), past: [] as Doc[], future: [] as Doc[] }));
  const { doc } = state;
  const shape = shapeOf(doc), page = pageOf(doc);
  const liveBefore = useRef<ShapeModel | null>(null);

  useEffect(() => { const t = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch { /* quota */ } }, 600); return () => clearTimeout(t); }, [doc]);

  /** change the document (one undo step) */
  const apply = useCallback((fn: (d: Doc) => Doc) => dispatch({ t: 'commit', fn }), []);
  const navigate = useCallback((fn: (d: Doc) => Doc) => dispatch({ t: 'navigate', fn }), []);
  /** replace the active shape (one undo step) */
  const commit = useCallback((next: ShapeModel) => dispatch({ t: 'commit', fn: d => replaceShape(d, { ...next, id: next.id ?? d.shapeId }) }), []);
  /** replace a shape while a gesture runs (no undo step) */
  const preview = useCallback((next: ShapeModel) => dispatch({ t: 'preview', fn: d => replaceShape(d, { ...next, id: next.id ?? d.shapeId }) }), []);
  /** a gesture finished: record the shape as it was before it began */
  const pushGesture = useCallback((before: ShapeModel) => dispatch({ t: 'push', snap: d => replaceShape(d, { ...before, id: before.id ?? d.shapeId }) }), []);
  /** slider-style edits: many previews, one undo step */
  const live = useCallback((next: ShapeModel, current: ShapeModel) => { if (!liveBefore.current) liveBefore.current = current; preview(next); }, [preview]);
  const liveEnd = useCallback(() => { if (liveBefore.current) { pushGesture(liveBefore.current); liveBefore.current = null; } }, [pushGesture]);

  return {
    doc, page, shape, canUndo: state.past.length > 0, canRedo: state.future.length > 0,
    apply, navigate, commit, preview, pushGesture, live, liveEnd,
    undo: useCallback(() => dispatch({ t: 'undo' }), []), redo: useCallback(() => dispatch({ t: 'redo' }), []),
    reset: useCallback((d?: Doc) => dispatch({ t: 'reset', doc: d ?? newDoc() }), []),
  };
}
export type DocumentApi = ReturnType<typeof useDocument>;
