export type Point = { x: number; y: number; in?: Point; out?: Point };
export type ShapeKind = 'path' | 'polygon';
export type ShapeModel = { name: string; kind: ShapeKind; points: Point[]; closed: boolean; fill: string; stroke: string; strokeWidth: number };
export const W = 1000;
export const H = 600;

export function fmt(n: number, precision = 1) {
  const p = 10 ** precision;
  const v = Math.round(n * p) / p;
  return Object.is(v, -0) ? '0' : String(v);
}
export function pathFromPoints(points: Point[], closed = true, smooth = true, precision = 1) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${fmt(points[0].x, precision)} ${fmt(points[0].y, precision)}`;
  let d = `M ${fmt(points[0].x, precision)} ${fmt(points[0].y, precision)}`;
  if (!smooth || points.length < 3) {
    for (const p of points.slice(1)) d += ` L ${fmt(p.x, precision)} ${fmt(p.y, precision)}`;
    return closed ? `${d} Z` : d;
  }
  const n = points.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p1 = points[i], p2 = points[(i + 1) % n];
    const handles1 = getHandles(points, i, closed);
    const handles2 = getHandles(points, (i + 1) % n, closed);
    d += ` C ${fmt(handles1.out.x, precision)} ${fmt(handles1.out.y, precision)} ${fmt(handles2.in.x, precision)} ${fmt(handles2.in.y, precision)} ${fmt(p2.x, precision)} ${fmt(p2.y, precision)}`;
  }
  return closed ? `${d} Z` : d;
}
export function polygonPoints(sides: number, radius = 220, cx = 500, cy = 300, start = -Math.PI / 2): Point[] {
  return Array.from({ length: sides }, (_, i) => ({ x: cx + Math.cos(start + i * Math.PI * 2 / sides) * radius, y: cy + Math.sin(start + i * Math.PI * 2 / sides) * radius }));
}
export function makeShape(kind: string, seed = 9): ShapeModel {
  if (kind === 'Wave') return { name: 'Soft wave', kind: 'path', points: Array.from({ length: 7 }, (_, i) => ({ x: 110 + i * 130, y: 295 + Math.sin(i * Math.PI / 3) * 105 })), closed: true, fill: '#69dfb5', stroke: '#9bf0d0', strokeWidth: 2 };
  if (kind === 'Blob') {
    let s = seed >>> 0; const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pts = Array.from({ length: 10 }, (_, i) => { const a = i * Math.PI * 2 / 10; const r = 190 + rand() * 65; return { x: 500 + Math.cos(a) * r, y: 300 + Math.sin(a) * r }; });
    return { name: 'Seeded blob', kind: 'path', points: pts, closed: true, fill: '#69dfb5', stroke: '#9bf0d0', strokeWidth: 2 };
  }
  if (kind === 'Circle') return { name: 'Circle', kind: 'path', points: polygonPoints(16, 180), closed: true, fill: '#69dfb5', stroke: '#9bf0d0', strokeWidth: 2 };
  if (kind === 'Triangle') return { name: 'Triangle', kind: 'polygon', points: polygonPoints(3), closed: true, fill: '#69dfb5', stroke: '#9bf0d0', strokeWidth: 2 };
  if (kind === 'Diamond') return { name: 'Diamond', kind: 'polygon', points: [{ x: 500, y: 70 }, { x: 760, y: 300 }, { x: 500, y: 530 }, { x: 240, y: 300 }], closed: true, fill: '#69dfb5', stroke: '#9bf0d0', strokeWidth: 2 };
  if (kind === 'Star') {
    const points = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 112 : 235; return { x: 500 + Math.cos(a) * r, y: 300 + Math.sin(a) * r }; });
    return { name: 'Star', kind: 'polygon', points, closed: true, fill: '#69dfb5', stroke: '#9bf0d0', strokeWidth: 2 };
  }
  return { name: kind, kind: 'polygon', points: polygonPoints(kind === 'Pentagon' ? 5 : kind === 'Octagon' ? 8 : 6), closed: true, fill: '#69dfb5', stroke: '#9bf0d0', strokeWidth: 2 };
}
export function simplify(points: Point[], tolerance: number) {
  if (points.length <= 4) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1], next = points[i + 1], p = points[i];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const dist = Math.abs(dy * p.x - dx * p.y + next.x * prev.y - next.y * prev.x) / (Math.hypot(dx, dy) || 1);
    if (dist >= tolerance) result.push(p);
  }
  result.push(points[points.length - 1]);
  return result;
}
export function samplePath(points: Point[], closed: boolean, steps = 8): Point[] {
  if (points.length < 3) return points;
  const sampled: Point[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const p1 = points[i], p2 = points[(i + 1) % points.length];
    const c1 = getHandles(points, i, closed).out;
    const c2 = getHandles(points, (i + 1) % points.length, closed).in;
    for (let j = 0; j < steps; j++) {
      const t = j / steps, mt = 1 - t;
      sampled.push({
        x: mt ** 3 * p1.x + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * p2.x,
        y: mt ** 3 * p1.y + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * p2.y,
      });
    }
  }
  if (!closed) sampled.push(points[points.length - 1]);
  return sampled;
}
export function getHandles(points: Point[], index: number, closed: boolean) {
  const n = points.length, point = points[index];
  const prev = points[(index - 1 + n) % n], next = points[(index + 1) % n];
  const before = !closed && index === 0 ? point : prev;
  const after = !closed && index === n - 1 ? point : next;
  const dx = after.x - before.x, dy = after.y - before.y;
  const length = Math.min(Math.hypot(point.x - before.x, point.y - before.y) || 100, Math.hypot(after.x - point.x, after.y - point.y) || 100) / 6;
  const norm = Math.hypot(dx, dy) || 1;
  return {
    in: point.in || { x: point.x - dx / norm * length, y: point.y - dy / norm * length },
    out: point.out || { x: point.x + dx / norm * length, y: point.y + dy / norm * length },
  };
}
export function polygonToCss(points: Point[], percentage = true, precision = 1) {
  return `clip-path: polygon(${points.map(p => `${fmt(percentage ? p.x / W * 100 : p.x, precision)}${percentage ? '%' : 'px'} ${fmt(percentage ? p.y / H * 100 : p.y, precision)}${percentage ? '%' : 'px'}`).join(', ')});`;
}
export function exportCode(shape: ShapeModel, format: string, precision = 1, tolerance = 8) {
  const d = pathFromPoints(shape.points, shape.closed, shape.kind === 'path', precision);
  const sampled = simplify(shape.kind === 'path' ? samplePath(shape.points, shape.closed) : shape.points, tolerance);
  const poly = polygonToCss(sampled, true, precision);
  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">\n  <path d="${d}" fill="${shape.fill}" />\n</svg>`;
  if (format === 'SVG') return svg;
  if (format === 'SVG PATH') return `d="${d}"`;
  if (format === 'CSS PATH') return `clip-path: path("${d}");`;
  if (format === 'POLYGON') return poly;
  if (format === 'REACT') return `export function Shape() {\n  return <div className="shape" />;\n}\n\n.shape {\n  ${poly}\n  background: ${shape.fill};\n}`;
  if (format === 'HTML + CSS') return `<div class="shape"></div>\n\n<style>\n.shape {\n  ${poly}\n  background: ${shape.fill};\n}\n</style>`;
  if (format === 'JSON') return JSON.stringify({
    name: shape.name,
    kind: shape.kind,
    viewBox: [W, H],
    closed: shape.closed,
    fill: shape.fill,
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    points: shape.points.map(p => ({
      x: Number(fmt(p.x, precision)),
      y: Number(fmt(p.y, precision)),
      ...(p.in ? { in: { x: Number(fmt(p.in.x, precision)), y: Number(fmt(p.in.y, precision)) } } : {}),
      ...(p.out ? { out: { x: Number(fmt(p.out.x, precision)), y: Number(fmt(p.out.y, precision)) } } : {}),
    })),
  }, null, 2);
  return svg;
}
