import path from "node:path";
import { ENCODE_TARGETS, encodeVideo } from "../encode/index.js";
import { blobExt, clamp, pick, singleVideo } from "../request.js";
import type { Tool } from "./types.js";

// No transformation of its own: the source goes straight to the output stage
// (encode/), with the format and quality the user picked.
export const convert: Tool = {
  inputs: singleVideo,
  async run({ ff, workDir, inputs, options, download }) {
    const target = pick(options.target, ENCODE_TARGETS, "mp4");
    const quality = Math.round(clamp(options.quality, 1, 100, 90));

    const inputPath = path.join(workDir, `input${blobExt(inputs[0], ".mp4")}`);
    await download(inputs[0], inputPath);

    const outputPath = await encodeVideo(ff, inputPath, workDir, target, {
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
