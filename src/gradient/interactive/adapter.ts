import { sortedStops, type GradientLayer, type GradientProject } from '../engine/model';
import { bleedOf, radii } from '../engine/geom';
import type { ShaderGeometry, ShaderMeshPoint, ShaderStop } from './types';

interface PaletteGroup {
  layer: GradientLayer;
  stops: ShaderStop[];
}

export interface ShaderPaletteAdapter {
  palette: ShaderStop[];
  notes: string[];
}

export interface ShaderLayerAdapter {
  palette: ShaderStop[];
  geometry: ShaderGeometry;
  meshPoints: ShaderMeshPoint[];
  meshBase: string;
  notes: string[];
}

export function interactionColorsForLayer(palette: ShaderStop[]): string[] {
  const colors = [...new Set(palette.map(stop => stop.color).filter(color => /^#[0-9a-f]{6}$/i.test(color)))];
  if (colors.length <= 5) return colors;
  return Array.from({ length: 5 }, (_, index) => colors[Math.round(index * (colors.length - 1) / 4)]);
}

export function supportsDirectShaderGeometry(layer: GradientLayer): boolean {
  return !layer.repeating && (layer.type === 'linear' || layer.type === 'radial' || layer.type === 'conic');
}

function layerPalette(layer: GradientLayer): ShaderStop[] {
  if (layer.type === 'mesh' && layer.mesh.points.length) {
    return [...layer.mesh.points]
      .sort((a, b) => a.x - b.x)
      .map(point => ({ color: point.color, position: point.x / 100, alpha: point.alpha }));
  }
  if (layer.solidColor !== undefined) {
    return [
      { color: layer.solidColor, position: 0, alpha: 1 },
      { color: layer.solidColor, position: 1, alpha: 1 },
    ];
  }
  if (layer.type === 'noise') return [];
  return sortedStops(layer.stops).map(stop => ({
    color: stop.color,
    position: stop.pos / 100,
    alpha: stop.alpha,
    hard: stop.hard,
    mid: stop.mid,
    curve: stop.curve,
  }));
}

export function gradientLayerToShader(layer: GradientLayer, project: GradientProject): ShaderLayerAdapter {
  let palette = layerPalette(layer);
  const notes: string[] = [];
  const bleed = bleedOf(layer, project.canvas);
  const layerScale = 1 + 2 * bleed;
  if (!palette.length && layer.mesh.base) {
    palette = [
      { color: layer.mesh.base, position: 0, alpha: 1 },
      { color: layer.mesh.base, position: 1, alpha: 1 },
    ];
  }
  if (!palette.length && project.background) {
    palette = [
      { color: project.background, position: 0, alpha: 1 },
      { color: project.background, position: 1, alpha: 1 },
    ];
  }
  if (!palette.length) {
    palette = [
      { color: '#7c5cff', position: 0, alpha: 1 },
      { color: '#22d3ee', position: 1, alpha: 1 },
    ];
    notes.push('This layer has no color stops; the shader is using its fallback palette.');
  }
  if (layer.type === 'curve') notes.push('Curve geometry remains CSS-backed; the shader adds an interactive overlay.');
  if (layer.type === 'noise') notes.push('Noise geometry remains CSS-backed; the shader adds an interactive overlay.');
  if (layer.repeating) notes.push('Repeating gradient geometry remains CSS-backed; the WebGL shader adds effects over the CSS gradient.');
  const meshPoints = layer.type === 'mesh' ? layer.mesh.points.slice(0, 8).map(point => ({
    color: point.color,
    x: point.x,
    y: point.y,
    size: point.size,
    alpha: point.alpha,
  })) : [];
  if (layer.type === 'mesh' && layer.mesh.points.length > 8) {
    notes.push(`Shader rendering supports up to 8 editable mesh points; the layer retains all ${layer.mesh.points.length} points in CSS and exports.`);
  }
  return {
    palette,
    meshPoints,
    meshBase: layer.type === 'mesh' ? layer.mesh.base : '',
    geometry: {
      kind: layer.type,
      angle: layer.angle,
      originX: layer.type === 'radial' || layer.type === 'conic' ? (layer.cx + 100 * bleed) / layerScale : 50,
      originY: layer.type === 'radial' || layer.type === 'conic' ? (layer.cy + 100 * bleed) / layerScale : 50,
      radiusX: layer.type === 'radial'
        ? layer.shape === 'circle'
          ? (radii(layer, project.canvas).rx / (project.canvas.w * layerScale)) * 100
          : layer.rx / layerScale
        : layer.rx,
      radiusY: layer.type === 'radial'
        ? layer.shape === 'circle'
          ? (radii(layer, project.canvas).ry / (project.canvas.h * layerScale)) * 100
          : layer.ry / layerScale
        : layer.ry,
      space: layer.space,
    },
    notes,
  };
}

/** Builds the shader's color ramp while leaving the exact CSS composition as the preview/export source. */
export function gradientProjectToShaderPalette(project: GradientProject): ShaderPaletteAdapter {
  const groups = project.layers
    .filter(layer => layer.visible && layer.opacity > 0)
    .map(layer => ({ layer, stops: layerPalette(layer) }))
    .filter(group => group.stops.length > 0) as PaletteGroup[];
  const flattened = groups.flatMap((group, groupIndex) => group.stops.map(stop => ({
    ...stop,
    position: groups.length === 1 ? stop.position : (groupIndex + stop.position) / groups.length,
  }))).sort((a, b) => a.position - b.position);

  if (!flattened.length && project.background) {
    flattened.push({ color: project.background, position: 0, alpha: 1 });
  }
  if (!flattened.length) {
    flattened.push({ color: '#7c5cff', position: 0, alpha: 1 });
  }
  if (flattened.length === 1) {
    flattened.push({ ...flattened[0], position: 1 });
    flattened[0] = { ...flattened[0], position: 0 };
  }

  const notes = [
    'The shader palette is derived from the same GradientProject layer stops used by the CSS renderer; CSS remains available as a fallback and static export.',
  ];
  if (groups.some(group => group.layer.type === 'mesh')) {
    notes.push('Mesh point colors contribute to the palette; their positions and point effects remain in the CSS layer.');
  }
  if (groups.some(group => group.layer.type === 'curve')) {
    notes.push('Curve geometry and per-layer transforms are retained by the CSS composition, not reproduced in the shader overlay.');
  }
  return { palette: flattened, notes };
}
