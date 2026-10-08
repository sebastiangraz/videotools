import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MARK,
  MARK_FILTERS,
  MARK_POSITIONS,
  MARK_SIZES,
  MARK_VIEWS,
  parseBounds,
  watermarkGraph,
  watermarkLayout,
} from "../_lib/tools/mark-graph.js";

// Expectations derive from MARK, so the tuned constants can change freely.
const HD = { width: 1920, height: 1080 };
// Big enough that rounding to even pixels is well under a percent.
const UHD = { width: 3840, height: 2160 };
const UNIT = Math.sqrt(UHD.width * UHD.height);
const layout = (video: { width: number; height: number }, aspect: number, base = 1000) =>
  watermarkLayout(video, {
    width: Math.round(base * Math.sqrt(aspect)),
    height: Math.round(base / Math.sqrt(aspect)),
  });

// Two alternative tunings prove the model holds as the constants move.
const TUNINGS: [string, Partial<typeof MARK>][] = [
  ["as tuned", {}],
  ["small, equal-area", { sizeRatio: 0.05, elongationGain: 0, maxSpan: 0.25, paddingRatio: 0.03 }],
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
    expect([l.LX, l.LY]).toEqual([UHD.width - l.margin - l.LW, UHD.height - l.margin - l.LH]);
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
    expect([portrait.LW, portrait.LH, portrait.margin]).toEqual([wide.LW, wide.LH, wide.margin]);
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
    expect(parseBounds(line(0, 50, 349, 160, 239), 400, 400)).toEqual({
      x: 50,
      y: 160,
      width: 300,
      height: 80,
    });
  });

  it("falls back to the whole image when nothing is reported", () => {
    const full = { x: 0, y: 0, width: 400, height: 300 };
    expect(parseBounds("", 400, 300)).toEqual(full);
    expect(parseBounds("[Parsed_bbox_2 @ 0] n:0 pts:0 pts_time:0", 400, 300)).toEqual(full);
  });
});

describe("watermarkLayout sizes", () => {
  it("is the medium size by default", () => {
    const bounds = { width: 300, height: 80 };
    expect(watermarkLayout(UHD, bounds)).toEqual(watermarkLayout(UHD, bounds, "medium"));
  });

  it.each([1, 16 / 9, 6, 1 / 3])(
    "scales a %s logo and its padding, and sets it a little further in",
    (aspect) => {
      const bounds = {
        width: Math.round(1000 * Math.sqrt(aspect)),
        height: Math.round(1000 / Math.sqrt(aspect)),
      };
      const base = watermarkLayout(UHD, bounds, "medium");
      const small = watermarkLayout(UHD, bounds, "small");
      const { scale, gap } = MARK_SIZES.small;
      expect(Math.abs(small.LW - base.LW * scale)).toBeLessThanOrEqual(2);
      expect(Math.abs(small.LH - base.LH * scale)).toBeLessThanOrEqual(2);
      expect(Math.abs(small.margin - base.margin * scale)).toBeLessThanOrEqual(1);
      // The medium gap is its padding; the small one is a share of that, the
      // same on both edges whatever the logo's shape
      expect(base.gap).toBe(base.margin);
      expect(Math.abs(small.gap - base.gap * gap)).toBeLessThanOrEqual(1);
      expect([small.LX, small.LY]).toEqual([
        UHD.width - small.gap - small.LW,
        UHD.height - small.gap - small.LH,
      ]);
      // The cell's corner stays even for the yuv420p crop
      expect((small.LX - small.margin) % 2).toBe(0);
      expect((small.LY - small.margin) % 2).toBe(0);
    },
  );

  it.each(Object.keys(MARK_SIZES) as (keyof typeof MARK_SIZES)[])(
    "keeps the %s gap its own, the padding giving way within it",
    (size) => {
      const bounds = { width: 300, height: 80 };
      const base = watermarkLayout(UHD, bounds, "medium");
      const l = watermarkLayout(UHD, bounds, size);
      const { scale, gap } = MARK_SIZES[size];
      expect(Math.abs(l.gap - base.gap * gap)).toBeLessThanOrEqual(1);
      expect(l.margin).toBeLessThanOrEqual(l.gap);
      expect(l.margin).toBeLessThanOrEqual(base.margin * scale + 1);
      expect((l.gap - l.margin) % 2).toBe(0);
    },
  );
});

