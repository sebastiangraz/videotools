import path from "node:path";
import { InputError } from "../errors.js";
import type { FFmpeg, MediaInfo } from "../ffmpeg.js";
import { encodePreserved } from "../encode/index.js";
import { encodeStill } from "../encode/still.js";
import { sourceRender, videoPad, type Render } from "../encode/render.js";
import { clamp, isBlobUrl } from "../request.js";
import { openSource, preservedFormat, type Source } from "../source.js";
import {
  isMarkFilter,
  isMarkSize,
  parseBounds,
  watermarkGraph,
  type Bounds,
  type MarkFilter,
  type MarkSize,
  type MarkView,
} from "./mark-graph.js";
import type { Tool } from "./types.js";

/**
 * Stamps `logoFile` (a PNG or SVG) onto the bottom-right corner of `source`, a
 * video or a still, as `filter` has it (see MARK_FILTERS): a plain overlay,
 * a glass lens in the logo's shape (see MARK), or the backdrop blurred in
 * it; at `size` (see MARK_SIZES). Audio is kept.
 */
async function addWatermark(
  ff: FFmpeg,
  source: Source,
  logoFile: string,
  filter: MarkFilter = "glass",
  size: MarkSize = "large",
): Promise<Render> {
  // A still is laid out by the size it decodes to: a JPEG that EXIF says
  // to turn reaches the graph turned (FFmpeg.shownSize).
  const frame = source.still
    ? { ...source.profile, ...(await ff.shownSize(source.path)) }
    : source.profile;
  const { logoPng, logo } = await openLogo(ff, logoFile, frame);
  const graph = watermarkGraph(
    frame,
    logo,
    filter,
    await logoBounds(ff, logoPng, logo),
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
      size,
    },
  );
  return sourceRender(source, {
    // The logo is a one-frame stream, which overlay simply holds for the
    // whole video.
    inputArgs: ["-i", source.path, "-i", logoPng],
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
 * `view` swaps the mark for one of the graph's debug views. Returns a JPEG.
 */
export async function renderWatermarkFrame(
  ff: FFmpeg,
  frameFile: string,
  logoFile: string,
  workDir: string,
  filter: MarkFilter = "glass",
  size: MarkSize = "large",
  view: MarkView = "render",
): Promise<string> {
  const frame = await ff.mediaInfo(frameFile);
  const { logoPng, logo } = await openLogo(ff, logoFile, frame);
  const graph = watermarkGraph(
    frame,
    logo,
    filter,
    await logoBounds(ff, logoPng, logo),
    { size, view },
  );

  const outputFile = path.join(workDir, "preview.jpg");
  await ff.runFFmpeg([
    "-y",
    "-i",
    frameFile,
    "-i",
    logoPng,
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

// The logo as a still PNG the graph can take, and its probe. A PNG is used
// as it is. An SVG is rasterized first (see rasterizeSvg). Anything else is
// turned away: the client only offers those two, and nothing else is tested
// (a GIF would play once and freeze). Going by the content rather than the
// name also catches animated PNGs ("apng").
async function openLogo(
  ff: FFmpeg,
  logoFile: string,
  frame: { width: number; height: number },
): Promise<{ logoPng: string; logo: MediaInfo }> {
  // The demuxer is sniffed before anything is taken from the probe: an SVG
  // whose declared size librsvg won't render probes with none at all.
  const { stderr } = await ff.run(ff.ffmpeg, ["-hide_banner", "-i", logoFile]);
  const logoPng = /^Input #0, svg_pipe,/m.test(stderr)
    ? await rasterizeSvg(ff, logoFile, frame)
    : logoFile;
  const logo = await ff.mediaInfo(logoPng);
  if (logo.codec !== "png") {
    throw new InputError(
      `Watermark must be a PNG or SVG image (got ${logo.codec || "an unknown format"})`,
      "invalid-watermark",
    );
  }
  return { logoPng, logo };
}

// An SVG drawn to a PNG next to it, at a size the graph only ever scales
// down from. librsvg is asked for a square canvas as big as the frame's
// long side (within bounds): it fits the drawing in centred at its own
// aspect ratio, so whatever the SVG declares (a size, only a viewBox, a
// size too big to draw), the logo's long side comes out at the canvas's,
// and logoBounds trims the empty sides off. The logo never spans more than
// MARK.maxSpan of the frame, twice that for the glass's lens maps, so that
// is enough. librsvg hands over premultiplied pixels labelled as straight
// alpha; unpremultiply makes them what they say, or every antialiased edge
// would come out darkened.
async function rasterizeSvg(
  ff: FFmpeg,
  svgFile: string,
  frame: { width: number; height: number },
): Promise<string> {
  const side = String(
    Math.round(clamp(Math.max(frame.width, frame.height), 512, 4096, 1920)),
  );
  const pngFile = path.join(path.dirname(svgFile), "logo-svg.png");
  await ff.runFFmpeg([
    "-y",
    "-width",
    side,
    "-height",
    side,
    "-keep_ar",
    "0",
    "-i",
    svgFile,
    "-vf",
    "format=rgba,unpremultiply=inplace=1",
    "-frames:v",
    "1",
    "-update",
    "1",
    pngFile,
  ]);
  return pngFile;
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
    // Glass and blur take the logo's alpha as their shape; without one
    // they are harmless, just the logo's full rectangle.
    const filter = isMarkFilter(options.filter) ? options.filter : "glass";
    const size = isMarkSize(options.size) ? options.size : "large";
    const quality = Math.round(clamp(options.quality, 1, 100, 90));

    const source = await openSource(job, inputs[0]);
    // A marked file comes back in the format it came in: a still as the
    // kind of image it is, the one tool that takes them.
    const format = source.still ?? preservedFormat(source);
    const logoPath = path.join(workDir, "logo.png");
    await download(inputs[1], logoPath);
    console.log(
      `Adding watermark to ${format} (${size}, ${filter}, quality ${quality})...`,
    );

    const render = await addWatermark(ff, source, logoPath, filter, size);
    const outputPath = source.still
      ? await encodeStill(ff, render, workDir, source.still, quality)
      : await encodePreserved(ff, render, workDir, preservedFormat(source), quality);
    return { outputPath, suffix: "marked", ext: format };
  },
};
