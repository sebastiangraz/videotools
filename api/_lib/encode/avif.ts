import { InputError } from "../errors.js";
import type { Encoder } from "./index.js";
import { conversionFps, encodeWithinBudget, graphArgs, levelRange, scaledSize } from "./render.js";
import { vpxCrf } from "./video.js";

// libaom is slow: keeps within the 300s function limit. Pixels = 60s at
// 30fps and 800×450, the most a conversion asks.
const MAX_AVIF_SECONDS = 60;
const MAX_AVIF_PIXELS = 60 * 30 * 800 * 450;

// A screen's limit; the format has none (GIF/WebP's are in their delays).
export const MAX_AVIF_FPS = 60;

// On a few frames libaom's rate control starves the inter frames (a third
// of the source's at three frames), so short results use crf + byte budget.
const RATE_CONTROL_MIN_FRAMES = 32;

// Up to this many frames libaom can afford a slower, tighter encode.
const SHORT_CLIP_FRAMES = 100;

export const encodeAvif: Encoder = async (
  ff,
  render,
  {
    outputFile,
    quality,
    fps = null,
    width = 800,
    everyFrame = false,
    lossless = false,
    chroma444 = false,
    cap,
  },
) => {
  const { duration } = render;
  if (duration > MAX_AVIF_SECONDS) {
    throw new InputError(
      `Video too long for AVIF: ${Math.round(duration)}s exceeds the ` +
        `${MAX_AVIF_SECONDS}s limit (AVIF encoding is ` +
        `slow). Trim the video or pick another format.`,
      "too-long",
    );
  }
  fps ??= conversionFps(render);
  const size = scaledSize(render, width);
  if (duration * fps * size.width * size.height > MAX_AVIF_PIXELS) {
    throw new InputError(
      `Video too long for AVIF at this size: ${Math.round(duration)}s of ` +
        `${Math.round(size.width)}×${Math.round(size.height)} ` +
        `at ${fps} fps is more than the app can encode in time (AVIF ` +
        `encoding is slow). Use a shorter or smaller clip.`,
      "too-long",
    );
  }
  const frames = duration * fps;
  const cpuUsed = frames <= SHORT_CLIP_FRAMES ? "6" : "8";
  // gbrp + lossless=1 is bit-exact (verified PSNR = inf); yuv420p halves
  // colour detail whatever the crf.
  const pixFmt = lossless ? "gbrp" : chroma444 ? "yuv444p" : "yuv420p";
  // The trunc in the scale keeps odd sources even for yuv420p.
  const encode = (crf: number, bitrate: string, to: string) =>
    ff.runFFmpeg([
      ...graphArgs(
        render,
        [
          ...(everyFrame ? [] : [`fps=${fps}`]),
          `scale='trunc(${width == null ? "iw" : `min(${width},iw)`}/2)*2':-2:flags=lanczos`,
        ],
        pixFmt,
      ),
      "-c:v",
      "libaom-av1",
      "-crf",
      lossless ? "0" : String(crf),
      // Constrained quality: crf up to this rate; 0 = no ceiling.
      "-b:v",
      bitrate,
      ...(lossless ? ["-aom-params", "lossless=1"] : []),
      "-cpu-used",
      cpuUsed,
      "-row-mt",
      "1",
      "-threads",
      "0",
      "-pix_fmt",
      pixFmt,
      "-an",
      "-f",
      "avif",
      to,
    ]);
  const crf = vpxCrf(quality);
  if (lossless || !cap || frames >= RATE_CONTROL_MIN_FRAMES) {
    await encode(crf, cap && !lossless ? `${cap.maxrate}k` : "0", outputFile);
    return;
  }
  await encodeWithinBudget(ff, {
    outputFile,
    levels: levelRange(crf, vpxCrf(1)),
    budget: ((cap.maxrate * 1000) / 8) * duration,
    encode: (level, to) => encode(level, "0", to),
  });
};