describe("watermarkLayout positions", () => {
  const bounds = { width: 300, height: 80 };
  const positions = Object.keys(MARK_POSITIONS) as (keyof typeof MARK_POSITIONS)[];

  it("sits bottom-right by default", () => {
    expect(watermarkLayout(UHD, bounds)).toEqual(
      watermarkLayout(UHD, bounds, "medium", "bottom-right"),
    );
  });

  it.each(positions)(
    "keeps the gap from the edges, within a pixel of centre, at %s",
    (position) => {
      const [fx, fy] = MARK_POSITIONS[position];
      // At the edges exactly the gap in; centred to the pixel, nudged for parity
      const along = (f: number, at: number, length: number, span: number, gap: number) => {
        if (f === 0.5) expect(Math.abs(at - (span - length) / 2)).toBeLessThanOrEqual(1);
        else expect(at).toBe(f ? span - gap - length : gap);
      };
      for (const [width, height] of [
        [1920, 1080],
        [1080, 1920],
        [853, 481],
      ]) {
        for (const size of ["small", "medium", "large"] as const) {
          const l = watermarkLayout({ width, height }, bounds, size, position);
          along(fx, l.LX, l.LW, l.VW, l.gap);
          along(fy, l.LY, l.LH, l.VH, l.gap);
          // The cell's corner stays even for the yuv420p crop
          expect((l.LX - l.margin) % 2).toBe(0);
          expect((l.LY - l.margin) % 2).toBe(0);
        }
      }
    },
  );
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
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(video, logo, { filter, bounds });
      expect(graph).toContain("[1:v]format=rgba,crop=300:80:50:160,");
      expect(graph).toContain(`scale=${l.LW}:${l.LH}:`);
    }
  });

  it("keeps an RGBA base out of YUV, and whole", () => {
    const odd = info(321, 241, "gif");
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(odd, logo, { filter, base: "rgba" });
      expect(graph).not.toMatch(/yuv|color_matrix/);
      expect(graph).toMatch(/^\[0:v\]format=rgba[,[]/);
      expect(graph).toMatch(/:format=auto,format=rgba\[out\]$/);
    }
  });

  it("composites video in yuv420p, cropped to even dimensions", () => {
    const odd = info(321, 241, "h264");
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(odd, logo, { filter });
      expect(graph).toMatch(/^\[0:v\]format=yuv420p,crop=320:240:0:0/);
      expect(graph).toMatch(/,format=yuv420p\[out\]$/);
    }
  });

  it("takes the video from the stream it is told to", () => {
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(video, logo, { filter, pad: "[0:v:1]" });
      expect(graph).toMatch(/^\[0:v:1\]format=yuv420p/);
      expect(graph).not.toContain("[0:v]");
    }
  });

  it("lays the logo out at the size it is given", () => {
    const l = watermarkLayout(video, logo, "small");
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(video, logo, { filter, size: "small" });
      expect(graph).toContain(`scale=${l.LW}:${l.LH}:`);
    }
  });

  it("lays the logo out where it is told", () => {
    const l = watermarkLayout(video, logo, "medium", "top-left");
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(video, logo, { filter, position: "top-left" });
      // plain overlays the logo itself; the glass filters their padded cell
      const p = filter === "plain" ? 0 : l.margin;
      expect(graph).toContain(`overlay=x=${l.LX - p}:y=${l.LY - p}`);
    }
  });

  it("gives the shadow room for its whole blur and offset, whatever the size and position", () => {
    for (const size of Object.keys(MARK_SIZES) as (keyof typeof MARK_SIZES)[]) {
      for (const position of Object.keys(MARK_POSITIONS) as (keyof typeof MARK_POSITIONS)[]) {
        const l = watermarkLayout(video, logo, size, position);
        const graph = watermarkGraph(video, logo, { filter: "glass", size, position });
        const [, w, h, x, y, sigma] =
          /pad=(\d+):(\d+):(\d+):(\d+):color=black@0,format=rgba,alphaextract,format=gray,gblur=sigma=([\d.]+)[^;]*\[sk1\]/
            .exec(graph)!
            .map(Number);
        const dy = y - x;
        expect(dy).toBeGreaterThan(0);
        // 3σ clear on every side, the offset included
        expect(x).toBeGreaterThanOrEqual(3 * sigma);
        expect(w - l.LW - x).toBeGreaterThanOrEqual(3 * sigma);
        expect(h - l.LH - y).toBeGreaterThanOrEqual(3 * sigma);
        // on the frame, around the logo (off its edge if need be), at an even
        // corner and size
        expect(graph).toContain(`[unshadowed][shadow]overlay=x=${l.LX - x}:y=${l.LY - x},`);
        for (const n of [w, h, l.LX - x, l.LY - x]) expect(Math.abs(n % 2)).toBe(0);
      }
    }
  });

  it("rotates through every position from the one it is given, clear at each move", () => {
    const clip = { ...video, duration: 60 };
    const positions = Object.keys(MARK_POSITIONS) as (keyof typeof MARK_POSITIONS)[];
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(clip, logo, { filter, position: "left", rotatePosition: true });
      // Each stop's corner in turn, as the mark's (last) overlay picks them
      const [, xs, ys] = /.*overlay=x='[^;]+;([^']+)':y='[^;]+;([^']+)'/.exec(graph)!;
      const stops = xs.split("+").map((x, i) => `${parseInt(x)},${parseInt(ys.split("+")[i])}`);
      const p = filter === "plain" ? 0 : watermarkLayout(clip, logo).margin;
      const corner = (position: (typeof positions)[number]) => {
        const l = watermarkLayout(clip, logo, "medium", position);
        return `${l.LX - p},${l.LY - p}`;
      };
      expect(stops[0]).toBe(corner("left"));
      expect([...stops].sort()).toEqual(positions.map(corner).sort());
      expect(graph).toContain("[clock]");
      expect(watermarkGraph(clip, logo, { filter })).not.toContain("[clock]");
    }
  });

  it("divides a rotating clip into equal stays, as many as the cadence fits but two at least", () => {
    const stays = (cadences: number) => {
      const duration = cadences * MARK.rotateCadence;
      const graph = watermarkGraph({ ...video, duration }, logo, {
        filter: "plain",
        rotatePosition: true,
      });
      // The stay's length and the last stay's index, as the stop is picked
      const [period, last] = /floor\(t\/([\d.]+)\),(\d+)\)/.exec(graph)!.slice(1).map(Number);
      expect(period * (last + 1)).toBeCloseTo(duration);
      return last + 1;
    };
    expect(stays(3.1)).toBe(3);
    expect(stays(2.5)).toBe(2);
    expect(stays(0.1)).toBe(2);
  });

  it("stays put while rotating a clip of unknown length", () => {
    expect(watermarkGraph(video, logo, { filter: "glass", rotatePosition: true })).toBe(
      watermarkGraph(video, logo, { filter: "glass" }),
    );
  });

  it("draws the small glass's rim at a share of the medium one's width", () => {
    // 1080p: a 2px rim at medium, one erosion per px; at small, whole
    // erosions and a mixed-in share of one more for any fraction left
    const erosions = (graph: string) => graph.match(/\berosion\b/g)?.length;
    const base = watermarkGraph(video, logo, { filter: "glass" });
    expect(erosions(base)).toBe(2);
    expect(base).not.toContain("[er3]");
    const small = watermarkGraph(video, logo, {
      filter: "glass",
      size: "small",
    });
    const width = 2 * MARK_SIZES.small.rim;
    const part = width % 1;
    if (part < 0.01) {
      expect(erosions(small)).toBe(Math.round(width));
      expect(small).not.toContain("[er3]");
    } else {
      expect(erosions(small)).toBe(Math.floor(width) + 1);
      expect(small).toContain(`blend=all_expr='A+(B-A)*${part.toFixed(3)}'`);
    }
  });

  // The bevel's wide and narrow blurs: the lens's shape
  const heightfield = (graph: string) => /\[mk1\]gblur=[^;]*;\[mk2\]gblur=[^;]*/.exec(graph)?.[0];
  // The x slope, scaled by how far the lens refracts
  const lens = (graph: string) =>
    /convolution=0m='-1 0 1 -2 0 2 -1 0 1':0rdiv=[^:]*/.exec(graph)?.[0];
  const opacities = (graph: string) =>
    [...graph.matchAll(/colorchannelmixer=aa=([\d.]+)/g)].map(([, aa]) => Number(aa));

  it("shows the displacement map over a light-gray frame, whatever the filter", () => {
    const glass = watermarkGraph(video, logo, { filter: "glass" });
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(video, logo, {
        filter,
        view: "displacement",
      });
      // The frame painted over, the maps' red x and green y laid on it
      expect(graph).toMatch(/^\[0:v\][^;]*,drawbox=w=iw:h=ih:[^;]*:t=fill/);
      expect(graph).toContain("mergeplanes=");
      expect(graph).toMatch(/,format=yuv420p\[out\]$/);
      // and none of the glass that refracts the frame
      expect(graph).not.toContain("remap=");
      expect(heightfield(graph)).toBeDefined();
      expect(heightfield(graph)).toBe(heightfield(glass));
    }
  });

  it("clears the glass of all but its refraction, over the frame, whatever the filter", () => {
    const glass = watermarkGraph(video, logo, { filter: "glass" });
    expect(opacities(glass).some((aa) => aa > 0)).toBe(true);
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(video, logo, { filter, view: "clear" });
      expect(graph).not.toContain("drawbox");
      expect(graph).toContain("remap=");
      // No frost; shadow, faint logo and rim all transparent
      expect(graph).toContain("gblur=sigma=0.00:steps=2");
      expect(opacities(graph).every((aa) => aa === 0)).toBe(true);
      // and the lens as tuned
      expect(lens(graph)).toBeDefined();
      expect(lens(graph)).toBe(lens(glass));
    }
  });

  it("keeps only the rim, as tuned, over a dimmed frame, whatever the filter", () => {
    const glass = watermarkGraph(video, logo, { filter: "glass" });
    const rimPaint = (graph: string) => /\[rf3\][^;]*\[paint\]/.exec(graph)?.[0];
    const rimLight = (graph: string) => /\[h4\][^;]*\[light\]/.exec(graph)?.[0];
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(video, logo, { filter, view: "rim" });
      expect(graph).not.toContain("drawbox");
      // The frame dimmed where it shows; the rim still paints off the original
      expect(graph).toMatch(
        /^\[0:v\][^;]*,split\[undimmed\]\[src\];\[undimmed\]lutyuv=[^;]*\[base\]/,
      );
      // Glass, shadow and faint logo transparent; the rim at its own opacity
      expect(graph).toMatch(/\[m1\]alphamerge,colorchannelmixer=aa=0\[glass\]/);
      expect(opacities(graph).filter((aa) => aa > 0)).toEqual([MARK.rimOpacity]);
      // painted and lit as in the render, off the same lens
      expect(rimPaint(graph)).toBeDefined();
      expect(rimPaint(graph)).toBe(rimPaint(glass));
      expect(rimLight(graph)).toBe(rimLight(glass));
      expect(lens(graph)).toBe(lens(glass));
    }
  });

  it("renders the mark by default", () => {
    expect(MARK_VIEWS).toContain("render");
    for (const filter of MARK_FILTERS) {
      expect(watermarkGraph(video, logo, { filter, view: "render" })).toBe(
        watermarkGraph(video, logo, { filter }),
      );
    }
  });

  it("leaves a logo that fills its canvas alone", () => {
    for (const filter of MARK_FILTERS) {
      const graph = watermarkGraph(video, logo, { filter });
      expect(graph).not.toMatch(/\[1:v\]format=rgba,crop=/);
    }
  });
});
