import type { EncodedSample, VideoTrackInfo } from './muxTypes';

/* WebM (Matroska subset) muxer for one video track. The whole file is assembled at the end so the header can carry the exact
 * duration, a SeekHead and a Cues index (players can seek immediately). Clusters start at every key frame. */

export type WebmCodec = 'vp8' | 'vp9' | 'av1';
const CODEC_ID: Record<WebmCodec, string> = { vp8: 'V_VP8', vp9: 'V_VP9', av1: 'V_AV1' };

const textEncoder = new TextEncoder();

const idBytes = (id: number): number[] => {
  const bytes: number[] = [];
  let value = id;
  while (value > 0) { bytes.unshift(value & 0xff); value = Math.floor(value / 256); }
  return bytes;
};

const sizeBytes = (size: number): number[] => {
  let length = 1;
  while (size >= 2 ** (7 * length) - 1 && length < 8) length++;
  const bytes: number[] = new Array(length);
  let value = size;
  for (let i = length - 1; i >= 0; i--) { bytes[i] = value % 256; value = Math.floor(value / 256); }
  bytes[0] |= 1 << (8 - length);
  return bytes;
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};

const element = (id: number, ...payload: Uint8Array[]): Uint8Array => {
  const body = payload.length === 1 ? payload[0] : concat(payload);
  return concat([Uint8Array.from(idBytes(id)), Uint8Array.from(sizeBytes(body.length)), body]);
};

const uint = (value: number, fixed = 0): Uint8Array => {
  let length = Math.max(fixed, 1);
  if (!fixed) while (value >= 2 ** (8 * length)) length++;
  const out = new Uint8Array(length);
  let rest = value;
  for (let i = length - 1; i >= 0; i--) { out[i] = rest % 256; rest = Math.floor(rest / 256); }
  return out;
};

const float64 = (value: number): Uint8Array => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
};

const text = (value: string) => textEncoder.encode(value);

export interface WebmOptions { codec: WebmCodec; track: VideoTrackInfo }

export function muxWebm(samples: EncodedSample[], options: WebmOptions): Blob {
  if (!samples.length) throw new Error('There are no encoded frames to write.');
  const { track, codec } = options;
  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const first = ordered[0].timestamp;
  const toMs = (us: number) => Math.round((us - first) / 1000);
  const last = ordered[ordered.length - 1];
  const durationMs = Math.max(1, (last.timestamp - first + Math.max(0, last.duration)) / 1000);

  const ebmlHeader = element(0x1a45dfa3,
    element(0x4286, uint(1)), element(0x42f7, uint(1)), element(0x42f2, uint(4)), element(0x42f3, uint(8)),
    element(0x4282, text('webm')), element(0x4287, uint(4)), element(0x4285, uint(2)));

  const info = element(0x1549a966,
    element(0x2ad7b1, uint(1000000)), element(0x4d80, text('ShapeForge')), element(0x5741, text('ShapeForge')), element(0x4489, float64(durationMs)));

  const trackEntry = element(0xae,
    element(0xd7, uint(1)), element(0x73c5, uint(1)), element(0x83, uint(1)), element(0x9c, uint(0)), element(0x86, text(CODEC_ID[codec])),
    ...(track.description && track.description.length && codec === 'av1' ? [element(0x63a2, track.description)] : []),
    element(0xe0, element(0xb0, uint(track.width)), element(0xba, uint(track.height))));
  const tracks = element(0x1654ae6b, trackEntry);

  // clusters: a new one starts at every key frame (and at least every 30 s, the limit of a 16-bit block timecode)
  const clusters: { start: number; key: boolean; bytes: Uint8Array }[] = [];
  let blocks: Uint8Array[] = [];
  let clusterStart = 0;
  let clusterKey = false;
  const flush = () => {
    if (!blocks.length) return;
    clusters.push({ start: clusterStart, key: clusterKey, bytes: element(0x1f43b675, element(0xe7, uint(clusterStart)), ...blocks) });
    blocks = [];
  };
  for (const sample of ordered) {
    const time = toMs(sample.timestamp);
    if (blocks.length && (sample.key || time - clusterStart > 30000)) flush();
    if (!blocks.length) { clusterStart = time; clusterKey = sample.key; }
    const relative = time - clusterStart;
    const header = Uint8Array.from([0x81, (relative >> 8) & 0xff, relative & 0xff, sample.key ? 0x80 : 0x00]);
    blocks.push(element(0xa3, header, sample.data));
  }
  flush();

  // cues + seek head have fixed-width position fields, so their sizes are known before offsets are
  const cueTarget = clusters.filter(cluster => cluster.key);
  const makeCues = (segmentOffsets: number[]) => element(0x1c53bb6b, ...cueTarget.map((cluster, i) =>
    element(0xbb, element(0xb3, uint(cluster.start)), element(0xb7, element(0xf7, uint(1)), element(0xf1, uint(segmentOffsets[i], 4))))));
  const makeSeekHead = (infoAt: number, tracksAt: number, cuesAt: number) => element(0x114d9b74,
    ...([[0x1549a966, infoAt], [0x1654ae6b, tracksAt], [0x1c53bb6b, cuesAt]] as [number, number][]).map(([id, at]) =>
      element(0x4dbb, element(0x53ab, Uint8Array.from(idBytes(id))), element(0x53ac, uint(at, 4)))));

  const seekSize = makeSeekHead(0, 0, 0).length;
  const cuesSize = makeCues(cueTarget.map(() => 0)).length;
  const infoAt = seekSize;
  const tracksAt = infoAt + info.length;
  const cuesAt = tracksAt + tracks.length;
  let clusterAt = cuesAt + cuesSize;
  const offsets = new Map<number, number>();
  for (const cluster of clusters) { offsets.set(cluster.start, clusterAt); clusterAt += cluster.bytes.length; }
  const seekHead = makeSeekHead(infoAt, tracksAt, cuesAt);
  const cues = makeCues(cueTarget.map(cluster => offsets.get(cluster.start)!));
  const segmentBody = concat([seekHead, info, tracks, cues, ...clusters.map(c => c.bytes)]);
  const segment = concat([Uint8Array.from(idBytes(0x18538067)), Uint8Array.from(sizeBytes(segmentBody.length)), segmentBody]);
  return new Blob([ebmlHeader as BlobPart, segment as BlobPart], { type: 'video/webm' });
}
