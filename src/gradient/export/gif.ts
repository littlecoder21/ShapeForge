/* Animated GIF encoder (GIF89a): per-frame median-cut palette, optional ordered / Floyd–Steinberg dithering, variable-width LZW. */

export type GifDither = 'none' | 'ordered' | 'floyd';

export interface GifOptions {
  width: number;
  height: number;
  /** 2…256 */
  colors: number;
  dither: GifDither;
  /** 0 = loop forever, 1 = play once, n = play n times */
  plays: number;
  /** keep 1-bit transparency (alpha < 128 becomes the transparent colour) */
  transparent: boolean;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

interface Bin { key: number; count: number; r: number; g: number; b: number }

/** Median cut over a 15-bit (5 bits per channel) histogram. Returns up to `limit` palette colours as r,g,b triples. */
function medianCut(histogram: Uint32Array, limit: number): number[] {
  const bins: Bin[] = [];
  for (let key = 0; key < histogram.length; key++) {
    const count = histogram[key];
    if (count) bins.push({ key, count, r: (key >> 10) & 31, g: (key >> 5) & 31, b: key & 31 });
  }
  if (!bins.length) return [0, 0, 0];
  interface Box { items: Bin[]; population: number }
  const boxes: Box[] = [{ items: bins, population: bins.reduce((sum, bin) => sum + bin.count, 0) }];
  const range = (items: Bin[]) => {
    let rMin = 31, rMax = 0, gMin = 31, gMax = 0, bMin = 31, bMax = 0;
    for (const bin of items) {
      if (bin.r < rMin) rMin = bin.r; if (bin.r > rMax) rMax = bin.r;
      if (bin.g < gMin) gMin = bin.g; if (bin.g > gMax) gMax = bin.g;
      if (bin.b < bMin) bMin = bin.b; if (bin.b > bMax) bMax = bin.b;
    }
    return { r: rMax - rMin, g: gMax - gMin, b: bMax - bMin };
  };
  while (boxes.length < limit) {
    // split the box with the most weight that can still be split
    let best = -1, bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.items.length < 2) continue;
      const r = range(box.items);
      const score = box.population * (Math.max(r.r, r.g, r.b) + 1);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best < 0) break;
    const box = boxes[best];
    const r = range(box.items);
    const channel: 'r' | 'g' | 'b' = r.g >= r.r && r.g >= r.b ? 'g' : r.r >= r.b ? 'r' : 'b';
    box.items.sort((a, b) => a[channel] - b[channel]);
    let accumulated = 0;
    let cut = 1;
    for (let i = 0; i < box.items.length - 1; i++) {
      accumulated += box.items[i].count;
      cut = i + 1;
      if (accumulated * 2 >= box.population) break;
    }
    const left = box.items.slice(0, cut), right = box.items.slice(cut);
    const leftPop = left.reduce((sum, bin) => sum + bin.count, 0);
    boxes.splice(best, 1, { items: left, population: leftPop }, { items: right, population: box.population - leftPop });
  }
  const palette: number[] = [];
  for (const box of boxes) {
    let r = 0, g = 0, b = 0;
    for (const bin of box.items) { r += bin.r * bin.count; g += bin.g * bin.count; b += bin.b * bin.count; }
    const n = Math.max(1, box.population);
    const expand = (v: number) => Math.min(255, Math.round((v / n) * 8 + 4));
    palette.push(expand(r), expand(g), expand(b));
  }
  return palette;
}

class Quantizer {
  readonly palette: number[];
  private readonly cache: Int16Array;
  constructor(palette: number[]) {
    this.palette = palette;
    this.cache = new Int16Array(32768).fill(-1);
  }
  get size() { return this.palette.length / 3; }
  /** nearest palette entry for an 8-bit colour, memoised on its 15-bit key */
  nearest(r: number, g: number, b: number): number {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = this.cache[key];
    if (hit >= 0) return hit;
    const cr = (r & 0xf8) | 4, cg = (g & 0xf8) | 4, cb = (b & 0xf8) | 4;
    let best = 0, bestDistance = Infinity;
    for (let i = 0, n = this.palette.length; i < n; i += 3) {
      const dr = this.palette[i] - cr, dg = this.palette[i + 1] - cg, db = this.palette[i + 2] - cb;
      const distance = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (distance < bestDistance) { bestDistance = distance; best = i / 3; if (!distance) break; }
    }
    this.cache[key] = best;
    return best;
  }
}

