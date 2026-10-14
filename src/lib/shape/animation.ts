import { fmt, frameOf, makeShape, pathFromPoints, ringsOf, shapeBounds, translatePoints, type Point, type ShapeModel } from './geometry';

export type AnimationGroup = 'transform' | 'geometry' | 'stroke' | 'fill';
export type AnimatedShape = ShapeModel & { animation?: ShapeAnimation };

export type TransformValues = { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
export type GeometryValues = { rings: Point[][] };
export type StrokeValues = { stroke: string; strokeWidth: number; opacity: number; draw?: number };
export type FillValues = { fill: string; opacity: number };
export type AnimationValues = Partial<{
  transform: TransformValues;
  geometry: GeometryValues;
  stroke: StrokeValues;
  fill: FillValues;
}>;
export type AnimationKeyframe = { id: string; time: number; values: AnimationValues };
export type ShapeAnimation = { duration: number; loop: boolean; iterations?: number; keyframes: AnimationKeyframe[] };

export const ANIMATION_GROUPS: { id: AnimationGroup; label: string }[] = [
  { id: 'transform', label: 'Position · scale · rotation' },
  { id: 'geometry', label: 'Shape geometry' },
  { id: 'stroke', label: 'Stroke · outline' },
  { id: 'fill', label: 'Fill · reveal' },
];

const copyRings = (shape: ShapeModel): Point[][] => [shape.points, ...(shape.extra ?? [])].map(ring =>
  ring.map(point => ({
    ...point,
    ...(point.in ? { in: { ...point.in } } : {}),
    ...(point.out ? { out: { ...point.out } } : {}),
  })),
);

export function captureAnimationValues(shape: ShapeModel, groups: AnimationGroup[]): AnimationValues {
  const values: AnimationValues = {};
  for (const group of groups) {
    if (group === 'transform') values.transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
    if (group === 'geometry') values.geometry = { rings: copyRings(shape) };
    if (group === 'stroke') values.stroke = { stroke: shape.stroke, strokeWidth: shape.strokeWidth, opacity: 1, draw: 1 };
    if (group === 'fill') values.fill = { fill: shape.fill, opacity: 1 };
  }
  return values;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function colorAt(a: string, b: string, t: number): string {
  const parse = (color: string) => {
    const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
    if (!hex) return null;
    const expanded = hex.length === 3 ? [...hex].map(value => value + value).join('') : hex;
    return [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16));
  };
  const ca = parse(a), cb = parse(b);
  if (!ca || !cb) return t < 1 ? a : b;
  return `#${ca.map((value, index) => Math.round(lerp(value, cb[index], t)).toString(16).padStart(2, '0')).join('')}`;
}

function resamplePolygonRing(points: Point[], count: number): Point[] {
  if (points.length < 2 || count < 2) return points.map(point => ({ x: point.x, y: point.y, mode: 'corner' }));
  const lengths = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  const perimeter = lengths.reduce((sum, length) => sum + length, 0);
  return Array.from({ length: count }, (_, index) => {
    let distance = perimeter * index / count, segment = 0;
    while (segment < lengths.length - 1 && distance > lengths[segment]) distance -= lengths[segment++];
    const start = points[segment], end = points[(segment + 1) % points.length];
    const ratio = lengths[segment] ? distance / lengths[segment] : 0;
    return { x: lerp(start.x, end.x, ratio), y: lerp(start.y, end.y, ratio), mode: 'corner' as const };
  });
}

function alignPolygonRing(reference: Point[], candidate: Point[]): Point[] {
  if (reference.length !== candidate.length || !candidate.length) return candidate;
  let best = candidate, bestDistance = Infinity;
  for (const direction of [candidate, [...candidate].reverse()]) {
    for (let offset = 0; offset < direction.length; offset++) {
      let distance = 0;
      for (let index = 0; index < direction.length; index++) {
        const a = reference[index], b = direction[(index + offset) % direction.length];
        distance += (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        best = Array.from({ length: direction.length }, (_, index) => ({ ...direction[(index + offset) % direction.length] }));
      }
    }
  }
  return best;
}

function interpolateRings(a: Point[][], b: Point[][], t: number, closed: boolean, polygon: boolean): Point[][] {
  if (a.length !== b.length) return t < 1 ? a : b;
  return a.map((source, ri) => {
    let ring = source, target = b[ri];
    if (ring.length !== target.length) {
      if (!closed || !polygon || !ring.length || !target.length) return t < 1 ? ring : target;
      const count = Math.max(ring.length, target.length);
      ring = resamplePolygonRing(ring, count);
      target = alignPolygonRing(ring, resamplePolygonRing(target, count));
    }
    return ring.map((point, pi) => {
      const matchingPoint = target[pi];
      const mixPoint = (from?: Point, to?: Point) => from && to ? { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) } : (t < 0.5 ? from : to);
      return {
        ...point,
        x: lerp(point.x, matchingPoint.x, t),
        y: lerp(point.y, matchingPoint.y, t),
        ...(point.in || matchingPoint.in ? { in: mixPoint(point.in, matchingPoint.in) } : {}),
        ...(point.out || matchingPoint.out ? { out: mixPoint(point.out, matchingPoint.out) } : {}),
      };
    });
  });
}

function sampleGroup<T extends AnimationValues[keyof AnimationValues]>(frames: AnimationKeyframe[], group: AnimationGroup, time: number, closed = false, polygon = false): T | undefined {
  const samples = frames.flatMap(frame => {
    const value = frame.values[group];
    return value ? [{ time: frame.time, value }] : [];
  });
  if (!samples.length) return undefined;
  if (time <= samples[0].time) return samples[0].value as T;
  if (time >= samples[samples.length - 1].time) return samples[samples.length - 1].value as T;
  const rightIndex = samples.findIndex(sample => sample.time >= time);
  const left = samples[rightIndex - 1], right = samples[rightIndex];
  const t = (time - left.time) / (right.time - left.time || 1);
  if (group === 'geometry') return { rings: interpolateRings((left.value as GeometryValues).rings, (right.value as GeometryValues).rings, t, closed, polygon) } as T;
  if (group === 'stroke') {
    const a = left.value as StrokeValues, b = right.value as StrokeValues;
    return { stroke: colorAt(a.stroke, b.stroke, t), strokeWidth: lerp(a.strokeWidth, b.strokeWidth, t), opacity: lerp(a.opacity, b.opacity, t), draw: lerp(a.draw ?? 1, b.draw ?? 1, t) } as T;
  }
  if (group === 'fill') {
    const a = left.value as FillValues, b = right.value as FillValues;
    return { fill: colorAt(a.fill, b.fill, t), opacity: lerp(a.opacity, b.opacity, t) } as T;
  }
  const a = left.value as TransformValues, b = right.value as TransformValues;
  return Object.fromEntries(Object.keys(a).map(key => [key, lerp(a[key as keyof TransformValues], b[key as keyof TransformValues], t)])) as T;
}

function opacityColor(color: string, opacity: number): string {
  const alpha = Math.max(0, Math.min(1, opacity));
  if (alpha >= 0.999) return color;
  if (color === 'none') return color;
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map(value => value + value).join('') : hex;
    return `rgba(${parseInt(expanded.slice(0, 2), 16)}, ${parseInt(expanded.slice(2, 4), 16)}, ${parseInt(expanded.slice(4, 6), 16)}, ${alpha})`;
  }
  return `color-mix(in srgb, ${color} ${alpha * 100}%, transparent)`;
}

