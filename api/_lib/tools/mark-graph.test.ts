// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MARK,
  MARK_SIZES,
  parseBounds,
  watermarkGraph,
  watermarkLayout,
} from "./mark-graph.js";


// Nothing here pins a tuned number: what the layout should come to is worked
// out from MARK, so the constants can be tweaked freely and the tests keep
// checking the model (the area budget, the frame-based gap, the bounds).
const HD = { width: 1920, height: 1080 };
// Big enough that rounding to even pixels is well under a percent.
const UHD = { width: 3840, height: 2160 };
const UNIT = Math.sqrt(UHD.width * UHD.height);
const layout = (
  video: { width: number; height: number },
  aspect: number,
  base = 1000,
) =>
  watermarkLayout(video, {
    width: Math.round(base * Math.sqrt(aspect)),
    height: Math.round(base / Math.sqrt(aspect)),
  });

// The suite runs on the values as tuned and on two quite different tunings,
// so it is known to hold across the range the constants might move in.
const TUNINGS: [string, Partial<typeof MARK>][] = [
  ["as tuned", {}],
  [
    "small, equal-area",
    { sizeRatio: 0.05, elongationGain: 0, maxSpan: 0.25, paddingRatio: 0.03 },
  ],
  [
    "large, near equal-height",
    { sizeRatio: 0.11, elongationGain: 0.8, maxSpan: 0.4, paddingRatio: 0.07 },
  ],
];

describe.each(TUNINGS)("watermarkLayout (%s)", (_name, tuning) => {
  const tuned = { ...MARK };
  beforeAll(() => void Object.assign(MARK, tuning));
  afterAll(() => void Object.assign(MARK, tuned));

  it("draws a 1:1 logo at sizeRatio of the frame's unit, paddingRatio of it in from the corner", () => {
    const l = layout(UHD, 1);
    expect(l.LW).toBe(l.LH);
    expect(Math.abs(l.LW - UNIT * MARK.sizeRatio)).toBeLessThanOrEqual(2);
    expect(l.margin).toBe(Math.round(UNIT * MARK.paddingRatio));
    expect([l.LX, l.LY]).toEqual([
      UHD.width - l.margin - l.LW,
      UHD.height - l.margin - l.LH,
    ]);
  });

  it("sizes by the logo's shape, not its resolution", () => {
    expect(layout(HD, 16 / 9, 200)).toEqual(layout(HD, 16 / 9, 4000));
  });

  it("has no jump anywhere along the aspect range", () => {
    for (let a = 0.1; a < 10; a *= 1.02) {
      const [p, q] = [layout(UHD, a), layout(UHD, a * 1.02)];
      // 2% more aspect moves a side by 2% at the very most (whatever the
      // gain); rounding to even adds up to 2px on top.
      expect(Math.abs(q.LW - p.LW)).toBeLessThan(0.03 * p.LW + 3);
      expect(Math.abs(q.LH - p.LH)).toBeLessThan(0.03 * p.LH + 3);
    }
  });

  it("budgets area by elongation^elongationGain, keeping the logo's aspect", () => {
    const square = layout(UHD, 1);
    for (const a of [4 / 3, 16 / 9, 3, 1 / 2]) {
      const l = layout(UHD, a);
      const elongation = Math.max(a, 1 / a);
      const budget = elongation ** MARK.elongationGain;
      const got = (l.LW * l.LH) / (square.LW * square.LH);
      expect(Math.abs(got / budget - 1)).toBeLessThan(0.05);
      expect(Math.abs(l.LW / l.LH / a - 1)).toBeLessThan(0.05);
    }
  });

  it("treats wide and tall alike, and landscape and portrait frames alike", () => {
    const [wide, tall] = [layout(HD, 2), layout(HD, 1 / 2)];
    expect([tall.LW, tall.LH]).toEqual([wide.LH, wide.LW]);
    const portrait = layout({ width: 1080, height: 1920 }, 2);
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
        expect(l.LW).toBeLessThanOrEqual(MARK.maxSpan * l.VW + 1);
        expect(l.LH).toBeLessThanOrEqual(MARK.maxSpan * l.VH + 1);
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
      parseBounds(line(0, 50, 349, 160, 239), 400, 400),
    ).toEqual({ x: 50, y: 160, width: 300, height: 80 });
  });

  it("falls back to the whole image when nothing is reported", () => {
    const full = { x: 0, y: 0, width: 400, height: 300 };
    expect(parseBounds("", 400, 300)).toEqual(full);
    expect(
      parseBounds(
        "[Parsed_bbox_2 @ 0] n:0 pts:0 pts_time:0",
        400,
        300,
      ),
    ).toEqual(full);
  });
});