const clamp255 = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);

/* LZW tables are reused between frames; a generation stamp replaces clearing 5 MB per dictionary reset. */
const lzwTable = new Int16Array(4096 * 256);
const lzwStamp = new Uint32Array(4096 * 256);
let lzwGeneration = 1;

/** Variable-width LZW of the index stream, wrapped into GIF data sub-blocks (algorithm follows the GIF89a specification). */
function lzw(indices: Uint8Array, minCodeSize: number): Uint8Array {
  let out = new Uint8Array(Math.max(1024, (indices.length >> 1) + 1024));
  let length = 0;
  const ensure = (extra: number) => {
    if (length + extra <= out.length) return;
    const grown = new Uint8Array(Math.max(out.length * 2, length + extra));
    grown.set(out.subarray(0, length));
    out = grown;
  };
  ensure(2);
  out[length++] = minCodeSize;
  let blockStart = length;
  ensure(1);
  out[length++] = 0;
  const closeBlock = () => { out[blockStart] = length - blockStart - 1; };
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let nextCode = eoiCode + 1;
  let codeSize = minCodeSize + 1;
  let current = 0, shift = 0;
  let generation = ++lzwGeneration;
  const pushByte = (byte: number) => {
    ensure(2);
    out[length++] = byte;
    if (length - blockStart - 1 === 255) { closeBlock(); blockStart = length; out[length++] = 0; }
  };
  const emit = (code: number) => {
    current |= code << shift;
    shift += codeSize;
    while (shift >= 8) { pushByte(current & 0xff); current >>>= 8; shift -= 8; }
  };
  emit(clearCode);
  let prefix = indices[0];
  const mask = clearCode - 1;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i] & mask;
    const key = (prefix << 8) | k;
    if (lzwStamp[key] === generation) { prefix = lzwTable[key]; continue; }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clearCode);
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
      generation = ++lzwGeneration;
    } else {
      if (nextCode >= (1 << codeSize)) codeSize++;
      lzwTable[key] = nextCode++;
      lzwStamp[key] = generation;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoiCode);
  if (shift > 0) pushByte(current & 0xff);
  closeBlock();
  if (out[blockStart] === 0) length = blockStart; // an empty trailing sub-block is replaced by the terminator
  ensure(1);
  out[length++] = 0;
  return out.slice(0, length);
}

export class GifEncoder {
  private readonly chunks: Uint8Array[] = [];
  private readonly options: GifOptions;
  private frames = 0;
  private cumulativeMs = 0;
  private writtenCs = 0;
  private finished = false;

  constructor(options: GifOptions) {
    this.options = { ...options, colors: Math.max(2, Math.min(256, Math.round(options.colors))) };
    const { width, height } = this.options;
    const header = new Uint8Array(13);
    header.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    header[6] = width & 255; header[7] = width >> 8;
    header[8] = height & 255; header[9] = height >> 8;
    header[10] = 0x70; // no global colour table, 8 bits of colour resolution
    this.chunks.push(header);
    if (this.options.plays !== 1) {
      const loops = this.options.plays <= 0 ? 0 : this.options.plays - 1;
      this.chunks.push(Uint8Array.from([0x21, 0xff, 0x0b, ...'NETSCAPE2.0'.split('').map(c => c.charCodeAt(0)), 0x03, 0x01, loops & 255, loops >> 8, 0x00]));
    }
  }

  get frameCount() { return this.frames; }

