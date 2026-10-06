import path from "node:path";
import type { FormatId } from "../formats.js";
import { InputError } from "../errors.js";
import type { FFmpeg, MediaInfo } from "../ffmpeg.js";
import { encodePreserved } from "../encode/index.js";
import { encodeStill } from "../encode/still.js";
import { sourceRender, videoPad, type Render } from "../encode/render.js";
import { clamp, isBlobUrl } from "../request.js";
import { openSource, preservedFormat, type Source } from "../source.js";
import {
  isMarkFilter,
  isMarkPosition,
  isMarkSize,
  parseBounds,
  perturbGraph,
  watermarkGraph,
  type Bounds,
  type MarkFilter,
  type MarkPosition,
  type MarkSize,
  type MarkView,
} from "./mark-graph.js";
import type { Tool, ToolJob } from "./types.js";

// mjpeg -q:v: 1 finest – 31 coarsest.
const PREVIEW_JPEG_Q = "3";

// SVG raster square side: the frame's long side, clamped.
const SVG_SIDE = { min: 512, max: 4096, fallback: 1920 };

type MarkLook = {
  filter?: MarkFilter;
  size?: MarkSize;
  position?: MarkPosition;
  view?: MarkView;
  rotatePosition?: boolean;
  perturb?: boolean;
};

async function addWatermark(
  ff: FFmpeg,
  source: Source,
  {
    logoFile,
    filter = "glass",
    size = "medium",
    position = "bottom-right",
    rotatePosition,
    perturb,
    view = "render",
  }: MarkLook & { logoFile: string },
): Promise<Render> {
  // An EXIF-rotated JPEG reaches the graph turned, so lay out by decoded size.
  const frame = source.still
    ? { ...source.profile, ...(await ff.shownSize(source.path)) }
    : source.profile;
  const { logoPng, logo } = await openLogo(ff, logoFile, frame);
  // GIF/WebP/stills stay RGBA: yuv420p would lose alpha, odd sizes and chroma.
  const base =
    source.format === "gif" || source.format === "webp" || source.still ? "rgba" : "yuv420p";
  const marked = watermarkGraph(frame, logo, {
    filter,
    bounds: await logoBounds(ff, logoPng, logo),
    base,
    pad: videoPad(source),
    size,
    position,
    rotatePosition,
    view,
  });
  const graph = perturb ? perturbGraph(marked, base) : marked;
  return sourceRender(source, {
    // overlay holds the one-frame logo stream for the whole video.
    inputArgs: ["-i", source.path, "-i", logoPng],
    filter: graph,
    keepAudio: true,
    width: frame.width,
    height: frame.height,
  });
}

// Same graph as addWatermark, so the preview matches the output. Returns a JPEG.
export async function renderWatermarkFrame(
  { ff, workDir }: Pick<ToolJob, "ff" | "workDir">,
  {
    frameFile,
    logoFile,
    filter = "glass",
    size = "medium",
    position = "bottom-right",
    view = "render",
  }: MarkLook & { frameFile: string; logoFile: string },
): Promise<string> {
  const frame = await ff.mediaInfo(frameFile);
  const { logoPng, logo } = await openLogo(ff, logoFile, frame);
  const graph = watermarkGraph(frame, logo, {
    filter,
    bounds: await logoBounds(ff, logoPng, logo),
    size,
    position,
    view,
  });

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
    PREVIEW_JPEG_Q,
    outputFile,
  ]);

  return outputFile;
}

// PNG or SVG only (a GIF logo would play once and freeze); checking the codec
// rather than the name also rejects APNG.
async function openLogo(
  ff: FFmpeg,
  logoFile: string,
  frame: { width: number; height: number },
): Promise<{ logoPng: string; logo: MediaInfo }> {
  // Sniff the demuxer first: an SVG with a size librsvg won't render probes empty.
  const summary = await ff.summary(logoFile);
  const svg = /^Input #0, svg_pipe,/m.test(summary);
  const logoPng = svg ? await rasterizeSvg(ff, logoFile, frame) : logoFile;
  const logo = await ff.mediaInfo(logoPng, svg ? undefined : summary);
  if (logo.codec !== "png") {
    throw new InputError(
      `Watermark must be a PNG or SVG image (got ${logo.codec || "an unknown format"})`,
      "invalid-watermark",
    );
  }
  return { logoPng, logo };
}

