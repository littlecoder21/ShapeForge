import { normalizeProject, type GradientProject } from './model';
import { POINTER_MODES } from '../interactive/pointerModes';

const FORMAT = 'shapeforge-gradient-project';
const FORMAT_VERSION = 1;
const GRADIENT_TYPES = ['linear', 'radial', 'conic', 'curve', 'mesh', 'noise'];
const COLOR_SPACES = ['srgb', 'srgb-linear', 'oklab', 'oklch'];
const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-lighter',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function serializeProjectFile(project: GradientProject): string {
  return JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, project }, null, 2);
}

function compatibilityWarnings(source: Record<string, unknown>, project: GradientProject): string[] {
  const warnings: string[] = [];
  const rawLayers = Array.isArray(source.layers) ? source.layers : [];
  const add = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  const shaderEnums: Record<string, readonly string[]> = {
    style: ['flow', 'aurora', 'liquid', 'holographic', 'plasma', 'silk', 'nebula', 'ribbons', 'metaballs', 'contours', 'smoke', 'fire'],
    quality: ['low', 'medium', 'high', 'ultra'],
    pointerMode: POINTER_MODES.map(mode => mode.id),
    interactionColorSource: ['layer', 'custom'],
    interactionFalloff: ['soft', 'linear', 'sharp', 'gaussian'],
    interactionDisplacementMode: ['push', 'pull'],
    paletteWrap: ['mirror', 'repeat'],
    renderBackend: ['css', 'webgl', 'overlay'],
  };
  const rawShader = isRecord(source.shader) ? source.shader : {};
  const normalizedShader = project.shader;
  for (const [key, supported] of Object.entries(shaderEnums)) {
    if (rawShader[key] !== undefined && (!supported.includes(String(rawShader[key])) || rawShader[key] !== normalizedShader?.[key as keyof typeof normalizedShader])) {
      add(`Unsupported shader setting "${key}" was replaced with a supported value.`);
    }
  }
  for (const [key, value] of Object.entries(normalizedShader ?? {})) {
    const rawValue = rawShader[key];
    if (rawValue === undefined || typeof value !== 'number') continue;
    const candidate = Number(rawValue);
    if (!Number.isFinite(candidate) || candidate !== value) add(`Shader setting "${key}" was outside its supported range and was adjusted.`);
  }
  for (const [index, rawLayer] of rawLayers.entries()) {
    if (!isRecord(rawLayer)) continue;
    const layer = project.layers[index];
    if (!layer) continue;
    if (rawLayer.type !== undefined && (!GRADIENT_TYPES.includes(String(rawLayer.type)) || rawLayer.type !== layer.type)) {
      add(`Layer ${index + 1} used an unsupported gradient type; it was loaded as ${layer.type}.`);
    }
    if (rawLayer.space !== undefined && (!COLOR_SPACES.includes(String(rawLayer.space)) || rawLayer.space !== layer.space)) {
      add(`Layer ${index + 1} used an unsupported color space; it was loaded with ${layer.space}.`);
    }
    if (rawLayer.blend !== undefined && (!BLEND_MODES.includes(String(rawLayer.blend)) || rawLayer.blend !== layer.blend)) {
      add(`Layer ${index + 1} used an unsupported blend mode; it was loaded with ${layer.blend}.`);
    }
    if (isRecord(rawLayer.texture) && rawLayer.texture.blend !== undefined && rawLayer.texture.blend !== layer.texture.blend) {
      add(`Layer ${index + 1} used an unsupported texture blend mode; a supported mode was selected.`);
    }
    if (isRecord(rawLayer.shader)) {
      const shader = rawLayer.shader;
      if (shader.style !== undefined && shader.style !== layer.shader?.style) add(`Layer ${index + 1} used an unsupported shader style; a supported style was selected.`);
      if (shader.mixMode !== undefined && shader.mixMode !== layer.shader?.mixMode) add(`Layer ${index + 1} used an unsupported shader blend mode; a supported mode was selected.`);
      if (isRecord(shader.controls)) {
        for (const [key, value] of Object.entries(layer.shader?.controls ?? {})) {
          if (shader.controls[key] === undefined) continue;
          const candidate = Number(shader.controls[key]);
          if (!Number.isFinite(candidate) || candidate !== value) add(`Layer ${index + 1} shader control "${key}" was outside its supported range and was adjusted.`);
        }
      }
    }
  }
  return warnings;
}

export interface ProjectFileImport {
  project: GradientProject;
  warnings: string[];
}

export function parseProjectFile(text: string): ProjectFileImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON file');
  }
  if (!isRecord(parsed)) throw new Error('This file does not contain a ShapeForge project.');

  const warnings: string[] = [];
  let source = parsed;
  if ('project' in parsed) {
    if (!isRecord(parsed.project)) throw new Error('The project file is missing its project data.');
    source = parsed.project;
    if (parsed.format !== FORMAT) warnings.push('This JSON uses an unrecognized project format; compatible project data was recovered.');
    if (typeof parsed.formatVersion === 'number' && parsed.formatVersion > FORMAT_VERSION) {
      warnings.push(`This project uses format version ${parsed.formatVersion}; unsupported settings may be replaced with compatible values.`);
    }
  }
  if (!Array.isArray(source.layers) || source.layers.length === 0) {
    throw new Error('Project has no layers.');
  }

  const project = normalizeProject(source);
  warnings.push(...compatibilityWarnings(source, project));
  return { project, warnings };
}
