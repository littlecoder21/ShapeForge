/* ═══════════════════════════ Texture preset registry ═══════════════════════════
 * Every texture has a STABLE id (`<family>-<slug of its label>`). The ids that older versions of the studio
 * generated from list position (`dots-1`, `woven-41`, …) are kept as ALIASES: they still resolve to exactly
 * the same preset, so saved projects, builders and favourites keep working. New code should store the stable id;
 * `normalizeTexture()` migrates legacy ids when a project is loaded.
 * The list order (and therefore the library order in the UI) is unchanged.
 */

export type TextureFamily = 'grain' | 'dots' | 'lines' | 'crosshatch' | 'grid' | 'waves' | 'geometric' | 'woven' | 'paper' | 'material' | 'organic';

export interface TexturePreset {
  /** Stable identifier — never derived from list position. */
  id: string;
  label: string;
  family: TextureFamily;
  /** Position inside the family. Kept for compatibility; renderers must not depend on it. */
  variant: number;
  /** The position-based id older versions generated (`family-N`, 1-based). Still accepted everywhere. */
  legacyId: string;
}

const FAMILY_NAMES: { family: TextureFamily; names: string[] }[] = [
  { family: 'grain', names: ['Film grain', 'Fine film', 'Coarse film', 'Silver grain', 'Soft noise', 'Dust noise', 'Colour noise', 'Vintage grain', 'Analog grain', '35mm grain', 'Super 8 grain', 'Pushed film', 'Paper speckle', 'Sensor noise', 'Cloud noise', 'Fine Grain', 'Digital Noise', 'Monochrome Noise', 'Color Noise', 'Gaussian Noise', 'Fractal Noise', 'Perlin Noise', 'Simplex Noise', 'Cellular Noise (Worley)', 'Displacement Noise', 'Pixel Noise', 'Dithering', 'RGB Noise', 'Chromatic Aberration', 'Glitch Art'] },
  { family: 'dots', names: ['Halftone', 'Fine halftone', 'Bold halftone', 'Micro dots', 'Wide dots', 'Stipple', 'Dense stipple', 'Sparse stipple', 'Offset dots', 'Diamond dots', 'Roundel', 'Rosette', 'Pin dots', 'Scatter dots', 'Screen print', 'Classic Halftone', 'Dense Halftone', 'Stochastic Halftone', 'Circular Dots', 'Microdots', 'Polka Dots', 'Random Speckles', 'Ink Splatter', 'Spray Paint', 'Ben-Day Dots', 'Stone Speckles'] },
  { family: 'lines', names: ['Horizontal lines', 'Fine horizontal', 'Wide horizontal', 'Vertical lines', 'Fine vertical', 'Wide vertical', 'Diagonal lines', 'Fine diagonal', 'Scanlines', 'Broken lines', 'Pinstripe', 'Long dash', 'Short dash', 'Slanted bands', 'Parallel strokes', 'Horizontal Stripes', 'Vertical Stripes', 'Moiré Lines', 'Scratched Surface', 'Worn Ink', 'Cracked Ink'] },
  { family: 'crosshatch', names: ['Crosshatch', 'Fine crosshatch', 'Loose crosshatch', 'Etching', 'Engraving', 'Woven hatch', 'Diagonal mesh', 'Dense hatch', 'Copperplate', 'Double hatch', 'Sketch marks', 'Lattice', 'Waffle hatch', 'Basket hatch', 'Crisscross', 'Diagonal Hatching', 'Crosshatching'] },
  { family: 'grid', names: ['Square grid', 'Fine grid', 'Bold grid', 'Graph paper', 'Dashed grid', 'Blueprint grid', 'Isometric grid', 'Hex grid', 'Dot grid', 'Major-minor grid', 'Rounded grid', 'Perspective grid', 'Offset grid', 'Micro grid', 'Tech grid', 'Hexagonal Grid', 'Triangular Pattern'] },
  { family: 'waves', names: ['Soft waves', 'Tight waves', 'Wide waves', 'Water ripples', 'Contour lines', 'Sine mesh', 'Flow lines', 'Interference', 'Topographic', 'Tide lines', 'Ripple field', 'Drift waves', 'Pulse waves', 'Moire waves', 'Sound waves', 'Marble', 'Dried Mud Cracks', 'Wood Grain', 'Tree Bark', 'Cloud Texture', 'Smoke', 'Fog', 'Watercolor Bleed', 'Ink in Water', 'Fluid Swirls', 'Marbling', 'Turbulence', 'Fractal Clouds', 'Topographic Contours'] },
  { family: 'geometric', names: ['Checkerboard', 'Fine checker', 'Diamond', 'Triangles', 'Honeycomb', 'Scales', 'Confetti', 'Pixel blocks', 'Chevron', 'Tessellation', 'Isometric cubes', 'Star field', 'Mosaic', 'Zigzag', 'Facet tiles', 'Organic Blobs', 'Voronoi Cells'] },
  { family: 'woven', names: ['Canvas weave', 'Linen', 'Twill', 'Basket weave', 'Paper fibers', 'Rough paper', 'Crossed fibers', 'Carbon fiber', 'Denim weave', 'Silk weave', 'Ribbed cloth', 'Jute', 'Felt grain', 'Herringbone', 'Knit stitch', 'Cotton Weave', 'Canvas Fabric', 'Denim', 'Silk', 'Wool', 'Velvet', 'Burlap', 'Herringbone Weave', 'Knitted Fabric', 'Leather Grain', 'Suede', 'Rubber', 'Brushed Metal', 'Polished Metal', 'Ceramic Glaze', 'Frosted Glass', 'Embossed Surface', 'Debossed Surface', 'Crushed Foil', 'Rust', 'Oxidation', 'Peeling Paint', 'Faded Paint', 'Weathered Surface', 'Vintage Print', 'Grunge'] },
  { family: 'paper', names: ['Handmade Paper', 'Recycled Paper', 'Parchment', 'Newsprint', 'Cardstock', 'Watercolor Paper', 'Cotton Paper', 'Rice Paper', 'Crumpled Paper', 'Torn Paper Edges'] },
  { family: 'material', names: ['Granite', 'Limestone', 'Sandstone', 'Concrete', 'Clay'] },
  { family: 'organic', names: ['Plasma Texture'] },
];