export function animatedShapeAt(shape: ShapeModel, animation: ShapeAnimation | undefined, time: number): ShapeModel {
  if (!animation?.keyframes.length) return shape;
  const frames = [...animation.keyframes].sort((a, b) => a.time - b.time);
  const duration = Math.max(1, animation.duration);
  const sampleTime = animation.loop ? ((time % duration) + duration) % duration : Math.max(0, Math.min(duration, time));
  const transform = sampleGroup<TransformValues>(frames, 'transform', sampleTime);
  const geometry = sampleGroup<GeometryValues>(frames, 'geometry', sampleTime, shape.closed, shape.kind === 'polygon');
  const stroke = sampleGroup<StrokeValues>(frames, 'stroke', sampleTime);
  const fill = sampleGroup<FillValues>(frames, 'fill', sampleTime);
  let next: ShapeModel = { ...shape };
  if (geometry?.rings) {
    next.points = geometry.rings[0].map(point => ({ ...point }));
    next.extra = geometry.rings.slice(1).map(ring => ring.map(point => ({ ...point })));
  }
  if (transform) {
    const bounds = shapeBounds(next), cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
    const angle = transform.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const mapPoint = (point: Point): Point => {
      const x = (point.x - cx) * transform.scaleX, y = (point.y - cy) * transform.scaleY;
      return { ...point, x: cx + x * cos - y * sin + transform.x, y: cy + x * sin + y * cos + transform.y };
    };
    const mapRing = (ring: Point[]) => ring.map(point => ({
      ...mapPoint(point),
      ...(point.in ? { in: mapPoint(point.in) } : {}),
      ...(point.out ? { out: mapPoint(point.out) } : {}),
    }));
    next.points = mapRing(next.points);
    if (next.extra) next.extra = next.extra.map(mapRing);
    if (next.box) {
      const topLeft = mapPoint({ x: next.box.x, y: next.box.y });
      next.box = { x: topLeft.x, y: topLeft.y, w: next.box.w * Math.abs(transform.scaleX), h: next.box.h * Math.abs(transform.scaleY) };
    }
  }
  if (stroke) {
    next.stroke = opacityColor(stroke.stroke, stroke.opacity);
    next.strokeWidth = stroke.strokeWidth;
  }
  if (fill) next.fill = fill.fill;
  return next;
}

