import fs from "node:fs/promises";
import path from "node:path";
import type { FormatId } from "../../../shared/formats.js";
import { DEFAULT_FPS, type FFmpeg } from "../ffmpeg.js";
import type { Source } from "../source.js";

// Leaves room inside the function's 300s (vercel.json) to upload the result.
const TIME_BUDGET_MS = 240_000;

// Assumes another try costs what the one begun at `started` did.
export function outOfTime(ff: FFmpeg, started: number): boolean {
  const took = Date.now() - started;
  return Date.now() - ff.startedAt + took > TIME_BUDGET_MS;
}

// Headroom over the source's bytes for what a tool adds.
export const TOOL_ALLOWANCE = 1.1;

const CONVERSION_FPS = 30;
export const conversionFps = (render: Render) =>
  Math.min(render.fps, CONVERSION_FPS);

export const fitWidth = (width: number) =>
  `scale='min(${width},iw)':-2:flags=lanczos`;

export function scaledSize(
  render: Render,
  width: number | null | undefined,
): { width: number; height: number } {
  const scale = width == null ? 1 : Math.min(1, width / render.width);
  return { width: render.width * scale, height: render.height * scale };
}

// Finest first; `coarsest` is as far as a size ceiling may push.
export function levelRange(finest: number, coarsest: number): number[] {
  const step = finest < coarsest ? 1 : -1;
  return Array.from(
    { length: Math.abs(coarsest - finest) + 1 },
    (_, i) => finest + i * step,
  );
}

// Index 0 is known not to fit. `over`: coarsest found too big; `pick`: finest
// that may fit (the last, untried, if none did).
export async function bisect(
  count: number,
  fits: (index: number) => Promise<boolean>,
  more = () => true,
): Promise<{ over: number; pick: number }> {
  let over = 0;
  let pick = count - 1;
  while (pick - over > 1 && more()) {
    const middle = Math.floor((over + pick) / 2);
    if (await fits(middle)) pick = middle;
    else over = middle;
  }
  return { over, pick };
}

// Tools only describe pictures (inputs + filtergraph); each result is encoded
// exactly once, by its format's encoder (index.ts).
export type Render = {
  inputArgs: string[];
  // Ends in [out]; absent means the first input's video as is.
  filter?: string;
  keepAudio: boolean;
  // Done by the encoder: each format has a cheaper way than reversing full
  // RGB frames in memory (graphArgs, gif.ts).
  palindrome?: boolean;
  // What quality is relative to (rate.ts); null for stills.
  source: Source | null;
  duration: number;
  fps: number;
  // Speed-up of a frame list that keeps every frame (GIF/WebP/AVIF): 2 lets
  // the result spend 2× the source rate so each frame keeps its bits. 1 for
  // video, which drops/repeats frames.
  pace?: number;
  // Before any encoder scaling.
  width: number;
  height: number;
  // PNG frames `inputArgs` already reads (stills), for frame-file encoders.
  frames?: string[];
};

// pal8 included: a GIF palette can hold transparency.
export function hasAlpha(pixFmt: string): boolean {
  return /^(rgba|bgra|argb|abgr|gbrap|yuva|ya\d|pal8)/.test(pixFmt);
}

// "[0:v:N]" when the main video isn't the first stream (videoIndex).
export function videoPad(source: Source | null, input = 0): string {
  const index = source?.profile.videoIndex ?? 0;
  return index ? `[${input}:v:${index}]` : `[${input}:v]`;
}

// ffmpeg prints NTSC rates rounded (29.97); fps=29.97 drifts a frame every
// half hour against the real 30000/1001.
const NTSC_TOLERANCE = 0.006;
export function frameRate(fps: number): string {
  const ntsc = [24, 30, 60, 120].find(
    (n) => Math.abs(fps - n / 1.001) < NTSC_TOLERANCE,
  );
  return ntsc ? `${ntsc}000/1001` : String(fps);
}

export function sourceRender(
  source: Source,
  extra: Partial<Render> = {},
): Render {
  return {
    inputArgs: ["-i", source.path],
    keepAudio: true,
    source,
    duration: source.profile.duration,
    fps: source.profile.fps ?? DEFAULT_FPS,
    width: source.profile.width,
    height: source.profile.height,
    ...extra,
  };
}

