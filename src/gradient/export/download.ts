/** Saves a blob through a temporary link (the same approach the code export uses). */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const MIME: Record<'png' | 'jpeg' | 'webp', string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
export const EXTENSION: Record<'png' | 'jpeg' | 'webp', string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

/** canvas.toBlob as a promise; refuses when the browser silently fell back to another format (old Safari for WebP). */
export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) reject(new Error('The image could not be encoded (it may be too large for this browser).'));
      else if (blob.type && blob.type !== type) reject(new Error(`This browser cannot save ${type.replace('image/', '').toUpperCase()} images. Choose PNG instead.`));
      else resolve(blob);
    }, type, quality);
  });
}

/** The largest picture (in pixels) the exporters will build; beyond it browsers run out of memory. */
export const MAX_PIXELS = 100_000_000;

export function assertSize(width: number, height: number) {
  if (width * height > MAX_PIXELS) throw new Error(`${width}×${height} is too large for a browser to render (${Math.round(width * height / 1e6)} megapixels). Choose a smaller size.`);
}
