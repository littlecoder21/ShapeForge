import type { TextureData } from './model';

export interface TexturePreset { id: string; label: string; family: 'grain' | 'dots' | 'lines' | 'crosshatch' | 'grid' | 'waves' | 'geometric' | 'woven' | 'paper' | 'material' | 'organic'; variant: number }

const families: { family: TexturePreset['family']; names: string[] }[] = [
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

export const TEXTURES: TexturePreset[] = families.flatMap(({ family, names }) => names.map((label, variant) => ({
  id: `${family}-${variant + 1}`,
  label,
  family,
  variant,
})));

const safeColor = (color: string) => /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
const round = (value: number) => String(Math.round(value * 100) / 100);
const precise = (value: number) => String(Math.round(value * 10000) / 10000);

const seeded = (seed: number) => {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

function noiseMotif(color: string, seed: number, frequency: number, octaves: number, type: 'fractalNoise' | 'turbulence' = 'fractalNoise', opacity = 1, id = 'texture-noise') {
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="${type}" baseFrequency="${precise(frequency)}" numOctaves="${octaves}" seed="${seed || 1}" stitchTiles="stitch" result="noise"/><feColorMatrix in="noise" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .33 .34 .33 0 0" result="mask"/><feFlood flood-color="${color}" result="ink"/><feComposite in="ink" in2="mask" operator="in"/></filter><rect width="64" height="64" filter="url(#${id})" opacity="${round(opacity)}"/>`;
}

function voronoiMotif(color: string, seed: number, count: number, fill: boolean, stroke: number) {
  const random = seeded(seed);
  const sites = Array.from({ length: count }, () => ({ x: random() * 64, y: random() * 64 }));
  const cells = sites.map(site => {
    let polygon = [{ x: -2, y: -2 }, { x: 66, y: -2 }, { x: 66, y: 66 }, { x: -2, y: 66 }];
    sites.forEach(other => {
      if (site === other) return;
      const mx = (site.x + other.x) / 2, my = (site.y + other.y) / 2;
      const nx = other.x - site.x, ny = other.y - site.y;
      const input = polygon;
      polygon = [];
      input.forEach((a, index) => {
        const b = input[(index + 1) % input.length];
        const da = (a.x - mx) * nx + (a.y - my) * ny;
        const db = (b.x - mx) * nx + (b.y - my) * ny;
        if (da <= 0) polygon.push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const t = da / (da - db);
          polygon.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      });
    });
    return polygon;
  });
  return `<g fill="${fill ? color : 'none'}" stroke="${color}" stroke-width="${round(stroke)}">${cells.map(points => `<polygon points="${points.map(p => `${round(p.x)},${round(p.y)}`).join(' ')}"/>`).join('')}</g>`;
}

function motif(preset: TexturePreset, texture: TextureData): string {
  const v = preset.variant, d = Math.max(1, Math.min(100, texture.density)), seed = Math.abs(Math.round(texture.seed));
  const gap = Math.max(4, 28 - d * 0.22 + (v % 3) * 2);
  const stroke = Math.max(0.35, (0.45 + d / 32) * (1 + (v % 4) * 0.25));
  const color = safeColor(texture.color);
  const lines = (spacing: number, angle: number, dash = '') => `<path d="M-64 ${spacing}H128 M-64 ${spacing * 2}H128" transform="rotate(${angle} 32 32)" fill="none" stroke="${color}" stroke-width="${round(stroke)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

  if (preset.family === 'grain') {
    const label = preset.label.toLowerCase();
    if (label === 'chromatic aberration' || label === 'glitch art') {
      const shift = Math.max(1, d / 18);
      if (label === 'chromatic aberration') return `<g opacity=".8"><path d="M4 8H60 M4 20H60 M4 32H60 M4 44H60 M4 56H60" stroke="#ff2858" stroke-width="4" transform="translate(${-round(shift)} 0)"/><path d="M4 8H60 M4 20H60 M4 32H60 M4 44H60 M4 56H60" stroke="#20e8ff" stroke-width="2" transform="translate(${round(shift)} 0)"/></g>`;
      return `<g opacity=".9"><path d="M0 8H18L22 4H41L44 12H64 M0 24H28L31 20H56 M8 40H21L25 44H49L53 36H64 M0 56H15L19 52H38" fill="none" stroke="${color}" stroke-width="${round(Math.max(1, stroke))}"/><path d="M32 0V64" stroke="#ff2858" stroke-width="${round(shift)}" opacity=".65"/><path d="M36 0V64" stroke="#20e8ff" stroke-width="${round(shift)}" opacity=".65"/></g>`;
    }
    if (label === 'cellular noise (worley)') return voronoiMotif(color, seed, Math.max(7, Math.round(d / 3)), false, stroke);
    if (label === 'silver grain') return `${noiseMotif(color, seed, .31, 2, 'fractalNoise', d / 100, 'silver-noise')}<g fill="${color}">${Array.from({ length: 20 }, (_, i) => `<circle cx="${round((Math.sin((seed + i) * 17.1) * 43758) % 64)}" cy="${round((Math.sin((seed + i) * 31.7) * 43758) % 64)}" r="${round(.3 + (i % 4) * .18)}"/>`).join('')}</g>`;
    if (label === 'monochrome noise') return noiseMotif(color, seed, .27, 2, 'turbulence', d / 100, 'mono-noise');
    if (label === 'soft noise') return noiseMotif(color, seed, .035, 3, 'fractalNoise', d / 120, 'soft-noise');
    if (label === 'colour noise') return `<g>${noiseMotif('#ff3b30', seed + 1, .11, 3, 'fractalNoise', d / 100, 'colour-red')}${noiseMotif('#34c759', seed + 2, .13, 2, 'fractalNoise', d / 100, 'colour-green')}${noiseMotif('#0a84ff', seed + 3, .17, 2, 'fractalNoise', d / 100, 'colour-blue')}</g>`;
    if (label === 'color noise') return `<g>${noiseMotif('#ff9f0a', seed + 4, .095, 3, 'turbulence', d / 100, 'color-amber')}${noiseMotif('#bf5af2', seed + 5, .145, 2, 'fractalNoise', d / 100, 'color-violet')}${noiseMotif('#64d2ff', seed + 6, .21, 2, 'turbulence', d / 100, 'color-cyan')}</g>`;
    if (label === 'rgb noise') return `<g opacity="${round(d / 100)}">${noiseMotif('#ff2638', seed + 1, .22, 2, 'fractalNoise', 1, 'noise-red')}<g transform="translate(2 0)">${noiseMotif('#28e879', seed + 2, .18, 2, 'turbulence', 1, 'noise-green')}</g><g transform="translate(-2 0)">${noiseMotif('#288bff', seed + 3, .14, 1, 'turbulence', 1, 'noise-blue')}</g></g>`;
    if (label === 'pixel noise' || label === 'dithering') {
      const step = label === 'pixel noise' ? Math.max(2, Math.round(8 - d / 18)) : Math.max(2, Math.round(5 - d / 30));
      const random = seeded(seed);
      const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
      let pixels = '';
      for (let y = 0; y < 64; y += step) for (let x = 0; x < 64; x += step) {
        const on = label === 'dithering' ? bayer[Math.floor(y / step) % 4][Math.floor(x / step) % 4] / 16 < .55 : random() > 0.48;
        if (on) pixels += `<rect x="${x}" y="${y}" width="${step}" height="${step}" fill="${color}"/>`;
      }
      return pixels;
    }
    if (label === 'rgb noise' || label === 'color noise') return `<g opacity="${round(d / 100)}">${noiseMotif('#ff2638', seed + 1, .22, 2, 'fractalNoise', 1, 'noise-red')}${noiseMotif('#28e879', seed + 2, .22, 2, 'fractalNoise', 1, 'noise-green')}${noiseMotif('#288bff', seed + 3, .22, 2, 'fractalNoise', 1, 'noise-blue')}</g>`;
    if (label === 'gaussian noise') return noiseMotif(color, seed, .38, 1, 'turbulence', d / 100);
    if (label === 'displacement noise') return `<filter id="displacement"><feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="2" seed="${seed || 1}" result="warp"/><feDisplacementMap in="SourceGraphic" in2="warp" scale="${round(2 + d * .12)}" xChannelSelector="R" yChannelSelector="G"/></filter><path d="M-64 16L0 0L64 16L128 0M-64 48L0 32L64 48L128 32" fill="none" stroke="${color}" stroke-width="${round(stroke)}" filter="url(#displacement)"/>`;
    if (label === 'perlin noise' || label === 'simplex noise') return noiseMotif(color, seed, label === 'simplex noise' ? .055 : .07, label === 'simplex noise' ? 2 : 4, label === 'simplex noise' ? 'turbulence' : 'fractalNoise', d / 100, `${label.replace(/\s/g, '-')}-noise`);
    if (label === 'digital noise') {
      const step = Math.max(1, Math.round(4 - d / 35)), random = seeded(seed);
      let pixels = '';
      for (let y = 0; y < 64; y += step) for (let x = 0; x < 64; x += step) if (random() > .5) pixels += `<rect x="${x}" y="${y}" width="${step}" height="${step}" fill="${color}"/>`;
      return pixels;
    }
    if (label === 'sensor noise') return noiseMotif(color, seed, .42, 1, 'turbulence', d / 100, 'sensor-noise');
    const fine = label === 'fine grain' || label === 'silver grain' || label === 'sensor noise' || label === 'digital noise';
    if (label === 'dust noise' || label === 'paper speckle' || label === 'random speckles') {
      const random = seeded(seed), max = Math.round(10 + d * .7);
      let specks = '';
      for (let i = 0; i < max; i++) {
        const r = label === 'dust noise' ? .2 + random() * 1.5 : .35 + random() * (label === 'paper speckle' ? .65 : 1.9);
        specks += `<circle cx="${round(random() * 64)}" cy="${round(random() * 64)}" r="${round(r)}" fill="${color}" opacity="${round(.25 + random() * .75)}"/>`;
      }
      return specks;
    }
    if (label === 'cloud noise' || label === 'fractal noise') return noiseMotif(color, seed, label === 'cloud noise' ? .035 : .09, 4, 'fractalNoise', d / 100, `${label.replace(/\s/g, '-')}-noise`);
    return noiseMotif(color, seed, fine ? .42 + v * .001 : .12 + v * .0037, fine ? 1 : 3, label.includes('film') || label.includes('grain') ? 'turbulence' : 'fractalNoise', d / 100, `grain-${v}`);
  }
  if (preset.family === 'dots') {
    const label = preset.label.toLowerCase();
    const random = seeded(seed);
    const step = Math.max(3, label.includes('dense') || label === 'microdots' || label === 'fine halftone' ? gap * .62 : label === 'wide dots' || label === 'sparse stipple' ? gap * 1.45 : gap);
    const radius = Math.max(.45, (label.includes('bold') || label === 'wide dots' || label === 'polka dots' ? 2 : 1) * d / (label === 'microdots' || label === 'fine halftone' ? 90 : 55));
    if (label === 'stochastic halftone') {
      let halftone = '';
      const jitter = step * .22;
      for (let y = -step; y < 64 + step; y += step) for (let x = -step; x < 64 + step; x += step) halftone += `<circle cx="${round(x + (random() - .5) * jitter)}" cy="${round(y + (random() - .5) * jitter)}" r="${round(radius * (.6 + random() * .8))}" fill="${color}"/>`;
      return `<g transform="rotate(12 32 32)">${halftone}</g>`;
    }
    if (label === 'stochastic stipple' || label === 'sparse stipple' || label === 'dense stipple' || label === 'stipple' || label === 'scatter dots' || label === 'random speckles' || label === 'stone speckles') {
      const count = Math.round((label === 'sparse stipple' ? 18 : label === 'dense stipple' ? 150 : 40) * d / 55);
      let marks = '';
      for (let i = 0; i < count; i++) {
        const r = label === 'stone speckles' ? .25 + random() * 1.7 : label === 'random speckles' ? .3 + random() * 2 : radius * (.45 + random());
        const x = random() * 64, y = random() * 64;
        if (label === 'scatter dots') marks += `<circle cx="${round(x)}" cy="${round(y)}" r="${round(radius * 1.4)}" fill="${color}" opacity="${round(.25 + random() * .7)}"/>`;
        else if (label === 'stipple' || label === 'stochastic stipple') marks += `<circle cx="${round(x)}" cy="${round(y)}" r="${round(Math.max(.35, r * .55))}" fill="${color}" opacity="${round(.4 + random() * .6)}"/>`;
        else marks += `<circle cx="${round(x)}" cy="${round(y)}" r="${round(r)}" fill="${color}" opacity="${round(.3 + random() * .7)}"/>`;
      }
      return marks;
    }
    if (label === 'ink splatter' || label === 'spray paint') {
      const cx = 32 + (random() - .5) * 12, cy = 32 + (random() - .5) * 12, count = label === 'ink splatter' ? 55 : 110;
      let drops = '';
      for (let i = 0; i < count; i++) {
        const a = random() * Math.PI * 2, r = label === 'spray paint' ? random() * 31 : Math.pow(random(), 1.8) * 30;
        const dot = label === 'spray paint' ? .25 + random() * 1.1 : .35 + random() * 2.8;
        drops += `<circle cx="${round(cx + Math.cos(a) * r)}" cy="${round(cy + Math.sin(a) * r)}" r="${round(dot)}" fill="${color}" opacity="${round(.35 + random() * .65)}"/>`;
      }
      return drops;
    }
    if (label === 'rosette') return `<g fill="none" stroke="${color}" stroke-width="${round(stroke)}">${[8, 13, 18, 23].map(r => `<circle cx="32" cy="32" r="${r}"/>`).join('')}${Array.from({ length: 12 }, (_, i) => `<path d="M32 9Q${round(32 + Math.cos(i * Math.PI / 6) * 11)} ${round(32 + Math.sin(i * Math.PI / 6) * 11)} ${round(32 + Math.cos((i + 1) * Math.PI / 6) * 23)} ${round(32 + Math.sin((i + 1) * Math.PI / 6) * 23)}"/>`).join('')}</g>`;
    if (label === 'ben-day dots' || label === 'offset dots') {
      let dots = '';
      for (let y = -step; y < 64 + step; y += step) for (let x = -step; x < 64 + step; x += step) dots += `<circle cx="${round(x + (Math.floor(y / step) % 2 ? step / 2 : 0))}" cy="${y}" r="${round(radius)}" fill="${color}"/>`;
      return `<g transform="rotate(15 32 32)">${dots}</g>`;
    }
    if (label === 'halftone' || label === 'classic halftone' || label === 'fine halftone' || label === 'dense halftone' || label === 'micro dots' || label === 'microdots' || label === 'circular dots') {
      const spacing = label === 'microdots' ? Math.max(3, gap * .5) : label === 'fine halftone' ? Math.max(3, gap * .7) : label === 'dense halftone' ? Math.max(3, gap * .78) : label === 'micro dots' ? Math.max(3, gap * .6) : gap;
      const dotRadius = label === 'microdots' || label === 'micro dots' ? Math.max(.35, radius * .55) : label === 'circular dots' ? Math.max(.7, radius * .82) : radius;
      let dots = '';
      for (let y = -spacing; y < 64 + spacing; y += spacing) for (let x = -spacing; x < 64 + spacing; x += spacing) dots += `<circle cx="${round(x + (Math.round(y / spacing) % 2 ? spacing / 2 : 0))}" cy="${y}" r="${round(dotRadius)}" fill="${color}"/>`;
      const angle = label === 'classic halftone' || label === 'fine halftone' ? 45 : label === 'dense halftone' ? 30 : 0;
      return angle ? `<g transform="rotate(${angle} 32 32)">${dots}</g>` : dots;
    }
    if (label === 'diamond dots') return `<g transform="rotate(45 32 32)">${Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => `<rect x="${round(col * step)}" y="${round(row * step)}" width="${round(radius * 1.5)}" height="${round(radius * 1.5)}" fill="${color}"/>`).join('')).join('')}</g>`;
    if (label === 'roundel' || label === 'pin dots' || label === 'circular dots' || label === 'micro dots' || label === 'microdots' || label === 'halftone' || label.includes('halftone') || label === 'screen print' || label === 'polka dots') {
      const offset = label === 'roundel' || label === 'pin dots' ? 0 : step / 2;
      let out = '';
      for (let y = -step; y < 64 + step; y += step) for (let x = -step; x < 64 + step; x += step) {
        const stagger = label === 'roundel' || label === 'pin dots' ? 0 : Math.round(y / step) % 2 ? offset : 0;
        const r = label === 'pin dots' ? Math.max(.45, radius * .4) : label === 'polka dots' ? Math.max(radius, 2.5) : radius;
        out += `<circle cx="${round(x + stagger)}" cy="${y}" r="${round(r)}" fill="${color}"/>`;
      }
      return out;
    }
    let out = '';
    for (let y = -step; y < 64 + step; y += step) for (let x = -step; x < 64 + step; x += step) out += `<circle cx="${round(x + (Math.round(y / step) % 2 ? step / 2 : 0))}" cy="${y}" r="${round(radius)}" fill="${color}"/>`;
    return out;
  }
  if (preset.family === 'lines') {
    const label = preset.label.toLowerCase();
    if (label === 'moiré lines') return `${lines(Math.max(3, gap * .72), 4)}<g transform="translate(0 3)">${lines(Math.max(3, gap * .72), -4)}</g>`;
    if (label === 'scratched surface') {
      const random = seeded(seed);
      let scratches = '';
      for (let i = 0; i < Math.round(18 + d * .6); i++) {
        const x = random() * 64, y = random() * 64, length = 3 + random() * 24;
        scratches += `<path d="M${round(x)} ${round(y)}l${round(length)} ${round((random() - .5) * 3)}" stroke="${color}" stroke-width="${round(.3 + random() * 1.1)}" opacity="${round(.25 + random() * .7)}"/>`;
      }
      return scratches;
    }
    if (label === 'worn ink' || label === 'faded paint' || label === 'weathered surface' || label === 'cracked ink') {
      if (label === 'cracked ink') return voronoiMotif(color, seed, Math.round(12 + d / 5), false, Math.max(.5, stroke * .7));
      const random = seeded(seed);
      const angle = label === 'worn ink' ? 0 : label === 'faded paint' ? 90 : 38;
      let streaks = '';
      for (let i = 0; i < 24; i++) {
        const y = random() * 64, x = random() * 64, len = 5 + random() * 30;
        streaks += `<path d="M${round(x)} ${round(y)}h${round(len)}" stroke="${color}" stroke-width="${round(.4 + random() * stroke)}" opacity="${round(label === 'faded paint' ? .12 + random() * .3 : .25 + random() * .65)}"/>`;
      }
      return `<g transform="rotate(${angle} 32 32)">${streaks}</g>`;
    }
    if (label === 'scanlines') {
      let scanlines = '';
      for (let y = 1; y < 64; y += Math.max(3, gap * .42)) scanlines += `<path d="M0 ${round(y)}H64" stroke="${color}" stroke-width="${round(Math.max(.5, stroke * .6))}"/>`;
      return scanlines;
    }
    if (label === 'horizontal stripes' || label === 'horizontal lines' || label === 'fine horizontal' || label === 'wide horizontal') return lines(label === 'fine horizontal' ? Math.max(3, gap * .55) : label === 'wide horizontal' ? gap * 1.6 : gap, 0);
    if (label === 'vertical stripes' || label === 'vertical lines' || label === 'fine vertical' || label === 'wide vertical') return lines(label === 'fine vertical' ? Math.max(3, gap * .55) : label === 'wide vertical' ? gap * 1.6 : gap, 90);
    if (label === 'diagonal lines' || label === 'fine diagonal' || label === 'diagonal hatching') return lines(label === 'fine diagonal' ? Math.max(3, gap * .55) : gap, 45);
    const angle = v === 14 ? 30 : v < 3 || v === 8 || v === 9 || v === 10 || v === 11 || v === 12 ? 0 : v < 6 ? 90 : v === 13 ? -45 : 45;
    const dash = v === 4 || v === 9 ? `${round(gap / 2)} ${round(gap / 3)}` : v === 11 ? `${round(gap * 1.4)} ${round(gap / 2)}` : v === 12 ? `${round(gap / 4)} ${round(gap / 2)}` : '';
    return lines(v === 10 ? Math.max(3, gap / 2) : gap, angle, dash);
  }
  if (preset.family === 'crosshatch') {
    const label = preset.label.toLowerCase();
    if (label === 'etching' || label === 'engraving' || label === 'copperplate') {
      const directions = label === 'etching' ? [45, -45] : label === 'engraving' ? [30, -30, 90] : [35, -35, 0, 90];
      return directions.map((angle, i) => `<g opacity="${round(1 - i * .16)}">${lines(Math.max(3, gap * (1 + i * .42)), angle)}</g>`).join('');
    }
    if (label === 'sketch marks') {
      const random = seeded(seed);
      let marks = '';
      for (let i = 0; i < 30; i++) {
        const x = random() * 64, y = random() * 64, len = 4 + random() * 14;
        marks += `<path d="M${round(x)} ${round(y)}l${round(len)} ${round((random() - .5) * 4)}" stroke="${color}" stroke-width="${round(.45 + random() * stroke)}"/>`;
      }
      return marks;
    }
    if (label === 'basket hatch' || label === 'waffle hatch' || label === 'lattice') {
      const step = label === 'waffle hatch' ? Math.max(4, gap * .7) : gap;
      let paths = '';
      for (let x = 0; x <= 64; x += step) for (let y = 0; y < 64; y += step) paths += `<path d="M${round(x)} ${round(y)}v${round(step * .48)}"/>`;
      for (let y = 0; y <= 64; y += step) for (let x = 0; x < 64; x += step) paths += `<path d="M${round(x)} ${round(y)}h${round(step * .48)}"/>`;
      return `<g fill="none" stroke="${color}" stroke-width="${round(stroke)}">${paths}</g>`;
    }
    const angle = v >= 12 ? 30 + (v - 12) * 10 : 45;
    return `${lines(gap, angle)}${lines(gap, v >= 12 ? angle - 90 : -45)}`;
  }
  if (preset.family === 'grid') {
    if (preset.label === 'Hexagonal Grid') return `<g fill="none" stroke="${color}" stroke-width="${round(stroke)}"><path d="M16 0L32 9.24V27.7L16 36.95L0 27.7V9.24ZM48 36.95L64 46.2V64.65L48 73.9L32 64.65V46.2Z"/></g>`;
    if (preset.label === 'Triangular Pattern') return `<g fill="none" stroke="${color}" stroke-width="${round(stroke)}"><path d="M0 64L32 8L64 64ZM-32 8L0 64L32 8L64 64L96 8"/></g>`;
    if (preset.label === 'Isometric Grid') return `${lines(gap, 30)}${lines(gap, -30)}${lines(gap, 90)}`;
    if (v === 6) return `${lines(gap, 30)}${lines(gap, -30)}`;
    if (v === 7) return `<path d="M16 1L31 9V25L16 33L1 25V9ZM48 33L63 41V57L48 65L33 57V41Z" transform="translate(0 -1)" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    if (v === 8) {
      let dots = '';
      for (let y = 0; y < 64; y += gap) for (let x = 0; x < 64; x += gap) dots += `<circle cx="${round(x + gap / 2)}" cy="${round(y + gap / 2)}" r="${round(stroke)}" fill="${color}"/>`;
      return dots;
    }
    if (v === 9 || v === 3 || v === 5) {
      let grid = '';
      const minor = Math.max(3, gap / (v === 3 ? 4 : 2));
      for (let x = 0; x <= 64; x += minor) grid += `<path d="M${round(x)} 0V64" stroke="${color}" stroke-width="${round(x % (minor * 4) < 0.1 ? stroke : stroke * 0.45)}"/>`;
      for (let y = 0; y <= 64; y += minor) grid += `<path d="M0 ${round(y)}H64" stroke="${color}" stroke-width="${round(y % (minor * 4) < 0.1 ? stroke : stroke * 0.45)}"/>`;
      return grid;
    }
    if (v === 10) return `<path d="M${round(gap / 2)} 0H${round(64 - gap / 2)}Q64 0 64 ${round(gap / 2)}V${round(64 - gap / 2)}Q64 64 ${round(64 - gap / 2)} 64H${round(gap / 2)}Q0 64 0 ${round(64 - gap / 2)}V${round(gap / 2)}Q0 0 ${round(gap / 2)} 0Z" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    if (v === 11) {
      let paths = '';
      for (let x = 0; x <= 64; x += gap) paths += `<path d="M32 32L${round(x)} 0 M32 32L${round(x)} 64"/>`;
      for (let y = 0; y <= 64; y += gap) paths += `<path d="M32 32L0 ${round(y)} M32 32L64 ${round(y)}"/>`;
      return `<g fill="none" stroke="${color}" stroke-width="${round(stroke)}">${paths}</g>`;
    }
    if (v === 12) return `${lines(gap, 0)}${lines(gap, 90)}`.replace(/transform="rotate\(90 32 32\)"/g, `transform="translate(${round(gap / 2)} 0) rotate(90 32 32)"`);
    if (v === 14) {
      let nodes = '';
      for (let x = 0; x <= 64; x += gap) for (let y = 0; y <= 64; y += gap) {
        nodes += `<circle cx="${round(x)}" cy="${round(y)}" r="${round(stroke * 1.5)}" fill="${color}"/>`;
      }
      return `${lines(gap, 0)}${lines(gap, 90)}${nodes}`;
    }
    const step = v === 13 ? Math.max(4, gap / 2) : gap;
    let grid = '';
    for (let x = 0; x <= 64; x += step) grid += `<path d="M${round(x)} 0V64"/>`;
    for (let y = 0; y <= 64; y += step) grid += `<path d="M0 ${round(y)}H64"/>`;
    return `<g fill="none" stroke="${color}" stroke-width="${round(stroke)}"${v === 4 ? ` stroke-dasharray="${round(gap / 2)} ${round(gap / 3)}"` : ''}>${grid}</g>`;
  }
  if (preset.family === 'waves') {
    const label = preset.label.toLowerCase();
    if (label === 'wood grain' || label === 'marble' || label === 'marbling') {
      const random = seeded(seed);
      let bands = '';
      const count = label === 'wood grain' ? 11 : 8;
      for (let i = 0; i < count; i++) {
        const x = i * (64 / (count - 1)), wobble = (random() - .5) * (label === 'wood grain' ? 10 : 5);
        if (label === 'wood grain') bands += `<path d="M${round(x)} -4C${round(x + wobble)} 12 ${round(x - wobble)} 24 ${round(x)} 34S${round(x + wobble)} 54 ${round(x)} 68" fill="none" stroke="${color}" stroke-width="${round(stroke * (i % 3 === 0 ? 1.4 : .65))}" opacity="${i % 3 === 0 ? '.85' : '.5'}"/>`;
        else bands += `<path d="M-4 ${round(i * 9)}C${round(12 + wobble)} ${round(i * 9 - 8)} ${round(42 - wobble)} ${round(i * 9 + 8)} 68 ${round(i * 9 - 2)}" fill="none" stroke="${color}" stroke-width="${round(stroke * (i % 3 === 0 ? 1.5 : .7))}" opacity="${i % 3 === 0 ? '.8' : '.45'}"/>`;
      }
      if (label === 'wood grain') {
        const cx = 18 + random() * 30, cy = 15 + random() * 34;
        bands += [3, 7, 12, 18].map(r => `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(r)}" ry="${round(r * .62)}" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`).join('');
      }
      return bands;
    }
    if (label === 'dried mud cracks' || label === 'cracked ink') return voronoiMotif(color, seed, Math.round(9 + d / 4), false, Math.max(.6, stroke));
    if (label === 'topographic' || label === 'topographic contours') {
      const random = seeded(seed), cx = 18 + random() * 28, cy = 18 + random() * 28;
      const rings = label === 'topographic' ? 6 : 9;
      const paths = Array.from({ length: rings }, (_, ring) => {
        const rx = 5 + ring * (label === 'topographic' ? 6 : 4.5), ry = 4 + ring * (label === 'topographic' ? 4 : 5);
        let path = '';
        for (let i = 0; i <= 48; i++) {
          const angle = (i / 48) * Math.PI * 2, wobble = 1 + (label === 'topographic' ? .06 : .11) * Math.sin(angle * (label === 'topographic' ? 5 : 7) + seed + ring);
          const x = cx + Math.cos(angle) * rx * wobble, y = cy + Math.sin(angle) * ry * wobble;
          path += `${i === 0 ? 'M' : 'L'}${round(x)} ${round(y)}`;
        }
        return `<path d="${path}Z" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
      }).join('');
      return paths;
    }
    if (label === 'contour lines' || label === 'tide lines') {
      const random = seeded(seed);
      let contours = '';
      for (let i = 0; i < 10; i++) {
        const y = i * 8 + 3, phase = random() * Math.PI * 2, amplitude = label === 'tide lines' ? 3 : 6;
        let path = `M-2 ${round(y + Math.sin(phase) * amplitude)}`;
        for (let x = 0; x <= 68; x += 4) path += `L${x} ${round(y + Math.sin(x / 8 + phase) * amplitude + Math.sin(x / 17 + phase * 1.3) * amplitude * .6)}`;
        contours += `<path d="${path}" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
      }
      return contours;
    }
    if (label === 'water ripples' || label === 'ripple field') {
      const random = seeded(seed), cx = 20 + random() * 24, cy = 20 + random() * 24;
      return `<g fill="none" stroke="${color}" stroke-width="${round(stroke)}">${[5, 10, 15, 21, 28, 36, 45].map((r, i) => `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${r}" ry="${round(r * (.58 + random() * .5))}" transform="rotate(${round(i * 7 - 20)} ${round(cx)} ${round(cy)})"/>`).join('')}</g>`;
    }
    if (label === 'tree bark') {
      const random = seeded(seed);
      let bark = '';
      for (let i = 0; i < 11; i++) {
        const x = i * 6 + random() * 3, width = .6 + random() * stroke;
        bark += `<path d="M${round(x)} -4q${round((random() - .5) * 6)} 13 0 24t0 24t0 24" fill="none" stroke="${color}" stroke-width="${round(width)}"/>`;
      }
      return bark;
    }
    if (label === 'cloud texture' || label === 'smoke' || label === 'fog' || label === 'turbulence' || label === 'fractal clouds' || label === 'plasma texture') {
      const frequency = label === 'fog' ? .018 : label === 'smoke' ? .042 : label === 'cloud texture' ? .055 : label === 'fractal clouds' ? .025 : .04;
      if (label === 'turbulence') return `${noiseMotif(color, seed, .12, 4, 'turbulence', d / 100, 'turbulence-noise')}${lines(Math.max(4, gap), 32, `${round(gap / 2)} ${round(gap / 3)}`)}`;
      return noiseMotif(color, seed, frequency, label === 'fractal clouds' ? 5 : 3, label === 'plasma texture' ? 'turbulence' : 'fractalNoise', label === 'fog' ? d / 160 : d / 100);
    }
    if (label === 'fluid swirls') {
      const random = seeded(seed);
      return Array.from({ length: 7 }, (_, i) => {
        const y = random() * 64, phase = random() * 28;
        return `<path d="M-4 ${round(y)}C${round(12 + phase)} ${round(y - 24)} ${round(40 - phase)} ${round(y + 24)} 68 ${round(y - 8)}" fill="none" stroke="${color}" stroke-width="${round(stroke * (i % 3 === 0 ? 2 : .8))}" opacity="${round(.25 + random() * .6)}"/>`;
      }).join('');
    }
    if (label === 'watercolor bleed' || label === 'ink in water' || label === 'organic blobs') {
      const random = seeded(seed);
      let blobs = '';
      for (let i = 0; i < 9; i++) {
        const x = random() * 64, y = random() * 64, rx = 4 + random() * (label === 'watercolor bleed' ? 14 : 10), ry = 3 + random() * 12;
        blobs += `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(rx)}" ry="${round(ry)}" transform="rotate(${round(random() * 180)} ${round(x)} ${round(y)})" fill="${color}" opacity="${round(.12 + random() * (label === 'watercolor bleed' ? .3 : .55))}"/>`;
      }
      return `${noiseMotif(color, seed, .035, 2, 'fractalNoise', .45)}${blobs}`;
    }
    if (label === 'interference' || label === 'moire waves') return `${lines(Math.max(3, gap * .72), 6)}<g transform="translate(0 2)">${lines(Math.max(3, gap * .72), -6)}</g>`;
    const amp = Math.max(1, 1 + v * 0.65), period = Math.max(8, gap * 1.5);
    let out = '';
    for (let y = -period; y < 64 + period; y += period / 2) {
      out += `<path d="M-64 ${round(y)} Q${round(-64 + period / 4)} ${round(y - amp)} ${round(-64 + period / 2)} ${round(y)} T${round(-64 + period)} ${round(y)} T${round(-64 + period * 1.5)} ${round(y)} T${round(-64 + period * 2)} ${round(y)}" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    }
    return out;
  }
  if (preset.family === 'paper') {
    const label = preset.label.toLowerCase();
    const fiber = Math.max(3, gap / 2);
    if (label === 'newsprint') {
      let dots = '';
      const step = Math.max(3, gap * .65);
      for (let y = 0; y < 64; y += step) for (let x = 0; x < 64; x += step) dots += `<circle cx="${round(x + step / 2)}" cy="${round(y + step / 2)}" r="${round(Math.max(.5, step * .13))}" fill="${color}"/>`;
      return `<g transform="rotate(15 32 32)">${dots}</g>`;
    }
    if (label === 'crumpled paper') return noiseMotif(color, seed, .06, 4, 'fractalNoise', .75);
    if (label === 'watercolor paper' || label === 'cotton paper' || label === 'rice paper' || label === 'cardstock') {
      const random = seeded(seed);
      let fibers = '';
      const count = label === 'cardstock' ? 8 : label === 'rice paper' ? 34 : 24;
      for (let i = 0; i < count; i++) {
        const x = random() * 64, y = random() * 64, length = label === 'rice paper' ? 2 + random() * 10 : 4 + random() * 18;
        fibers += `<path d="M${round(x)} ${round(y)}l${round(length)} ${round((random() - .5) * 3)}" stroke="${color}" stroke-width="${round(label === 'cardstock' ? .8 : .35 + random() * .5)}" opacity="${round(.25 + random() * .55)}"/>`;
      }
      return label === 'watercolor paper' ? `${noiseMotif(color, seed, .04, 2, 'fractalNoise', .25)}${fibers}` : fibers;
    }
    let fibers = '';
    const random = seeded(seed);
    const count = label === 'handmade paper' || label === 'recycled paper' ? 34 : label === 'parchment' ? 10 : 18;
    for (let i = 0; i < count; i++) {
      const x = random() * 64, y = random() * 64, length = fiber * (.4 + random() * 1.8);
      fibers += `<path d="M${round(x)} ${round(y)}q${round(length / 3)} ${round((random() - .5) * 3)} ${round(length)} ${round((random() - .5) * 4)}" stroke="${color}" stroke-width="${round(Math.max(.35, stroke * (label === 'parchment' ? .65 : .35)))}" opacity="${round(.35 + random() * .55)}"/>`;
    }
    if (label === 'torn paper edges') return `<path d="M0 8L5 6L9 9L15 5L20 8L26 4L32 7L38 3L44 8L50 4L56 9L64 5V64H0Z" fill="${color}" opacity=".45"/>${fibers}`;
    if (label === 'parchment') return `${noiseMotif(color, seed, .025, 3, 'fractalNoise', .3)}${fibers}`;
    return `<g fill="none">${fibers}</g>`;
  }
  if (preset.family === 'material') {
    const label = preset.label.toLowerCase(), random = seeded(seed);
    if (label === 'granite' || label === 'concrete' || label === 'stone speckles') {
      let specks = '';
      const count = label === 'granite' ? 64 : label === 'concrete' ? 38 : 52;
      for (let i = 0; i < count; i++) {
        const r = label === 'granite' ? .4 + random() * 1.35 : .25 + random() * .9;
        specks += `<circle cx="${round(random() * 64)}" cy="${round(random() * 64)}" r="${round(r)}" fill="${color}" opacity="${round(.35 + random() * .65)}"/>`;
      }
      return label === 'concrete' ? `${noiseMotif(color, seed, .045, 2, 'fractalNoise', .25, 'concrete-noise')}${specks}` : specks;
    }
    if (label === 'limestone' || label === 'sandstone') {
      let strata = '';
      for (let i = 0; i < 9; i++) {
        const y = i * 8 + random() * 4, dash = label === 'sandstone' && i % 2 === 0 ? ` stroke-dasharray="${round(gap / 3)} ${round(gap / 4)}"` : '';
        strata += `<path d="M-2 ${round(y)}Q18 ${round(y - 3 + random() * 6)} 34 ${round(y)}T66 ${round(y + (random() - .5) * 5)}" fill="none" stroke="${color}" stroke-width="${round(stroke * (i % 3 === 0 ? 1.45 : .7))}"${dash}/>`;
      }
      return label === 'sandstone' ? `${strata}${noiseMotif(color, seed, .18, 1, 'turbulence', .2, 'sandstone-grain')}` : strata;
    }
    if (label === 'clay') return `${voronoiMotif(color, seed, Math.round(11 + d / 8), false, Math.max(.45, stroke * .55))}${noiseMotif(color, seed, .035, 2, 'fractalNoise', .35, 'clay-grain')}`;
    return noiseMotif(color, seed, .035, 2, 'fractalNoise', .55, 'material-noise');
  }
  if (preset.family === 'organic') {
    const plasma = preset.label === 'Plasma Texture';
    return noiseMotif(color, seed, plasma ? .035 : .04, 3, plasma ? 'turbulence' : 'fractalNoise', d / 100, 'organic-noise');
  }
  if (preset.family === 'geometric') {
    const label = preset.label.toLowerCase(), random = seeded(seed);
    const step = Math.max(4, gap);
    if (label === 'voronoi cells') return voronoiMotif(color, seed, Math.round(9 + d / 5), false, stroke);
    if (label === 'organic blobs') {
      let blobs = '';
      for (let i = 0; i < 7; i++) {
        const cx = 4 + random() * 56, cy = 4 + random() * 56, rx = 5 + random() * 10, ry = 4 + random() * 9;
        blobs += `<path d="M${round(cx - rx)} ${round(cy)}C${round(cx - rx)} ${round(cy - ry)} ${round(cx - rx / 2)} ${round(cy - ry)} ${round(cx)} ${round(cy - ry / 2)}S${round(cx + rx)} ${round(cy - ry / 2)} ${round(cx + rx)} ${round(cy)}S${round(cx + rx / 2)} ${round(cy + ry)} ${round(cx)} ${round(cy + ry / 2)}S${round(cx - rx)} ${round(cy + ry / 2)} ${round(cx - rx)} ${round(cy)}Z" fill="${color}"/>`;
      }
      return blobs;
    }
    if (label === 'honeycomb' || label === 'hexagonal grid') {
      const hex = `<path d="M16 1L31 9.5V26.5L16 35L1 26.5V9.5ZM48 29L63 37.5V54.5L48 63L33 54.5V37.5Z" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
      return hex;
    }
    if (label === 'chevron') return `<path d="M-16 4L0 20L16 4L32 20L48 4L64 20L80 4 M-16 36L0 52L16 36L32 52L48 36L64 52L80 36" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    if (label === 'scales') return `<g fill="none" stroke="${color}" stroke-width="${round(stroke)}">${Array.from({ length: 5 }, (_, row) => Array.from({ length: 3 }, (_, col) => { const x = col * 32 - (row % 2 ? 16 : 0), y = row * 16 - 4; return `<path d="M${x} ${y + 16}A16 16 0 0 1 ${x + 32} ${y + 16}"/>`; }).join('')).join('')}</g>`;
    if (label === 'triangles' || label === 'triangular pattern') return `<path d="M0 64L32 8L64 64ZM-32 8L0 64L32 8L64 64L96 8 M0 8L32 64L64 8" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    if (label === 'pixel blocks') {
      let pixels = '';
      for (let y = 0; y < 64; y += step) for (let x = 0; x < 64; x += step) if (random() > .4) pixels += `<rect x="${x}" y="${y}" width="${round(step * (.45 + random() * .55))}" height="${round(step * (.45 + random() * .55))}" fill="${color}"/>`;
      return pixels;
    }
    if (label === 'tessellation') return `<path d="M0 0L32 16L64 0 M0 32L32 16L64 32L32 48Z M0 64L32 48L64 64 M0 0V64 M64 0V64" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    if (label === 'isometric cubes') return `<path d="M32 0L56 14L32 28L8 14ZM8 14V42L32 56V28 M56 14V42L32 56 M64 38L88 52L64 66L40 52ZM40 52V80M88 52V80L64 94L40 80" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    if (label === 'zigzag') return `<path d="M-16 16L0 0L16 16L32 0L48 16L64 0L80 16 M-16 48L0 32L16 48L32 32L48 48L64 32L80 48" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    if (label === 'facet tiles') return `<path d="M0 0L32 0L18 32L0 20ZM32 0L64 0L64 20L18 32ZM0 20L18 32L0 64ZM18 32L64 20L40 64L0 64Z" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    if (v === 0 || v === 1 || v === 7) {
      const cell = v === 1 ? 8 : v === 7 ? 6 : 16;
      let squares = '';
      for (let y = 0; y < 64; y += cell) for (let x = 0; x < 64; x += cell) if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0) squares += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${color}"/>`;
      return squares;
    }
    if (v === 2 || v === 5 || v === 9 || v === 14) {
      const shape = v === 2
        ? `M32 0L64 32L32 64L0 32Z M32 0V64 M0 32H64`
        : v === 5
          ? `M0 32Q16 8 32 32T64 32 M0 0V32 M32 0V32 M64 0V32`
          : v === 9
            ? `M0 0L32 32L64 0 M0 64L32 32L64 64 M0 0V64 M64 0V64`
            : `M0 0L32 0L0 32Z M32 0L64 0L64 32Z M0 32L32 32L0 64Z M32 32L64 32L64 64Z`;
      return `<path d="${shape}" fill="${v === 14 ? color : 'none'}" stroke="${color}" stroke-width="${round(stroke)}"/>`;
    }
    if (v === 3 || v === 8 || v === 13) {
      const angle = v === 3 ? 30 : v === 8 ? 30 : 22;
      return `${lines(step, angle)}${v === 3 ? lines(step, -30) : ''}`;
    }
    if (v === 4 || v === 10) {
      const hex = `<path d="M16 1L31 9V25L16 33L1 25V9ZM48 33L63 41V57L48 65L33 57V41Z" transform="translate(0 -1)" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
      return v === 10 ? `${hex}${lines(step, 90)}${lines(step, 0)}` : hex;
    }
    if (v === 6 || v === 11) {
      const rnd = (n: number) => (Math.sin((seed + 1) * n * 12.9898) * 43758.5453) % 1;
      let marks = '';
      for (let i = 0; i < 22; i++) {
        const x = Math.abs(rnd(i + 1)) * 64, y = Math.abs(rnd(i + 31)) * 64, radius = v === 11 ? 0.8 + Math.abs(rnd(i + 61)) * 2 : 1.5;
        marks += v === 11
          ? `<path d="M${round(x)} ${round(y - radius)}L${round(x + radius * 0.45)} ${round(y - radius * 0.45)}L${round(x + radius)} ${round(y)}L${round(x + radius * 0.45)} ${round(y + radius * 0.45)}L${round(x)} ${round(y + radius)}L${round(x - radius * 0.45)} ${round(y + radius * 0.45)}L${round(x - radius)} ${round(y)}L${round(x - radius * 0.45)} ${round(y - radius * 0.45)}Z" fill="${color}"/>`
          : `<circle cx="${round(x)}" cy="${round(y)}" r="${round(radius)}" fill="${color}"/>`;
      }
      return marks;
    }
    if (v === 12) {
      let mosaic = '';
      for (let y = 0; y < 64; y += step) for (let x = 0; x < 64; x += step) {
        const pad = (Math.floor(x / step) + Math.floor(y / step)) % 2 ? stroke : 0;
        mosaic += `<rect x="${round(x + pad)}" y="${round(y + pad)}" width="${round(step - pad * 2)}" height="${round(step - pad * 2)}" fill="${color}" opacity="${((x + y) / 128 * 0.5 + 0.3).toFixed(2)}"/>`;
      }
      return mosaic;
    }

    return `<path d="M-64 16L0 0L64 16L128 0 M-64 48L0 32L64 48L128 32" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
  }
  if (preset.family === 'woven') {
    const label = preset.label.toLowerCase(), random = seeded(seed);
    const step = Math.max(3, gap * (label === 'burlap' || label === 'jute' ? 1.4 : label === 'micro grid' ? .5 : 1));
    if (label === 'paper fibers') {
      let fibers = '';
      for (let i = 0; i < 35; i++) {
        const x = random() * 64, y = random() * 64, length = 2 + random() * 14;
        fibers += `<path d="M${round(x)} ${round(y)}q${round(length / 2)} ${round((random() - .5) * 2)} ${round(length)} ${round((random() - .5) * 3)}" fill="none" stroke="${color}" stroke-width="${round(.3 + random() * .5)}" opacity="${round(.25 + random() * .55)}"/>`;
      }
      return fibers;
    }
    if (label === 'canvas fabric') return `<g transform="rotate(-45 32 32)">${lines(Math.max(3, step * .72), 0)}${lines(Math.max(3, step * .72), 90)}</g>`;
    if (label === 'linen') return `<g>${noiseMotif(color, seed, .18, 1, 'turbulence', .2, 'linen-fuzz')}${lines(Math.max(3, step * .65), 0)}${lines(Math.max(3, step * .65), 90)}</g>`;
    if (label === 'cotton weave' || label === 'basket weave') {
      if (label === 'cotton weave') return `${lines(Math.max(3, step * .62), 0)}${lines(Math.max(3, step * .62), 90)}`;
      let weave = '';
      for (let y = 0; y < 64; y += step) for (let x = 0; x < 64; x += step) {
        const over = (Math.round(x / step) + Math.round(y / step)) % 2 === 0;
        weave += `<path d="M${round(x)} ${round(y)}h${round(step)} M${round(x)} ${round(y)}v${round(step)}" stroke="${color}" stroke-width="${round(stroke * (over ? 1.35 : .8))}" opacity="${over ? '.9' : '.55'}"/>`;
      }
      return weave;
    }
    if (label.includes('metal')) {
      const spacing = label === 'brushed metal' ? Math.max(2, step * .35) : Math.max(5, step * 1.2);
      let grain = '';
      for (let y = 0; y < 64; y += spacing) grain += `<path d="M0 ${round(y)}H64" stroke="${color}" stroke-width="${round(label === 'brushed metal' ? .25 + random() * .6 : .4 + random() * .45)}" opacity="${round(.2 + random() * .55)}"/>`;
      return label === 'polished metal' ? `${noiseMotif(color, seed, .025, 1, 'turbulence', .18, 'metal-cloud')}${grain}<ellipse cx="32" cy="32" rx="28" ry="12" fill="none" stroke="${color}" stroke-width="${round(stroke)}" opacity=".7"/>` : grain;
    }
    if (label === 'herringbone' || label === 'herringbone weave') {
      let paths = '';
      for (let y = -step; y < 64 + step; y += step) paths += `<path d="M-16 ${round(y)}l${round(step)} ${round(step)}h${round(step)}l${round(-step)} ${round(-step)}h${round(-step)}l${round(step)} ${round(-step)}h${round(step)}" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
      return paths;
    }
    if (label === 'knit stitch' || label === 'knitted fabric' || label === 'wool' || label === 'velvet' || label === 'silk' || label === 'silk weave') {
      let stitches = '';
      const rows = label === 'velvet' ? Math.max(4, step * .7) : step;
      for (let y = -rows; y < 64 + rows; y += rows) for (let x = -step; x < 64 + step; x += step) {
        if (label === 'knit stitch' || label === 'knitted fabric' || label === 'wool') stitches += `<path d="M${round(x)} ${round(y + rows)}C${round(x - step * .25)} ${round(y + rows * .25)} ${round(x + step * 1.25)} ${round(y + rows * .25)} ${round(x + step)} ${round(y + rows)}" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>`;
        else if (label === 'velvet') stitches += `<path d="M${round(x)} ${round(y)}v${round(rows * .7)}" stroke="${color}" stroke-width="${round(stroke)}" opacity=".6"/>`;
        else stitches += `<path d="M${round(x)} ${round(y)}l${round(step)} ${round(rows)}" stroke="${color}" stroke-width="${round(stroke)}" opacity=".55"/>`;
      }
      return stitches;
    }
    if (label === 'leather grain' || label === 'suede' || label === 'rubber' || label === 'felt grain' || label === 'grunge' || label === 'vintage print' || label === 'rust' || label === 'oxidation' || label === 'peeling paint' || label === 'weathered surface' || label === 'faded paint') {
      let marks = '';
      const count = label === 'rubber' ? 68 : label === 'rust' ? 68 : label === 'oxidation' ? 34 : label === 'leather grain' ? 28 : label === 'peeling paint' ? 20 : label === 'faded paint' ? 30 : label === 'weathered surface' ? 52 : label === 'vintage print' ? 36 : label === 'grunge' ? 58 : label === 'felt grain' ? 100 : 42;
      for (let i = 0; i < count; i++) {
        const x = random() * 64, y = random() * 64, rx = .4 + random() * (label === 'peeling paint' ? 4 : label === 'faded paint' ? 6 : 1.8), ry = .3 + random() * (label === 'leather grain' ? .8 : label === 'faded paint' ? .5 : 1.8);
        if (label === 'leather grain') marks += `<path d="M${round(x)} ${round(y)}q${round(rx)} ${round(-ry)} ${round(rx * 2)} 0" fill="none" stroke="${color}" stroke-width="${round(stroke)}" opacity=".7"/>`;
        else if (label === 'peeling paint' || label === 'weathered surface') marks += `<path d="M${round(x)} ${round(y)}l${round(rx)} ${round(-ry)}l${round(rx * .7)} ${round(ry * .8)}Z" fill="${color}" opacity="${round(.2 + random() * .65)}"/>`;
        else if (label === 'faded paint' || label === 'vintage print') marks += `<path d="M${round(x)} ${round(y)}h${round(rx * (label === 'vintage print' ? 2 : 4))}" stroke="${color}" stroke-width="${round(.35 + random() * stroke)}" opacity="${round(.15 + random() * .4)}"/>`;
        else if (label === 'felt grain') marks += `<path d="M${round(x)} ${round(y)}l${round((random() - .5) * 2)} ${round(1 + random() * 3)}" stroke="${color}" stroke-width="${round(.25 + random() * .5)}" opacity="${round(.2 + random() * .45)}"/>`;
        else marks += `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(rx)}" ry="${round(ry)}" fill="${color}" opacity="${round(.25 + random() * .65)}"/>`;
      }
      if (label === 'leather grain' || label === 'suede') return `${noiseMotif(color, seed, .07, 2, 'fractalNoise', .3, 'leather-noise')}${marks}`;
      if (label === 'rust') return `${noiseMotif(color, seed, .065, 4, 'fractalNoise', .55, 'rust-noise')}${marks}`;
      if (label === 'oxidation') return `${noiseMotif(color, seed, .022, 2, 'turbulence', .32, 'oxidation-noise')}${marks}`;
      if (label === 'felt grain') return `${noiseMotif(color, seed, .24, 2, 'turbulence', .25, 'felt-fuzz')}${marks}`;
      if (label === 'weathered surface') return `${voronoiMotif(color, seed, 13, false, stroke * .55)}${marks}`;
      if (label === 'vintage print') return `${noiseMotif(color, seed, .14, 1, 'turbulence', .2, 'print-distress')}${marks}`;
      if (label === 'grunge') return `${noiseMotif(color, seed, .055, 4, 'fractalNoise', .5, 'grunge-noise')}${marks}`;
      return marks;
    }
    if (label === 'frosted glass' || label === 'ceramic glaze' || label === 'crushed foil' || label === 'embossed surface' || label === 'debossed surface') {
      if (label === 'crushed foil') return `<path d="M0 0L22 8L12 28L0 20ZM22 8L50 0L40 24L12 28ZM50 0L64 12L40 24ZM0 20L12 28L18 60L0 64ZM12 28L40 24L54 50L18 60ZM40 24L64 12L64 48L54 50ZM18 60L54 50L64 64L0 64Z" fill="none" stroke="${color}" stroke-width="${round(stroke * 1.4)}"/>`;
      if (label === 'embossed surface' || label === 'debossed surface') return `<g fill="none" stroke="${color}" stroke-width="${round(stroke)}" opacity=".8"><path d="M4 4H60V60H4Z M8 8H56V56H8Z M12 12H52V52H12Z" transform="${label === 'embossed surface' ? 'translate(-1 -1)' : 'translate(1 1)'}"/></g>`;
      return `${noiseMotif(color, seed, label === 'frosted glass' ? .21 : .06, 2, 'fractalNoise', label === 'frosted glass' ? .45 : .35, 'surface-noise')}${label === 'ceramic glaze' ? `<circle cx="${round(random() * 64)}" cy="${round(random() * 64)}" r="${round(2 + random() * 4)}" fill="none" stroke="${color}" stroke-width="${round(stroke)}"/>` : ''}`;
    }
    if (label === 'denim' || label === 'denim weave' || label === 'twill') return `<g transform="rotate(35 32 32)"><path d="M0 0V64 M${round(step)} 0V64 M0 ${round(step)}H64 M0 ${round(step * 2)}H64" stroke="${color}" stroke-width="${round(stroke)}" opacity=".7"/>${noiseMotif(color, seed, .16, 1, 'turbulence', .2, 'denim-fleck')}</g>`;
    const fiberGap = Math.max(3, gap / (v % 2 ? 2 : 1));
    let horizontal = '', vertical = '';
    for (let p = -fiberGap; p <= 64 + fiberGap; p += fiberGap) {
      horizontal += `<path d="M-2 ${round(p)}H66" stroke="${color}" stroke-width="${round(stroke)}" opacity="${round(.42 + random() * .38)}"/>`;
      vertical += `<path d="M${round(p)} -2V66" stroke="${color}" stroke-width="${round(stroke)}" opacity="${round(.42 + random() * .38)}"/>`;
    }
    if (label === 'burlap' || label === 'jute') return `<g fill="none">${horizontal}${vertical}<path d="M0 0H64V64H0Z" stroke="${color}" stroke-width="${round(stroke)}" stroke-dasharray="1 3"/></g>`;
    if (label === 'carbon fiber') return `<g transform="rotate(45 32 32)">${horizontal}${vertical}</g>`;
    return `<g fill="none">${horizontal}${vertical}</g>`;
  }
  const fiberGap = Math.max(3, gap / (v % 2 ? 2 : 1));
  const weave = `<path d="M0 ${round(fiberGap)}H64 M0 ${round(fiberGap * 3)}H64 M0 ${round(fiberGap * 5)}H64" stroke="${color}" stroke-width="${round(stroke)}" opacity=".7"/><path d="M${round(fiberGap)} 0V64 M${round(fiberGap * 3)} 0V64 M${round(fiberGap * 5)} 0V64" stroke="${color}" stroke-width="${round(stroke)}" opacity=".45"/>`;
  return weave;
}

