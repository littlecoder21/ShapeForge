import type { TrailFxConfig } from './model';
import type { TrailFxSources } from './shaders.generated';

export interface TrailFxSample { clientX: number; clientY: number; pointerType?: string }
export interface TrailFxRuntime {
  /** feed a pointer event (mouse, touch or pen): `move` and `down` position it, `down`/`up` press and release it (particles and ribbons react to both), `leave` marks it gone */
  handle(kind: 'move' | 'down' | 'up' | 'cancel' | 'leave', sample: TrailFxSample): void;
  /** the canvas moved or scrolled: re-read its rectangle */
  invalidate(): void;
  resize(): void;
  /** new values; the pipeline is only rebuilt when the list of enabled passes changed */
  setConfig(config: TrailFxConfig): void;
  destroy(): void;
}
export interface TrailFxOptions { sources: TrailFxSources; config: TrailFxConfig; onError?: (message: string) => void }
export function createTrailFx(canvas: HTMLCanvasElement, options: TrailFxOptions): TrailFxRuntime | null;
