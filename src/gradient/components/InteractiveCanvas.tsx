import { useEffect, useMemo, useRef, useState } from 'react';
import { InteractiveRenderer } from '../interactive/core/InteractiveRenderer';
import { gradientLayerToShader } from '../interactive/adapter';
import { normalizeInteractiveSettings, type InteractiveRendererStatus } from '../interactive/types';
import type { GradientLayer, GradientProject } from '../engine/model';

export default function InteractiveCanvas({ project, layer, interactive = false }: { project: GradientProject; layer: GradientLayer; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<InteractiveRenderer | null>(null);
  const config = useMemo(() => normalizeInteractiveSettings(project.shader), [project.shader]);
  const adapted = useMemo(() => gradientLayerToShader(layer, project), [layer, project]);
  const [status, setStatus] = useState<{ value: InteractiveRendererStatus; message: string }>({ value: 'ready', message: '' });
  const settings = useMemo(() => ({ ...config, style: layer.shader?.style ?? config.style }), [config, layer.shader?.style]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new InteractiveRenderer(canvas, {
      palette: adapted.palette,
      settings,
      geometry: adapted.geometry,
      meshPoints: adapted.meshPoints,
      meshBase: adapted.meshBase,
      onStatusChange: (value, message = '') => setStatus({ value, message }),
    });
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.update({ palette: adapted.palette, settings, geometry: adapted.geometry, meshPoints: adapted.meshPoints, meshBase: adapted.meshBase });
  }, [adapted, settings]);

  return <>
    <canvas
      ref={canvasRef}
      className="gs-shader-canvas"
      aria-label="Interactive shader gradient preview"
      style={{ pointerEvents: interactive ? 'auto' : 'none' }}
      data-testid={`gs-shader-canvas-${layer.id}`}
    />
    {status.value !== 'ready' && (
      <div className={`gs-shader-status ${status.value}`} role="status" data-testid={`gs-shader-status-${layer.id}`}>
        {status.message || (status.value === 'fallback' ? 'WebGL unavailable · showing the CSS gradient' : 'Shader preview unavailable · showing the CSS gradient')}
      </div>
    )}
    {status.value === 'ready' && (adapted.notes.length > 0 || project.shader?.enabled) && (
      <div className="gs-shader-status note" role="note" title={adapted.notes.join(' ')} data-testid={`gs-shader-status-${layer.id}`}>
        {adapted.notes.length ? adapted.notes.join(' ') : 'Shader layer · base gradient tools remain active'}
      </div>
    )}
  </>;
}
