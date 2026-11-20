/** One encoded video sample as produced by WebCodecs (copied out of the EncodedVideoChunk). */
export interface EncodedSample {
  data: Uint8Array;
  /** presentation time in microseconds */
  timestamp: number;
  /** microseconds */
  duration: number;
  key: boolean;
}

export interface VideoTrackInfo {
  width: number;
  height: number;
  /** codec-specific configuration record (avcC for H.264, av1C for AV1); empty for VP8 / VP9 */
  description?: Uint8Array;
}
