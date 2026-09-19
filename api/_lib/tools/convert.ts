import { ENCODE_TARGETS, encodeRender } from "../encode/index.js";
import { sourceRender } from "../encode/render.js";
import { clamp, pick, singleVideo } from "../request.js";
import { openSource } from "../source.js";
import type { Tool } from "./types.js";

// No transformation of its own: the source goes straight to the output stage
// (encode/), with the format and quality the user picked.
export const convert: Tool = {
  inputs: singleVideo,
  async run(job) {
    const { ff, workDir, inputs, options } = job;
    const target = pick(options.target, ENCODE_TARGETS, "mp4");
    const quality = Math.round(clamp(options.quality, 1, 100, 90));

    // Any source ffmpeg reads will do here: this is the tool that turns the
    // ones no other tool can hand back (avi, mkv, ...) into ones they can.
    const source = await openSource(job, inputs[0]);
    const render = sourceRender(source);

    const outputPath = await encodeRender(ff, render, workDir, target, {
      quality,
      ...(target === "gif"
        ? {
            // Absent fps → match the source framerate (capped in the
            // encoder). 30 is the practical GIF ceiling: delays are
            // centiseconds, so gifski alternates 3/4cs frames for 30fps;
            // browsers clamp ≥50fps.
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
