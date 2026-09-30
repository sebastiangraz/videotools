import type { Encoder } from "./index.js";
import type { RateCap } from "./rate.js";
import { audioArgs, graphArgs } from "./render.js";

// yuv420p needs even dimensions and odd-sized sources exist.
const EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

// An mp4's index up front, so it plays before it has fully downloaded.
export const FASTSTART = ["-movflags", "+faststart"];

// x264 crf: 0 best – 51 worst; quality 100 → 1 (visually lossless — true
// lossless x264 forces the High 4:4:4 profile most players reject),
// quality 1 → 35. On its own crf 1 is many times the size of any delivered
// source; next to the source's bitrate as a ceiling (x264Cap) it means
// "spend all of it", which is what matching the source takes.
function x264Crf(quality: number): string {
  return String(Math.max(1, Math.round(35 - (quality / 100) * 34)));
}

// VP9 and AV1 crf: 0 best – 63 worst; quality 100 → 10, quality 1 → 50.
export const vpxCrf = (quality: number) => Math.round(50 - (quality / 100) * 40);

// x264's ceiling on top of its crf (rate.ts): crf decides up to the rate the
// source spent, and the VBV buffer holds it there.
function x264Cap(cap: RateCap | null): string[] {
  return cap
    ? ["-maxrate", `${cap.maxrate}k`, "-bufsize", `${cap.bufsize}k`]
    : [];
}

// mp4 / mov: H.264 + AAC.
const encodeH264 =
  (faststart: boolean): Encoder =>
  async (ff, render, { outputFile, quality, cap }) => {
    await ff.runFFmpeg([
      ...graphArgs(render, [EVEN_SCALE], "yuv420p"),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      x264Crf(quality),
      ...x264Cap(cap),
      "-pix_fmt",
      "yuv420p",
      ...audioArgs(render, ["aac"], ["-c:a", "aac", "-b:a", "192k"]),
      ...(faststart ? FASTSTART : []),
      outputFile,
    ]);
  };

export const encodeMp4 = encodeH264(true);
export const encodeMov = encodeH264(false);

// VP9 + Opus.
export const encodeWebm: Encoder = async (ff, render, { outputFile, quality, cap }) => {
  await ff.runFFmpeg([
    ...graphArgs(render, [EVEN_SCALE], "yuv420p"),
    "-c:v",
    "libvpx-vp9",
    "-crf",
    String(vpxCrf(quality)),
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