// A square canvas of the frame's long side fits any SVG (size, viewBox only,
// huge) at its aspect; logoBounds trims the sides. librsvg outputs premultiplied
// pixels labelled straight, so unpremultiply or edges darken.
async function rasterizeSvg(
  ff: FFmpeg,
  svgFile: string,
  frame: { width: number; height: number },
): Promise<string> {
  const { min, max, fallback } = SVG_SIDE;
  const side = String(Math.round(clamp(Math.max(frame.width, frame.height), min, max, fallback)));
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

// Logos often carry empty margins that would size and place them wrong.
// Opaque images report their whole frame; a failed pass means no trimming.
async function logoBounds(ff: FFmpeg, logoFile: string, logo: MediaInfo): Promise<Bounds> {
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

const SIZE_TAGS: Record<MarkSize, string> = { small: "Sm", medium: "Md", large: "Lg", dev: "Dev" };

// e.g. watermark.svg_sLg_fGlass_pBR_rTrue_q100: the logo's name, then each
// setting as its letter and value.
function verboseName(
  watermarkName: string,
  look: {
    size: MarkSize;
    filter: MarkFilter | "pureGlass";
    position: MarkPosition;
    rotatePosition: boolean;
    perturb: boolean;
    quality: number;
  },
): string {
  const logo = watermarkName.replace(/[^\w.-]/g, "_");
  const filter = look.filter[0].toUpperCase() + look.filter.slice(1);
  const position = look.position
    .split("-")
    .map((part) => part[0].toUpperCase())
    .join("");
  const flag = (on: boolean) => (on ? "True" : "False");
  return `${logo}_s${SIZE_TAGS[look.size]}_f${filter}_p${position}_r${flag(look.rotatePosition)}_st${flag(look.perturb)}_q${look.quality}`;
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
    const filter = isMarkFilter(options.filter) ? options.filter : "glass";
    const size = isMarkSize(options.size) ? options.size : "medium";
    const position = isMarkPosition(options.position) ? options.position : "bottom-right";
    const rotatePosition = options.rotatePosition === true;
    const perturb = options.perturb === true;
    // Pure glass (MARK_CLEAR) is the one debug view that renders as an output;
    // like in the preview, it stands in for any filter.
    const view = options.view === "clear" ? "clear" : "render";
    const quality = Math.round(clamp(options.quality, 1, 100, 90));

    const source = await openSource(job, inputs[0]);
    // mark is the only tool that takes stills.
    const { still } = source;
    const format = still ?? preservedFormat(source);
    const logoPath = path.join(workDir, "logo.png");
    await download(inputs[1], logoPath);
    console.log(
      `Adding watermark to ${format} (${size}, ${filter}, ${position}${rotatePosition ? " rotating" : ""}${perturb ? " perturbed" : ""}${view === "clear" ? " pure glass" : ""}, quality ${quality})...`,
    );

    const render = await addWatermark(ff, source, {
      logoFile: logoPath,
      filter,
      size,
      position,
      rotatePosition,
      perturb,
      view,
    });
    const outputPath = still
      ? await encodeStill(job, render, { format: still, quality })
      : await encodePreserved(job, render, {
          format: format as FormatId,
          quality,
        });
    const verbose =
      options.verboseOutput === true
        ? verboseName(
            typeof options.watermarkName === "string" ? options.watermarkName : "watermark",
            {
              size,
              filter: view === "clear" ? "pureGlass" : filter,
              position,
              rotatePosition,
              perturb,
              quality,
            },
          )
        : undefined;
    return { outputPath, suffix: "marked", verbose, ext: format };
  },
};
