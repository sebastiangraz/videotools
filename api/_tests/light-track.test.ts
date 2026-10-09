import { describe, expect, it } from "vitest";
import { findPeaks, gridSize, TRACK, trackLuma, type Luma } from "../_lib/light-track.js";

// The analysis grid of a 16:9 source, and glows drawn on it like the
// scripts/smoke-assets/light clips: a 16 black floor, 1/e² radius 0.22×height.
const [W, H] = [64, 36];
const SOURCE = { width: 640, height: 360 };
const SIGMA = (0.22 * H) / 2;
type Glow = { x: number; y: number; level?: number };
const frame = (glows: Glow[]) =>
  Uint8Array.from({ length: W * H }, (_, i) => {
    const [px, py] = [i % W, Math.floor(i / W)];
    const light = Math.max(
      0,
      ...glows.map(
        ({ x, y, level = 1 }) =>
          level * Math.exp(-((px - x) ** 2 + (py - y) ** 2) / (2 * SIGMA ** 2)),
      ),
    );
    return Math.round(16 + 219 * light);
  });
const clip = (seconds: number, glowsAt: (t: number) => Glow[]): Luma => {
  const step = 1 / TRACK.fps;
  const frames = Array.from({ length: Math.round(seconds / step) }, (_, i) =>
    frame(glowsAt(i * step)),
  );
  return { width: W, height: H, frames, step };
};
// Grid px to source px, as the track reports them.
const toSource = (g: Glow) => ({
  x: ((g.x + 0.5) * SOURCE.width) / W,
  y: ((g.y + 0.5) * SOURCE.height) / H,
});

describe("gridSize", () => {
  it("keeps the source's aspect at the grid's long side", () => {
    expect(gridSize(1920, 1080)).toEqual({ width: 64, height: 36 });
    expect(gridSize(1080, 1920)).toEqual({ width: 36, height: 64 });
  });
});

describe("findPeaks", () => {
  it("places a glow between grid pixels", () => {
    const [peak, ...rest] = findPeaks(frame([{ x: 20.4, y: 11.7 }]), W, H);
    expect(rest).toEqual([]);
    expect(peak.x).toBeCloseTo(20.4, 0);
    expect(peak.y).toBeCloseTo(11.7, 0);
    expect(Math.abs(peak.x - 20.4)).toBeLessThan(0.25);
    expect(Math.abs(peak.y - 11.7)).toBeLessThan(0.25);
  });

  it("finds no light in a flat or barely lit frame", () => {
    expect(findPeaks(frame([]), W, H)).toEqual([]);
    expect(findPeaks(frame([{ x: 30, y: 18, level: 0.04 }]), W, H)).toEqual([]);
  });

  it("lists every light near the brightest, brightest first, and drops faint ones", () => {
    const peaks = findPeaks(
      frame([
        { x: 10, y: 10, level: 0.9 },
        { x: 50, y: 25 },
        { x: 30, y: 30, level: 0.3 },
      ]),
      W,
      H,
    );
    expect(peaks.map((p) => Math.round(p.x))).toEqual([50, 10]);
  });

  it("takes a clipped plateau as one light", () => {
    const sky = Uint8Array.from({ length: W * H }, (_, i) => (Math.floor(i / W) < 8 ? 235 : 40));
    expect(findPeaks(sky, W, H)).toHaveLength(1);
  });
});

