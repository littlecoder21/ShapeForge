import type { Point, TextShapeData } from '../../lib/shape/geometry';

export default function TextArtboardObject({ text, points }: { text: TextShapeData; points: Point[] }) {
  if (points.length < 4 || !text.width || !text.height) return null;
  const origin = points[0], topRight = points[1], bottomLeft = points[3];
  const a = (topRight.x - origin.x) / text.width, b = (topRight.y - origin.y) / text.width;
  const c = (bottomLeft.x - origin.x) / text.height, d = (bottomLeft.y - origin.y) / text.height;
  return <svg x={0} y={0} width={text.width} height={text.height} viewBox={`0 0 ${text.width} ${text.height}`} preserveAspectRatio="none"
    transform={`matrix(${a} ${b} ${c} ${d} ${origin.x} ${origin.y})`} data-testid="artboard-text">
    <g dangerouslySetInnerHTML={{ __html: text.content }} />
  </svg>;
}
