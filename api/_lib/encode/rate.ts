// Quality is relative to the source: 100 spends what the source spends per
// second, 50 half of that. It is a ceiling on top of each encoder's own
// quality curve (crf), never a target, so a result is at most as large as its
// source allows and smaller when the pictures need less.
//
// Why a ceiling at all: crf is absolute. x264's crf 1 on footage that was
// delivered at crf 23 re-encodes the source's compression artifacts as if
// they were detail, at 5–15× the size and no better than the source looked.
// What the source spent is the most its pictures can be worth.
export type RateCap = {
  // kb/s
  maxrate: number;
  // kbit
  bufsize: number;
};

// How many of H.264's bits a codec needs for the same picture, roughly. A
// source in a more efficient codec than the result's gets that much more to
// spend: an HEVC clip held to its own bitrate in H.264 would come out
// visibly worse than it went in. The other way round the ceiling stays the
// source's own rate (a factor below 1 would not match the source, it would
// second-guess it).
const BITS_VS_H264: Record<string, number> = {
  hevc: 1 / 1.5,
  vp9: 1 / 1.4,
  av1: 1 / 1.8,
};

export function codecFactor(sourceCodec: string, resultCodec: string): number {
  const source = BITS_VS_H264[sourceCodec] ?? 1;
  const result = BITS_VS_H264[resultCodec] ?? 1;
  return Math.max(1, result / source);
}

// `sourceKbps` is the source's video stream alone; null (nothing known to
// compare with: stills, a stream without duration) means no ceiling.
// `seconds` is the length of the result. `factor` is what a second of the
// result may spend over what a second of the source did: the codec's
// (codecFactor) times the pace its frames go by at (Render.pace).
export function rateCap(
  sourceKbps: number | null,
  quality: number,
  seconds: number,
  factor = 1,
): RateCap | null {
  if (!sourceKbps) return null;
  const maxrate = Math.max(8, Math.round((sourceKbps * factor * quality) / 100));
  // The buffer is how far a busy stretch may run ahead of the rate: about a
  // sixth of the clip keeps the whole file within ~15% of rate × duration
  // (measured on x264), half a second to two seconds' worth at the ends so
  // that short clips still get to open on a full-size keyframe and long
  // ones stay streamable.
  const window = Math.min(2, Math.max(0.5, seconds / 6));
  return { maxrate, bufsize: Math.round(maxrate * window) };
}
