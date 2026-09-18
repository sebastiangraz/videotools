import path from "node:path";
import type { FFmpeg, MediaInfo } from "../ffmpeg.js";
import { h264, x264Crf } from "../encode/h264.js";
import { blobExt, clamp, isBlobUrl } from "../request.js";
import { parseBounds, watermarkGraph, type Bounds } from "./mark-graph.js";
import type { Tool } from "./types.js";

/**
 * Stamps `logoFile` (a PNG) onto the bottom-right corner of `inputFile`.
 * With `filter` the logo's alpha becomes the shape of a glass lens (see
 * MARK) instead of a plain overlay. Audio is kept. Output is mp4.
 */
export async function addWatermark(
  ff: FFmpeg,
  inputFile: string,
  logoFile: string,
  workDir: string,
  filter = false,
  quality = 90,
): Promise<string> {
  console.log(
    `Adding watermark (${filter ? "glass" : "plain"}, quality ${quality})...`,
  );

  const video = await ff.mediaInfo(inputFile);
  const logo = await logoInfo(ff, logoFile);
  const graph = watermarkGraph(
    video,
    logo,
    filter,
    await logoBounds(ff, logoFile, logo),
  );

  const outputFile = path.join(workDir, "output.mp4");
  await ff.runFFmpeg([
    "-y",
    "-i",
    inputFile,
    // The logo is a one-frame stream, which overlay simply holds for the
    // whole video.
    "-i",
    logoFile,
    "-filter_complex",
    graph,
    "-map",
    "[out]",
    "-map",
    "0:a?",
    ...h264(x264Crf(quality)),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputFile,
  ]);

  return outputFile;
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
    throw new Error(
      `Watermark must be a PNG image (got ${logo.codec || "an unknown format"})`,
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
  async run({ ff, workDir, inputs, options, download }) {
    // Frosted-glass mode; only meaningful with an alpha channel, but
    // harmless without: the glass is then the logo's full rectangle.
    const filter = options.filter === true;
    const quality = Math.round(clamp(options.quality, 1, 100, 90));

    const inputPath = path.join(workDir, `input${blobExt(inputs[0], ".mp4")}`);
    const logoPath = path.join(workDir, "logo.png");
    await download(inputs[0], inputPath);
    await download(inputs[1], logoPath);

    const outputPath = await addWatermark(
      ff,
      inputPath,
      logoPath,
      workDir,
      filter,
      quality,
    );
    return { outputPath, suffix: "marked", ext: "mp4" };
  },
};
