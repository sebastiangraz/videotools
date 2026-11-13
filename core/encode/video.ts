import { InputError } from "../errors.js";
import type { FFmpeg } from "../ffmpeg.js";
import { sizeLabel } from "../helpers.js";
import type { Encoder } from "./index.js";
import type { RateCap } from "./rate.js";
import { audioArgs, graphArgs, type Render } from "./render.js";

// yuv420p needs even dimensions and odd-sized sources exist.
const EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

// Index up front so it plays while downloading.
export const FASTSTART = ["-movflags", "+faststart"];

// Quality 100 → crf 1 (crf 0 forces High 4:4:4, which most players reject),
// 1 → 35. crf 1 relies on the rate cap to mean "spend the source's rate".
function x264Crf(quality: number): string {
  return String(Math.max(1, Math.round(35 - (quality / 100) * 34)));
}

// VP9 and AV1 crf: 0 best – 63 worst; quality 100 → 10, quality 1 → 50.
export const vpxCrf = (quality: number) => Math.round(50 - (quality / 100) * 40);

function x264Cap(cap: RateCap | null): string[] {
  return cap ? ["-maxrate", `${cap.maxrate}k`, "-bufsize", `${cap.bufsize}k`] : [];
}

// x264 holds its lookahead and, per thread, a frame with its reconstruction:
// megabytes per megapixel, measured at 4K beside a 10-bit decoder. Its own
// choice of 1.5 threads a core outgrows a fixed heap at 4K, and an encoder
// that can't allocate hangs rather than fails.
const X264_MB = { base: 245, thread: 15 };

export function x264Threads(ff: FFmpeg, { width, height, held = 0 }: Render): string[] {
  if (!ff.heap) return [];
  const megapixels = (width * height) / 1e6;
  const room = (ff.heap - held) / 2 ** 20 / megapixels;
  const fit = Math.floor((room - X264_MB.base) / X264_MB.thread);
  if (fit < 1) {
    throw new InputError(
      `Video too large to encode: ${sizeLabel(width, height)} frames don't fit in memory.`,
      "too-large",
    );
  }
  return ["-threads", String(Math.min(fit, Math.floor(navigator.hardwareConcurrency * 1.5)))];
}

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
      ...x264Threads(ff, render),
      "-pix_fmt",
      "yuv420p",
      ...audioArgs(render, ["aac"], ["-c:a", "aac", "-b:a", "192k"]),
      ...(faststart ? FASTSTART : []),
      outputFile,
    ]);
  };

export const encodeMp4 = encodeH264(true);
export const encodeMov = encodeH264(false);

export const encodeWebm: Encoder = async (ff, render, { outputFile, quality, cap }) => {
  await ff.runFFmpeg([
    ...graphArgs(render, [EVEN_SCALE], "yuv420p"),
    "-c:v",
    "libvpx-vp9",
    "-crf",
    String(vpxCrf(quality)),
    // Constrained quality: crf up to this rate; 0 = no ceiling. One-pass
    // lands ~0.8× the rate; two-pass would double the time we don't have.
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
    ...audioArgs(render, ["opus", "vorbis"], ["-c:a", "libopus", "-b:a", "128k", "-ac", "2"]),
    outputFile,
  ]);
};
