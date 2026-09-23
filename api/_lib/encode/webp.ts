import fs from "node:fs/promises";
import { TIME_BUDGET_MS } from "./gif.js";
import type { Encoder } from "./index.js";
import { graphArgs, type Render } from "./render.js";

// A frame's delay is whole milliseconds, but browsers slow anything under
// 20 down, as they do a GIF's: 50 is the most frames a second it can show.
export const MAX_WEBP_FPS = 50;

// The slider maps to 65–100 rather than libwebp's raw scale: below ~83
// VP8 quantizes fine texture down to per-block averages, which reads as
// a block grid on solid colors (x264 at the same slider position
// preserves texture, so the formats would look wildly different at
// "equal" quality). The same for a still (still.ts).
export const webpQuality = (quality: number) =>
  Math.round(65 + (quality / 100) * 35);

// The libwebp settings the slider stands for, finest first: the one it maps
// to and every coarser one down to the slider's own bottom, which is as far
// as a size ceiling may take a picture (here and in still.ts).
export const webpLevels = (quality: number) =>
  Array.from(
    { length: webpQuality(quality) - webpQuality(1) + 1 },
    (_, i) => webpQuality(quality) - i,
  );

// What a WebP that went in as a WebP may weigh, as a still is held to its
// source's bytes (still.ts): the source's, by the frame (a sped-up WebP
// keeps all of its frames), times the slider's share, plus a tenth for what
// a tool adds. Null for every other source: a WebP of a video is never the
// video's size.
async function webpBudget(render: Render, quality: number): Promise<number | null> {
  const { source } = render;
  if (source?.format !== "webp") return null;
  const { duration, fps } = source.profile;
  const sourceFrames = duration * (fps ?? 0);
  if (!(sourceFrames > 0)) return null;
  const frames = render.duration * render.fps;
  const { size } = await fs.stat(source.path);
  return size * (frames / sourceFrames) * (quality / 100) * 1.1;
}

// Whether an animated WebP was saved lossless: its first frame's picture is
// a VP8L chunk, where a lossy one is "VP8 " (behind an ALPH chunk if it has
// alpha). ffmpeg decodes both kinds to argb, so the probe can't tell. The
// file is "RIFF" size "WEBP", then chunks of fourcc, little-endian size and
// data padded to an even length; an ANMF chunk's data is a 16-byte frame
// header followed by the frame's own chunks. The headers are read one at a
// time, skipping the data: an ICC profile in front can be any size.
export async function isLosslessWebp(file: string): Promise<boolean> {
  const handle = await fs.open(file, "r");
  try {
    const header = new Uint8Array(8);
    const chunkAt = async (at: number) => {
      const { bytesRead } = await handle.read(header, 0, 8, at);
      if (bytesRead < 8) return null;
      return {
        tag: String.fromCharCode(...header.subarray(0, 4)),
        size: new DataView(header.buffer).getUint32(4, true),
      };
    };
    let at = 12;
    for (let chunk = await chunkAt(at); chunk; chunk = await chunkAt(at)) {
      if (chunk.tag === "ANMF") {
        at += 8 + 16;
        continue;
      }
      if (chunk.tag === "VP8L") return true;
      if (chunk.tag === "VP8 ") return false;
      at += 8 + chunk.size + (chunk.size % 2);
    }
    return false;
  } finally {
    await handle.close();
  }
}

// Animated WebP is intra-only (every frame is a standalone lossy still), so
// output often exceeds the source video's size — inherent to the format, not
// the settings. Don't be tempted by cr_threshold: its block skipping leaves
// stale gray squares in flat/dark/bright regions, for a measured saving of
// only a few percent.
export const encodeWebp: Encoder = async (
  ff,
  render,
  outputFile,
  { quality, fps = null, width = 800, everyFrame = false },
) => {
  // No explicit fps → match the pictures, up to 30; no width → as they are.
  // A conversion caps the width at 800 like the other animated-image
  // formats. (A tool that hands a WebP back asks for the WebP's own.)
  fps = Math.min(fps ?? Math.min(render.fps, 30), MAX_WEBP_FPS);
  const input = graphArgs(
    render,
    [
      ...(everyFrame ? [] : [`fps=${fps}`]),
      ...(width == null ? [] : [`scale='min(${width},iw)':-2:flags=lanczos`]),
    ],
    "bgra",
  );
  // A lossy WebP written lossless would be several times its size for
  // nothing: its losses are in the pixels already (as for a still, still.ts).
  const { source } = render;
  const lossless =
    quality >= 100 &&
    (source?.format !== "webp" || (await isLosslessWebp(source.path)));
  if (lossless) {
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
    return;
  }

  const encode = (level: number) =>
    ff.runFFmpeg([
      ...input,
      "-c:v",
      "libwebp_anim",
      "-q:v",
      String(level),
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
  const levels = webpLevels(quality);
  const budget = await webpBudget(render, quality);
  let started = Date.now();
  await encode(levels[0]);
  const fits = async () => (await fs.stat(outputFile)).size <= (budget ?? Infinity);
  if (await fits()) return;

  // libwebp has no rate control, and at the slider's top its finest setting
  // encodes a lossy source's artifacts as detail (it came to over twice
  // the source's bytes a frame). So a result over its source's ceiling is encoded again coarser,
  // bisecting the settings the slider has left, while the function's time
  // allows (a try costs what the first one did). `over` is the coarsest
  // setting known to be too big, `pick` the finest one that may fit.
  let over = 0;
  let pick = levels.length - 1;
  let written = 0;
  while (pick - over > 1) {
    const took = Date.now() - started;
    // Room for this try and, should it not fit, the one at `pick`.
    if (Date.now() - ff.startedAt + 2 * took > TIME_BUDGET_MS) break;
    const middle = Math.floor((over + pick) / 2);
    started = Date.now();
    await encode(levels[middle]);
    written = middle;
    if (await fits()) pick = middle;
    else over = middle;
  }
  console.log(
    `Over the ${Math.round(budget ?? 0)} bytes its source allows at ` +
      `${levels[0]}: settled on ${levels[pick]}`,
  );
  if (written !== pick) await encode(levels[pick]);
};
