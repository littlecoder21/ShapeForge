import { makeShape, type ShapeModel } from '../../lib/shape/geometry';
import type { AnimatedShape } from '../../lib/shape/animation';

/* ═══════════ Document model: pages → shapes ═══════════
 * Every page is a 1000 × 600 artboard holding any number of shapes. All operations are pure (Doc → Doc) so history is
 * simply a list of snapshots.
 */
export type PageUnit = 'px' | 'mm' | 'cm' | 'in';
export interface Page { id: string; name: string; shapes: ShapeModel[]; width: number; height: number; unit: PageUnit; background: string }
export interface Doc { pages: Page[]; pageId: string; shapeId: string }

let n = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36).slice(-4)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const SHAPE_COLORS = ['#69dfb5', '#7aa2ff', '#ffb86b', '#f78fb3', '#c4a1ff', '#ffe066', '#7be0e0', '#ff8f8f'];
const EMPTY_PAGE_SHAPE: ShapeModel = { id: '__empty-page__', name: 'Empty page', kind: 'polygon', points: [], closed: false, fill: 'none', stroke: 'none', strokeWidth: 0 };

export const withId = (s: ShapeModel): ShapeModel => (s.id ? s : { ...s, id: uid('s') });

export function newDoc(first: ShapeModel = makeShape('Blob', 23)): Doc {
  const shape = withId(first);
  const page: Page = { id: uid('p'), name: 'Page 1', shapes: [shape], width: 1000, height: 600, unit: 'px', background: '#21262d' };
  return { pages: [page], pageId: page.id, shapeId: shape.id! };
}

export const pageOf = (d: Doc): Page => d.pages.find(p => p.id === d.pageId) ?? d.pages[0];
export const shapeOf = (d: Doc): ShapeModel => { const p = pageOf(d); return p.shapes.find(s => s.id === d.shapeId) ?? p.shapes[0] ?? EMPTY_PAGE_SHAPE; };

const mapPage = (d: Doc, id: string, fn: (p: Page) => Page): Doc => ({ ...d, pages: d.pages.map(p => (p.id === id ? fn(p) : p)) });

/** Replace a shape (matched by id) wherever it is. */
export function replaceShape(d: Doc, next: ShapeModel): Doc {
  const id = next.id ?? d.shapeId;
  return { ...d, pages: d.pages.map(p => (p.shapes.some(s => s.id === id) ? { ...p, shapes: p.shapes.map(s => (s.id === id ? { ...next, id } : s)) } : p)) };
}
export const patchShape = (d: Doc, id: string, patch: Partial<ShapeModel>): Doc => mapPage(d, pageOf(d).id, p => ({ ...p, shapes: p.shapes.map(s => (s.id === id ? { ...s, ...patch } : s)) }));

/** Add a shape to the current page and select it. New shapes get the next palette colour unless they brought their own. */
export function addShape(d: Doc, shape: ShapeModel, recolor = true): Doc {
  const page = pageOf(d), s = withId(shape);
  const colored = recolor && !shape.derived ? { ...s, fill: SHAPE_COLORS[page.shapes.length % SHAPE_COLORS.length] } : s;
  return { ...mapPage(d, page.id, p => ({ ...p, shapes: [...p.shapes, colored] })), shapeId: colored.id! };
}

