import fs from "node:fs/promises";
import path from "node:path";
import type { FormatId } from "../formats.js";
import { InputError } from "../errors.js";
import type { FFmpeg, MediaInfo, SourceProfile } from "../ffmpeg.js";
import { encodePreserved } from "../encode/index.js";
import { encodeStill } from "../encode/still.js";
import { sourceRender, videoPad, type Render } from "../encode/render.js";
import { uploadExt, clamp, clampInt, isUploadId } from "../request.js";
import { openSource, preservedFormat, type Source } from "../source.js";
import {
  MARK,
  MARK_TUNING,
  isMarkFilter,
  isMarkPosition,
  isMarkSize,
  isMarkView,
  type MarkFilter,
  type MarkPosition,
  type MarkSize,
  type MarkTuning,
  type MarkView,
} from "./mark-config.js";
import { parseBounds, watermarkGraph, type Bounds } from "./mark-graph.js";
import { followLight } from "./mark-light.js";
import type { Tool, ToolJob } from "./types.js";

// mjpeg -q:v: 1 finest – 31 coarsest.
const PREVIEW_JPEG_Q = "3";

// SVG raster long side: the frame's long side, clamped.
const SVG_SIDE = { min: 512, max: 4096, fallback: 1920 };

// Only the glass has a light to aim; the depth map shows none.
const lit = (filter: MarkFilter, view: MarkView | undefined) =>
  filter === "glass" && view !== "displacement";

type MarkLook = {
  filter?: MarkFilter;
  size?: MarkSize;
  position?: MarkPosition;
  view?: MarkView;
  route?: MarkPosition[];
  tuning?: MarkTuning;
};

export function markLook(options: Record<string, unknown>): Required<Omit<MarkLook, "route">> {
  return {
    filter: isMarkFilter(options.filter) ? options.filter : "glass",
    size: isMarkSize(options.size) ? options.size : "medium",
    position: isMarkPosition(options.position) ? options.position : "bottom-right",
    view: isMarkView(options.view) ? options.view : "render",
    tuning: Object.fromEntries(
      Object.entries(MARK_TUNING).map(([key, [min, max]]) => [
        key,
        clamp(Object(options.tuning)[key], min, max, MARK[key as keyof MarkTuning]),
      ]),
    ),
  };
}

async function markGraph(
  { ff, workDir }: Pick<ToolJob, "ff" | "workDir">,
  file: string,
  frame: SourceProfile,
  logoFile: string,
  options: Omit<Parameters<typeof watermarkGraph>[2], "bounds" | "light">,
): Promise<{ graph: string; logoPng: string }> {
  const [{ logoPng, logo }, light] = await Promise.all([
    openLogo(ff, logoFile, frame),
    lit(options.filter, options.view) ? followLight(ff, file, frame, workDir) : null,
  ]);
  const graph = watermarkGraph(frame, logo, {
    ...options,
    bounds: await logoBounds(ff, logoPng, logo),
    light,
  });
  await light?.write();
  return { graph, logoPng };
}

async function addWatermark(
  job: Pick<ToolJob, "ff" | "workDir">,
  source: Source,
  { logoFile, filter = "glass", ...look }: MarkLook & { logoFile: string },
): Promise<Render> {
  // An EXIF-rotated JPEG reaches the graph turned, so lay out by decoded size.
  const frame = source.still
    ? { ...source.profile, ...(await job.ff.shownSize(source.path)) }
    : source.profile;
  const { graph, logoPng } = await markGraph(job, source.path, frame, logoFile, {
    ...look,
    filter,
    // GIF/WebP/stills stay RGBA: yuv420p would lose alpha, odd sizes and chroma.
    base: source.format === "gif" || source.format === "webp" || source.still ? "rgba" : "yuv420p",
    pad: videoPad(source),
  });
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
  job: Pick<ToolJob, "ff" | "workDir">,
  {
    frameFile,
    logoFile,
    filter = "glass",
    size = "medium",
    position = "bottom-right",
    view = "render",
    tuning,
  }: MarkLook & { frameFile: string; logoFile: string },
): Promise<string> {
  const { ff, workDir } = job;
  const frame = await ff.mediaInfo(frameFile);
  const { graph, logoPng } = await markGraph(job, frameFile, frame, logoFile, {
    filter,
    size,
    position,
    view,
    tuning,
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
  // Sniff the demuxer first: ffmpeg recognizes an SVG but may not decode it.
  const summary = await ff.summary(logoFile);
  const svg = /^Input #0, svg_pipe,/m.test(summary);
  const logoPng = svg ? await rasterizeSvg(logoFile, frame) : logoFile;
  const logo = await ff.mediaInfo(logoPng, svg ? undefined : summary);
  if (logo.codec !== "png") {
    throw new InputError(
      `Watermark must be a PNG or SVG image (got ${logo.codec || "an unknown format"})`,
      "invalid-watermark",
    );
  }
  return { logoPng, logo };
}

// At the frame's long side, so it scales down like a PNG would; logoBounds
// trims any margins the SVG carries.
async function rasterizeSvg(
  svgFile: string,
  frame: { width: number; height: number },
): Promise<string> {
  const { min, max, fallback } = SVG_SIDE;
  const side = clampInt(Math.max(frame.width, frame.height), min, max, fallback);
  const pngFile = path.join(path.dirname(svgFile), "logo-svg.png");
  // Loaded on first use, so importing mark doesn't load the WebAssembly.
  const { svgToPng } = await import("../svg.js");
  let png: Uint8Array;
  try {
    png = await svgToPng(await fs.readFile(svgFile), side);
  } catch {
    throw new InputError("Watermark SVG could not be rendered", "invalid-watermark");
  }
  await fs.writeFile(pngFile, png);
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

export const mark: Tool = {
  inputs({ upload, watermark }) {
    if (!isUploadId(upload) || !isUploadId(watermark)) {
      return { error: "Expected a video and a watermark upload" };
    }
    return [upload, watermark];
  },
  async run(job) {
    const { workDir, inputs, options, take } = job;
    const { filter, size, position, view, tuning } = markLook(options);
    const route =
      Array.isArray(options.route) && options.route.every(isMarkPosition) ? options.route : [];
    const quality = clampInt(options.quality, 1, 100, 90);

    const source = await openSource(job, inputs[0]);
    // mark is the only tool that takes stills.
    const { still } = source;
    const format = still ?? preservedFormat(source);
    const logoPath = path.join(workDir, `logo${uploadExt(inputs[1], ".png")}`);
    await take(inputs[1], logoPath);
    console.log(
      `Adding watermark to ${format} (${size}, ${filter}, ${position}${route.length > 1 ? " shuffled" : ""}, quality ${quality})...`,
    );

    const render = await addWatermark(job, source, {
      logoFile: logoPath,
      filter,
      size,
      position,
      view,
      route,
      tuning,
    });
    const outputPath = still
      ? await encodeStill(job, render, { format: still, quality })
      : await encodePreserved(job, render, {
          format: format as FormatId,
          quality,
        });
    return { outputPath, suffix: "marked", ext: format };
  },
};
