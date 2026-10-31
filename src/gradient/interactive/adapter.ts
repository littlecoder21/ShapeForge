import { sortedStops, type GradientLayer, type GradientProject } from '../engine/model';
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
  }));
}

export function gradientLayerToShader(layer: GradientLayer, project: GradientProject): ShaderLayerAdapter {
  let palette = layerPalette(layer);
  const notes: string[] = [];
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
  if (layer.type === 'curve') notes.push('Curve handles still define the layer shape; shader colors follow the curve layer stop ramp.');
  if (layer.type === 'noise') notes.push('Noise layers use their shader color ramp; the original grain remains as a texture overlay.');
  if (palette.length > 8) notes.push(`Shader rendering supports up to 8 color stops; the layer retains all ${palette.length} stops in CSS and exports.`);
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
      originX: layer.cx,
      originY: layer.cy,
      radiusX: layer.rx,
      radiusY: layer.ry,
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
    'The shader combines visible layer colors into an animated palette; the exact CSS composition remains underneath and is unchanged for static exports.',
  ];
  if (groups.some(group => group.layer.type === 'mesh')) {
    notes.push('Mesh point colors contribute to the palette; their positions and point effects remain in the CSS layer.');
  }
  if (groups.some(group => group.layer.type === 'curve')) {
    notes.push('Curve geometry and per-layer transforms are retained by the CSS composition, not reproduced in the shader overlay.');
  }
  if (flattened.length > 8) {
    notes.push(`The shader supports up to 8 color stops; it will use the first 8 of ${flattened.length}.`);
  }
  return { palette: flattened, notes };
}
