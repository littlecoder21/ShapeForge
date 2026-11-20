/* Minimal ZIP writer (stored, no compression). Used for frame sequences and multi-size image bundles.
 * Entries are kept as Blob parts, so a large sequence is not copied into one giant buffer. */

const encoder = new TextEncoder();
let table: Uint32Array | null = null;

export function crc32(data: Uint8Array, seed = 0): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

interface CentralEntry { name: Uint8Array; crc: number; size: number; offset: number; time: number; day: number }

export class ZipWriter {
  private readonly parts: BlobPart[] = [];
  private readonly central: CentralEntry[] = [];
  private offset = 0;
  private readonly stamp = dosDateTime(new Date());

  get count() { return this.central.length; }

  /** Adds one file. Folder separators in `name` are kept as they are. */
  async add(name: string, data: Blob | Uint8Array): Promise<void> {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    if (this.central.length >= 65534) throw new Error('A ZIP file can hold at most 65,534 files. Lower the frame rate or the duration.');
    if (bytes.length >= 0xffffffff || this.offset + bytes.length > 0xfffffff0) throw new Error('The ZIP would be larger than 4 GB. Lower the size, frame rate or duration.');
    const nameBytes = encoder.encode(name.replace(/^\/+/, ''));
    const crc = crc32(bytes);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, this.stamp.time, true);
    view.setUint16(12, this.stamp.day, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    this.central.push({ name: nameBytes, crc, size: bytes.length, offset: this.offset, time: this.stamp.time, day: this.stamp.day });
    this.parts.push(header, bytes as BlobPart);
    this.offset += header.length + bytes.length;
  }

  finish(): Blob {
    const directory: Uint8Array[] = [];
    let directorySize = 0;
    for (const entry of this.central) {
      const record = new Uint8Array(46 + entry.name.length);
      const view = new DataView(record.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, entry.time, true);
      view.setUint16(14, entry.day, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.name.length, true);
      view.setUint32(42, entry.offset, true);
      record.set(entry.name, 46);
      directory.push(record);
      directorySize += record.length;
    }
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, this.central.length, true);
    endView.setUint16(10, this.central.length, true);
    endView.setUint32(12, directorySize, true);
    endView.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...(directory as BlobPart[]), end as BlobPart], { type: 'application/zip' });
  }
}
