import { InputError } from "../errors.js";
import type { Encoder } from "./index.js";
import {
  conversionFps,
  encodeWithinBudget,
  graphArgs,
  levelRange,
  scaledSize,
} from "./render.js";
import { vpxCrf } from "./video.js";

// libaom is slow enough that long or large clips would blow the 300s
// function timeout, so animated AVIF gets two ceilings: seconds, and the
// pixels there are to encode (what 60s at 30 fps and 800×450 come to, the
// most a conversion's 800px cap ever asked of it).
const MAX_AVIF_SECONDS = 60;
const MAX_AVIF_PIXELS = 60 * 30 * 800 * 450;

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
  // No explicit fps → match the pictures, up to 30; no width → as they are.
  // A conversion caps the width at 800 like the other animated-image
  // formats. (A tool that hands an AVIF back asks for the AVIF's own.)
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
  // AV1 crf mapped like the webm encoder's (vpxCrf).
  const crf = vpxCrf(quality);
  if (lossless || !cap || frames >= RATE_CONTROL_MIN_FRAMES) {
    await encode(crf, cap && !lossless ? `${cap.maxrate}k` : "0", outputFile);
    return;
  }
  // The crf the slider stands for and every coarser one down to its bottom,
  // against the bytes the rate comes to over the clip.
  await encodeWithinBudget(ff, {
    outputFile,
    levels: levelRange(crf, vpxCrf(1)),
    budget: ((cap.maxrate * 1000) / 8) * duration,
    encode: (level, to) => encode(level, "0", to),
  });
};
