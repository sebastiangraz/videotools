// @vitest-environment node
import { describe, expect, it } from "vitest";
import VideoProcessor from "./video-processor.js";

const HD = { width: 1920, height: 1080 };
const layout = (
  video: { width: number; height: number },
  aspect: number,
  base = 1000,
) =>
  VideoProcessor.watermarkLayout(video, {
    width: Math.round(base * Math.sqrt(aspect)),
    height: Math.round(base / Math.sqrt(aspect)),
  });

describe("watermarkLayout", () => {
  it("keeps a 4:1 logotype at its calibrated size, a logo-independent gap in", () => {
    const l = layout(HD, 4);
    expect([l.LW, l.LH, l.margin]).toEqual([346, 86, 65]);
    expect([l.LX, l.LY]).toEqual([1920 - 65 - 346, 1080 - 65 - 86]);
  });

  it("sizes by the logo's shape, not its resolution", () => {
    expect(layout(HD, 16 / 9, 200)).toEqual(layout(HD, 16 / 9, 4000));
  });

  it("has no jump anywhere along the aspect range", () => {
    for (let a = 0.1; a < 10; a *= 1.02) {
      const [p, q] = [layout(HD, a), layout(HD, a * 1.02)];
      // 2% more aspect moves each side by about 1–2%; rounding to even
      // adds up to 2px on sides that are at least 40px here.
      expect(Math.abs(q.LW - p.LW) / p.LW).toBeLessThan(0.08);
      expect(Math.abs(q.LH - p.LH) / p.LH).toBeLessThan(0.08);
    }
  });

  it("evens out the area: a square mark and a 4:3 logo are close, a logotype gets more", () => {
    const area = (a: number) => {
      const l = layout(HD, a);
      return l.LW * l.LH;
    };
    expect(area(4 / 3) / area(1)).toBeGreaterThan(1);
    expect(area(4 / 3) / area(1)).toBeLessThan(1.25);
    expect(area(4) / area(1)).toBeCloseTo(2, 1);
  });

  it("treats wide and tall alike, and landscape and portrait frames alike", () => {
    const [wide, tall] = [layout(HD, 3), layout(HD, 1 / 3)];
    expect([tall.LW, tall.LH]).toEqual([wide.LH, wide.LW]);
    const portrait = layout({ width: 1080, height: 1920 }, 3);
    expect([portrait.LW, portrait.LH, portrait.margin]).toEqual([
      wide.LW,
      wide.LH,
      wide.margin,
    ]);
  });

  it("scales with the frame, so the downscaled preview matches the export", () => {
    const full = layout({ width: 3840, height: 2160 }, 2.5);
    for (const [width, height] of [
      [1920, 1080],
      [1280, 720],
    ]) {
      const k = 3840 / width;
      const l = layout({ width, height }, 2.5);
      expect(Math.abs(l.LW * k - full.LW)).toBeLessThanOrEqual(2 * k);
      expect(Math.abs(l.LH * k - full.LH)).toBeLessThanOrEqual(2 * k);
      expect(Math.abs(l.margin * k - full.margin)).toBeLessThanOrEqual(k);
    }
  });

  it("stays even and inside the frame, glass cell included, for any logo on any frame", () => {
    const frames = [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
      [2560, 1080],
      [853, 481],
      [320, 240],
      [10000, 100],
    ];
    for (const [width, height] of frames) {
      const margins = new Set<number>();
      for (let a = 0.05; a <= 20; a *= 1.3) {
        const l = layout({ width, height }, a);
        for (const n of [l.VW, l.VH, l.LW, l.LH]) expect(n % 2).toBe(0);
        expect(l.LW).toBeLessThanOrEqual(0.33 * l.VW + 1);
        expect(l.LH).toBeLessThanOrEqual(0.33 * l.VH + 1);
        // The cell: the logo plus the margin on every side.
        expect(l.LX - l.margin).toBeGreaterThanOrEqual(0);
        expect(l.LY - l.margin).toBeGreaterThanOrEqual(0);
        expect(l.LX + l.LW + l.margin).toBe(l.VW);
        expect(l.LY + l.LH + l.margin).toBe(l.VH);
        margins.add(l.margin);
      }
      if (width < 10000) expect(margins.size).toBe(1);
    }
  });
});

describe("parseBounds", () => {
  const line = (n: number, x1: number, x2: number, y1: number, y2: number) =>
    `[Parsed_bbox_2 @ 000001526dfafdc0] n:${n} pts:${n} pts_time:${n} x1:${x1} x2:${x2} y1:${y1} y2:${y2} w:${x2 - x1 + 1} h:${y2 - y1 + 1} crop=1:1:0:0 drawbox=0:0:1:1`;

  it("reads the visible box", () => {
    expect(
      VideoProcessor.parseBounds(line(0, 50, 349, 160, 239), 400, 400),
    ).toEqual({ x: 50, y: 160, width: 300, height: 80 });
  });

  it("takes the union over an animation's frames, skipping empty ones", () => {
    const log = [
      line(0, 50, 100, 60, 90),
      "[Parsed_bbox_2 @ 000001526dfafdc0] n:1 pts:1 pts_time:1",
      line(2, 80, 300, 20, 70),
    ].join("\n");
    expect(VideoProcessor.parseBounds(log, 400, 400)).toEqual({
      x: 50,
      y: 20,
      width: 251,
      height: 71,
    });
  });

  it("falls back to the whole image when nothing is reported", () => {
    const full = { x: 0, y: 0, width: 400, height: 300 };
    expect(VideoProcessor.parseBounds("", 400, 300)).toEqual(full);
    expect(
      VideoProcessor.parseBounds(
        "[Parsed_bbox_2 @ 0] n:0 pts:0 pts_time:0",
        400,
        300,
      ),
    ).toEqual(full);
  });
});

describe("watermarkGraph", () => {
  const info = (width: number, height: number, codec: string) => ({
    duration: 0,
    width,
    height,
    fps: null,
    codec,
    matrix: null,
  });
  const video = info(1920, 1080, "h264");
  const logo = info(400, 400, "png");

  it("crops a logo to its visible bounds and lays it out by them", () => {
    const bounds = { x: 50, y: 160, width: 300, height: 80 };
    const l = VideoProcessor.watermarkLayout(video, bounds);
    for (const filter of [false, true]) {
      const { graph } = VideoProcessor.watermarkGraph(
        video,
        logo,
        filter,
        bounds,
      );
      expect(graph).toContain("[1:v]format=rgba,crop=300:80:50:160,");
      expect(graph).toContain(`scale=${l.LW}:${l.LH}:`);
    }
  });

  it("leaves a logo that fills its canvas alone", () => {
    for (const filter of [false, true]) {
      const { graph } = VideoProcessor.watermarkGraph(video, logo, filter);
      expect(graph).not.toMatch(/\[1:v\]format=rgba,crop=/);
    }
  });
});
