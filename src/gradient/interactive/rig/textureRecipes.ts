import { normalizeTexture } from '../../engine/textureControls';
import { RIG_SOURCE_MAP, type RigRule } from './model';
import { normalizeTexFx, type RigTextureFx } from './textureFx';

/* Texture recipes.
 *
 * A recipe is nothing but a set of ordinary rule settings: one of the CSS textures, its motion and shading (textureFx.ts), the
 * source, falloff, blend and colour. There is no special code behind any of them, which is the point: everything a recipe does can
 * be built by hand in the rule editor, and "Starfall" or "Ember trail" can be taken apart and changed afterwards.
 * Recipes are applied to a rule from the texture editor, and also appear as ready-made interactions ("Texture brushes"). */

export interface TextureRecipe {
  id: string;
  label: string;
  blurb: string;
  /** shows up in the preset list too, with a longer trail life when it needs one */
  trailLife?: number;
  texture: Record<string, unknown>;
  fx: Partial<RigTextureFx>;
  rule: Partial<Pick<RigRule, 'source' | 'radius' | 'falloff' | 'blend' | 'colorMode' | 'color' | 'amount' | 'shape' | 'aspect' | 'edge'>>;
}

export const TEXTURE_RECIPES: TextureRecipe[] = [
  {
    id: 'starfall', label: 'Starfall', blurb: 'Stars drift down through the pointer’s wake and twinkle.', trailLife: 1.4,
    texture: { pattern: 'geometric-star-field', scale: 90, density: 55, opacity: 100, color: '#fff3c4', seed: 11 },
    fx: { anchor: 'screen', scrollSpeed: 150, scrollAngle: 280, twinkle: 0.85, twinkleRate: 3, flutter: 0.3, flutterRate: 1.1, dropout: 0.3, depth: 0.6, gain: 1.6 },
    rule: { source: 'trail', radius: 1.7, falloff: 'tail', blend: 'add', colorMode: 'custom', color: '#ffe9a8', amount: 1.2 },
  },
  {
    id: 'ember-trail', label: 'Ember trail', blurb: 'Warm sparks rise and flicker behind the pointer.', trailLife: 1.3,
    texture: { pattern: 'dots-scatter-dots', scale: 70, density: 45, opacity: 100, color: '#ffb347', seed: 23 },
    fx: { anchor: 'screen', scrollSpeed: 120, scrollAngle: 82, twinkle: 0.7, twinkleRate: 5, flutter: 0.5, flutterRate: 2.2, dropout: 0.35, depth: 0.5, gain: 1.8, tint: 0.35 },
    rule: { source: 'trail', radius: 1.4, falloff: 'tail', blend: 'add', colorMode: 'custom', color: '#ff6a1f', amount: 1.2 },
  },
  {
    id: 'snowfall', label: 'Snowfall', blurb: 'Soft flakes fall across the whole canvas, thicker near the pointer.',
    texture: { pattern: 'dots-polka-dots', scale: 64, density: 40, opacity: 100, color: '#ffffff', seed: 5 },
    fx: { anchor: 'screen', scrollSpeed: 70, scrollAngle: 262, flutter: 0.6, flutterRate: 0.8, dropout: 0.45, depth: 0.7, gain: 1.1 },
    rule: { source: 'fixed', radius: 4, falloff: 'plateau', blend: 'screen', colorMode: 'custom', color: '#ffffff', amount: 1 },
  },
  {
    id: 'fireflies', label: 'Fireflies', blurb: 'Warm specks hover near the pointer and pulse slowly.',
    texture: { pattern: 'dots-random-speckles', scale: 80, density: 30, opacity: 100, color: '#d8ff7a', seed: 31 },
    fx: { anchor: 'screen', scrollSpeed: 18, scrollAngle: 60, twinkle: 0.9, twinkleRate: 1.2, flutter: 0.8, flutterRate: 0.7, dropout: 0.4, depth: 0.7, gain: 2 },
    rule: { source: 'pointer', radius: 2, falloff: 'gauss', blend: 'add', colorMode: 'custom', color: '#c6ff4d', amount: 1.2 },
  },
  {
    id: 'confetti', label: 'Confetti', blurb: 'Coloured pieces tumble down wherever you move.',
    texture: { pattern: 'geometric-confetti', scale: 110, density: 50, opacity: 100, color: '#ffffff', seed: 9 },
    fx: { anchor: 'screen', scrollSpeed: 170, scrollAngle: 270, spin: 40, flutter: 0.4, flutterRate: 1.6, dropout: 0.25, depth: 0.5, tint: 0.7, gain: 1.2 },
    rule: { source: 'trail', radius: 1.6, falloff: 'smooth', blend: 'mix', colorMode: 'spectrum', amount: 1.2 },
  },
  {
    id: 'rain', label: 'Rain', blurb: 'Fine streaks fall quickly through the pointer area.',
    texture: { pattern: 'lines-fine-vertical', scale: 70, density: 50, opacity: 100, color: '#cfe8ff', seed: 3 },
    fx: { anchor: 'screen', scrollSpeed: 520, scrollAngle: 264, dropout: 0.4, depth: 0.5, gain: 1.2 },
    rule: { source: 'pointer', radius: 2.4, falloff: 'smooth', blend: 'screen', colorMode: 'custom', color: '#bfe3ff', amount: 1 },
  },
  {
    id: 'bubbles', label: 'Bubbles', blurb: 'Round bubbles rise and sway behind the pointer.', trailLife: 1.2,
    texture: { pattern: 'dots-circular-dots', scale: 80, density: 35, opacity: 100, color: '#d5f6ff', seed: 17 },
    fx: { anchor: 'screen', scrollSpeed: 70, scrollAngle: 90, flutter: 0.7, flutterRate: 0.9, dropout: 0.4, depth: 0.6, gain: 1.1 },
    rule: { source: 'trail', radius: 1.5, falloff: 'tail', blend: 'screen', colorMode: 'custom', color: '#d5f6ff', amount: 1 },
  },
  {
    id: 'glitter', label: 'Glitter', blurb: 'Tiny stars flash where the pointer is.',
    texture: { pattern: 'geometric-star-field', scale: 42, density: 60, opacity: 100, color: '#ffffff', seed: 41 },
    fx: { anchor: 'screen', twinkle: 1, twinkleRate: 6, dropout: 0.3, gain: 1.8 },
    rule: { source: 'pointer', radius: 1.3, falloff: 'gauss', blend: 'add', colorMode: 'custom', color: '#ffffff', amount: 1.2 },
  },
  {
    id: 'dust', label: 'Dust', blurb: 'Slow motes of dust catch the light around the pointer.',
    texture: { pattern: 'grain-dust-noise', scale: 56, density: 40, opacity: 100, color: '#fff1d6', seed: 7 },
    fx: { anchor: 'screen', scrollSpeed: 12, scrollAngle: 20, flutter: 0.3, flutterRate: 0.5, dropout: 0.3, depth: 0.6, gain: 1.4 },
    rule: { source: 'pointer', radius: 2.2, falloff: 'smooth', blend: 'screen', colorMode: 'custom', color: '#fff1d6', amount: 1 },
  },
  {
    id: 'magic-sparks', label: 'Magic sparks', blurb: 'Spinning star dust in changing colours rises from the pointer.', trailLife: 1.2,
    texture: { pattern: 'geometric-star-field', scale: 76, density: 50, opacity: 100, color: '#ffffff', seed: 13 },
    fx: { anchor: 'screen', scrollSpeed: 90, scrollAngle: 90, spin: 25, twinkle: 0.8, twinkleRate: 4, dropout: 0.3, depth: 0.5, tint: 1, gain: 1.6 },
    rule: { source: 'trail', radius: 1.5, falloff: 'tail', blend: 'add', colorMode: 'spectrum', amount: 1.2 },
  },
];

export const TEXTURE_RECIPE_MAP = Object.fromEntries(TEXTURE_RECIPES.map(recipe => [recipe.id, recipe])) as Record<string, TextureRecipe>;

/** Applies a recipe to a rule. The rule keeps its effect, id, drives and shape editing; everything the recipe names is replaced. */
export function applyTextureRecipe(rule: RigRule, recipe: TextureRecipe): RigRule {
  const source = recipe.rule.source ?? rule.source;
  const sourceParams = RIG_SOURCE_MAP[source].params;
  return {
    ...rule,
    ...recipe.rule,
    sp1: source === rule.source ? rule.sp1 : sourceParams[0]?.def ?? 0,
    sp2: source === rule.source ? rule.sp2 : sourceParams[1]?.def ?? 0,
    texture: normalizeTexture({ ...rule.texture, ...recipe.texture, enabled: true }),
    texFx: normalizeTexFx(recipe.fx),
  };
}
