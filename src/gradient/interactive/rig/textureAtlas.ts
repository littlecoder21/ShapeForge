import { textureTileSvg } from '../../engine/textures';
import { activeRules, type InteractionRig } from './model';

const svgDataUri = (source: string) => `data:image/svg+xml,${encodeURIComponent(source)}`;

/** A compact 4×2 atlas of the existing CSS texture tiles, in active-rule order. */
export function ruleTextureAtlasDataUri(rig: Pick<InteractionRig, 'rules'> | null): string {
  const rules = rig ? activeRules(rig) : [];
  if (!rules.some(rule => rule.texture.enabled)) return '';
  const images = rules.flatMap((rule, index) => {
    if (!rule.texture.enabled) return [];
    const x = (index % 4) * 64;
    const y = Math.floor(index / 4) * 64;
    return [`<image x="${x}" y="${y}" width="64" height="64" href="${svgDataUri(textureTileSvg(rule.texture))}"/>`];
  }).join('');
  return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128" viewBox="0 0 256 128">${images}</svg>`);
}
