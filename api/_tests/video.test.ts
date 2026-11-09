import { afterEach, describe, expect, it, vi } from "vitest";
import type { FFmpeg } from "../_lib/ffmpeg.js";
import type { Render } from "../_lib/encode/render.js";
import { x264Threads } from "../_lib/encode/video.js";

const engine = { heap: 3.4 * 2 ** 30 } as FFmpeg;
const frames = (width: number, height: number, held?: number) =>
  ({ width, height, held }) as Render;

describe("x264Threads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leaves a native run to x264", () => {
    expect(x264Threads({ heap: null } as FFmpeg, frames(3840, 2160))).toEqual([]);
  });

  it("gives small frames x264's own count and large ones what the heap fits", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 32 });
    expect(x264Threads(engine, frames(1920, 1080))).toEqual(["-threads", "48"]);
    expect(x264Threads(engine, frames(3840, 2160))).toEqual(["-threads", "11"]);
  });

  it("makes room for what the graph buffers", () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 32 });
    expect(x264Threads(engine, frames(3840, 2160, 1.2e9))).toEqual(["-threads", "2"]);
  });

  it("refuses frames no thread count fits", () => {
    expect(() => x264Threads(engine, frames(7680, 4320))).toThrow(/too large/);
  });
});
