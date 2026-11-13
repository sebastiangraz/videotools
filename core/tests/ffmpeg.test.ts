import { describe, expect, it } from "vitest";
import { parseMediaInfo, parseOutputSize, runProgress, shownDuration } from "../ffmpeg.js";

// Real lines from the engine: ffmpeg 9.0 with `-progress pipe:2`, gifski 1.34.
describe("runProgress", () => {
  it("counts ffmpeg's frames at its output's rate, not its time", () => {
    const read = runProgress(9);
    for (const line of [
      "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080, 5088 kb/s, 60 fps, 60 tbr, 60k tbn (default)",
      "  Stream #0:0(und): Video: h264 (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080, q=2-31, 30 fps, 30k tbn (default)",
      "frame=  135 fps= 29 q=-1.0 size=    1024KiB time=00:00:08.89 bitrate=N/A speed=1.9x",
      // The audio's, ahead of the video's encode.
      "out_time_us=8896000",
    ]) {
      expect(read(line)).toBeNull();
    }
    expect(read("frame=135")).toBe(0.5);
    expect(read("frame=300")).toBe(1);
  });

  it("can't place ffmpeg's frames before it lists a rate", () => {
    expect(runProgress(9)("frame=135")).toBeNull();
  });

  it.each([
    ["Frame 1 / 180  _......  1m ", 1 / 180],
    ["3.4MB GIF; Frame 45 / 180  ###########_......  3s ", 0.25],
  ])("reads gifski's %j", (line, done) => {
    expect(runProgress(0)(line)).toBe(done);
  });
});

describe("parseMediaInfo", () => {
  // Real ffmpeg lines, each file probed as logo.png (the watermark PNG check).
  it.each([
    ["png", "png, rgb24(pc, gbr/unknown/unknown), 200x100 [SAR 1:1 DAR 2:1]"],
    ["gif", "gif, bgra, 200x100 [SAR 64:64 DAR 2:1]"],
    ["apng", "apng, rgb24(pc, gbr/unknown/unknown), 200x100 [SAR 1:1 DAR 2:1]"],
    ["mjpeg", "mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 200x100 [SAR 1:1 DAR 2:1]"],
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
  // 9.0.2 on an EXIF-rotated 1600x1080 JPEG: input line = stored size,
  // output line = decoded size.
  const log = `Input #0, image2, from 'turned.jpg':
  Duration: 00:00:00.04, start: 0.000000, bitrate: 9712 kb/s
  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 1600x1080, 25 fps, 25 tbr, 25 tbn
Stream mapping:
  Stream #0:0 -> #0:0 (mjpeg (native) -> wrapped_avframe (native))
Press [q] to stop, [?] for help
Output #0, null, to 'pipe:':
  Metadata:
    encoder         : Lavf63.1.102
  Stream #0:0: Video: wrapped_avframe, yuvj420p(pc, bt470bg/unknown/unknown, progressive), 1080x1600, q=2-31, 200 kb/s, 25 fps, 25 tbn
    Metadata:
      encoder         : Lavc63.1.102 wrapped_avframe
    Side data:
      EXIF metadata: (14 bytes)`;

  it("reads the size the pictures were written at, not the input's", () => {
    expect(parseOutputSize(log)).toEqual({ width: 1080, height: 1600 });
  });

  it("has none for a run that never got to its output", () => {
    expect(parseOutputSize(log.slice(0, log.indexOf("Stream mapping")))).toBeNull();
  });
});

describe("shownDuration", () => {
  const packet = (frame: number, discard = false) => ({
    time: frame / 30,
    duration: 1 / 30,
    size: 1,
    key: false,
    discard,
  });

  // In decode order, as a trim without re-encoding leaves them: hidden frames
  // ahead of the cut, and a skip before the last.
  it("runs from the first shown frame to the end of the last", () => {
    const packets = [
      packet(-2, true),
      packet(-1, true),
      packet(0),
      packet(2),
      packet(1),
      packet(4),
    ];
    expect(shownDuration(packets)).toBeCloseTo(5 / 30);
  });
});