export function animatedFillOpacity(animation: ShapeAnimation | undefined, time: number): number {
  if (!animation?.keyframes.length) return 1;
  const frames = [...animation.keyframes].sort((a, b) => a.time - b.time);
  const duration = Math.max(1, animation.duration);
  const sampleTime = animation.loop ? ((time % duration) + duration) % duration : Math.max(0, Math.min(duration, time));
  return sampleGroup<FillValues>(frames, 'fill', sampleTime)?.opacity ?? 1;
}

export function animatedStrokeDraw(animation: ShapeAnimation | undefined, time: number): number {
  if (!animation?.keyframes.length) return 1;
  const frames = [...animation.keyframes].sort((a, b) => a.time - b.time);
  const duration = Math.max(1, animation.duration);
  const sampleTime = animation.loop ? ((time % duration) + duration) % duration : Math.max(0, Math.min(duration, time));
  return sampleGroup<StrokeValues>(frames, 'stroke', sampleTime)?.draw ?? 1;
}

export function createPolygonMorph(shape: ShapeModel, targetKind: string): ShapeAnimation {
  const duration = 2200;
  const sourceBounds = shapeBounds(shape);
  const target = makeShape(targetKind);
  const targetBounds = shapeBounds(target);
  const fit = target.points.map(point => ({
    x: sourceBounds.x + (point.x - targetBounds.x) * (sourceBounds.w / Math.max(targetBounds.w, 1)),
    y: sourceBounds.y + (point.y - targetBounds.y) * (sourceBounds.h / Math.max(targetBounds.h, 1)),
    mode: 'corner' as const,
  }));
  const count = Math.max(shape.points.length, fit.length);
  const start = resamplePolygonRing(shape.points, count);
  const end = alignPolygonRing(start, resamplePolygonRing(fit, count));
  return {
    duration,
    loop: true,
    keyframes: [
      { id: 'kf-polygon-morph-start', time: 0, values: { geometry: { rings: [start] } } },
      { id: 'kf-polygon-morph-target', time: duration / 2, values: { geometry: { rings: [end] } } },
      { id: 'kf-polygon-morph-end', time: duration, values: { geometry: { rings: [start.map(point => ({ ...point }))] } } },
    ],
  };
}

