import fs from "node:fs/promises";
import path from "node:path";
import type { StillId } from "../../../shared/formats.js";
import type { FFmpeg } from "../ffmpeg.js";
import { graphArgs, hasAlpha, type Render } from "./render.js";
import { webpLevels } from "./webp.js";

// mjpeg's scale: 1 is its finest, 31 its coarsest.
const JPEG_COARSEST = 31;

// The codec settings the slider stands for, finest first: the one it maps to
// and every coarser one down to the slider's own bottom, which is as far as
// the size ceiling below may take a picture.
const range = (from: number, to: number) =>
  Array.from({ length: Math.abs(to - from) + 1 }, (_, i) =>
    from < to ? from + i : from - i,
  );
const JPEG_LEVELS = (quality: number) =>
  range(Math.round(1 + ((100 - quality) / 99) * (JPEG_COARSEST - 1)), JPEG_COARSEST);

// The stills' side of the output stage: the one picture a render of a still
// source comes to, written as the kind of image the source is (the mark tool
// is the only one that has any).
//   PNG   lossless whatever the slider says, with alpha if the source has it.
//         (8 bits a channel: the graphs composite in RGBA.)
//   JPEG  the slider runs over mjpeg's whole scale, 100 = its finest (-q:v 1),
//         at the source's chroma subsampling.
//   WebP  lossless at 100 if the source is; else lossy on the animated
//         encoder's curve (webp.ts). A lossy source written lossless would be
//         several times its size for nothing: its losses are in the pixels
//         already.
// Quality is relative to the source here too. A video is held to a share of
// its source's bitrate (rate.ts); a lossy still, which has no rate control,
// to the same share of its source's bytes, plus a tenth for what the mark
// adds. Without it 100 is the codec's finest whatever the source was saved
// at, and encodes its artifacts as detail: libwebp's 100 came to 3.2× a
// photo saved at 85. A picture over the ceiling is encoded again coarser,
// bisecting the settings the slider has left; these encodes take a second.
export async function encodeStill(
  ff: FFmpeg,
  render: Render,
  workDir: string,
  still: StillId,
  quality: number,
): Promise<string> {
  const pixFmt = render.source?.profile.pixFmt ?? "";
  console.log(`Encoding ${still} (quality ${quality})...`);
  const outputFile = path.join(workDir, `output.${still}`);
  // The pictures to encode: the tool's render, until a file stands in for it.
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
    // -q:v in lossless mode is compression effort (webp.ts).
    await encode([
      "-c:v",
      "libwebp",
      "-lossless",
      "1",
      "-q:v",
      "75",
      "-pix_fmt",
      "bgra",
    ]);
    return outputFile;
  }

  const levels = still === "jpg" ? JPEG_LEVELS(quality) : webpLevels(quality);
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
          // What the encoder takes of what JPEGs come in; grey, CMYK and the
          // odd subsamplings get full chroma, since the logo may bring colour.
          /^yuvj4(20|22|44)p$/.test(pixFmt) ? pixFmt : "yuvj444p",
        ]
      : // "icon" for the same reason as in webp.ts.
        ["-c:v", "libwebp", "-q:v", String(level), "-preset", "icon", "-pix_fmt", "bgra"];

  const ceiling = render.source
    ? (await fs.stat(render.source.path)).size * (quality / 100) * 1.1
    : Infinity;
  let written = -1;
  const fits = async (index: number) => {
    await encode(codecArgs(levels[index]));
    written = index;
    return (await fs.stat(outputFile)).size <= ceiling;
  };
  if (await fits(0)) return outputFile;

  // More tries to come, so the marked picture is rendered once more, to a
  // PNG (lossless, so no generation is lost to it, and barely compressed,
  // since it is gone in a moment), and the tries read that: what a try
  // costs is then the encode and not the tool's graph.
  const marked = path.join(workDir, "marked.png");
  await encode(
    ["-c:v", "png", "-compression_level", "1", "-pix_fmt", "rgba"],
    marked,
  );
  pictures = { ...render, inputArgs: ["-i", marked], filter: undefined, source: null };

  // `over` is the coarsest setting known to be too big, `pick` the finest
  // one that may fit: the coarsest of all, tried or not, if nothing does.
  let over = 0;
  let pick = levels.length - 1;
  while (pick - over > 1) {
    const middle = Math.floor((over + pick) / 2);
    if (await fits(middle)) pick = middle;
    else over = middle;
  }
  console.log(
    `Over the ${Math.round(ceiling)} bytes its source allows at ` +
      `${levels[0]}: settled on ${levels[pick]}`,
  );
  if (written !== pick) await encode(codecArgs(levels[pick]));
  return outputFile;
}
