import { memo, useMemo } from 'react';
import { pathOfShape, type ShapeModel } from '../../lib/shape/geometry';
import { paintedMarkup } from '../../lib/shape/paintMarkup';

/** A non-active shape on the page: drawn flat (fill + gradient), no handles. Tap it to make it the active shape. */
const StaticShape = memo(function StaticShape({ shape }: { shape: ShapeModel }) {
  const d = useMemo(() => pathOfShape(shape), [shape.points, shape.extra, shape.closed, shape.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const painted = useMemo(() => paintedMarkup(shape), [shape.paint, shape.points, shape.extra, shape.closed, shape.kind, shape.box, shape.frame, shape.strokeWidth, shape.fillRule, shape.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <g className="shape-other" data-testid="other-shape">
    {painted && <g transform={`translate(${painted.x} ${painted.y})`} pointerEvents="none"><defs dangerouslySetInnerHTML={{ __html: painted.defs }} /><g dangerouslySetInnerHTML={{ __html: painted.body }} /></g>}
    <path className={`shape-fill other${painted ? ' painted' : ''}`} d={d} style={painted ? undefined : { fill: shape.fill }} fillRule={shape.fillRule} />
  </g>;
});
export default StaticShape;
