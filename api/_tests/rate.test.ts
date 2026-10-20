import { describe, expect, it } from "vitest";
import { codecFactor, rateCap } from "../_lib/encode/rate.js";

// `seconds` of video at `kbps`; 32 fps keeps the times exact in binary.
const steady = (kbps: number, seconds: number, from = 0) =>
  Array.from({ length: seconds * 32 }, (_, i) => ({
    time: from + i / 32,
    duration: 1 / 32,
    size: (kbps * 1000) / 8 / 32,
  }));

describe("rateCap", () => {
  it("spends three times the source's rate at quality 100 and a share of it below", () => {
    expect(rateCap(steady(2700, 6), 100, 6)?.maxrate).toBe(8100);
    expect(rateCap(steady(2700, 6), 60, 6)?.maxrate).toBe(4860);
    expect(rateCap(steady(2700, 6), 50, 6)?.maxrate).toBe(4050);
  });

  it("goes by the source's busiest stretch, not its average", () => {
    const hold = [...steady(100, 5), ...steady(2000, 2, 5), ...steady(100, 5, 7)];
    expect(rateCap(hold, 100, 12)?.maxrate).toBe(6000);
  });

  it("goes by the whole clip when it is shorter than the buffer", () => {
    expect(rateCap(steady(1000, 0.25), 100, 0.25)?.maxrate).toBe(3000);
  });

  it("has no ceiling without a source to compare with", () => {
    expect(rateCap(null, 100, 5)).toBeNull();
    expect(rateCap([], 100, 5)).toBeNull();
  });

  it("sizes the buffer by the clip, between half a second and two", () => {
    expect(rateCap(steady(1000, 1), 50, 1)?.bufsize).toBe(750);
    expect(rateCap(steady(1000, 6), 50, 6)?.bufsize).toBe(1500);
    expect(rateCap(steady(1000, 60), 50, 60)?.bufsize).toBe(3000);
  });

  it("gives a source in a leaner codec more to spend", () => {
    expect(rateCap(steady(1000, 6), 50, 6, codecFactor("hevc", "h264"))?.maxrate).toBe(2250);
  });
});

describe("codecFactor", () => {
  it("is 1 between equals and towards the leaner codec", () => {
    expect(codecFactor("h264", "h264")).toBe(1);
    expect(codecFactor("vp9", "vp9")).toBe(1);
    expect(codecFactor("h264", "vp9")).toBe(1);
    expect(codecFactor("mpeg4", "h264")).toBe(1);
  });

  it("makes up for what H.264 needs over HEVC, VP9 and AV1", () => {
    expect(codecFactor("hevc", "h264")).toBeCloseTo(1.5);
    expect(codecFactor("vp9", "h264")).toBeCloseTo(1.4);
    expect(codecFactor("av1", "h264")).toBeCloseTo(1.8);
  });
});