export function removeShape(d: Doc, id: string): Doc {
  const page = pageOf(d);
  if (page.shapes.length <= 1) return d;
  const i = page.shapes.findIndex(s => s.id === id), shapes = page.shapes.filter(s => s.id !== id);
  return { ...mapPage(d, page.id, p => ({ ...p, shapes })), shapeId: d.shapeId === id ? shapes[Math.min(i, shapes.length - 1)].id! : d.shapeId };
}
export function clearPage(d: Doc): Doc {
  const page = pageOf(d);
  if (!page.shapes.length) return d;
  return { ...mapPage(d, page.id, current => ({ ...current, shapes: [] })), shapeId: '' };
}
export function replaceShapesWithUnion(d: Doc, ids: string[], merged: ShapeModel): Doc {
  const selected = new Set(ids);
  if (selected.size < 2 || selected.size !== ids.length) return d;
  const page = pageOf(d), indexes = page.shapes.flatMap((shape, index) => selected.has(shape.id ?? '') ? [index] : []);
  if (indexes.length !== selected.size) return d;
  const firstIndex = indexes[0], replacement = withId(merged);
  const shapes = page.shapes.filter(shape => !selected.has(shape.id ?? ''));
  shapes.splice(Math.min(firstIndex, shapes.length), 0, replacement);
  return { ...mapPage(d, page.id, p => ({ ...p, shapes })), shapeId: replacement.id! };
}
export function duplicateShape(d: Doc, id: string): Doc {
  const page = pageOf(d), src = page.shapes.find(s => s.id === id);
  if (!src) return d;
  const copy: ShapeModel = { ...JSON.parse(JSON.stringify(src)), id: uid('s'), name: `${src.name} copy` };
  const shift = (r: ShapeModel['points']) => r.map(p => ({ ...p, x: p.x + 24, y: p.y + 24, ...(p.in ? { in: { ...p.in, x: p.in.x + 24, y: p.in.y + 24 } } : {}), ...(p.out ? { out: { ...p.out, x: p.out.x + 24, y: p.out.y + 24 } } : {}) }));
  copy.points = shift(copy.points); if (copy.extra) copy.extra = copy.extra.map(shift); if (copy.box) copy.box = { ...copy.box, x: copy.box.x + 24, y: copy.box.y + 24 };
  const animatedCopy = copy as AnimatedShape;
  if (animatedCopy.animation) animatedCopy.animation = {
    ...animatedCopy.animation,
    keyframes: animatedCopy.animation.keyframes.map(frame => ({
      ...frame,
      values: {
        ...frame.values,
        ...(frame.values.geometry ? { geometry: { rings: frame.values.geometry.rings.map(shift) } } : {}),
      },
    })),
  };
  const i = page.shapes.findIndex(s => s.id === id);
  return { ...mapPage(d, page.id, p => ({ ...p, shapes: [...p.shapes.slice(0, i + 1), copy, ...p.shapes.slice(i + 1)] })), shapeId: copy.id! };
}
/** dir −1 = send backward (lower in the stack), +1 = bring forward. */
export function moveShape(d: Doc, id: string, dir: -1 | 1): Doc {
  return mapPage(d, pageOf(d).id, p => {
    const i = p.shapes.findIndex(s => s.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= p.shapes.length) return p;
    const a = [...p.shapes]; [a[i], a[j]] = [a[j], a[i]]; return { ...p, shapes: a };
  });
}
export const selectShape = (d: Doc, id: string): Doc => (pageOf(d).shapes.some(s => s.id === id) ? { ...d, shapeId: id } : d);

export function addPage(d: Doc, first?: ShapeModel): Doc {
  const shape = withId(first ?? { ...makeShape('Circle'), fill: SHAPE_COLORS[d.pages.length % SHAPE_COLORS.length] });
  const page: Page = { id: uid('p'), name: `Page ${d.pages.length + 1}`, shapes: [shape], width: 1000, height: 600, unit: 'px', background: '#21262d' };
  return { pages: [...d.pages, page], pageId: page.id, shapeId: shape.id! };
}
export function removePage(d: Doc, id: string): Doc {
  if (d.pages.length <= 1) return d;
  const i = d.pages.findIndex(p => p.id === id), pages = d.pages.filter(p => p.id !== id), next = d.pageId === id ? pages[Math.min(i, pages.length - 1)] : pageOf(d);
  return { pages, pageId: next.id, shapeId: next.shapes.some(s => s.id === d.shapeId) ? d.shapeId : next.shapes[0]?.id ?? '' };
}
export const renamePage = (d: Doc, id: string, name: string): Doc => mapPage(d, id, p => ({ ...p, name }));
export const patchPage = (d: Doc, id: string, patch: Partial<Omit<Page, 'id' | 'shapes'>>): Doc => mapPage(d, id, p => ({ ...p, ...patch }));
export function selectPage(d: Doc, id: string): Doc {
  const p = d.pages.find(x => x.id === id);
  return p ? { ...d, pageId: id, shapeId: p.shapes.some(s => s.id === d.shapeId) ? d.shapeId : p.shapes[0]?.id ?? '' } : d;
}

/** Parse a stored document, repairing ids; returns null when unusable. */
export function reviveDoc(raw: unknown): Doc | null {
  try {
    const r = raw as Doc;
    if (!r || !Array.isArray(r.pages) || !r.pages.length) return null;
    const pages = r.pages.map((p, i) => ({
      id: p.id || uid('p'), name: p.name || `Page ${i + 1}`,
      shapes: (Array.isArray(p.shapes) ? p.shapes : [makeShape('Blob', 23)]).map(withId),
      width: Number.isFinite(p.width) && p.width > 0 ? p.width : 1000,
      height: Number.isFinite(p.height) && p.height > 0 ? p.height : 600,
      unit: ['px', 'mm', 'cm', 'in'].includes(p.unit) ? p.unit : 'px',
      background: typeof p.background === 'string' ? p.background : '#21262d',
    }));
    const page = pages.find(p => p.id === r.pageId) ?? pages[0];
    return { pages, pageId: page.id, shapeId: page.shapes.find(s => s.id === r.shapeId)?.id ?? page.shapes[0]?.id ?? '' };
  } catch { return null; }
}
