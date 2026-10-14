import { parsePathData, parseShapeInput } from './boundary';
import { shapeBounds, type ShapeModel } from './geometry';

const ARTBOARD = { width: 1000, height: 600 };
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function transformMatrix(element: Element): Matrix {
  const ancestors: Element[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
  return ancestors.reduce((matrix, node) => {
    const transform = node.getAttribute('transform') ?? '';
    const expressions = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    let next: Matrix = IDENTITY, match: RegExpExecArray | null;
    while ((match = expressions.exec(transform))) {
      const values = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (values.some(value => !Number.isFinite(value))) throw new Error('SVG transform contains invalid numbers');
      let operation: Matrix = IDENTITY;
      if (match[1] === 'matrix' && values.length === 6) operation = values as Matrix;
      else if (match[1] === 'translate' && values.length >= 1 && values.length <= 2) operation = [1, 0, 0, 1, values[0], values[1] ?? 0];
      else if (match[1] === 'scale' && values.length >= 1 && values.length <= 2) operation = [values[0], 0, 0, values[1] ?? values[0], 0, 0];
      else if (match[1] === 'rotate' && values.length >= 1 && values.length <= 3) {
        const angle = values[0] * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
        operation = [c, s, -s, c, 0, 0];
        if (values.length === 3) operation = multiply(multiply([1, 0, 0, 1, values[1], values[2]], operation), [1, 0, 0, 1, -values[1], -values[2]]);
      } else if (match[1] === 'skewX' && values.length === 1) operation = [1, 0, Math.tan(values[0] * Math.PI / 180), 1, 0, 0];
      else if (match[1] === 'skewY' && values.length === 1) operation = [1, Math.tan(values[0] * Math.PI / 180), 0, 1, 0, 0];
      else throw new Error(`Unsupported SVG transform "${match[1]}"`);
      next = multiply(next, operation);
    }
    return multiply(matrix, next);
  }, IDENTITY);
}

function transformShape(shape: ShapeModel, matrix: Matrix): ShapeModel {
  const map = (points: ShapeModel['points']) => points.map(point => {
    const apply = (p: { x: number; y: number }) => ({ x: matrix[0] * p.x + matrix[2] * p.y + matrix[4], y: matrix[1] * p.x + matrix[3] * p.y + matrix[5] });
    return { ...point, ...apply(point), ...(point.in ? { in: apply(point.in) } : {}), ...(point.out ? { out: apply(point.out) } : {}) };
  });
  return { ...shape, points: map(shape.points), ...(shape.extra ? { extra: shape.extra.map(map) } : {}) };
}

function mappedShapes(shapes: ShapeModel[], bounds: { x: number; y: number; w: number; h: number }): ShapeModel[] {
  if (!shapes.length) throw new Error('The imported shape has no usable area');
  const width = Math.max(1, bounds.w), height = Math.max(1, bounds.h);
  const scale = Math.min(ARTBOARD.width * 0.8 / width, ARTBOARD.height * 0.8 / height);
  const offsetX = (ARTBOARD.width - width * scale) / 2 - bounds.x * scale;
  const offsetY = (ARTBOARD.height - height * scale) / 2 - bounds.y * scale;
  const mapRing = (ring: ShapeModel['points']) => ring.map(point => ({
    ...point,
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
    ...(point.in ? { in: { x: point.in.x * scale + offsetX, y: point.in.y * scale + offsetY } } : {}),
    ...(point.out ? { out: { x: point.out.x * scale + offsetX, y: point.out.y * scale + offsetY } } : {}),
  }));
  return shapes.map(shape => ({
    ...shape,
    points: mapRing(shape.points),
    ...(shape.extra ? { extra: shape.extra.map(mapRing) } : {}),
  }));
}

function pathShapes(data: string, name: string): ShapeModel[] {
  return parsePathData(data).map((path, index) => ({
    name: name + (index ? ` ${index + 1}` : ''),
    kind: 'path',
    points: path.nodes,
    closed: path.closed,
    fill: '#69dfb5',
    stroke: 'none',
    strokeWidth: 0,
  }));
}

function elementShapes(svg: SVGSVGElement): ShapeModel[] {
  const shapes: ShapeModel[] = [];
  const elements = [...svg.querySelectorAll('path, polygon, polyline, rect, circle, ellipse, line')]
    .filter(element => !element.closest('defs, clipPath, mask, pattern, marker, symbol'));
  for (const [index, element] of elements.entries()) {
    const tag = element.localName;
    let data = '';
    if (tag === 'path') data = element.getAttribute('d') ?? '';
    else if (tag === 'polygon' || tag === 'polyline') {
      const points = element.getAttribute('points') ?? '';
      const values = points.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (values.length < 4 || values.length % 2 !== 0 || values.some(value => !Number.isFinite(value))) continue;
      data = `M${values[0]} ${values[1]} ` + Array.from({ length: values.length / 2 - 1 }, (_, i) => `L${values[(i + 1) * 2]} ${values[(i + 1) * 2 + 1]}`).join(' ') + (tag === 'polygon' ? ' Z' : '');
    } else if (tag === 'rect') {
      const x = Number(element.getAttribute('x') ?? 0), y = Number(element.getAttribute('y') ?? 0);
      const width = Number(element.getAttribute('width') ?? 0), height = Number(element.getAttribute('height') ?? 0);
      if (width <= 0 || height <= 0) continue;
      data = `M${x} ${y} H${x + width} V${y + height} H${x} Z`;
    } else if (tag === 'circle' || tag === 'ellipse') {
      const cx = Number(element.getAttribute('cx') ?? 0), cy = Number(element.getAttribute('cy') ?? 0);
      const rx = Number(element.getAttribute(tag === 'circle' ? 'r' : 'rx') ?? 0);
      const ry = Number(element.getAttribute(tag === 'circle' ? 'r' : 'ry') ?? 0);
      if (rx <= 0 || ry <= 0) continue;
      const k = 0.5522847498;
      data = `M${cx + rx} ${cy} C${cx + rx} ${cy + k * ry} ${cx + k * rx} ${cy + ry} ${cx} ${cy + ry} C${cx - k * rx} ${cy + ry} ${cx - rx} ${cy + k * ry} ${cx - rx} ${cy} C${cx - rx} ${cy - k * ry} ${cx - k * rx} ${cy - ry} ${cx} ${cy - ry} C${cx + k * rx} ${cy - ry} ${cx + rx} ${cy - k * ry} ${cx + rx} ${cy} Z`;
    } else {
      const x1 = Number(element.getAttribute('x1') ?? 0), y1 = Number(element.getAttribute('y1') ?? 0);
      const x2 = Number(element.getAttribute('x2') ?? 0), y2 = Number(element.getAttribute('y2') ?? 0);
      data = `M${x1} ${y1} L${x2} ${y2}`;
    }
    if (!data.trim()) continue;
    try { shapes.push(...pathShapes(data, element.getAttribute('id') || `${tag} ${index + 1}`).map(shape => transformShape(shape, transformMatrix(element)))); }
    catch (error) {
      throw new Error(`Could not import ${tag} ${element.getAttribute('id') || index + 1}: ${error instanceof Error ? error.message : 'invalid geometry'}`);
    }
  }
  return shapes;
}

/** Converts pasted SVG markup, SVG path data, or supported CSS/SVG point notation into editable artboard shapes. */
export function importShapeText(source: string): ShapeModel[] {
  const text = source.trim();
  if (!text) throw new Error('Paste SVG markup, path data, polygon(), polyline(), or point coordinates');

  if (text.startsWith('<')) {
    const document = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (document.querySelector('parsererror')) throw new Error('The SVG document could not be parsed');
    const root = document.documentElement;
    if (root.localName !== 'svg') throw new Error('Expected an SVG document');
    const shapes = elementShapes(root as unknown as SVGSVGElement);
    if (!shapes.length) throw new Error('No supported SVG paths or shapes were found');
    const viewBox = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
      return mappedShapes(shapes, { x: viewBox[0], y: viewBox[1], w: viewBox[2], h: viewBox[3] });
    }
    const bounds = shapes.reduce((all, shape) => {
      const b = shapeBounds(shape);
      const x = Math.min(all.x, b.x), y = Math.min(all.y, b.y);
      return { x, y, w: Math.max(all.x + all.w, b.x + b.w) - x, h: Math.max(all.y + all.h, b.y + b.h) - y };
    }, { x: Infinity, y: Infinity, w: -Infinity, h: -Infinity });
    return mappedShapes(shapes, bounds);
  }

  const parsed = parseShapeInput(text);
  const shapes: ShapeModel[] = parsed.map((item, index) => ({
    name: item.source === 'path' ? `Imported path ${index + 1}` : `Imported ${item.source} ${index + 1}`,
    kind: item.source === 'path' ? 'path' : 'polygon',
    points: item.nodes,
    closed: item.closed,
    fill: '#69dfb5',
    stroke: 'none',
    strokeWidth: 0,
  }));
  const bounds = shapes.reduce((all, shape) => {
    const b = shapeBounds(shape);
    const x = Math.min(all.x, b.x), y = Math.min(all.y, b.y);
    return { x, y, w: Math.max(all.x + all.w, b.x + b.w) - x, h: Math.max(all.y + all.h, b.y + b.h) - y };
  }, { x: Infinity, y: Infinity, w: -Infinity, h: -Infinity });
  return mappedShapes(shapes, bounds);
}
