import { InputError } from "../errors.js";
import type { Encoder } from "./index.js";
import { encodeWithinBudget, graphArgs } from "./render.js";

// libaom is slow enough that long or large clips would blow the 300s
// function timeout, so animated AVIF gets two ceilings: seconds, and the
// pixels there are to encode (what 60s at 30 fps and 800×450 come to, the
// most a conversion's 800px cap ever asked of it).
export const MAX_AVIF_SECONDS = 60;
export const MAX_AVIF_PIXELS = 60 * 30 * 800 * 450;

// The format has no ceiling of its own (a GIF's or WebP's is in its delays),
// so this is a screen's: past it a speed-up drops frames rather than write
// ones nothing shows.
export const MAX_AVIF_FPS = 60;

// libaom's rate control is a target, not a ceiling, and it splits the rate
// between a keyframe and the frames after it the way a long run of pictures
// wants. With only a few, the inter frames get a fraction of what the
// source spent on them (measured: a third, at three frames) and the whole
// lands well under the rate. So a result of fewer frames than this is
// encoded at its crf alone and held to the rate's bytes the way the formats
// without rate control are (encodeWithinBudget); a handful of frames can
// afford the tries.
export const RATE_CONTROL_MIN_FRAMES = 32;

// AV1 crf mapped like the webm encoder: quality 100 → 10, quality 1 → 50.
const crfFor = (quality: number) => Math.round(50 - (quality / 100) * 40);

export const encodeAvif: Encoder = async (
  ff,
  render,
  outputFile,
  {
    quality,
    fps = null,
    width = 800,
    everyFrame = false,
    lossless = false,
    chroma444 = false,
  },
  cap,
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
  // No explicit fps → match the pictures, up to 30; no width → as they are.
  // A conversion caps the width at 800 like the other animated-image
  // formats. (A tool that hands an AVIF back asks for the AVIF's own.)
  fps ??= Math.min(render.fps, 30);
  const scale = width == null ? 1 : Math.min(1, width / render.width);
  const pixels = duration * fps * render.width * scale * render.height * scale;
  if (pixels > MAX_AVIF_PIXELS) {
    throw new InputError(
      `Video too long for AVIF at this size: ${Math.round(duration)}s of ` +
        `${Math.round(render.width * scale)}×${Math.round(render.height * scale)} ` +
        `at ${fps} fps is more than the app can encode in time (AVIF ` +
        `encoding is slow). Use a shorter or smaller clip.`,
      "too-long",
    );
  }
  const frames = duration * fps;
  // A handful of frames can afford a slower, tighter encode.
  const cpuUsed = frames <= 100 ? "6" : "8";
  // Truly lossless: planar RGB (gbrp) skips the RGB→YUV rounding and chroma
  // subsampling, and aom's lossless mode skips quantization. Verified
  // bit-exact against source frames (PSNR = inf). Short of that, full chroma
  // resolution (yuv420p halves colour detail regardless of crf).
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
      // Constrained quality, like the webm encoder: crf up to the source's
      // rate, or no ceiling (0) without one.
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
  const crf = crfFor(quality);
  if (lossless || !cap || frames >= RATE_CONTROL_MIN_FRAMES) {
    await encode(crf, cap && !lossless ? `${cap.maxrate}k` : "0", outputFile);
    return;
  }
  // The crf the slider stands for and every coarser one down to its bottom,
  // against the bytes the rate comes to over the clip.
  const levels = Array.from(
    { length: crfFor(1) - crf + 1 },
    (_, i) => crf + i,
  );
  await encodeWithinBudget(
    ff,
    outputFile,
    levels,
    (level, to) => encode(level, "0", to),
    ((cap.maxrate * 1000) / 8) * duration,
  );
};