describe("trackLuma", () => {
  it("follows a glow crossing the frame, in source px", () => {
    const { points } = trackLuma(
      clip(6, (t) => [{ x: (W * t) / 6, y: H / 2 }]),
      SOURCE,
    );
    expect(points).toHaveLength(60);
    const xs = points.map((p) => p.x);
    expect(xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1)).toBe(true);
    for (const p of points) expect(Math.abs(p.y - SOURCE.height / 2)).toBeLessThan(6);
    // On the glow, unsmoothed.
    const mid = points[30];
    expect(Math.abs(mid.x - toSource({ x: W / 2, y: 0 }).x)).toBeLessThan(10);
    expect(mid.strength).toBeGreaterThan(0.5);
  });

  // Two equal glows wandering like pair.mp4's: the one followed is whichever
  // the track is nearer, and it may change only where they meet (they do,
  // at 6.9s).
  it("stays with one of two equal lights while they are apart", () => {
    const wander = (side: number, [f1, p1, f2, p2]: number[], t: number) =>
      side * (0.5 + 0.24 * Math.sin(f1 * t + p1) + 0.16 * Math.sin(f2 * t + p2));
    const glows = (t: number) => [
      { x: wander(W, [0.9, 0, 2.3, 1.1], t), y: wander(H, [1.3, 2, 2.9, 0.4], t) },
      { x: wander(W, [1.1, 3, 2.1, 4.2], t), y: wander(H, [0.7, 5, 3.1, 2.6], t) },
    ];
    const { points } = trackLuma(clip(12, glows), SOURCE);
    let followed = -1;
    let switches = 0;
    for (const p of points) {
      const [a, b] = glows(p.time).map(toSource);
      // Met: either may be the one it leaves with.
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.25 * SOURCE.width) {
        followed = -1;
        continue;
      }
      const nearer = Math.hypot(p.x - a.x, p.y - a.y) < Math.hypot(p.x - b.x, p.y - b.y) ? 0 : 1;
      if (followed >= 0 && nearer !== followed) switches++;
      followed = nearer;
    }
    expect(switches).toBe(0);
  });

  it("ignores a brighter light that flashes for less than holdSeconds", () => {
    const flash = TRACK.holdSeconds / 2;
    const { points } = trackLuma(
      clip(3, (t) => [
        { x: 12, y: 18, level: 0.7 },
        { x: 52, y: 18, level: t >= 1 && t < 1 + flash ? 1 : 0.7 },
      ]),
      SOURCE,
    );
    for (const p of points) expect(p.x).toBeLessThan(SOURCE.width / 2);
  });

  it("moves to a light that stays brighter for holdSeconds, from when it got brighter", () => {
    const { points } = trackLuma(
      clip(4, (t) => [
        { x: 12, y: 18, level: 0.7 },
        { x: 52, y: 18, level: t >= 1 ? 1 : 0.7 },
      ]),
      SOURCE,
    );
    const atSecond = (s: number) => points[Math.round(s * TRACK.fps)];
    expect(atSecond(1 - 0.1).x).toBeLessThan(SOURCE.width / 4);
    for (const s of [1, 1 + TRACK.holdSeconds / 2, 4 - 0.1]) {
      expect(atSecond(s).x).toBeGreaterThan(SOURCE.width * 0.75);
      expect(atSecond(s).strength).toBeGreaterThan(0.8);
    }
  });

  it("takes the brightest light at once when the followed one is gone (a cut)", () => {
    const { points } = trackLuma(
      clip(3, (t) => (t < 1 ? [{ x: 12, y: 10 }] : [{ x: 52, y: 26 }])),
      SOURCE,
    );
    expect(points[Math.round(1.8 * TRACK.fps)].x).toBeGreaterThan(SOURCE.width * 0.7);
  });

  it("holds the last light through dark frames, with no strength", () => {
    const { points } = trackLuma(
      clip(2, (t) => (t < 1 ? [{ x: 20, y: 9 }] : [])),
      SOURCE,
    );
    const last = points.at(-1)!;
    expect(last.strength).toBe(0);
    expect(last.x).toBeCloseTo(points[9].x, 0);
    expect(last.y).toBeCloseTo(points[9].y, 0);
  });

  it("starts in the middle of a frame with no light", () => {
    const { points } = trackLuma(
      clip(0.2, () => []),
      SOURCE,
    );
    expect(points[0]).toMatchObject({ x: 320, y: 180, strength: 0 });
  });
});
