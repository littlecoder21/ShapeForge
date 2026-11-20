import type { GradientProject } from '../engine/model';
import { projectSvg } from '../engine/svg';
import { assertSize, canvasToBlob, EXTENSION, MIME } from './download';
import { animationInfo, exportSlug, resolveBackground, resolveSizes } from './exportPlan';
import { MAX_IMAGE_SIDE, type ImageSettings } from './exportTypes';
import { openFrameSource } from './frameCapture';
import { ZipWriter } from './zip';

export interface ExportedFile { name: string; blob: Blob; width: number; height: number }
export interface ImageExportResult {
  /** what to download: the single file, or a ZIP when several sizes were exported */
  blob: Blob;
  fileName: string;
  files: ExportedFile[];
  notes: string[];
}

export interface ImageProgress { done: number; total: number; message: string }
interface Hooks { signal?: AbortSignal; onProgress?: (progress: ImageProgress) => void }

export function imageIsDynamic(project: GradientProject) { return animationInfo(project).dynamic; }

export async function runImageExport(project: GradientProject, settings: ImageSettings, hooks: Hooks = {}): Promise<ImageExportResult> {
  const { signal, onProgress } = hooks;
  const info = animationInfo(project);
  const slug = exportSlug(project, settings.fileName);
  const alpha = settings.format !== 'jpeg';
  const background = resolveBackground(project, settings.background, alpha);
  const sizes = resolveSizes(project.canvas, settings.size, { even: false, maxSide: MAX_IMAGE_SIDE, single: settings.format === 'svg' });
  const timeTag = info.dynamic && settings.time > 0 ? `-t${String(Math.round(settings.time * 100) / 100).replace('.', '_')}s` : '';
  const notes: string[] = [];
  const files: ExportedFile[] = [];

  if (settings.format === 'svg') {
    onProgress?.({ done: 0, total: 1, message: 'Writing SVG…' });
    const size = sizes[0];
    const svg = projectSvg({ ...project, background }, { size: `width="${size.width}" height="${size.height}"` });
    if (info.dynamic) notes.push('SVG is a still image: animation and shader layers are not part of it.');
    files.push({ name: `${slug}${size.suffix}.svg`, blob: new Blob([svg], { type: 'image/svg+xml' }), width: size.width, height: size.height });
  } else {
    for (const size of sizes) assertSize(size.width, size.height);
    const key = settings.format === 'jpeg' ? 'jpeg' : settings.format;
    const source = await openFrameSource({ project, background, captureStatic: true, signal, onStatus: message => onProgress?.({ done: 0, total: sizes.length, message }) });
    try {
      if (source.dynamic) await source.advanceTo(settings.time * 1000);
      for (let i = 0; i < sizes.length; i++) {
        if (signal?.aborted) throw new DOMException('The export was cancelled.', 'AbortError');
        const size = sizes[i];
        onProgress?.({ done: i, total: sizes.length, message: `Rendering ${size.label}…` });
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d', { alpha })!;
        if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, size.width, size.height); }
        await source.render(ctx, { width: size.width, height: size.height, fit: size.fit });
        const blob = await canvasToBlob(canvas, MIME[key], key === 'png' ? undefined : settings.quality / 100);
        files.push({ name: `${slug}${size.suffix}${timeTag}.${EXTENSION[key]}`, blob, width: size.width, height: size.height });
      }
      notes.push(...source.notes);
    } finally {
      source.dispose();
    }
  }

  onProgress?.({ done: files.length, total: sizes.length, message: 'Done' });
  if (files.length === 1) return { blob: files[0].blob, fileName: files[0].name, files, notes: [...new Set(notes)] };
  const zip = new ZipWriter();
  for (const file of files) await zip.add(file.name, file.blob);
  return { blob: zip.finish(), fileName: `${slug}${timeTag}-images.zip`, files, notes: [...new Set(notes)] };
}

/** A small preview of the frame at `timeSec`, drawn onto a fresh canvas whose long side is `maxSide`. */
export async function renderPreviewCanvas(project: GradientProject, options: {
  background: string; timeSec: number; width: number; height: number; fit: 'contain' | 'cover' | 'stretch'; maxSide: number; signal?: AbortSignal;
}): Promise<{ canvas: HTMLCanvasElement; notes: string[] }> {
  const k = Math.min(options.maxSide / options.width, options.maxSide / options.height);
  const width = Math.max(2, Math.round(options.width * k)), height = Math.max(2, Math.round(options.height * k));
  const source = await openFrameSource({ project, background: options.background, captureStatic: true, signal: options.signal });
  try {
    if (source.dynamic) await source.advanceTo(options.timeSec * 1000);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    if (options.background) { ctx.fillStyle = options.background; ctx.fillRect(0, 0, width, height); }
    await source.render(ctx, { width, height, fit: options.fit });
    return { canvas, notes: source.notes };
  } finally {
    source.dispose();
  }
}
