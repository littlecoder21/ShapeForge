import { instantiateRig, makeRig, makeRule } from './model';
import { RIG_PRESET_GROUPS, RIG_PRESETS, type RigPreset } from './presets';
import { applyTextureRecipe, TEXTURE_RECIPES } from './textureRecipes';

/* The interaction catalog the panel shows: the built-in presets plus the texture brushes.
 *
 * Every texture brush is a single "Texture brush" rule configured by a recipe (textureRecipes.ts), so each one can be opened in
 * the builder and taken apart: it is the same CSS texture engine, with the motion and shading controls of the texture editor. */

export const TEXTURE_BRUSH_GROUP = 'Texture brushes';

export const TEXTURE_BRUSH_PRESETS: RigPreset[] = TEXTURE_RECIPES.map(recipe => ({
  id: `tex-${recipe.id}`,
  label: `${recipe.label} (texture)`,
  group: TEXTURE_BRUSH_GROUP,
  description: recipe.blurb,
  build: () => {
    const rig = makeRig(recipe.label, [applyTextureRecipe(makeRule('texture'), recipe)], { presetId: `tex-${recipe.id}` });
    if (recipe.trailLife) rig.physics = { ...rig.physics, trailLife: recipe.trailLife };
    return instantiateRig(rig);
  },
}));

export const ALL_RIG_PRESETS: RigPreset[] = [...RIG_PRESETS, ...TEXTURE_BRUSH_PRESETS];
export const ALL_RIG_PRESET_GROUPS: string[] = [...RIG_PRESET_GROUPS, TEXTURE_BRUSH_GROUP];
export const ALL_RIG_PRESET_MAP = Object.fromEntries(ALL_RIG_PRESETS.map(item => [item.id, item])) as Record<string, RigPreset>;
