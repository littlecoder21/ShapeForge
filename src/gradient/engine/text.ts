import type { TextLayerData } from './model';

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function textSvgMarkup(text: TextLayerData, width: number, height: number, fill = '#fff'): string {
  const lines = text.content.replace(/\r\n?/g, '\n').split('\n');
  const lineStep = text.fontSize * text.lineHeight;
  const blockHeight = text.fontSize + Math.max(0, lines.length - 1) * lineStep;
  const top = text.verticalAlign === 'top' ? 0 : text.verticalAlign === 'middle' ? (height - blockHeight) / 2 : height - blockHeight;
  const baseline = top + text.fontSize;
  const x = text.align === 'left' ? 0 : text.align === 'right' ? width : width / 2;
  const anchor = text.align === 'left' ? 'start' : text.align === 'right' ? 'end' : 'middle';
  const tspans = lines.map((line, index) => `<tspan x="${x}"${index ? ` dy="${lineStep}"` : ''}>${xml(line || ' ')}</tspan>`).join('');
  return `<text x="${x}" y="${baseline}" text-anchor="${anchor}" font-family="${xml(text.fontFamily)}" font-size="${text.fontSize}" font-weight="${text.fontWeight}" letter-spacing="${text.letterSpacing}" fill="${fill}" xml:space="preserve">${tspans}</text>`;
}

export function textMaskDataUri(text: TextLayerData, width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${textSvgMarkup(text, width, height)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`;
}
