import { useEffect, useMemo, useRef } from 'react';
import { prepareMeshField, renderPreparedMeshField } from '../engine/meshField';
import type { GradientLayer } from '../engine/model';

interface Props {
  layer: GradientLayer;
  canvas: { w: number; h: number };
}

const PREVIEW_EDGE = 192;

export default function MeshFieldCanvas({ layer, canvas }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const aspect = canvas.w / Math.max(1, canvas.h);
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(canvas.w, canvas.h));
  const width = Math.max(1, Math.round(canvas.w * scale));
  const height = Math.max(1, Math.round(canvas.h * scale));
  const input = useMemo(() => ({
    seed: layer.mesh.seed,
    base: layer.mesh.base || undefined,
    points: layer.mesh.points.map(point => ({
      x: point.x,
      y: point.y,
      color: point.color,
      alpha: point.alpha,
      size: point.size,
      core: point.core,
      strength: point.strength,
      aspect: point.aspect,
      angle: point.angle,
      transform: point.transform,
    })),
  }), [layer.mesh]);
  const field = useMemo(
    () => prepareMeshField(input, layer.mesh.field, aspect),
    [input, layer.mesh.field, aspect],
  );
  const animate = layer.mesh.field.warp > 0 && layer.mesh.field.flow > 0;

  useEffect(() => {
    const canvasElement = ref.current;
    const context = canvasElement?.getContext('2d', { alpha: true });
    if (!canvasElement || !context) return;

    let frame = 0;
    let lastDraw = -Infinity;
    const started = performance.now();
    const draw = (now: number) => {
      if (!animate || now - lastDraw >= 1000 / 12) {
        lastDraw = now;
        field.time = animate ? (now - started) / 1000 : 0;
        const pixels = renderPreparedMeshField(field, width, height);
        const image = context.createImageData(width, height);
        image.data.set(pixels);
        context.putImageData(image, 0, 0);
      }
      if (animate) frame = requestAnimationFrame(draw);
    };
    draw(started);
    return () => cancelAnimationFrame(frame);
  }, [animate, field, height, width]);

  if (!layer.mesh.field.enabled || layer.text) return null;
  return (
    <canvas
      ref={ref}
      className="gs-mesh-field-canvas"
      width={width}
      height={height}
      aria-label="Smooth mesh field preview"
      data-testid={`gs-mesh-field-${layer.id}`}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}