export const slugify = (label: string) => label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const TEXTURES: TexturePreset[] = FAMILY_NAMES.flatMap(({ family, names }) => names.map((label, variant) => ({
  id: `${family}-${slugify(label)}`,
  label,
  family,
  variant,
  legacyId: `${family}-${variant + 1}`,
})));

const BY_ID = new Map<string, TexturePreset>();
const BY_LEGACY = new Map<string, TexturePreset>();
for (const preset of TEXTURES) {
  if (BY_ID.has(preset.id)) throw new Error(`Duplicate texture id: ${preset.id}`);
  BY_ID.set(preset.id, preset);
  BY_LEGACY.set(preset.legacyId, preset);
}

/** Legacy position-based id → stable id (every id older versions could have produced). */
export const LEGACY_TEXTURE_IDS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(TEXTURES.map(preset => [preset.legacyId, preset.id])));

export const DEFAULT_PATTERN = 'grain-film-grain';

/** Stable id for a stable id OR a legacy id; undefined when the value is not a known texture. */
export function resolveTextureId(id: unknown): string | undefined {
  if (typeof id !== 'string') return undefined;
  return BY_ID.get(id)?.id ?? BY_LEGACY.get(id)?.id;
}

export function findTexture(id: unknown): TexturePreset | undefined {
  if (typeof id !== 'string') return undefined;
  return BY_ID.get(id) ?? BY_LEGACY.get(id);
}
