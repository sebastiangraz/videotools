import { FORMAT_IDS } from "../../../shared/formats.js";
import { encodeRender } from "../encode/index.js";
import { sourceRender } from "../encode/render.js";
import { clamp, pick, singleVideo } from "../request.js";
import { openSource } from "../source.js";
import type { Tool } from "./types.js";

export const convert: Tool = {
  inputs: singleVideo,
  async run(job) {
    const { inputs, options } = job;
    const target = pick(options.target, FORMAT_IDS, "mp4");
    const quality = Math.round(clamp(options.quality, 1, 100, 90));

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
            fps:
              options.fps == null
                ? null
                : Math.round(clamp(options.fps, 1, 30, 15)),
            width: Math.round(clamp(options.width, 100, 800, 640)),
          }
        : {}),
    });
    return { outputPath, suffix: "converted", ext: target };
  },
};
