import { createContext, useContext } from 'react';
import type { GradientLayer } from '../../engine/model';
import type { InteractionRig } from '../../interactive/rig/model';
import type { InteractiveSettings, ShaderLayerConfig } from '../../interactive/types';

export interface ShaderPanelContext {
  settings: InteractiveSettings;
  /** every layer, top-most first (the order of the Layers panel) */
  layers: GradientLayer[];
  /** the layer whose values the sub-panels display */
  primary: GradientLayer | null;
  /** the layers every edit applies to (the checked ones; the primary layer when none is checked) */
  targets: GradientLayer[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  update: (patch: Partial<InteractiveSettings>, coalesce?: string) => void;
  updateRig: (change: (rig: InteractionRig) => InteractionRig, coalesce?: string) => void;
  /** apply a shader-layer patch to the given layers (default: the targets); enabling a layer also switches the project shader on */
  patchLayers: (patch: Partial<ShaderLayerConfig> | ((layer: GradientLayer) => Partial<ShaderLayerConfig>), ids?: string[], coalesce?: string) => void;
  /** make a layer the one the rest of the studio edits */
  focusLayer: (id: string) => void;
  announce: (message: string) => void;
}

const Ctx = createContext<ShaderPanelContext | null>(null);
export const ShaderPanelProvider = Ctx.Provider;

export function useShader(): ShaderPanelContext {
  const value = useContext(Ctx);
  if (!value) throw new Error('Shader sub-panels must render inside <InteractivePanel>.');
  return value;
}
