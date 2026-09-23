import path from "node:path";
import { InputError } from "../errors.js";
import type { FFmpeg, MediaInfo } from "../ffmpeg.js";
import { encodePreserved } from "../encode/index.js";
import { encodeStill } from "../encode/still.js";
import { sourceRender, videoPad, type Render } from "../encode/render.js";
import { clamp, isBlobUrl } from "../request.js";
import { openSource, preservedFormat, type Source } from "../source.js";
import { parseBounds, watermarkGraph, type Bounds } from "./mark-graph.js";
import type { Tool } from "./types.js";

/**
 * Stamps `logoFile` (a PNG) onto the bottom-right corner of `source`, a
 * video or a still. With `filter` the logo's alpha becomes the shape of a
 * glass lens (see MARK) instead of a plain overlay. Audio is kept.
 */
export async function addWatermark(
  ff: FFmpeg,
  source: Source,
  logoFile: string,
  filter = false,
): Promise<Render> {
  const logo = await logoInfo(ff, logoFile);
  // A still is laid out by the size it decodes to: a JPEG that EXIF says
  // to turn reaches the graph turned (FFmpeg.shownSize).
  const frame = source.still
    ? { ...source.profile, ...(await ff.shownSize(source.path)) }
    : source.profile;
  const graph = watermarkGraph(
    frame,
    logo,
    filter,
    await logoBounds(ff, logoFile, logo),
    {
      // A GIF or animated WebP is RGB(A) going in and coming out, so it is
      // never taken through yuv420p in between (mark-graph.ts). Nor is a
      // still: its alpha, its odd row or column of pixels and its full
      // chroma resolution are all its format's to keep.
      base:
        source.format === "gif" || source.format === "webp" || source.still
          ? "rgba"
          : "yuv420p",
      pad: videoPad(source),
    },
  );
  return sourceRender(source, {
    // The logo is a one-frame stream, which overlay simply holds for the
    // whole video.
    inputArgs: ["-i", source.path, "-i", logoFile],
    filter: graph,
    keepAudio: true,
    width: frame.width,
    height: frame.height,
  });
}

/**
 * One composited frame for the UI's preview: `frameFile` is a still (the
 * browser's grab of the video's first frame) and goes through exactly the
 * graph addWatermark uses, so whatever the filter does, the preview shows.
 * Returns a JPEG.
 */
export async function renderWatermarkFrame(
  ff: FFmpeg,
  frameFile: string,
  logoFile: string,
  workDir: string,
  filter = false,
): Promise<string> {
  const frame = await ff.mediaInfo(frameFile);
  const logo = await logoInfo(ff, logoFile);
  const graph = watermarkGraph(
    frame,
    logo,
    filter,
    await logoBounds(ff, logoFile, logo),
  );

  const outputFile = path.join(workDir, "preview.jpg");
  await ff.runFFmpeg([
    "-y",
    "-i",
    frameFile,
    "-i",
    logoFile,
    "-filter_complex",
    graph,
    "-map",
    "[out]",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    outputFile,
  ]);

  return outputFile;
}

// Probes the logo, which has to be a still PNG. The client only offers
// those, but nothing else is tested any more (a GIF would play once and
// freeze), so whatever else reaches the API is turned away. Going by the
// codec rather than the name also catches animated PNGs ("apng").
async function logoInfo(ff: FFmpeg, logoFile: string): Promise<MediaInfo> {
  const logo = await ff.mediaInfo(logoFile);
  if (logo.codec !== "png") {
    throw new InputError(
      `Watermark must be a PNG image (got ${logo.codec || "an unknown format"})`,
      "invalid-watermark",
    );
  }
  return logo;
}

// The part of a logo that is actually visible: many assets carry empty
// canvas around the mark (a logotype exported on a square, uneven
// margins), and sized and placed by the canvas they come out small and
// off the corner. bbox logs the box of the alpha above min_val; an opaque
// image (format=rgba gives it a solid alpha) reports its whole frame. A
// failed pass just means no trimming.
async function logoBounds(
  ff: FFmpeg,
  logoFile: string,
  logo: MediaInfo,
): Promise<Bounds> {
  const { stderr } = await ff.run(ff.ffmpeg, [
    "-hide_banner",
    "-i",
    logoFile,
    "-vf",
    "format=rgba,alphaextract,bbox=min_val=16",
    "-f",
    "null",
    "-",
  ]);
  return parseBounds(stderr, logo.width, logo.height);
}

export const mark: Tool = {
  inputs({ blobUrl, watermarkUrl }) {
    if (!isBlobUrl(blobUrl) || !isBlobUrl(watermarkUrl)) {
      return { error: "Expected a video and a watermark blob URL" };
    }
    return [blobUrl, watermarkUrl];
  },
  async run(job) {
    const { ff, workDir, inputs, options, download } = job;
    // Frosted-glass mode; only meaningful with an alpha channel, but
    // harmless without: the glass is then the logo's full rectangle.
    const filter = options.filter === true;
    const quality = Math.round(clamp(options.quality, 1, 100, 90));

    const source = await openSource(job, inputs[0]);
    // A marked file comes back in the format it came in: a still as the
    // kind of image it is, the one tool that takes them.
    const format = source.still ?? preservedFormat(source);
    const logoPath = path.join(workDir, "logo.png");
    await download(inputs[1], logoPath);
    console.log(
      `Adding watermark to ${format} (${filter ? "glass" : "plain"}, quality ${quality})...`,
    );

    const render = await addWatermark(ff, source, logoPath, filter);
    const outputPath = source.still
      ? await encodeStill(ff, render, workDir, source.still, quality)
      : await encodePreserved(ff, render, workDir, preservedFormat(source), quality);
    return { outputPath, suffix: "marked", ext: format };
  },
};