// A palindrome converts to `pixFmt` before `reverse` buffers frames, so the
// buffer holds 1.5 bytes/px (yuv420p) rather than RGBA's 4.
export function graphArgs(
  render: Render,
  chain: string[],
  pixFmt: string,
): string[] {
  const { inputArgs, filter, palindrome, source } = render;
  if (!filter && !palindrome) {
    // Unmapped, ffmpeg picks the stream it likes best, maybe a cover image.
    const index = source?.profile.videoIndex ?? 0;
    return [
      "-y",
      ...inputArgs,
      ...(index ? ["-map", `0:v:${index}`] : []),
      ...(chain.length ? ["-vf", chain.join(",")] : []),
    ];
  }
  const steps = palindrome ? [...chain, `format=${pixFmt}`] : chain;
  const body = steps.length ? steps.join(",") : "null";
  const graph =
    `${filter ? `${filter};[out]` : videoPad(source)}${body}` +
    (palindrome
      ? ",split[fwd][rev];[rev]reverse[back];[fwd][back]concat=n=2:v=1:a=0[enc]"
      : "[enc]");
  return ["-y", ...inputArgs, "-filter_complex", graph, "-map", "[enc]"];
}

// Audio is copied when the container takes its codec (`fits`): no tool
// changes sound, so re-encoding gains nothing.
export function audioArgs(
  render: Render,
  fits: string[],
  encode: string[],
): string[] {
  if (!render.keepAudio) return ["-an"];
  // Once the video is mapped by hand (graphArgs), so is everything else.
  const byHand =
    render.filter || render.palindrome || render.source?.profile.videoIndex;
  const mapped = byHand ? ["-map", "0:a?"] : [];
  const codec = render.source?.profile.audio?.codec;
  const copy = codec !== undefined && fits.includes(codec);
  return [...mapped, ...(copy ? ["-c:a", "copy"] : encode)];
}

// For same-format frame lists (no rate control): source bytes per frame.
// Null otherwise: a GIF of a video is never the video's size.
export async function sourceBytesBudget(
  render: Render,
  format: FormatId,
  frames: number,
  share = 1,
): Promise<number | null> {
  const { source } = render;
  if (source?.format !== format) return null;
  const { duration, fps } = source.profile;
  const sourceFrames = Math.round(duration * (fps ?? 0));
  if (sourceFrames < 1) return null;
  const { size } = await fs.stat(source.path);
  return size * (frames / sourceFrames) * share * TOOL_ALLOWANCE;
}

// For encoders without trustworthy rate control (GIF, WebP, short AVIF):
// bisect `levels` while time allows, keeping the finest fit, else smallest.
export async function encodeWithinBudget(
  ff: FFmpeg,
  {
    outputFile,
    levels,
    budget,
    encode,
  }: {
    outputFile: string;
    levels: number[];
    budget: number | null;
    encode: (level: number, to: string) => Promise<unknown>;
  },
): Promise<void> {
  let started = Date.now();
  await encode(levels[0], outputFile);
  const fits = async (file: string) =>
    (await fs.stat(file)).size <= (budget ?? Infinity);
  if (await fits(outputFile)) return;

  const tryFile = `${outputFile}.try${path.extname(outputFile)}`;
  let fitted = false;
  const { over, pick } = await bisect(
    levels.length,
    async (index) => {
      started = Date.now();
      await encode(levels[index], tryFile);
      const fit = await fits(tryFile);
      // A fit is finer than earlier fits; a miss is smaller than all tries.
      if (fit || !fitted) await fs.rename(tryFile, outputFile);
      fitted ||= fit;
      return fit;
    },
    () => !outOfTime(ff, started),
  );
  await fs.rm(tryFile, { force: true });
  console.log(
    `Over the ${Math.round(budget ?? 0)} bytes its source allows at ` +
      `${levels[0]}: settled on ${fitted ? levels[pick] : levels[over]}`,
  );
}
