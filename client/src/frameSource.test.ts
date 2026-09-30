import { describe, expect, it } from "vitest";
import { openFrameSource } from "./frameSource";
import { clampStart, maxStart } from "./hooks/useVideoSource";
import { scrubTimes } from "./pages/Mark/useMarkPreview";
import { gifFile, stubImageDecoder, type FakeFrame } from "./test/media";

describe("openFrameSource", () => {
  it("times a GIF off its frames, through ImageDecoder", async () => {
    // 20 frames of 0.1 s
    stubImageDecoder(20, 100);
    const frames = await openFrameSource(gifFile("a.gif"));
    const shown = async (second: number) =>
      ((await frames.frameAt(second)).image as unknown as FakeFrame).frameIndex;

    expect(await frames.duration()).toBe(2);
    expect(await shown(0)).toBe(0);
    expect(await shown(1.5)).toBe(15);
    // Past the end, the last frame (a <video> clamps the same way)
    expect(await shown(9)).toBe(19);
  });
});

describe("clampStart", () => {
  it("keeps Start at inside the clip, down to the last whole tenth", () => {
    expect(maxStart(10.57)).toBe(10.5);
    expect(clampStart(99, 10.57)).toBe(10.5);
    expect(clampStart(9, 2)).toBe(2);
    expect(clampStart(1.5, 2)).toBe(1.5);
    expect(clampStart(null, 2)).toBeNull();
  });

  it("leaves it be while the length is unknown", () => {
    expect(maxStart(0)).toBeUndefined();
    expect(clampStart(99, 0)).toBe(99);
  });
});

describe("scrubTimes", () => {
  it("spaces five grabs evenly over the clip, the end left out", () => {
    expect(scrubTimes(10)).toEqual([0, 2, 4, 6, 8]);
  });

  it("grabs just the first frame of a still", () => {
    expect(scrubTimes(0)).toEqual([0]);
  });
});
