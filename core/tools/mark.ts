import fs from "node:fs/promises";
import path from "node:path";
import type { FormatId } from "../formats.js";
import { InputError } from "../errors.js";
import { svgToPng } from "../svg.js";
import type { FFmpeg, MediaInfo, SourceProfile } from "../ffmpeg.js";
import { encodePreserved } from "../encode/index.js";
import { encodeStill } from "../encode/still.js";
import { sourceRender, videoPad, type Render } from "../encode/render.js";
import { clamp, clampInt, fileExt } from "../helpers.js";
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

type Logo = { logoPng: string; logo: MediaInfo; bounds: Bounds };

async function markGraph(
  { ff, workDir }: Pick<ToolJob, "ff" | "workDir">,
  file: string,
  frame: SourceProfile,
  opening: Promise<Logo>,
  options: Omit<Parameters<typeof watermarkGraph>[2], "bounds" | "light">,
): Promise<{ graph: string; logoPng: string }> {
  const [{ logoPng, logo, bounds }, light] = await Promise.all([
    opening,
    lit(options.filter, options.view) ? followLight(ff, file, frame, workDir) : null,
  ]);
  const graph = watermarkGraph(frame, logo, { ...options, bounds, light });
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
  const { graph, logoPng } = await markGraph(
    job,
    source.path,
    frame,
    openLogo(job.ff, logoFile, frame),
    {
      ...look,
      filter,
      // GIF/WebP/stills stay RGBA: yuv420p would lose alpha, odd sizes and chroma.
      base:
        source.format === "gif" || source.format === "webp" || source.still ? "rgba" : "yuv420p",
      pad: videoPad(source),
    },
  );
  return sourceRender(source, {
    // overlay holds the one-frame logo stream for the whole video.
    inputArgs: ["-i", source.path, "-i", logoPng],
    filter: graph,
    keepAudio: true,
    width: frame.width,
    height: frame.height,
  });
}

// Same graph as addWatermark, so the previews match the output. A JPEG per
// frame: frames of one source, so one size, sharing the opened logo.
export async function renderWatermarkFrames(
  { ff, workDir }: Pick<ToolJob, "ff" | "workDir">,
  {
    frames,
    logoFile,
    filter = "glass",
    size = "medium",
    view = "render",
    tuning,
  }: Omit<MarkLook, "position" | "route"> & {
    frames: { file: string; position: MarkPosition }[];
    logoFile: string;
  },
): Promise<string[]> {
  const frame = await ff.mediaInfo(frames[0].file);
  const opening = openLogo(ff, logoFile, frame);
  return Promise.all(
    frames.map(async ({ file, position }, n) => {
      // Each frame tracks its own light.
      const frameDir = path.join(workDir, String(n));
      await fs.mkdir(frameDir, { recursive: true });
      const { graph, logoPng } = await markGraph({ ff, workDir: frameDir }, file, frame, opening, {
        filter,
        size,
        position,
        view,
        tuning,
      });

      const outputFile = path.join(frameDir, "preview.jpg");
      await ff.runFFmpeg([
        "-y",
        "-i",
        file,
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
    }),
  );
}

// PNG or SVG only (a GIF logo would play once and freeze); checking the codec
// rather than the name also rejects APNG.
async function openLogo(
  ff: FFmpeg,
  logoFile: string,
  frame: { width: number; height: number },
): Promise<Logo> {
  // Sniff the demuxer first: ffmpeg recognizes an SVG but may not decode it.
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
  return { logoPng, logo, bounds: await logoBounds(ff, logoPng, logo) };
}

// At the frame's long side, so it scales down like a PNG would; logoBounds
// trims any margins the SVG carries.
async function rasterizeSvg(
  ff: FFmpeg,
  svgFile: string,
  frame: { width: number; height: number },
): Promise<string> {
  const { min, max, fallback } = SVG_SIDE;
  const side = clampInt(Math.max(frame.width, frame.height), min, max, fallback);
  const pngFile = path.join(path.dirname(svgFile), "logo-svg.png");
  const png = await svgToPng(ff.resvg, await fs.readFile(svgFile), side).catch(() => {
    throw new InputError("Watermark SVG could not be rendered", "invalid-watermark");
  });
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

// Inputs: the source, then the logo (PNG or SVG).
export const mark: Tool = async (job) => {
  const { workDir, inputs, options } = job;
  const { filter, size, position, view, tuning } = markLook(options);
  const route =
    Array.isArray(options.route) && options.route.every(isMarkPosition) ? options.route : [];
  const quality = clampInt(options.quality, 1, 100, 90);

  const source = await openSource(job, inputs[0]);
  // mark is the only tool that takes stills.
  const { still } = source;
  const format = still ?? preservedFormat(source);
  const logoPath = path.join(workDir, `logo${fileExt(inputs[1].name, ".png")}`);
  await inputs[1].save(logoPath);
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
};