describe("watermarkLayout sizes", () => {
  it("is the large size by default", () => {
    const bounds = { width: 300, height: 80 };
    expect(watermarkLayout(UHD, bounds)).toEqual(
      watermarkLayout(UHD, bounds, "large"),
    );
  });

  it("scales the logo and its gap by the size", () => {
    const square = { width: 1000, height: 1000 };
    const large = watermarkLayout(UHD, square, "large");
    const small = watermarkLayout(UHD, square, "small");
    const scale = MARK_SIZES.small / MARK_SIZES.large;
    expect(Math.abs(small.LW - large.LW * scale)).toBeLessThanOrEqual(2);
    expect(Math.abs(small.margin - large.margin * scale)).toBeLessThanOrEqual(
      1,
    );
    expect([small.LX, small.LY]).toEqual([
      UHD.width - small.margin - small.LW,
      UHD.height - small.margin - small.LH,
    ]);
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
    sar: 1,
  });
  const video = info(1920, 1080, "h264");
  const logo = info(400, 400, "png");

  it("crops a logo to its visible bounds and lays it out by them", () => {
    const bounds = { x: 50, y: 160, width: 300, height: 80 };
    const l = watermarkLayout(video, bounds);
    for (const filter of [false, true]) {
      const graph = watermarkGraph(video, logo, filter, bounds);
      expect(graph).toContain("[1:v]format=rgba,crop=300:80:50:160,");
      expect(graph).toContain(`scale=${l.LW}:${l.LH}:`);
    }
  });

  it("keeps an RGBA base out of YUV, and whole", () => {
    const odd = info(321, 241, "gif");
    for (const filter of [false, true]) {
      const graph = watermarkGraph(odd, logo, filter, undefined, {
        base: "rgba",
      });
      expect(graph).not.toMatch(/yuv|color_matrix/);
      expect(graph).toMatch(/^\[0:v\]format=rgba[,[]/);
      expect(graph).toMatch(/:format=auto,format=rgba\[out\]$/);
    }
  });

  it("composites video in yuv420p, cropped to even dimensions", () => {
    const odd = info(321, 241, "h264");
    for (const filter of [false, true]) {
      const graph = watermarkGraph(odd, logo, filter);
      expect(graph).toMatch(/^\[0:v\]format=yuv420p,crop=320:240:0:0/);
      expect(graph).toMatch(/,format=yuv420p\[out\]$/);
    }
  });

  it("takes the video from the stream it is told to", () => {
    for (const filter of [false, true]) {
      const graph = watermarkGraph(video, logo, filter, undefined, {
        pad: "[0:v:1]",
      });
      expect(graph).toMatch(/^\[0:v:1\]format=yuv420p/);
      expect(graph).not.toContain("[0:v]");
    }
  });

  it("lays the logo out at the size it is given", () => {
    const l = watermarkLayout(video, logo, "small");
    for (const filter of [false, true]) {
      const graph = watermarkGraph(video, logo, filter, undefined, {
        size: "small",
      });
      expect(graph).toContain(`scale=${l.LW}:${l.LH}:`);
    }
  });

  it("leaves a logo that fills its canvas alone", () => {
    for (const filter of [false, true]) {
      const graph = watermarkGraph(video, logo, filter);
      expect(graph).not.toMatch(/\[1:v\]format=rgba,crop=/);
    }
  });
});