export function textureTileSvg(texture: TextureData): string {
  const preset = TEXTURES.find(item => item.id === texture.pattern) ?? TEXTURES[0];
  const angle = Number.isFinite(texture.angle) ? texture.angle : 0;
  const content = motif(preset, texture);
  const contrast = Math.max(0, Math.min(3, texture.contrast / 100)), intercept = 0.5 * (1 - contrast);
  const filter = texture.softness > 0 || Math.abs(contrast - 1) > 0.001
    ? `<filter id="appearance" x="-20%" y="-20%" width="140%" height="140%">${texture.softness > 0 ? `<feGaussianBlur stdDeviation="${round(texture.softness)}" result="soft"/>` : ''}${Math.abs(contrast - 1) > 0.001 ? `<feComponentTransfer${texture.softness > 0 ? ' in="soft"' : ''}><feFuncR type="linear" slope="${round(contrast)}" intercept="${round(intercept)}"/><feFuncG type="linear" slope="${round(contrast)}" intercept="${round(intercept)}"/><feFuncB type="linear" slope="${round(contrast)}" intercept="${round(intercept)}"/></feComponentTransfer>` : ''}</filter>`
    : '';
  const base = texture.backgroundEnabled ? `<rect width="64" height="64" fill="${safeColor(texture.backgroundColor)}" opacity="${round(texture.backgroundOpacity / 100)}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs>${filter}</defs><g${filter ? ' filter="url(#appearance)"' : ''}>${base}<g transform="rotate(${round(angle)} 32 32)">${content}</g></g></svg>`;
}

export const textureDataUri = (texture: TextureData) => `url("data:image/svg+xml,${encodeURIComponent(textureTileSvg(texture))}")`;
