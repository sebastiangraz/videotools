import fs from "node:fs/promises";
import type { Source } from "../source.js";
import type { Encoder } from "./index.js";
import {
  conversionFps,
  encodeWithinBudget,
  fitWidth,
  graphArgs,
  levelRange,
  sourceBytesBudget,
} from "./render.js";

// Browsers slow frame delays under 20ms, as for GIF.
export const MAX_WEBP_FPS = 50;

// Maps to 65–100: below ~83 VP8 flattens texture into a block grid on solid
// colours, while x264 at the same slider keeps it.
const webpQuality = (quality: number) =>
  Math.round(65 + (quality / 100) * 35);

export const webpLevels = (quality: number) =>
  levelRange(webpQuality(quality), webpQuality(1));

// In lossless mode -q:v is compression effort, not fidelity. libwebp drops an
// opaque alpha.
export const WEBP_LOSSLESS = ["-lossless", "1", "-q:v", "75", "-pix_fmt", "bgra"];

// ffmpeg decodes every WebP to argb, so walk the RIFF chunks: lossless means
// only VP8L, no "VP8 " (mixed files have both). ANMF data starts with a
// 16-byte frame header, then the frame's chunks.
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

// Lossy codecs are lossless only in RGB mode, which decodes as planar gbr.
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

// A lossy source written lossless is many times its size for nothing: its
// artifacts get stored as detail (AVIF at 100 came to 31× its source).
export async function isLosslessSource(source: Source | null): Promise<boolean> {
  if (!source) return true;
  if (source.format === "webp") return isLosslessWebp(source.path);
  const { codec, pixFmt } = source.profile;
  return LOSSLESS_CODECS.includes(codec) || pixFmt.startsWith("gbr");
}

// Intra-only, so often bigger than the source video. Avoid cr_threshold: it
// leaves stale gray squares for a few percent saved.
export const encodeWebp: Encoder = async (
  ff,
  render,
  { outputFile, quality, fps = null, width = 800, everyFrame = false },
) => {
  const rate = Math.min(fps ?? conversionFps(render), MAX_WEBP_FPS);
  const input = graphArgs(
    render,
    [
      ...(everyFrame ? [] : [`fps=${rate}`]),
      ...(width == null ? [] : [fitWidth(width)]),
    ],
    "bgra",
  );
  const lossless = quality >= 100 && (await isLosslessSource(render.source));
  if (lossless) {
    await ff.runFFmpeg([
      ...input,
      "-c:v",
      "libwebp_anim",
      ...WEBP_LOSSLESS,
      "-loop",
      "0",
      "-an",
      outputFile,
    ]);
    return;
  }

  const encode = (level: number, to: string) =>
    ff.runFFmpeg([
      ...input,
      "-c:v",
      "libwebp_anim",
      "-q:v",
      String(level),
      // "icon" disables spatial noise shaping, which starves flat regions
      // into a block grid; better PSNR everywhere (~12% larger on detail).
      "-preset",
      "icon",
      "-loop",
      "0",
      "-an",
      to,
    ]);
  // No rate control: at the top, a lossy source's artifacts came to over 2×
  // its bytes a frame.
  await encodeWithinBudget(ff, {
    outputFile,
    levels: webpLevels(quality),
    budget: await sourceBytesBudget(
      render,
      "webp",
      render.duration * render.fps,
      quality / 100,
    ),
    encode,
  });
};
