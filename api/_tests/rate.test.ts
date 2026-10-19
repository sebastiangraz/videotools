import { describe, expect, it } from "vitest";
import { codecFactor, rateCap } from "../_lib/encode/rate.js";

describe("rateCap", () => {
  it("spends three times the source's rate at quality 100 and a share of it below", () => {
    expect(rateCap(2723, 100, 5.03)?.maxrate).toBe(8169);
    expect(rateCap(2723, 60, 5.03)?.maxrate).toBe(4901);
    expect(rateCap(2723, 50, 5.03)?.maxrate).toBe(4085);
  });

  it("has no ceiling without a source to compare with", () => {
    expect(rateCap(null, 100, 5)).toBeNull();
    expect(rateCap(0, 100, 5)).toBeNull();
  });

  it("sizes the buffer by the clip, between half a second and two", () => {
    expect(rateCap(1000, 50, 1)?.bufsize).toBe(750);
    expect(rateCap(1000, 50, 6)?.bufsize).toBe(1500);
    expect(rateCap(1000, 50, 60)?.bufsize).toBe(3000);
  });

  it("gives a source in a leaner codec more to spend", () => {
    expect(rateCap(1000, 50, 6, codecFactor("hevc", "h264"))?.maxrate).toBe(2250);
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
