import type { EncodedSample, VideoTrackInfo } from './muxTypes';

/* MP4 (ISO BMFF) muxer for one H.264 video track. "Fast start" layout: ftyp, moov, mdat, so a browser can play while downloading.
 * The samples are the AVCC (length-prefixed) access units that WebCodecs produces with `avc: { format: 'avc' }`. */

const TIMESCALE = 90000;
const encoder = new TextEncoder();

const u16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const ascii = (s: string) => Array.from(encoder.encode(s));

function box(type: string, ...payload: (number[] | Uint8Array)[]): Uint8Array {
  let size = 8;
  for (const part of payload) size += part.length;
  const out = new Uint8Array(size);
  out.set(u32(size), 0);
  out.set(ascii(type), 4);
  let offset = 8;
  for (const part of payload) { out.set(part, offset); offset += part.length; }
  return out;
}

const fullBox = (type: string, version: number, flags: number, ...payload: (number[] | Uint8Array)[]) =>
  box(type, [version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff], ...payload);

export interface Mp4Options { track: VideoTrackInfo }

export function muxMp4(samples: EncodedSample[], options: Mp4Options): Blob {
  if (!samples.length) throw new Error('There are no encoded frames to write.');
  const { track } = options;
  if (!track.description || !track.description.length) throw new Error('The H.264 encoder did not report its decoder configuration.');
  const ordered = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const first = ordered[0].timestamp;
  const tick = (us: number) => Math.round(((us - first) * TIMESCALE) / 1e6);

  // decode order equals presentation order for the encoders WebCodecs exposes (no B-frames)
  const dts = ordered.map(sample => tick(sample.timestamp));
  const deltas = ordered.map((sample, i) => i < ordered.length - 1 ? dts[i + 1] - dts[i] : Math.max(1, tick(sample.timestamp + Math.max(0, sample.duration)) - dts[i]));
  const totalTicks = deltas.reduce((sum, d) => sum + d, 0);
  const movieDuration = Math.round((totalTicks * 1000) / TIMESCALE);

  const sttsEntries: number[] = [];
  let runDelta = -1, runCount = 0, runs = 0;
  for (const delta of deltas) {
    if (delta === runDelta) { runCount++; continue; }
    if (runCount) { sttsEntries.push(...u32(runCount), ...u32(runDelta)); runs++; }
    runDelta = delta; runCount = 1;
  }
  sttsEntries.push(...u32(runCount), ...u32(runDelta)); runs++;

  const keyIndexes = ordered.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
  const sizes = ordered.map(s => s.data.length);
  const dataBytes = sizes.reduce((sum, n) => sum + n, 0);

  const avcC = box('avcC', track.description);
  const avc1 = box('avc1',
    [0, 0, 0, 0, 0, 0], u16(1), u16(0), u16(0), new Array(12).fill(0),
    u16(track.width), u16(track.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1),
    new Array(32).fill(0), u16(0x0018), u16(0xffff), avcC);

  const buildMoov = (mdatOffset: number) => {
    const stbl = box('stbl',
      fullBox('stsd', 0, 0, u32(1), avc1),
      fullBox('stts', 0, 0, u32(runs), sttsEntries),
      ...(keyIndexes.length && keyIndexes.length < ordered.length ? [fullBox('stss', 0, 0, u32(keyIndexes.length), keyIndexes.flatMap(u32))] : []),
      fullBox('stsc', 0, 0, u32(1), u32(1), u32(ordered.length), u32(1)),
      fullBox('stsz', 0, 0, u32(0), u32(ordered.length), sizes.flatMap(u32)),
      fullBox('stco', 0, 0, u32(1), u32(mdatOffset)));
    const minf = box('minf',
      fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
      box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1))),
      stbl);
    const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(totalTicks), u16(0x55c4), u16(0));
    const hdlr = fullBox('hdlr', 0, 0, u32(0), ascii('vide'), u32(0), u32(0), u32(0), [...ascii('VideoHandler'), 0]);
    const mdia = box('mdia', mdhd, hdlr, minf);
    const identity = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
    const tkhd = fullBox('tkhd', 0, 7, u32(0), u32(0), u32(1), u32(0), u32(movieDuration), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), identity, u32(track.width << 16), u32(track.height << 16));
    const trak = box('trak', tkhd, mdia);
    const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDuration), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), identity, new Array(24).fill(0), u32(2));
    return box('moov', mvhd, trak);
  };

  const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
  const moovSize = buildMoov(0).length;
  const mdatOffset = ftyp.length + moovSize + 8;
  const moov = buildMoov(mdatOffset);
  const mdatHeader = Uint8Array.from([...u32(dataBytes + 8), ...ascii('mdat')]);
  if (dataBytes + 8 > 0xfffffff0) throw new Error('The MP4 would be larger than 4 GB. Lower the size, quality or duration.');
  return new Blob([ftyp as BlobPart, moov as BlobPart, mdatHeader as BlobPart, ...ordered.map(s => s.data as BlobPart)], { type: 'video/mp4' });
}
