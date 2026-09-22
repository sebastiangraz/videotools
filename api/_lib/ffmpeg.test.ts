// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseMediaInfo, parseOutputSize } from "./ffmpeg.js";

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

describe("parseOutputSize", () => {
  // `ffmpeg -i turned.jpg -frames:v 1 -f null -` (7.0.2) on a 320x240 JPEG
  // whose EXIF orientation stands it on end: the input line has the size as
  // stored, the output line the size the picture is decoded to.
  const log = `Input #0, image2, from 'turned.jpg':
  Duration: 00:00:00.04, start: 0.000000, bitrate: 3061 kb/s
  Stream #0:0: Video: mjpeg (Baseline), yuvj444p(pc, bt470bg/unknown/unknown), 320x240 [SAR 1:1 DAR 4:3], 25 fps, 25 tbr, 25 tbn
Stream mapping:
  Stream #0:0 -> #0:0 (mjpeg (native) -> wrapped_avframe (native))
Press [q] to stop, [?] for help
Output #0, null, to 'pipe:':
  Metadata:
    encoder         : Lavf61.1.100
  Stream #0:0: Video: wrapped_avframe, yuvj444p(pc, bt470bg/unknown/unknown, progressive), 240x320 [SAR 1:1 DAR 3:4], q=2-31, 200 kb/s, 25 fps, 25 tbn
      Metadata:
        encoder         : Lavc61.3.100 wrapped_avframe`;

  it("reads the size the pictures were written at, not the input's", () => {
    expect(parseOutputSize(log)).toEqual({ width: 240, height: 320 });
  });

  it("has none for a run that never got to its output", () => {
    expect(parseOutputSize(log.slice(0, log.indexOf("Stream mapping")))).toBeNull();
  });
});
