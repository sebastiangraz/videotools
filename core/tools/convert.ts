import { FORMATS, RANGES } from "../formats.js";
import { encodeRender } from "../encode/index.js";
import { sourceRender } from "../encode/render.js";
import { clampInt, pick } from "../helpers.js";
import { openSource } from "../source.js";
import type { Tool } from "./types.js";

const TARGETS = FORMATS.map((f) => f.id);

export const convert: Tool = async (job) => {
  const { inputs, options } = job;
  const target = pick(options.target, TARGETS, "mp4");
  const quality = clampInt(options.quality, ...RANGES.quality, 90);

  // Unlike other tools, accepts any readable source (avi, mkv, ...).
  const source = await openSource(job, inputs[0]);
  const render = sourceRender(source);

  const outputPath = await encodeRender(job, render, {
    format: target,
    quality,
    ...(target === "gif"
      ? {
          // null = source fps. GIF delays are centiseconds (30fps alternates
          // 3/4cs) and browsers clamp ≥50fps, so 30 is the practical cap.
          fps: options.fps == null ? null : clampInt(options.fps, ...RANGES.fps, 15),
          width: clampInt(options.width, ...RANGES.width, 640),
        }
      : {}),
  });
  return { outputPath, suffix: "converted", ext: target };
};
