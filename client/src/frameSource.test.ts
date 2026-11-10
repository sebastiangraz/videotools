import { describe, expect, it, vi } from "vitest";
import { openFrameSource } from "./frameSource";
import { clampStart, maxStart } from "./hooks/useVideoSource";
import { SCRUB_FRAMES, scrubTimes } from "./pages/Mark/useMarkPreview";
import {
  file,
  imageFile,
  stubImageDecoder,
  stubMediaLoading,
  stubProperties,
  type FakeFrame,
} from "./test/media";

describe("openFrameSource", () => {
  it("times a GIF off its frames, through ImageDecoder", async () => {
    // 20 frames of 0.1 s
    stubImageDecoder(20, 100);
    const frames = await openFrameSource(imageFile("a.gif"));
    const shown = async (second: number) =>
      ((await frames.frameAt(second)).image as unknown as FakeFrame).frameIndex;

    expect(await frames.duration()).toBe(2);
    expect(await frames.frameCount!()).toBe(20);
    expect(await shown(0)).toBe(0);
    expect(await shown(1.5)).toBe(15);
    // Past the end, the last frame (a <video> clamps the same way)
    expect(await shown(9)).toBe(19);
  });

  it("gives a still no length and its one frame at any time", async () => {
    stubImageDecoder(1, 0);
    const frames = await openFrameSource(imageFile("a.jpg", "image/jpeg"));

    expect(await frames.duration()).toBe(0);
    expect(await frames.frameCount!()).toBe(1);
    const frame = await frames.frameAt(3);
    expect((frame.image as unknown as FakeFrame).frameIndex).toBe(0);
  });

  it("waits for a video seek to land, and rejects it and every later one on an error", async () => {
    stubMediaLoading("decodes");
    // Seeks land only on `seeked`; jsdom has no `error`
    let error: object | null = null;
    stubProperties(HTMLVideoElement.prototype, {
      seeking: { get: () => true },
      error: { get: () => error },
    });
    const created = vi.spyOn(document, "createElement");
    const frames = await openFrameSource(file("a.mp4", "video/mp4"));
    const video = created.mock.results[0].value as HTMLVideoElement;

    const landing = frames.frameAt(1);
    video.dispatchEvent(new Event("seeked"));
    expect((await landing).image).toBe(video);

    const failing = frames.frameAt(2);
    error = {};
    video.dispatchEvent(new Event("error"));
    await expect(failing).rejects.toThrow();
    await expect(frames.frameAt(3)).rejects.toThrow();
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
  it("spaces its grabs evenly over the clip, the end left out", () => {
    const step = 10 / SCRUB_FRAMES;
    const times = scrubTimes(10);
    expect(times).toHaveLength(SCRUB_FRAMES);
    times.forEach((time, i) => expect(time).toBeCloseTo(i * step));
    expect(times.at(-1)! + step).toBeCloseTo(10);
  });

  it("grabs just the first frame of a still", () => {
    expect(scrubTimes(0)).toEqual([0]);
  });
});
