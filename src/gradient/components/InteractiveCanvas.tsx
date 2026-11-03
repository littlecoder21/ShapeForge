import { useEffect, useMemo, useRef, useState } from 'react';
import { InteractiveRenderer } from '../interactive/core/InteractiveRenderer';
import { gradientLayerToShader, interactionColorsForLayer, supportsDirectShaderGeometry } from '../interactive/adapter';
import { normalizeInteractiveSettings, type InteractiveRendererStatus } from '../interactive/types';
import type { GradientLayer, GradientProject } from '../engine/model';
import { textMaskDataUri } from '../engine/text';
import { bleedOf } from '../engine/geom';

export default function InteractiveCanvas({ project, layer, interactive = false }: { project: GradientProject; layer: GradientLayer; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<InteractiveRenderer | null>(null);
  const config = useMemo(() => normalizeInteractiveSettings(project.shader), [project.shader]);
  const adapted = useMemo(() => gradientLayerToShader(layer, project), [layer, project]);
  const mixLayer = project.layers.find(candidate => candidate.id === layer.shader?.mixLayerId && candidate.visible && candidate.id !== layer.id);
  const mixAdapted = useMemo(() => mixLayer ? gradientLayerToShader(mixLayer, project) : null, [mixLayer, project]);
  const layerMix = useMemo(() => ({
    palette: mixAdapted?.palette ?? [],
    space: mixAdapted?.geometry.space,
    mode: layer.shader?.mixMode ?? 'mix',
    strength: mixAdapted ? layer.shader?.mixStrength ?? 0 : 0,
    speed: layer.shader?.mixSpeed ?? 0,
  }), [mixAdapted, layer.shader]);
  const [status, setStatus] = useState<{ value: InteractiveRendererStatus; message: string }>({ value: 'ready', message: '' });
  const settings = useMemo(() => ({
    ...config,
    ...layer.shader?.controls,
    style: layer.shader?.style ?? config.style,
  }), [config, layer.shader?.controls, layer.shader?.style]);
  const rendererSettings = useMemo(() => ({
    ...settings,
    interactionColor: settings.interactionColorSource === 'layer'
      ? interactionColorsForLayer(adapted.palette)[0] ?? settings.interactionColor
      : settings.interactionColor,
    interactionColors: settings.interactionColorSource === 'layer'
      ? interactionColorsForLayer(adapted.palette)
      : settings.interactionColors,
    renderBackend: settings.renderBackend === 'webgl' && !supportsDirectShaderGeometry(layer) ? 'overlay' as const : settings.renderBackend,
  }), [settings, layer, adapted.palette]);
  const backendRef = useRef(rendererSettings.renderBackend);
  backendRef.current = rendererSettings.renderBackend;
  const textMaskSize = `${100 / (1 + 2 * bleedOf(layer, project.canvas))}%`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new InteractiveRenderer(canvas, {
      palette: adapted.palette,
      settings: rendererSettings,
      geometry: adapted.geometry,
      meshPoints: adapted.meshPoints,
      meshBase: adapted.meshBase,
      layerMix,
      onStatusChange: (value, message = '') => {
        canvas.parentElement?.classList.toggle('gs-webgl-ready', backendRef.current === 'webgl' && value === 'ready');
        setStatus({ value, message });
      },
    });
    canvas.parentElement?.classList.toggle('gs-webgl-ready', rendererSettings.renderBackend === 'webgl' && renderer.getStatus().status === 'ready');
    rendererRef.current = renderer;
    return () => {
      canvas.parentElement?.classList.remove('gs-webgl-ready');
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.update({ palette: adapted.palette, settings: rendererSettings, geometry: adapted.geometry, meshPoints: adapted.meshPoints, meshBase: adapted.meshBase, layerMix });
    const canvas = canvasRef.current;
    canvas?.parentElement?.classList.toggle('gs-webgl-ready', rendererSettings.renderBackend === 'webgl' && rendererRef.current?.getStatus().status === 'ready');
  }, [adapted, rendererSettings, layerMix]);

  return <>
    <canvas
      ref={canvasRef}
      className="gs-shader-canvas"
      aria-label="Interactive shader gradient preview"
      style={{
        pointerEvents: interactive ? 'auto' : 'none',
        ...(layer.text ? {
          maskImage: textMaskDataUri(layer.text, project.canvas.w, project.canvas.h),
          WebkitMaskImage: textMaskDataUri(layer.text, project.canvas.w, project.canvas.h),
          maskSize: `${textMaskSize} ${textMaskSize}`,
          WebkitMaskSize: `${textMaskSize} ${textMaskSize}`,
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
        } : {}),
      }}
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
