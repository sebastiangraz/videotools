import type { Encoder } from "./index.js";
import { graphArgs } from "./render.js";

// The slider maps to 65–100 rather than libwebp's raw scale: below ~83
// VP8 quantizes fine texture down to per-block averages, which reads as
// a block grid on solid colors (x264 at the same slider position
// preserves texture, so the formats would look wildly different at
// "equal" quality). The same for a still (still.ts).
export const webpQuality = (quality: number) =>
  Math.round(65 + (quality / 100) * 35);

// Animated WebP is intra-only (every frame is a standalone lossy still), so
// output often exceeds the source video's size — inherent to the format, not
// the settings. Don't be tempted by cr_threshold: its block skipping leaves
// stale gray squares in flat/dark/bright regions, for a measured saving of
// only a few percent.
export const encodeWebp: Encoder = async (
  ff,
  render,
  outputFile,
  { quality },
) => {
  const fps = Math.min(render.fps, 30);
  const input = graphArgs(
    render,
    [`fps=${fps}`, "scale='min(800,iw)':-2:flags=lanczos"],
    "bgra",
  );
  if (quality >= 100) {
    // True lossless (relative to the decoded RGB frames): no VP8
    // quantization at all, so none of its block-grid artifacts on solid
    // colors. -q:v in lossless mode means compression effort, not fidelity.
    // Expect large files.
    await ff.runFFmpeg([
      ...input,
      "-c:v",
      "libwebp_anim",
      "-lossless",
      "1",
      "-q:v",
      "75",
      "-pix_fmt",
      "bgra",
      "-loop",
      "0",
      "-an",
      outputFile,
    ]);
  } else {
    await ff.runFFmpeg([
      ...input,
      "-c:v",
      "libwebp_anim",
      "-q:v",
      String(webpQuality(quality)),
      // "icon" despite the name: it disables spatial noise shaping, which
      // otherwise starves flat/solid regions of bits and leaves a faint
      // block grid there. Measured better PSNR than the default on both
      // flat and detailed content (~12% larger on detail-heavy frames).
      "-preset",
      "icon",
      "-loop",
      "0",
      "-an",
      outputFile,
    ]);
  }
};
