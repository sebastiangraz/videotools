// Quality 100 caps the rate at GENERATION × the source's, on top of crf
// (a ceiling, not a target): crf alone re-encodes source artifacts at 5–15×
// the size. At 1× the source rate x264 VBV visibly blocks gradients (47 vs
// 57 dB PSNR at 2×), so 100 ≈ visually the source and 50 ≈ its size.
export const GENERATION = 2;

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

// `sourceKbps` null means no ceiling. `factor` = codecFactor × Render.pace.
export function rateCap(
  sourceKbps: number | null,
  quality: number,
  seconds: number,
  factor = 1,
): RateCap | null {
  if (!sourceKbps) return null;
  const maxrate = Math.max(
    8,
    Math.round((sourceKbps * factor * GENERATION * quality) / 100),
  );
  // ~1/6 of the clip keeps the file within ~15% of rate × duration (x264);
  // ≥0.5s so short clips open on a full keyframe, ≤2s to stay streamable.
  const window = Math.min(2, Math.max(0.5, seconds / 6));
  return { maxrate, bufsize: Math.round(maxrate * window) };
}
