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

type Logo = { logo: MediaInfo; bounds: Bounds };

async function markGraph(
  { ff, workDir }: Pick<ToolJob, "ff" | "workDir">,
  file: string,
  frame: SourceProfile,
  opening: Promise<Logo>,
  options: Omit<Parameters<typeof watermarkGraph>[2], "bounds" | "light">,
): Promise<string> {
  const [{ logo, bounds }, light] = await Promise.all([
    opening,
    lit(options.filter, options.view) ? followLight(ff, file, frame, workDir) : null,
  ]);
  const graph = watermarkGraph(frame, logo, { ...options, bounds, light });
  await light?.write();
  return graph;
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
  const graph = await markGraph(job, source.path, frame, openLogo(job.ff, logoFile), {
    ...look,
    filter,
    // GIF/WebP/stills stay RGBA: yuv420p would lose alpha, odd sizes and chroma.
    base: source.format === "gif" || source.format === "webp" || source.still ? "rgba" : "yuv420p",
    pad: videoPad(source),
  });
  return sourceRender(source, {
    // overlay holds the one-frame logo stream for the whole video.
    inputArgs: ["-i", source.path, "-i", logoFile],
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
  // A round's renders run at once and compete for the CPUs; a lone frame
  // uses its threads.
  ff.oneCpu = frames.length > 1;
  // Each frame tracks its own light, in a folder of its own.
  const frameDirs = frames.map((_, n) => path.join(workDir, String(n)));
  const [frame] = await Promise.all([
    ff.mediaInfo(frames[0].file),
    ...frameDirs.map((dir) => fs.mkdir(dir)),
  ]);
  // Every frame awaits it from the start: an abort's rejection with nothing
  // awaiting it would go unhandled and end the engine.
  const opening = openLogo(ff, logoFile);
  return Promise.all(
    frames.map(async ({ file, position }, n) => {
      const graph = await markGraph({ ff, workDir: frameDirs[n] }, file, frame, opening, {
        filter,
        size,
        position,
        view,
        tuning,
      });

      const outputFile = path.join(frameDirs[n], "preview.jpg");
      await ff.runFFmpeg([
        "-y",
        "-i",
        file,
        "-i",
        logoFile,
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

// PNG only (a GIF logo would play once and freeze); checking the codec rather
// than the name also rejects APNG.
async function openLogo(ff: FFmpeg, logoFile: string): Promise<Logo> {
  const logo = await ff.mediaInfo(logoFile);
  if (logo.codec !== "png") {
    throw new InputError(
      `Watermark must be a PNG image (got ${logo.codec || "an unknown format"})`,
      "invalid-watermark",
    );
  }
  return { logo, bounds: await logoBounds(ff, logoFile, logo) };
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
