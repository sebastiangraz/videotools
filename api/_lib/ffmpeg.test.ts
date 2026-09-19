// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseMediaInfo } from "./ffmpeg.js";

describe("parseMediaInfo", () => {
  // The watermark's PNG check goes by this, so the lines are ffmpeg's own:
  // each of these files was probed under the name logo.png.
  it.each([
    ["png", "png, rgb24(pc, gbr/unknown/unknown), 200x100 [SAR 1:1 DAR 2:1]"],
    ["gif", "gif, bgra, 200x100 [SAR 64:64 DAR 2:1]"],
    ["apng", "apng, rgb24(pc, gbr/unknown/unknown), 200x100 [SAR 1:1 DAR 2:1]"],
    [
      "mjpeg",
      "mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 200x100 [SAR 1:1 DAR 2:1]",
    ],
    ["webp", "webp, yuv420p(tv, bt470bg/unknown/unknown), 200x100"],
  ])("reads the codec of %s content, whatever the file is called", (codec, stream) => {
    const summary = [
      "Input #0, png_pipe, from 'logo.png':",
      "  Duration: N/A, bitrate: N/A",
      `  Stream #0:0: Video: ${stream}, 25 fps, 25 tbr, 25 tbn`,
    ].join("\n");
    expect(parseMediaInfo(summary)).toMatchObject({
      codec,
      width: 200,
      height: 100,
    });
  });
});
