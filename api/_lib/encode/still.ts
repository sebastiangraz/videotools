import fs from "node:fs/promises";
import path from "node:path";
import type { StillId } from "../../../shared/formats.js";
import type { ToolJob } from "../tools/types.js";
import {
  bisect,
  graphArgs,
  hasAlpha,
  levelRange,
  TOOL_ALLOWANCE,
  type Render,
} from "./render.js";
import { WEBP_LOSSLESS, webpLevels } from "./webp.js";

const JPEG_COARSEST = 31;

const jpegLevels = (quality: number) =>
  levelRange(
    Math.round(1 + ((100 - quality) / 99) * (JPEG_COARSEST - 1)),
    JPEG_COARSEST,
  );

// PNG is always lossless; WebP only at 100 from a lossless source. Lossy
// stills are capped at quality% of the source's bytes (+TOOL_ALLOWANCE):
// uncapped, libwebp 100 came to 3.2× a photo saved at 85.
export async function encodeStill(
  { ff, workDir }: Pick<ToolJob, "ff" | "workDir">,
  render: Render,
  { format: still, quality }: { format: StillId; quality: number },
): Promise<string> {
  const pixFmt = render.source?.profile.pixFmt ?? "";
  console.log(`Encoding ${still} (quality ${quality})...`);
  const outputFile = path.join(workDir, `output.${still}`);
  let pictures = render;
  const encode = (codecArgs: string[], to = outputFile) =>
    ff.runFFmpeg([
      ...graphArgs(pictures, [], "rgba"),
      "-frames:v",
      "1",
      ...codecArgs,
      "-an",
      to,
    ]);

  if (still === "png") {
    await encode([
      "-c:v",
      "png",
      "-pix_fmt",
      hasAlpha(pixFmt) ? "rgba" : "rgb24",
    ]);
    return outputFile;
  }
  // ffmpeg's WebP decoder gives lossless pictures as argb, lossy ones as
  // yuv(a)420p. libwebp takes bgra either way, and drops an opaque alpha.
  if (still === "webp" && quality >= 100 && pixFmt === "argb") {
    await encode(["-c:v", "libwebp", ...WEBP_LOSSLESS]);
    return outputFile;
  }

  const levels = still === "jpg" ? jpegLevels(quality) : webpLevels(quality);
  // Grey, CMYK and odd subsamplings get full chroma: the logo may add colour.
  const jpegPixFmt = /^yuvj4(20|22|44)p$/.test(pixFmt) ? pixFmt : "yuvj444p";
  const codecArgs = (level: number) =>
    still === "jpg"
      ? [
          "-c:v",
          "mjpeg",
          // -q:v stops at 2 unless the floor is lowered with it.
          "-qmin",
          "1",
          "-q:v",
          String(level),
          "-pix_fmt",
          jpegPixFmt,
        ]
      : // "icon" for the same reason as in webp.ts.
        [
          "-c:v",
          "libwebp",
          "-q:v",
          String(level),
          "-preset",
          "icon",
          "-pix_fmt",
          "bgra",
        ];

  const ceiling = render.source
    ? (await fs.stat(render.source.path)).size *
      (quality / 100) *
      TOOL_ALLOWANCE
    : Infinity;
  let written = -1;
  const fits = async (index: number) => {
    await encode(codecArgs(levels[index]));
    written = index;
    return (await fs.stat(outputFile)).size <= ceiling;
  };
  if (await fits(0)) return outputFile;

  // Render the graph once to a fast lossless PNG so retries only re-encode.
  const marked = path.join(workDir, "marked.png");
  await encode(
    ["-c:v", "png", "-compression_level", "1", "-pix_fmt", "rgba"],
    marked,
  );
  pictures = {
    ...render,
    inputArgs: ["-i", marked],
    filter: undefined,
    source: null,
  };

  const { pick } = await bisect(levels.length, fits);
  console.log(
    `Over the ${Math.round(ceiling)} bytes its source allows at ` +
      `${levels[0]}: settled on ${levels[pick]}`,
  );
  if (written !== pick) await encode(codecArgs(levels[pick]));
  return outputFile;
}
