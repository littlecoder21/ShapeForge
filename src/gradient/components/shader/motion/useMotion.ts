import { useCallback, useMemo, useRef } from 'react';
import { cloneMotion, defaultMotion, type MotionConfig } from '../../../../motion/types';
import { useShader } from '../context';

/** Defaults every "reset to default" dot compares against. Never mutated. */
export const MOTION_DEFAULTS: MotionConfig = defaultMotion();

export interface MotionEditor {
  config: MotionConfig;
  /** Edit a private copy of the config; edits in the same tick compose. `coalesce` merges a slider drag into one undo step. */
  edit: (change: (draft: MotionConfig) => void, coalesce?: string) => void;
  /** Replace the whole config (presets, imports). */
  replace: (next: MotionConfig, coalesce?: string) => void;
  announce: (message: string) => void;
}

/** The motion config of the project plus the two ways to change it. The config lives in `settings.motion`, next to everything else
 *  the renderer and the exporter read, so the preview and the exported page always see the same values. */
export function useMotion(): MotionEditor {
  const { settings, update, announce } = useShader();
  const config = useMemo(() => settings.motion ?? defaultMotion(), [settings.motion]);
  const latest = useRef(config);
  latest.current = config;
  const replace = useCallback((next: MotionConfig, coalesce?: string) => {
    latest.current = next;
    update({ motion: next }, coalesce);
  }, [update]);
  const edit = useCallback((change: (draft: MotionConfig) => void, coalesce?: string) => {
    const draft = cloneMotion(latest.current);
    change(draft);
    latest.current = draft;
    update({ motion: draft }, coalesce);
  }, [update]);
  return { config, edit, replace, announce };
}
