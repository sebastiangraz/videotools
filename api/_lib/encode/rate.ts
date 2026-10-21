// Quality 100 caps the rate at GENERATION × the source's peak, on top of crf
// (a ceiling, not a target): crf alone re-encodes source artifacts at 5–15×
// the size. At 1× the source rate x264 VBV visibly blocks gradients (47 vs
// 57 dB PSNR at 2×). At 2× crf 1 keeps the buffer drained, so keyframes at
// scene cuts and fast motion still starved (SSIM 0.92, VMAF 82 on the worst
// frames); 3× clears them, so 100 ≈ the source.
export const GENERATION = 3;

// Nor below this many bits per output pixel: on near-still frames x264 VBV
// plans for far more than it spends, so a lean source at a large size starved
// at a fifth of its cap. A bigger buffer fixed it too, but grew small busy clips.
const MIN_BITS_PER_PIXEL = 0.01;

export type RateCap = {
  // kb/s
  maxrate: number;
  // kbit
  bufsize: number;
};

// Bits needed relative to H.264. A more efficient source codec raises the
// ceiling (HEVC at its own rate in H.264 looks worse); never lowers it.
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

// `packets` (the source's video) null means no ceiling. `factor` =
// codecFactor × Render.pace. `pixels`: the output's pixels per second.
export function rateCap(
  packets: { time: number; duration: number; size: number }[] | null,
  quality: number,
  seconds: number,
  factor = 1,
  pixels = 0,
): RateCap | null {
  // ~1/6 of the clip keeps the file within ~15% of rate × duration (x264);
  // ≥0.5s so short clips open on a full keyframe, ≤2s to stay streamable.
  const window = Math.min(2, Math.max(0.5, seconds / 6));
  // The source's peak over the buffer's span, not its average: a clip that
  // mostly holds still would leave its busy second or a keyframe starving.
  const sorted = [...(packets ?? [])].sort((a, b) => a.time - b.time);
  const span = Math.min(
    window,
    sorted.reduce((sum, p) => sum + p.duration, 0),
  );
  if (!span) return null;
  let peak = 0;
  let bytes = 0;
  let start = 0;
  for (const packet of sorted) {
    bytes += packet.size;
    while (sorted[start].time <= packet.time - span) bytes -= sorted[start++].size;
    peak = Math.max(peak, bytes);
  }
  const sourceKbps = (peak * 8) / 1000 / span;
  const ceiling = Math.max(sourceKbps * factor * GENERATION, (pixels * MIN_BITS_PER_PIXEL) / 1000);
  const maxrate = Math.max(8, Math.round((ceiling * quality) / 100));
  return { maxrate, bufsize: Math.round(maxrate * window) };
}