/** Generates a self-contained HTML/CSS/JavaScript export for an animated shape. */
export function exportAnimatedHtml(shape: ShapeModel, animation: ShapeAnimation, precision = 1): string {
  const frame = frameOf(shape);
  const localRings = ringsOf(shape).map(ring => translatePoints(ring, -frame.x, -frame.y));
  const d = localRings.map(ring => pathFromPoints(ring, shape.closed, shape.kind === 'path', precision)).join(' ');
  const geometryFrames = animation.keyframes.filter(keyframe => keyframe.values.geometry);
  const ringCounts = shape.kind === 'polygon' && shape.closed
    ? Array.from({ length: Math.max(0, ...geometryFrames.map(keyframe => keyframe.values.geometry!.rings.length)) }, (_, index) =>
      Math.max(0, ...geometryFrames.map(keyframe => keyframe.values.geometry!.rings[index]?.length ?? 0)))
    : [];
  const referenceRings = geometryFrames[0]?.values.geometry?.rings ?? [];
  const frames = animation.keyframes.map(keyframe => ({
    ...keyframe,
    values: {
      ...keyframe.values,
      ...(keyframe.values.geometry ? {
        geometry: {
          ...keyframe.values.geometry,
          geometryPath: keyframe.values.geometry.rings.map((ring, index) => {
            let points = ring;
            if (ringCounts[index] && shape.kind === 'polygon' && shape.closed) {
              const count = ringCounts[index];
              points = resamplePolygonRing(ring, count);
              if (referenceRings[index]?.length) points = alignPolygonRing(resamplePolygonRing(referenceRings[index], count), points);
            }
            return pathFromPoints(translatePoints(points, -frame.x, -frame.y), shape.closed, shape.kind === 'path', precision);
          }).join(' '),
        },
      } : {}),
    },
  }));
  const escaped = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const config = JSON.stringify({ ...animation, keyframes: frames }).replaceAll('<', '\\u003c');
  const rule = shape.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
  const aspect = `${fmt(frame.w, precision)} / ${fmt(frame.h, precision)}`;
  return `<!-- HTML -->
<div class="sf-animated-shape" data-sf-animation>
  <svg viewBox="0 0 ${fmt(frame.w, precision)} ${fmt(frame.h, precision)}" role="img" aria-label="${escaped(shape.name)}">
    <path class="sf-shape" pathLength="1" d="${escaped(d)}" fill="${escaped(shape.fill)}" stroke="${escaped(shape.stroke)}" stroke-width="${fmt(shape.strokeWidth, precision)}"${rule} />
  </svg>
</div>

<!-- CSS -->
<style>
.sf-animated-shape { width: 100%; aspect-ratio: ${aspect}; }
.sf-animated-shape svg { display: block; width: 100%; height: 100%; overflow: visible; }
.sf-animated-shape .sf-shape { transform-box: fill-box; transform-origin: center; }
</style>

<!-- JavaScript -->
<script>
(() => {
  const root = document.querySelector('[data-sf-animation]');
  const path = root && root.querySelector('.sf-shape');
  if (!root || !path) return;
  const animation = ${config};
  const frames = [...animation.keyframes].sort((a, b) => a.time - b.time);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sample = (group, time) => {
    const items = frames.filter(frame => frame.values[group]).map(frame => ({ time: frame.time, value: frame.values[group] }));
    if (!items.length) return null;
    if (time <= items[0].time) return items[0].value;
    if (time >= items[items.length - 1].time) return items[items.length - 1].value;
    const index = items.findIndex(item => item.time >= time);
    const a = items[index - 1], b = items[index], t = (time - a.time) / (b.time - a.time || 1);
    if (group === 'geometry') {
      const left = a.value.geometryPath.match(/[a-zA-Z]|[-+]?(?:\\d*\\.)?\\d+(?:[eE][-+]?\\d+)?/g) || [];
      const right = b.value.geometryPath.match(/[a-zA-Z]|[-+]?(?:\\d*\\.)?\\d+(?:[eE][-+]?\\d+)?/g) || [];
      if (left.length !== right.length || left.some((part, i) => /[a-zA-Z]/.test(part) !== /[a-zA-Z]/.test(right[i]) || (/[a-zA-Z]/.test(part) && part !== right[i]))) return t < 1 ? a.value : b.value;
      return { geometryPath: left.map((part, i) => /[a-zA-Z]/.test(part) ? part : String(lerp(Number(part), Number(right[i]), t))).join(' ') };
    }
    if (group === 'transform') return Object.fromEntries(Object.keys(a.value).map(key => [key, lerp(a.value[key], b.value[key], t)]));
    const color = (from, to) => {
      const parse = value => {
        const hex = value && value.match(/^#([\\da-f]{3}|[\\da-f]{6})$/i)?.[1];
        if (!hex) return null;
        const full = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex;
        return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16));
      };
      const left = parse(from), right = parse(to);
      return left && right ? '#' + left.map((value, index) => Math.round(lerp(value, right[index], t)).toString(16).padStart(2, '0')).join('') : null;
    };
    const result = { ...a.value };
    for (const key of Object.keys(b.value)) {
      const from = a.value[key] ?? (key === 'draw' ? 1 : b.value[key]), to = b.value[key];
      result[key] = typeof from === 'number' && typeof to === 'number' ? lerp(from, to, t) : (color(from, to) ?? (t < 0.5 ? from : to));
    }
    return result;
  };
  const start = performance.now();
  const initialGeometry = frames.find(frame => frame.values.geometry)?.values.geometry;
  if (initialGeometry) path.setAttribute('d', initialGeometry.geometryPath);
  const tick = now => {
    const duration = Math.max(1, animation.duration);
    const elapsed = now - start;
    const totalDuration = duration * Math.max(1, Math.floor(animation.iterations ?? 1));
    const time = animation.loop ? elapsed % duration : elapsed >= totalDuration ? duration : elapsed % duration;
    const transform = sample('transform', time);
    const geometry = sample('geometry', time);
    const stroke = sample('stroke', time);
    const fill = sample('fill', time);
    if (transform) {
      const bounds = path.getBBox();
      const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
      path.setAttribute('transform', 'translate(' + transform.x + ' ' + transform.y + ') translate(' + cx + ' ' + cy + ') rotate(' + transform.rotation + ') scale(' + transform.scaleX + ' ' + transform.scaleY + ') translate(' + -cx + ' ' + -cy + ')');
    }
    if (geometry) path.setAttribute('d', geometry.geometryPath);
    if (stroke) {
      path.setAttribute('stroke', stroke.stroke);
      path.setAttribute('stroke-width', stroke.strokeWidth);
      path.style.strokeOpacity = stroke.opacity;
      path.style.strokeDasharray = '1';
      path.style.strokeDashoffset = String(1 - (stroke.draw ?? 1));
    }
    if (fill) { path.setAttribute('fill', fill.fill); path.style.fillOpacity = fill.opacity; }
    if (animation.loop || elapsed < totalDuration) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
</script>`;
}

