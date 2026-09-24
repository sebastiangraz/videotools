// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_AVIF_FPS } from "../encode/avif.js";
import type { SourceProfile } from "../ffmpeg.js";
import type { Source } from "../source.js";
import { changeSpeed } from "./speed.js";

const profile = (fps: number): SourceProfile => ({
  duration: 3,
  width: 320,
  height: 240,
  fps,
  codec: "av1",
  matrix: null,
  sar: 1,
  videoIndex: 0,
  formatNames: [],
  majorBrand: null,
  bitrateKbps: null,
  videoKbps: null,
  pixFmt: "yuv420p",
  audio: null,
});

const source = (format: Source["format"], fps: number): Source => ({
  path: "input",
  profile: profile(fps),
  format,
  still: null,
});

describe("changeSpeed", () => {
  it("keeps a video's frame rate and its rate: frames drop or repeat", () => {
    const faster = changeSpeed(source("mp4", 30), 2);
    expect(faster.fps).toBe(30);
    expect(faster.duration).toBe(1.5);
    expect(faster.pace).toBe(1);
    expect(changeSpeed(source("mp4", 30), 0.5).pace).toBe(1);
  });

  it("keeps every frame of a frame list: the delays change, at their bits", () => {
    for (const format of ["gif", "webp", "avif"] as const) {
      const faster = changeSpeed(source(format, 1), 2);
      expect(faster.fps).toBe(2);
      expect(faster.filter).toContain("setpts=PTS/2,fps=2");
      expect(faster.pace).toBe(2);
      const slower = changeSpeed(source(format, 1), 0.5);
      expect(slower.fps).toBe(0.5);
      expect(slower.pace).toBe(0.5);
    }
  });

  it("drops frames past what the format shows, keeping the bits of the rest", () => {
    const render = changeSpeed(source("avif", 30), 4);
    expect(render.fps).toBe(MAX_AVIF_FPS);
    expect(render.pace).toBe(MAX_AVIF_FPS / 30);
  });
});
