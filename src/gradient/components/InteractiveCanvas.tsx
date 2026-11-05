import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { InteractiveRenderer } from '../interactive/core/InteractiveRenderer';
import { gradientLayerToShader, interactionColorsForLayer, supportsDirectShaderGeometry } from '../interactive/adapter';
import { normalizeInteractiveSettings, type InteractiveLayerState, type InteractiveRendererStatus } from '../interactive/types';
import { resolveStyleParams } from '../interactive/styles';
import type { GradientLayer, GradientProject } from '../engine/model';
import { textMaskDataUri } from '../engine/text';
import { bleedOf } from '../engine/geom';

interface Props { project: GradientProject; layer: GradientLayer; interactive?: boolean }

const mixLayerOf = (project: GradientProject, layer: GradientLayer) =>
  project.layers.find(candidate => candidate.id === layer.shader?.mixLayerId && candidate.visible && candidate.id !== layer.id);

/* Performance note
 * This component is re-rendered by the preview on every project edit (every slider tick in any panel).
 * It used to rebuild the layer palette from the whole `project` each time, which handed the renderer a fresh palette
 * array, which re-baked the 512-entry colour LUT and re-uploaded two textures per shader layer, many times a second.
 * Everything below is keyed on the few inputs that really matter, and the memo comparator skips the render outright
 * when none of them changed. */
function InteractiveCanvasInner({ project, layer, interactive = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<InteractiveRenderer | null>(null);
  const config = useMemo(() => normalizeInteractiveSettings(project.shader), [project.shader]);
  const adapted = useMemo(() => gradientLayerToShader(layer, project), [layer, project.canvas, project.background]); // eslint-disable-line react-hooks/exhaustive-deps
  const mixLayer = mixLayerOf(project, layer);
  const mixAdapted = useMemo(() => mixLayer ? gradientLayerToShader(mixLayer, project) : null, [mixLayer, project.canvas, project.background]); // eslint-disable-line react-hooks/exhaustive-deps
  const layerMix = useMemo(() => ({
    palette: mixAdapted?.palette ?? [],
    space: mixAdapted?.geometry.space,
    mode: layer.shader?.mixMode ?? 'mix',
    strength: mixAdapted ? layer.shader?.mixStrength ?? 0 : 0,
    speed: layer.shader?.mixSpeed ?? 0,
  }), [mixAdapted, layer.shader?.mixMode, layer.shader?.mixStrength, layer.shader?.mixSpeed]);
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
  const styleParamsKey = (layer.shader?.styleParams ?? []).join(',');
  const layerState = useMemo<InteractiveLayerState>(() => ({
    styleParams: resolveStyleParams(settings.style, layer.shader?.styleParams),
    reaction: layer.shader?.interact === false ? 0 : layer.shader?.reaction ?? 1,
  }), [settings.style, styleParamsKey, layer.shader?.interact, layer.shader?.reaction]); // eslint-disable-line react-hooks/exhaustive-deps
  const backendRef = useRef(rendererSettings.renderBackend);
  backendRef.current = rendererSettings.renderBackend;
  const textMaskSize = `${100 / (1 + 2 * bleedOf(layer, project.canvas))}%`;
  const textMask = useMemo(
    () => layer.text ? textMaskDataUri(layer.text, project.canvas.w, project.canvas.h) : '',
    [layer.text, project.canvas.w, project.canvas.h],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new InteractiveRenderer(canvas, {
      palette: adapted.palette,
      settings: rendererSettings,
      layer: layerState,
      geometry: adapted.geometry,
      meshPoints: adapted.meshPoints,
      meshBase: adapted.meshBase,
      layerMix,
      onStatusChange: (value, message = '') => {
        canvas.parentElement?.classList.toggle('gs-webgl-ready', backendRef.current === 'webgl' && value === 'ready');
        setStatus(previous => previous.value === value && previous.message === message ? previous : { value, message });
      },
    });
    canvas.parentElement?.classList.toggle('gs-webgl-ready', rendererSettings.renderBackend === 'webgl' && renderer.getStatus().status === 'ready');
    rendererRef.current = renderer;
    return () => {
      canvas.parentElement?.classList.remove('gs-webgl-ready');
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    rendererRef.current?.update({ palette: adapted.palette, settings: rendererSettings, layer: layerState, geometry: adapted.geometry, meshPoints: adapted.meshPoints, meshBase: adapted.meshBase, layerMix });
    const canvas = canvasRef.current;
    canvas?.parentElement?.classList.toggle('gs-webgl-ready', rendererSettings.renderBackend === 'webgl' && rendererRef.current?.getStatus().status === 'ready');
  }, [adapted, rendererSettings, layerMix, layerState]);

  return <>
    <canvas
      ref={canvasRef}
      className="gs-shader-canvas"
      aria-label="Interactive shader gradient preview"
      style={{
        pointerEvents: interactive ? 'auto' : 'none',
        ...(layer.text ? {
          maskImage: textMask,
          WebkitMaskImage: textMask,
          maskSize: `${textMaskSize} ${textMaskSize}`,
          WebkitMaskSize: `${textMaskSize} ${textMaskSize}`,
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
        } : {}),
      }}
      data-testid={`gs-shader-canvas-${layer.id}`}
    />
    {status.value !== 'ready' && status.value !== 'compiling' && (
      <div className={`gs-shader-status ${status.value}`} role="status" data-testid={`gs-shader-status-${layer.id}`}>
        {status.message || (status.value === 'fallback' ? 'WebGL unavailable · showing the CSS gradient' : 'Shader preview unavailable · showing the CSS gradient')}
      </div>
    )}
    {status.value === 'ready' && status.message && (
      <div className="gs-shader-status note" role="note" title={status.message} data-testid={`gs-shader-status-${layer.id}`}>{status.message}</div>
    )}
    {status.value === 'ready' && !status.message && (adapted.notes.length > 0 || project.shader?.enabled) && (
      <div className="gs-shader-status note" role="note" title={adapted.notes.join(' ')} data-testid={`gs-shader-status-${layer.id}`}>
        {adapted.notes.length ? adapted.notes.join(' ') : 'Shader layer · base gradient tools remain active'}
      </div>
    )}
  </>;
}

const InteractiveCanvas = memo(InteractiveCanvasInner, (previous, next) =>
  previous.layer === next.layer
  && previous.interactive === next.interactive
  && previous.project.shader === next.project.shader
  && previous.project.canvas === next.project.canvas
  && previous.project.background === next.project.background
  && mixLayerOf(previous.project, previous.layer) === mixLayerOf(next.project, next.layer));

export default InteractiveCanvas;