export type AnimatedHtmlParts = { html: string; css: string; javascript: string };

export function exportAnimatedHtmlParts(shape: ShapeModel, animation: ShapeAnimation, precision = 1): AnimatedHtmlParts {
  const source = exportAnimatedHtml(shape, animation, precision);
  const htmlMarker = '<!-- HTML -->\n';
  const cssMarker = '\n\n<!-- CSS -->\n<style>\n';
  const javascriptMarker = '\n</style>\n\n<!-- JavaScript -->\n<script>\n';
  const scriptEnd = '\n</script>';
  const htmlStart = source.indexOf(htmlMarker);
  const cssStart = source.indexOf(cssMarker);
  const jsStart = source.indexOf(javascriptMarker);
  const jsEnd = source.lastIndexOf(scriptEnd);
  if (htmlStart !== 0 || cssStart < htmlMarker.length || jsStart < cssStart || jsEnd < jsStart) {
    throw new Error('Animated export sections could not be split');
  }
  return {
    html: source.slice(htmlMarker.length, cssStart),
    css: source.slice(cssStart + cssMarker.length, jsStart),
    javascript: source.slice(jsStart + javascriptMarker.length, jsEnd),
  };
}

export function combineAnimatedHtml(parts: AnimatedHtmlParts): string {
  return `<!-- HTML -->\n${parts.html}\n\n<!-- CSS -->\n<style>\n${parts.css}\n</style>\n\n<!-- JavaScript -->\n<script>\n${parts.javascript}\n</script>`;
}

