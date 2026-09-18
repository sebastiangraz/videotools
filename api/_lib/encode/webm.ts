import type { Encoder } from "./index.js";
import { EVEN_SCALE } from "./h264.js";

// VP9 + Opus.
export const encodeWebm: Encoder = async (
  ff,
  inputFile,
  outputFile,
  { quality },
) => {
  // VP9 crf: 0 best – 63 worst; quality 100 → 10, quality 1 → 50.
  const crf = String(Math.round(50 - (quality / 100) * 40));
  await ff.runFFmpeg([
    "-y",
    "-i",
    inputFile,
    "-vf",
    EVEN_SCALE,
    "-c:v",
    "libvpx-vp9",
    "-crf",
    crf,
    "-b:v",
    "0",
    "-row-mt",
    "1",
    "-cpu-used",
    "4",
    "-deadline",
    "good",
    "-pix_fmt",
    "yuv420p",
    // Opus rejects some surround layouts, so downmix to stereo.
    "-c:a",
    "libopus",
    "-b:a",
    "128k",
    "-ac",
    "2",
    outputFile,
  ]);
};
