import { InputError } from "../errors.js";
import type { Encoder } from "./index.js";
import { graphArgs } from "./render.js";

// libaom is slow enough that long or large clips would blow the 300s
// function timeout, so animated AVIF gets two ceilings: seconds, and the
// pixels there are to encode (what 60s at 30 fps and 800×450 come to, the
// most a conversion's 800px cap ever asked of it).
export const MAX_AVIF_SECONDS = 60;
export const MAX_AVIF_PIXELS = 60 * 30 * 800 * 450;

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
  // AV1 crf mapped like the webm encoder: quality 100 → 10, quality 1 → 50.
  // The trunc keeps odd sources even for yuv420p.
  const crf = Math.round(50 - (quality / 100) * 40);
  // A handful of frames can afford a slower, tighter encode.
  const cpuUsed = duration * fps <= 100 ? "6" : "8";
  // Truly lossless: planar RGB (gbrp) skips the RGB→YUV rounding and chroma
  // subsampling, and aom's lossless mode skips quantization. Verified
  // bit-exact against source frames (PSNR = inf). Short of that, full chroma
  // resolution (yuv420p halves colour detail regardless of crf).
  const pixFmt = lossless ? "gbrp" : chroma444 ? "yuv444p" : "yuv420p";
  await ff.runFFmpeg([
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
    cap && !lossless ? `${cap.maxrate}k` : "0",
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
    outputFile,
  ]);
};
