import type { Font, PathCommand } from 'opentype.js';
import type { Point, TextGlyphShape, TextStrokePath, TextVectorGlyph } from '../../lib/shape/geometry';

const DEFAULT_GLYPH: TextGlyphShape = { x: 0, y: 0, rotation: 0, scaleX: 100, scaleY: 100 };
const PRESETS: Record<string, string[]> = {
  A: ['M10 90L50 8L90 90', 'M27 58L73 58'], B: ['M18 90L18 8', 'M18 8C92 0 90 48 18 48', 'M18 48C98 44 94 96 18 90'],
  C: ['M88 18C28 -8 8 24 10 52C10 82 38 102 88 82'], D: ['M18 90L18 8', 'M18 8C100 8 100 90 18 90'],
  E: ['M82 10L18 10L18 90L84 90', 'M18 50L70 50'], F: ['M20 90L20 10L84 10', 'M20 48L70 48'],
  G: ['M88 18C30 -8 8 24 10 52C10 86 50 104 86 78L86 55L55 55'], H: ['M18 10L18 90', 'M82 10L82 90', 'M18 50L82 50'],
  I: ['M50 10L50 90'], J: ['M78 10L78 68C78 104 20 100 18 72'], K: ['M18 10L18 90', 'M82 12L22 52L84 90'],
  L: ['M20 10L20 90L84 90'], M: ['M12 90L18 10L50 62L82 10L88 90'], N: ['M18 90L18 10L82 90L82 10'],
  O: ['M50 8C96 8 96 92 50 92C4 92 4 8 50 8Z'], P: ['M20 90L20 10L70 10C104 12 98 52 70 52L20 52'],
  Q: ['M50 8C96 8 96 92 50 92C4 92 4 8 50 8Z', 'M60 68L92 98'], R: ['M20 90L20 10L70 10C104 12 98 52 70 52L20 52', 'M54 52L88 90'],
  S: ['M84 18C42 -2 10 12 14 34C18 52 82 48 86 68C92 94 48 104 12 82'], T: ['M12 12L88 12', 'M50 12L50 90'],
  U: ['M16 10L16 62C16 104 84 104 84 62L84 10'], V: ['M12 10L50 90L88 10'], W: ['M8 10L24 90L50 42L76 90L92 10'],
  X: ['M16 12L84 88', 'M84 12L16 88'], Y: ['M12 10L50 50L88 10', 'M50 50L50 90'], Z: ['M14 12L86 12L14 88L86 88'],
};

function toContours(commands: PathCommand[]): Point[][] {
  const contours: Point[][] = [];
  let points: Point[] = [];
  for (const command of commands) {
    if (command.type === 'M') {
      if (points.length) contours.push(points);
      points = [{ x: command.x, y: command.y, mode: 'corner' }];
    } else if (command.type === 'L') {
      if (points.length) points.push({ x: command.x, y: command.y, mode: 'corner' });
    } else if (command.type === 'C') {
      const current = points[points.length - 1];
      if (!current) continue;
      current.mode = 'free';
      current.out = { x: command.x1, y: command.y1 };
      points.push({ x: command.x, y: command.y, in: { x: command.x2, y: command.y2 }, mode: 'free' });
    } else if (command.type === 'Q') {
      const current = points[points.length - 1];
      if (!current) continue;
      const end = { x: command.x, y: command.y };
      current.mode = 'free';
      current.out = { x: current.x + (command.x1 - current.x) * 2 / 3, y: current.y + (command.y1 - current.y) * 2 / 3 };
      points.push({ ...end, in: { x: end.x + (command.x1 - end.x) * 2 / 3, y: end.y + (command.y1 - end.y) * 2 / 3 }, mode: 'free' });
    } else if (command.type === 'Z' && points.length) {
      contours.push(points);
      points = [];
    }
  }
  if (points.length) contours.push(points);
  return contours.filter(contour => contour.length >= 2);
}

function contourPathData(commands: PathCommand[]): string[] {
  const output: string[] = [];
  let current = '';
  for (const command of commands) {
    if (command.type === 'M') {
      if (current) output.push(current);
      current = `M${command.x} ${command.y}`;
    } else if (command.type === 'L') current += `L${command.x} ${command.y}`;
    else if (command.type === 'C') current += `C${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`;
    else if (command.type === 'Q') current += `Q${command.x1} ${command.y1} ${command.x} ${command.y}`;
    else if (command.type === 'Z') current += 'Z';
  }
  if (current) output.push(current);
  return output;
}

export function createVectorGlyphs(font: Font, text: string, fontSize: number, letterSpacing: number, lineSpacing: number, glyphShapes: TextGlyphShape[]): TextVectorGlyph[] {
  const glyphs: TextVectorGlyph[] = [];
  const lines = text.split(/\r?\n/);
  const lineHeight = fontSize * lineSpacing / 100;
  let index = 0;
  lines.forEach((line, lineIndex) => {
    let cursorX = 32;
    const baseline = 24 + fontSize + lineIndex * lineHeight;
    const chars = [...line];
    for (let charIndex = 0; charIndex < chars.length; charIndex++) {
      const char = chars[charIndex];
      const glyph = font.charToGlyph(char);
      const advance = (glyph.advanceWidth ?? font.unitsPerEm * 0.6) * fontSize / font.unitsPerEm + letterSpacing;
      if (!/\s/.test(char) && font.hasChar(char)) {
        const pivotX = cursorX + advance / 2, pivotY = baseline;
        const shape = glyphShapes[index] ?? DEFAULT_GLYPH;
        const transform = `translate(${shape.x} ${shape.y}) translate(${pivotX} ${pivotY}) rotate(${shape.rotation}) scale(${shape.scaleX / 100} ${shape.scaleY / 100}) translate(${-pivotX} ${-pivotY})`;
        const path = font.getPath(char, cursorX, baseline, fontSize);
        glyphs.push({ index, char, d: path.toPathData(3), contourPaths: contourPathData(path.commands), transform, contours: toContours(path.commands), pivotX, pivotY });
      }
      cursorX += advance + font.getKerningValue(glyph, font.charToGlyph(chars[charIndex + 1] ?? ' ')) * fontSize / font.unitsPerEm;
      index++;
    }
    if (lineIndex < lines.length - 1) index++;
  });
  return glyphs;
}