export function createAnimationPreset(name: string, shape: ShapeModel): ShapeAnimation {
  const duration = 1800;
  const baseTransform: TransformValues = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  const transform = (patch: Partial<TransformValues>): TransformValues => ({ ...baseTransform, ...patch });
  const geometry = copyRings(shape);
  const bounds = shapeBounds(shape), centerX = bounds.x + bounds.w / 2, centerY = bounds.y + bounds.h / 2;
  const expanded = geometry.map(ring => ring.map(point => ({
    ...point,
    x: centerX + (point.x - centerX) * 1.16,
    y: centerY + (point.y - centerY) * 1.16,
    ...(point.in ? { in: { x: centerX + (point.in.x - centerX) * 1.16, y: centerY + (point.in.y - centerY) * 1.16 } } : {}),
    ...(point.out ? { out: { x: centerX + (point.out.x - centerX) * 1.16, y: centerY + (point.out.y - centerY) * 1.16 } } : {}),
  })));
  const frame = (time: number, values: AnimationValues): AnimationKeyframe => ({ id: `kf-${time}`, time, values });
  if (name === 'Spin') return { duration, loop: true, keyframes: [frame(0, { transform: transform({ rotation: 0 }) }), frame(duration, { transform: transform({ rotation: 360 }) })] };
  if (name === 'Float') return { duration, loop: true, keyframes: [frame(0, { transform: transform({ y: 0 }) }), frame(duration / 2, { transform: transform({ y: -38 }) }), frame(duration, { transform: transform({ y: 0 }) })] };
  if (name === 'Reveal') return { duration, loop: false, keyframes: [frame(0, { fill: { fill: shape.fill, opacity: 0 }, stroke: { stroke: shape.stroke, strokeWidth: shape.strokeWidth, opacity: 0, draw: 1 } }), frame(duration, { fill: { fill: shape.fill, opacity: 1 }, stroke: { stroke: shape.stroke, strokeWidth: shape.strokeWidth, opacity: 1, draw: 1 } })] };
  if (name === 'Fill reveal') return { duration, loop: false, keyframes: [frame(0, { fill: { fill: shape.fill, opacity: 0 } }), frame(duration, { fill: { fill: shape.fill, opacity: 1 } })] };
  if (name === 'Stroke draw') return { duration, loop: false, keyframes: [frame(0, { stroke: { stroke: shape.stroke, strokeWidth: shape.strokeWidth, opacity: 1, draw: 0 } }), frame(duration, { stroke: { stroke: shape.stroke, strokeWidth: shape.strokeWidth, opacity: 1, draw: 1 } })] };
  if (name === 'Morph') return { duration, loop: true, keyframes: [frame(0, { geometry: { rings: geometry } }), frame(duration / 2, { geometry: { rings: expanded } }), frame(duration, { geometry: { rings: geometry } })] };
  return { duration, loop: true, keyframes: [frame(0, { transform: transform({ scaleX: 1, scaleY: 1 }) }), frame(duration / 2, { transform: transform({ scaleX: 1.12, scaleY: 1.12 }) }), frame(duration, { transform: transform({ scaleX: 1, scaleY: 1 }) })] };
}
