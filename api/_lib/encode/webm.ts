import type { Encoder } from "./index.js";
import { EVEN_SCALE } from "./h264.js";
import { audioArgs, graphArgs } from "./render.js";

// VP9 + Opus.
export const encodeWebm: Encoder = async (
  ff,
  render,
  outputFile,
  { quality },
  cap,
) => {
  // VP9 crf: 0 best – 63 worst; quality 100 → 10, quality 1 → 50.
  const crf = String(Math.round(50 - (quality / 100) * 40));
  await ff.runFFmpeg([
    ...graphArgs(render, [EVEN_SCALE], "yuv420p"),
    "-c:v",
    "libvpx-vp9",
    "-crf",
    crf,
    // With a bitrate next to it, crf is "constrained quality": the quality
    // to aim for, up to that rate. 0 = no ceiling. One-pass VP9 stays well
    // under the rate it is given (around 0.8×); a second pass would fix
    // that at twice the time, which the function's limit doesn't have.
    "-b:v",
    cap ? `${cap.maxrate}k` : "0",
    "-row-mt",
    "1",
    "-cpu-used",
    "4",
    "-deadline",
    "good",
    "-pix_fmt",
    "yuv420p",
    // Opus rejects some surround layouts, so downmix to stereo.
    ...audioArgs(
      render,
      ["opus", "vorbis"],
      ["-c:a", "libopus", "-b:a", "128k", "-ac", "2"],
    ),
    outputFile,
  ]);
};
