import type { GradientProject } from './model';
import { serializeProjectFile } from './projectFile';

const encoder = new TextEncoder();

interface ZipEntry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndRecord(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 22 - 65535);
  for (let offset = view.byteLength - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50
      && offset + 22 + view.getUint16(offset + 20, true) === view.byteLength) return offset;
  }
  throw new Error('This file does not contain a valid ZIP directory.');
}

async function inflateRaw(data: Uint8Array, maximumSize: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('ZIP deflate decompression is unavailable in this browser.');
  try {
    const stream = new Blob([new Uint8Array(data).buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumSize) {
        await reader.cancel();
        throw new Error('Decompressed project JSON exceeds its declared size.');
      }
      chunks.push(value);
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  } catch (error) {
    throw new Error(error instanceof Error ? `Could not decompress ZIP entry: ${error.message}` : 'Could not decompress ZIP entry.');
  }
}

async function readEntry(bytes: Uint8Array, view: DataView, entry: { name: string; flags: number; method: number; crc: number; compressedSize: number; size: number; localOffset: number }): Promise<string> {
  const maximumJsonSize = 20 * 1024 * 1024;
  if (entry.size > maximumJsonSize) throw new Error(`Project JSON "${entry.name}" exceeds the 20 MB import limit.`);
  if (entry.flags & 1) throw new Error(`Project JSON "${entry.name}" is encrypted and cannot be imported.`);
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`Project JSON "${entry.name}" uses unsupported ZIP compression.`);

  const local = entry.localOffset;
  if (local + 30 > view.byteLength || view.getUint32(local, true) !== 0x04034b50) {
    throw new Error(`Project JSON "${entry.name}" has an invalid ZIP entry header.`);
  }
  const nameLength = view.getUint16(local + 26, true);
  const extraLength = view.getUint16(local + 28, true);
  const start = local + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > view.byteLength) throw new Error(`Project JSON "${entry.name}" is truncated.`);
  const compressed = bytes.subarray(start, end);
  const data = entry.method === 0 ? compressed : await inflateRaw(compressed, entry.size);
  if (data.length !== entry.size) throw new Error(`Project JSON "${entry.name}" failed its size check.`);
  if (crc32(data) !== entry.crc) throw new Error(`Project JSON "${entry.name}" failed its integrity check.`);
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}

export async function extractProjectJsonFromZip(file: Blob): Promise<string> {
  if (file.size > 100 * 1024 * 1024) throw new Error('ZIP archive exceeds the 100 MB import limit.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(view);
  const disk = view.getUint16(end + 4, true);
  const directoryDisk = view.getUint16(end + 6, true);
  const entriesOnDisk = view.getUint16(end + 8, true);
  const entryCount = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount || entryCount === 0xffff || directoryOffset === 0xffffffff) {
    throw new Error('Multi-disk and ZIP64 archives are not supported.');
  }
  if (directoryOffset + directorySize > end) throw new Error('The ZIP directory is invalid or truncated.');

  const decoder = new TextDecoder('utf-8');
  const jsonEntries: { name: string; flags: number; method: number; crc: number; compressedSize: number; size: number; localOffset: number }[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > directoryOffset + directorySize || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('The ZIP contains a malformed file directory.');
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > directoryOffset + directorySize) throw new Error('The ZIP file directory is truncated.');
    if (view.getUint16(offset + 34, true) !== 0 || view.getUint32(offset + 20, true) === 0xffffffff
      || view.getUint32(offset + 24, true) === 0xffffffff || view.getUint32(offset + 42, true) === 0xffffffff) {
      throw new Error('Multi-disk and ZIP64 archives are not supported.');
    }
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!name.endsWith('/') && /\.json$/i.test(name)) {
      jsonEntries.push({
        name,
        flags: view.getUint16(offset + 8, true),
        method: view.getUint16(offset + 10, true),
        crc: view.getUint32(offset + 16, true),
        compressedSize: view.getUint32(offset + 20, true),
        size: view.getUint32(offset + 24, true),
        localOffset: view.getUint32(offset + 42, true),
      });
    }
    offset = recordEnd;
  }
  if (offset !== directoryOffset + directorySize) throw new Error('The ZIP file directory has an invalid size.');
  if (!jsonEntries.length) throw new Error('This ZIP archive does not contain a project JSON file.');
  if (jsonEntries.length > 128 || jsonEntries.reduce((total, entry) => total + entry.size, 0) > 40 * 1024 * 1024) {
    throw new Error('ZIP archive contains too many or too much project JSON to import safely.');
  }

  const projects: { name: string; json: string }[] = [];
  let lastError: unknown;
  for (const entry of jsonEntries) {
    try {
      const json = await readEntry(bytes, view, entry);
      const parsed = JSON.parse(json) as { format?: unknown; project?: unknown; layers?: unknown };
      if ((parsed.format === 'shapeforge-gradient-project' && parsed.project) || Array.isArray(parsed.layers)) {
        projects.push({ name: entry.name, json });
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (projects.length === 1) return projects[0].json;
  if (projects.length > 1) throw new Error('This ZIP contains multiple project JSON files. Import a ZIP with only one project.');
  if (lastError instanceof Error) throw lastError;
  throw new Error('This ZIP does not contain a recognizable ShapeForge project JSON file.');
}

function write16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

function safeFolderName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\.+$/g, '').trim() || 'gradient';
}

function makeZip(entries: ZipEntry[]): Blob {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    entry.offset = localOffset;
    const local = new Uint8Array(30 + entry.name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write32(localView, 14, entry.crc);
    write32(localView, 18, entry.data.length);
    write32(localView, 22, entry.data.length);
    write16(localView, 26, entry.name.length);
    local.set(entry.name, 30);
    localParts.push(local, entry.data);
    localOffset += local.length + entry.data.length;

    const central = new Uint8Array(46 + entry.name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write32(centralView, 16, entry.crc);
    write32(centralView, 20, entry.data.length);
    write32(centralView, 24, entry.data.length);
    write16(centralView, 28, entry.name.length);
    write32(centralView, 42, entry.offset);
    central.set(entry.name, 46);
    centralParts.push(central);
  }

  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 8, entries.length);
  write16(endView, 10, entries.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, localOffset);

  const bytes = new Uint8Array(localOffset + centralSize + end.length);
  let offset = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new Blob([bytes], { type: 'application/zip' });
}

export async function createPresetArchive(name: string, project: GradientProject, preview: Blob): Promise<Blob> {
  const folder = safeFolderName(name);
  const files = [
    { path: `${folder}/${folder}.json`, data: encoder.encode(serializeProjectFile(project)) },
    { path: `${folder}/${folder}.png`, data: new Uint8Array(await preview.arrayBuffer()) },
  ];
  return makeZip(files.map(file => {
    const nameBytes = encoder.encode(file.path);
    return { name: nameBytes, data: file.data, crc: crc32(file.data), offset: 0 };
  }));
}
