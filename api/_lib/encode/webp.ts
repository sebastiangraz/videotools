import fs from "node:fs/promises";
import type { Source } from "../source.js";
import type { Encoder } from "./index.js";
import { TIME_BUDGET_MS, graphArgs, sourceBytesBudget } from "./render.js";

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

// Whether an animated WebP was saved lossless: every frame's picture is a
// VP8L chunk, where a lossy one is "VP8 " (behind an ALPH chunk if it has
// alpha), and a mixed file (gif2webp -mixed) has both. ffmpeg decodes every
// kind to argb, so the probe can't tell. The file is "RIFF" size "WEBP",
// then chunks of fourcc, little-endian size and data padded to an even
// length; an ANMF chunk's data is a 16-byte frame header followed by the
// frame's own chunks, which the walk steps into. Only the headers are read,
// a few per frame: the pictures (and an ICC profile) are skipped.
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
    let lossless = false;
    let at = 12;
    for (let chunk = await chunkAt(at); chunk; chunk = await chunkAt(at)) {
      if (chunk.tag === "VP8 ") return false;
      if (chunk.tag === "VP8L") lossless = true;
      at += chunk.tag === "ANMF" ? 8 + 16 : 8 + chunk.size + (chunk.size % 2);
    }
    return lossless;
  } finally {
    await handle.close();
  }
}

// Codecs that keep every pixel they are given. The lossy ones (H.264, VP9,
// AV1, ...) only do in their RGB mode, which decodes as planar gbr.
const LOSSLESS_CODECS = [
  "gif",
  "png",
  "apng",
  "ffv1",
  "utvideo",
  "huffyuv",
  "ffvhuff",
  "qtrle",
  "rawvideo",
];

// Whether a source's pictures are still as they were made, so a lossless
// WebP keeps something: pictures a tool drew from nothing but stills (no
// source) are, and so is a GIF, a lossless WebP, or lossless AV1. A lossy
// source written lossless would be many times its size for nothing: its
// losses are in the pixels already, and lossless stores them as detail
// (AVIF at 100 came to 31× its source).
export async function isLosslessSource(source: Source | null): Promise<boolean> {
  if (!source) return true;
  if (source.format === "webp") return isLosslessWebp(source.path);
  const { codec, pixFmt } = source.profile;
  return LOSSLESS_CODECS.includes(codec) || pixFmt.startsWith("gbr");
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
  // formats. (A tool that hands a WebP back asks for the WebP's own, and
  // its pictures already come at that rate.)
  const rate = Math.min(fps ?? Math.min(render.fps, 30), MAX_WEBP_FPS);
  const input = graphArgs(
    render,
    [
      ...(everyFrame ? [] : [`fps=${rate}`]),
      ...(width == null ? [] : [`scale='min(${width},iw)':-2:flags=lanczos`]),
    ],
    "bgra",
  );
  // Lossless only for pictures that are (isLosslessSource); a lossy source
  // at 100 gets libwebp's finest lossy setting instead (as a still does,
  // still.ts).
  const lossless = quality >= 100 && (await isLosslessSource(render.source));
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

  // Each try is written next to the result and kept only if it is better:
  // the finest one that fits, or failing that the smallest one yet.
  const tryFile = `${outputFile}.try.webp`;
  const encode = (level: number, to = outputFile) =>
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
      to,
    ]);
  const levels = webpLevels(quality);
  const budget = await sourceBytesBudget(
    render,
    "webp",
    render.duration * render.fps,
    quality / 100,
  );
  let started = Date.now();
  await encode(levels[0]);
  const fits = async (file: string) =>
    (await fs.stat(file)).size <= (budget ?? Infinity);
  if (await fits(outputFile)) return;

  // libwebp has no rate control, and at the slider's top its finest setting
  // encodes a lossy source's artifacts as detail (it came to over twice the
  // source's bytes a frame). So a result over its source's ceiling is
  // encoded again coarser, bisecting the settings the slider has left, while
  // the function's time allows (a try costs about what the last one did).
  // `over` is the coarsest setting known to be too big, `pick` the finest
  // one that may fit.
  let over = 0;
  let pick = levels.length - 1;
  let fitted = false;
  while (pick - over > 1) {
    const took = Date.now() - started;
    if (Date.now() - ff.startedAt + took > TIME_BUDGET_MS) break;
    const middle = Math.floor((over + pick) / 2);
    started = Date.now();
    await encode(levels[middle], tryFile);
    const fit = await fits(tryFile);
    if (fit) pick = middle;
    else over = middle;
    // A try that fits is finer than any before it that did; one that
    // doesn't is coarser, so smaller, than everything tried so far.
    if (fit || !fitted) await fs.rename(tryFile, outputFile);
    fitted ||= fit;
  }
  await fs.rm(tryFile, { force: true });
  console.log(
    `Over the ${Math.round(budget ?? 0)} bytes its source allows at ` +
      `${levels[0]}: settled on ${fitted ? levels[pick] : levels[over]}`,
  );
};
