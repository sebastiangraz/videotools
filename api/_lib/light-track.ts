import fs from "node:fs/promises";
import path from "node:path";
import type { FFmpeg } from "./ffmpeg.js";

// Where a picture's light is: its brightest region, followed over time. The
// analysis reads a small blurred luma grid, so a broad glow outweighs a
// specular pixel, and costs one tiny decode of the source.
export const TRACK = {
  // Analysis grid long side, px.
  grid: 64,
  // Analysed frames per second; the light moves slower than this.
  fps: 10,
  // Grid blur sigma, px: one bright block is not a light.
  blur: 1.5,
  // A light counts only above this share of the brightest pixel's contrast.
  floor: 0.6,
  // Contrast (peak less the frame's median, 0–255) below which a frame has
  // no light to follow, e.g. a flat grey or a fade to black.
  minContrast: 12,
  // A rival peak takes over only once this much brighter than the followed
  // one (by contrast) ...
  switchMargin: 0.15,
  // ... for this long, seconds: a flicker or a crossing never moves the light.
  holdSeconds: 0.4,
  // Grid diagonal share a light may travel between two analysed frames and
  // still be the one followed; past it, it was lost (a cut), and the
  // brightest is taken at once.
  reach: 0.12,
  // Position smoothing time constant, seconds: a switch glides over ~3×.
  smoothSeconds: 0.1,
};

export type Luma = {
  // Grid size; each frame is width×height 8-bit luma, row-major.
  width: number;
  height: number;
  frames: Uint8Array[];
  // Seconds per frame.
  step: number;
};

export type Peak = { x: number; y: number; contrast: number };

// `x`/`y` in source px (pixel centres), `strength` the light's contrast 0–1:
// 0 where the frame had none, which holds the last position.
export type LightPoint = { time: number; x: number; y: number; strength: number };

export type LightTrack = { width: number; height: number; points: LightPoint[] };

export function gridSize(width: number, height: number, long = TRACK.grid) {
  const scale = long / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// Raw grey frames, written to a file: the runner buffers stdout as text.
export async function sampleLuma(
  ff: FFmpeg,
  file: string,
  {
    width,
    height,
    videoIndex = 0,
    workDir,
  }: { width: number; height: number; videoIndex?: number; workDir: string },
): Promise<Luma> {
  const grid = gridSize(width, height);
  const rawFile = path.join(workDir, "light-luma.raw");
  await ff.runFFmpeg([
    "-y",
    "-i",
    file,
    "-map",
    `0:v:${videoIndex}`,
    "-vf",
    `fps=${TRACK.fps},scale=${grid.width}:${grid.height}:flags=area,format=gray,gblur=sigma=${TRACK.blur}`,
    "-f",
    "rawvideo",
    rawFile,
  ]);
  const data = await fs.readFile(rawFile);
  await fs.rm(rawFile, { force: true });
  const size = grid.width * grid.height;
  const frames = Array.from(
    { length: Math.floor(data.length / size) },
    (_, i) => new Uint8Array(data.buffer, data.byteOffset + i * size, size),
  );
  return { ...grid, frames, step: 1 / TRACK.fps };
}

// Each connected region above the floor is one light, brightest first, at
// its centroid weighted by how far above the floor each pixel is: a glow's
// middle, or the middle of a clipped sky.
export function findPeaks(frame: Uint8Array, width: number, height: number): Peak[] {
  const median = medianOf(frame);
  let max = 0;
  for (const v of frame) max = Math.max(max, v);
  if (max - median < TRACK.minContrast) return [];
  const floor = median + (max - median) * TRACK.floor;
  const seen = new Uint8Array(frame.length);
  const peaks: Peak[] = [];
  const queue: number[] = [];
  for (let start = 0; start < frame.length; start++) {
    if (seen[start] || frame[start] < floor) continue;
    seen[start] = 1;
    queue.push(start);
    let [sum, sx, sy, top] = [0, 0, 0, 0];
    while (queue.length) {
      const i = queue.pop()!;
      const [x, y] = [i % width, Math.floor(i / width)];
      // +1: a region one notch over the floor still has a place.
      const w = frame[i] - floor + 1;
      [sum, sx, sy, top] = [sum + w, sx + w * x, sy + w * y, Math.max(top, frame[i])];
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const n = ny * width + nx;
          if (!seen[n] && frame[n] >= floor) {
            seen[n] = 1;
            queue.push(n);
          }
        }
      }
    }
    peaks.push({ x: sx / sum, y: sy / sum, contrast: top - median });
  }
  return peaks.sort((a, b) => b.contrast - a.contrast);
}

function medianOf(frame: Uint8Array): number {
  const counts = new Uint32Array(256);
  for (const v of frame) counts[v]++;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += counts[v];
    if (seen * 2 >= frame.length) return v;
  }
  return 255;
}

// Follows one light across the frames: the peak nearest the last one, until
// a rival outshines it by switchMargin for holdSeconds, or it's lost. Then
// smoothed, and mapped from grid to source px.
export function trackLuma(luma: Luma, source: { width: number; height: number }): LightTrack {
  const { width, height, frames, step } = luma;
  const reach = TRACK.reach * Math.hypot(width, height);
  const smooth = 1 - Math.exp(-step / TRACK.smoothSeconds);
  const apart = (a: Peak, b: Peak) => Math.hypot(a.x - b.x, a.y - b.y);
  let followed: Peak | null = null;
  // The brighter peak waiting out holdSeconds, and since when.
  let rival: { peak: Peak; since: number } | null = null;
  // Starts mid-frame until a light shows.
  let shown = { x: (width - 1) / 2, y: (height - 1) / 2 };
  const points: LightPoint[] = [];

  for (const [i, frame] of frames.entries()) {
    const time = i * step;
    const peaks = findPeaks(frame, width, height);
    if (!peaks.length) {
      points.push({ time, ...toSource(shown), strength: 0 });
      continue;
    }
    const brightest = peaks[0];
    const last: Peak | null = followed;
    const near: Peak | null = last
      ? peaks.reduce((a, b) => (apart(b, last) < apart(a, last) ? b : a))
      : null;
    let next: Peak;
    if (!last || !near || apart(near, last) > reach) {
      next = brightest;
      rival = null;
      if (!last) shown = { x: brightest.x, y: brightest.y };
    } else if (brightest.contrast > near.contrast * (1 + TRACK.switchMargin)) {
      const since: number = rival && apart(brightest, rival.peak) <= reach ? rival.since : time;
      const held = time - since >= TRACK.holdSeconds - 1e-9;
      next = held ? brightest : near;
      rival = held ? null : { peak: brightest, since };
    } else {
      next = near;
      rival = null;
    }
    followed = next;
    shown = {
      x: shown.x + (next.x - shown.x) * smooth,
      y: shown.y + (next.y - shown.y) * smooth,
    };
    points.push({ time, ...toSource(shown), strength: next.contrast / 255 });
  }
  return { width: source.width, height: source.height, points };

  function toSource({ x, y }: { x: number; y: number }) {
    return {
      x: ((x + 0.5) * source.width) / width,
      y: ((y + 0.5) * source.height) / height,
    };
  }
}

export async function trackLight(
  ff: FFmpeg,
  file: string,
  source: { width: number; height: number; videoIndex?: number },
  workDir: string,
): Promise<LightTrack> {
  return trackLuma(await sampleLuma(ff, file, { ...source, workDir }), source);
}