  /** `rgba` is width × height × 4. `durationMs` is how long this frame stays on screen (rounded to GIF's 10 ms units without drift). */
  addFrame(rgba: Uint8ClampedArray | Uint8Array, durationMs: number) {
    if (this.finished) throw new Error('The GIF is already finished.');
    const { width, height, colors, dither, transparent } = this.options;
    const pixels = width * height;
    if (rgba.length < pixels * 4) throw new Error('Frame data does not match the GIF size.');
    // 1. histogram + palette (index 0 is reserved for transparency when needed)
    const histogram = new Uint32Array(32768);
    let hasTransparent = false;
    for (let i = 0; i < pixels; i++) {
      const o = i * 4;
      if (transparent && rgba[o + 3] < 128) { hasTransparent = true; continue; }
      histogram[((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3)]++;
    }
    const limit = colors - (hasTransparent ? 1 : 0);
    const cut = medianCut(histogram, Math.max(1, limit));
    const offset = hasTransparent ? 1 : 0;
    const palette = hasTransparent ? [0, 0, 0, ...cut] : cut;
    const quantizer = new Quantizer(cut);
    const indices = new Uint8Array(pixels);
    // 2. map pixels
    if (dither === 'floyd') {
      const rowA = new Float32Array((width + 2) * 3), rowB = new Float32Array((width + 2) * 3);
      let current = rowA, next = rowB;
      for (let y = 0; y < height; y++) {
        next.fill(0);
        const leftToRight = (y & 1) === 0;
        for (let step = 0; step < width; step++) {
          const x = leftToRight ? step : width - 1 - step;
          const p = y * width + x, o = p * 4;
          if (hasTransparent && rgba[o + 3] < 128) { indices[p] = 0; continue; }
          const e = (x + 1) * 3;
          const r = clamp255(rgba[o] + current[e]), g = clamp255(rgba[o + 1] + current[e + 1]), b = clamp255(rgba[o + 2] + current[e + 2]);
          const index = quantizer.nearest(r | 0, g | 0, b | 0);
          indices[p] = index + offset;
          const q = index * 3;
          const er = r - cut[q], eg = g - cut[q + 1], eb = b - cut[q + 2];
          const dx = leftToRight ? 1 : -1;
          const spread = (row: Float32Array, at: number, weight: number) => { row[at * 3] += er * weight; row[at * 3 + 1] += eg * weight; row[at * 3 + 2] += eb * weight; };
          spread(current, x + 1 + dx, 7 / 16);
          spread(next, x + 1 - dx, 3 / 16);
          spread(next, x + 1, 5 / 16);
          spread(next, x + 1 + dx, 1 / 16);
        }
        const swap = current; current = next; next = swap;
      }
    } else {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = y * width + x, o = p * 4;
          if (hasTransparent && rgba[o + 3] < 128) { indices[p] = 0; continue; }
          let r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
          if (dither === 'ordered') {
            const t = (BAYER4[(y & 3) * 4 + (x & 3)] - 7.5) * 2.2;
            r = clamp255(r + t); g = clamp255(g + t); b = clamp255(b + t);
          }
          indices[p] = quantizer.nearest(r | 0, g | 0, b | 0) + offset;
        }
      }
    }
    // 3. frame blocks
    this.cumulativeMs += Math.max(0, durationMs);
    const targetCs = Math.round(this.cumulativeMs / 10);
    const delay = Math.max(2, targetCs - this.writtenCs);
    this.writtenCs += delay;
    const count = palette.length / 3;
    let bits = 1;
    while ((1 << bits) < count) bits++;
    const tableSize = 1 << bits;
    while (palette.length < tableSize * 3) palette.push(0);
    const gce = Uint8Array.from([0x21, 0xf9, 0x04, hasTransparent ? (2 << 2) | 1 : 1 << 2, delay & 255, delay >> 8, 0, 0x00]);
    const descriptor = Uint8Array.from([0x2c, 0, 0, 0, 0, width & 255, width >> 8, height & 255, height >> 8, 0x80 | (bits - 1)]);
    const minCodeSize = Math.max(2, bits);
    this.chunks.push(gce, descriptor, Uint8Array.from(palette), lzw(indices, minCodeSize));
    this.frames++;
  }

  finish(): Blob {
    if (!this.finished) { this.chunks.push(Uint8Array.from([0x3b])); this.finished = true; }
    return new Blob(this.chunks as BlobPart[], { type: 'image/gif' });
  }
}