export function makePresetStrokes(text: string, fontSize: number, lineSpacing: number, advances: number[], glyphShapes: TextGlyphShape[]): TextStrokePath[] {
  const strokes: TextStrokePath[] = [];
  const lines = text.split(/\r?\n/);
  let index = 0, advanceIndex = 0;
  lines.forEach((line, lineIndex) => {
    let cursorX = 32;
    const baseline = 24 + fontSize + lineIndex * fontSize * lineSpacing / 100;
    for (const char of line) {
      const advance = advances[advanceIndex++] ?? fontSize * 0.6;
      if (!/\s/.test(char)) {
        const paths = PRESETS[char.toUpperCase()];
        if (paths) {
          const scale = fontSize / 100 * (char === char.toLowerCase() ? 0.76 : 1);
          const yOffset = char === char.toLowerCase() ? fontSize * 0.25 : 0;
          const pivotX = cursorX + advance / 2, pivotY = baseline;
          const shape = glyphShapes[index] ?? DEFAULT_GLYPH;
          const characterTransform = `translate(${shape.x} ${shape.y}) translate(${pivotX} ${pivotY}) rotate(${shape.rotation}) scale(${shape.scaleX / 100} ${shape.scaleY / 100}) translate(${-pivotX} ${-pivotY})`;
          const pathTransform = `${characterTransform} translate(${cursorX} ${baseline - fontSize + yOffset}) scale(${scale})`;
          for (let i = 0; i < paths.length; i++) {
            strokes.push({
              id: `preset-${index}-${i}`,
              name: `${char} · stroke ${i + 1}`,
              d: paths[i],
              glyphIndex: index,
              transform: pathTransform,
              reverse: false, startPercent: 0, duration: 0.35, pauseAfter: 0, overlapNext: 0, closed: false,
            });
          }
        }
      }
      cursorX += advance;
      index++;
    }
    if (lineIndex < lines.length - 1) index++;
  });
  return strokes;
}

export function variantStrokePath(d: string, reverse: boolean, startPercent: number, closed: boolean): string {
  if (!reverse && startPercent <= 0) return d;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.append(path);
  document.body.append(svg);
  try {
    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length < 0.1) return d;
    const samples = Math.min(480, Math.max(32, Math.ceil(length / 2)));
    const start = Math.min(0.99, Math.max(0, startPercent / 100)) * length;
    const openReverseStart = startPercent <= 0 ? length : start;
    const points = Array.from({ length: samples + 1 }, (_, i) => {
      const progress = i / samples;
      const distance = closed
        ? (start + (reverse ? -progress : progress) * length + length * 2) % length
        : reverse ? openReverseStart * (1 - progress) : start + (length - start) * progress;
      const point = path.getPointAtLength(distance);
      return `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    });
    return points.join(' ');
  } finally {
    svg.remove();
  }
}

export function transformContourPoint(point: Point, glyph: TextVectorGlyph): Point {
  const shape = glyph.transform;
  const match = shape.match(/^translate\(([-\d.]+) ([-\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\)/);
  if (!match) return { ...point };
  const [, dxValue, dyValue, pxValue, pyValue, rotationValue, sxValue, syValue] = match;
  const [dx, dy, px, py, rotation, sx, sy] = [dxValue, dyValue, pxValue, pyValue, rotationValue, sxValue, syValue].map(Number);
  const angle = rotation * Math.PI / 180;
  const x = (point.x - px) * sx, y = (point.y - py) * sy;
  return { ...point, x: px + x * Math.cos(angle) - y * Math.sin(angle) + dx, y: py + x * Math.sin(angle) + y * Math.cos(angle) + dy };
}

function sampleTransformedPath(d: string, transform = ''): Point[] {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 2000 2000');
  const a = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  a.setAttribute('d', d);
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  if (transform) group.setAttribute('transform', transform);
  group.append(a); svg.append(group); document.body.append(svg);
  try {
    const length = a.getTotalLength(), matrix = a.getCTM();
    if (!matrix || length < 0.1) return [];
    const count = Math.min(600, Math.max(24, Math.ceil(length / 2)));
    return Array.from({ length: count + 1 }, (_, i) => {
      const point = a.getPointAtLength(length * i / count);
      const mapped = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: mapped.x, y: mapped.y };
    });
  } finally {
    svg.remove();
  }
}

export function isValidPathData(d: string): boolean {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.append(path); document.body.append(svg);
  try { return d.trim().length > 0 && Number.isFinite(path.getTotalLength()); }
  catch { return false; }
  finally { svg.remove(); }
}

export function mergeStrokePaths(first: string, second: string, firstTransform = '', secondTransform = ''): string {
  const left = sampleTransformedPath(first, firstTransform);
  const right = sampleTransformedPath(second, secondTransform);
  if (!left.length || !right.length) throw new Error('Both strokes must contain valid SVG path data');
  return [left, right].map((path, index) => path.map((point, pointIndex) => `${index === 0 && pointIndex === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')).join(' ');
}
