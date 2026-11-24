/* Minimal dependency-free PNG encoder (stored deflate blocks, no compression). Synchronous and deterministic, so it runs the same in
 * the browser and in Node tests, which lets exports embed a baked image without canvas.toDataURL(). Smooth baked fields are small
 * (≈ 160×100 px), so skipping compression costs a few tens of kilobytes at most. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const put32 = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = (value >>> 24) & 255; target[offset + 1] = (value >>> 16) & 255; target[offset + 2] = (value >>> 8) & 255; target[offset + 3] = value & 255;
};

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  put32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  put32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Encodes straight-alpha RGBA pixels. Fully opaque images are written as 8-bit RGB (a quarter smaller). */
export function encodePng(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) { opaque = false; break; }
  const channels = opaque ? 3 : 4, stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4, to = row + 1 + x * channels;
      raw[to] = rgba[from]; raw[to + 1] = rgba[from + 1]; raw[to + 2] = rgba[from + 2];
      if (!opaque) raw[to + 3] = rgba[from + 3];
    }
  }
  // zlib stream of stored blocks
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  z[0] = 0x78; z[1] = 0x01;
  let at = 2;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535, size = Math.min(65535, raw.length - start);
    z[at++] = b === blocks - 1 ? 1 : 0;
    z[at++] = size & 255; z[at++] = size >>> 8; z[at++] = ~size & 255; z[at++] = (~size >>> 8) & 255;
    z.set(raw.subarray(start, start + size), at);
    at += size;
  }
  put32(z, at, adler32(raw));
  const header = new Uint8Array(13);
  put32(header, 0, width); put32(header, 4, height);
  header[8] = 8; header[9] = opaque ? 2 : 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { png.set(part, offset); offset += part.length; }
  return png;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const pngDataUri = (rgba: ArrayLike<number>, width: number, height: number) => `data:image/png;base64,${bytesToBase64(encodePng(rgba, width, height))}`;
