import { useEffect, useRef, type CSSProperties } from 'react';
import { createTrailFx, type TrailFxRuntime } from '../interactive/trailfx/runtime';
import { TRAILFX_SOURCES } from '../interactive/trailfx/shaders.generated';
import type { TrailFxConfig } from '../interactive/trailfx/model';

/** The Trail FX canvas drawn over the gradient layers. It listens to the window (like the original effect) and only reacts to
 *  pointers that are over it; touch input follows the project's "Touch interaction" switch. */
export default function TrailFxOverlay({ config, touch }: { config: TrailFxConfig; touch: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<TrailFxRuntime | null>(null);
  const configRef = useRef(config); configRef.current = config;
  const touchRef = useRef(touch); touchRef.current = touch;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { canvas.style.display = 'none'; return; }
    const runtime = createTrailFx(canvas, {
      sources: TRAILFX_SOURCES,
      config: configRef.current,
      onError: message => { console.warn('Trail FX disabled:', message); canvas.style.display = 'none'; },
    });
    runtimeRef.current = runtime;
    if (!runtime) { canvas.style.display = 'none'; return; }
    const forward = (kind: 'move' | 'down' | 'up' | 'cancel' | 'leave') => (event: PointerEvent) => {
      if (event.pointerType === 'touch' && !touchRef.current) return;
      runtime.handle(kind, event);
    };
    const handlers = { pointermove: forward('move'), pointerdown: forward('down'), pointerup: forward('up'), pointercancel: forward('cancel') };
    (Object.keys(handlers) as (keyof typeof handlers)[]).forEach(type => window.addEventListener(type, handlers[type], { passive: true }));
    // the pointer leaving the window ends hover-driven particles, forces and chains
    const onLeave = forward('leave');
    document.documentElement.addEventListener('pointerleave', onLeave, { passive: true });
    const invalidate = () => runtime.invalidate();
    window.addEventListener('scroll', invalidate, { passive: true, capture: true });
    const observer = new ResizeObserver(() => runtime.resize());
    observer.observe(canvas);
    return () => {
      (Object.keys(handlers) as (keyof typeof handlers)[]).forEach(type => window.removeEventListener(type, handlers[type]));
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', invalidate, { capture: true });
      observer.disconnect();
      runtime.destroy();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => { runtimeRef.current?.setConfig(config); }, [config]);

  const style: CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3,
    opacity: config.opacity, mixBlendMode: config.blend as CSSProperties['mixBlendMode'],
  };
  return <canvas ref={canvasRef} className="gs-trailfx-canvas" style={style} aria-hidden="true" data-testid="gs-trailfx-canvas" />;
}
