import fs from "node:fs/promises";
import type { FormatId } from "../../../shared/formats.js";
import type { Source } from "../source.js";

// How long the encoders that retry (gif.ts, webp.ts) may keep at it: the
// run has to stay inside the function's 300s (vercel.json), with room to
// upload the result.
export const TIME_BUDGET_MS = 240_000;

// What a tool asks the output stage to encode: the pictures, not the format.
// A tool describes its transformation as ffmpeg inputs plus a filtergraph and
// never encodes anything itself, so every result is encoded exactly once, by
// the one encoder its format has (index.ts).
export type Render = {
  // ffmpeg's input arguments: `-i <file>` per input, each with whatever
  // options have to precede it.
  inputArgs: string[];
  // A filter_complex that ends in [out]. Absent: the first input's video as
  // it is.
  filter?: string;
  // Whether the first input's audio comes along (where the format has any).
  keepAudio: boolean;
  // Play it forward, then backward. The encoder does this rather than the
  // tool's graph because each format has a cheaper way than reversing full
  // RGB frames in memory (see graphArgs, and gif.ts).
  palindrome?: boolean;
  // The upload the pictures come from, which is what quality is relative to
  // (rate.ts). Null when there is none to compare with: stills.
  source: Source | null;
  // Of the result, in seconds and frames per second. Encoders cap the rate
  // where their format has a ceiling.
  duration: number;
  fps: number;
  // Of the pictures, before any scaling an encoder does.
  width: number;
  height: number;
  // The pictures as PNG files in one folder, in order, when the tool has
  // them that way anyway (stills): what `inputArgs` reads, so an encoder
  // that works from frame files needs no copies of its own.
  frames?: string[];
};

// Pixel formats with an alpha channel, by ffmpeg's naming: rgba, bgra, argb,
// abgr, gbrap, yuva420p, ya8, pal8 (a GIF's palette can hold transparency).
export function hasAlpha(pixFmt: string): boolean {
  return /^(rgba|bgra|argb|abgr|gbrap|yuva|ya\d|pal8)/.test(pixFmt);
}

// The source's video as a filtergraph names it, as input number `input`:
// "[0:v]", or "[0:v:1]" where the video to work on is not the file's first
// video stream (SourceProfile.videoIndex).
export function videoPad(source: Source | null, input = 0): string {
  const index = source?.profile.videoIndex ?? 0;
  return index ? `[${input}:v:${index}]` : `[${input}:v]`;
}

// A frame rate as the fps filter takes it. ffmpeg prints NTSC rates rounded
// (29.97), and a filter given that decimal drifts a frame every half hour
// against the real 30000/1001.
export function frameRate(fps: number): string {
  const ntsc = [24, 30, 60, 120].find((n) => Math.abs(fps - n / 1.001) < 0.006);
  return ntsc ? `${ntsc}000/1001` : String(fps);
}

// A source, untransformed: what convert encodes, and what the tools start
// from.
export function sourceRender(source: Source, extra: Partial<Render> = {}): Render {
  return {
    inputArgs: ["-i", source.path],
    keepAudio: true,
    source,
    duration: source.profile.duration,
    fps: source.profile.fps ?? 30,
    width: source.profile.width,
    height: source.profile.height,
    ...extra,
  };
}

// Input and filter arguments of an encode: the render's graph followed by
// the encoder's own `chain` (frame rate, scaling: what its format needs).
// A plain source stays the plain `-vf` command. `pixFmt` is the format the
// encoder writes; a palindrome converts to it before buffering the reversed
// half, so that buffer holds 1.5 bytes a pixel (yuv420p) and not RGBA's 4
// wherever the format has no alpha to keep (WebP's bgra does).
export function graphArgs(
  render: Render,
  chain: string[],
  pixFmt: string,
): string[] {
  const { inputArgs, filter, palindrome, source } = render;
  if (!filter && !palindrome) {
    // Left to itself ffmpeg takes the video stream it likes best, which is
    // only certain to be the right one when there is just one.
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

// Audio arguments of a format that carries audio: `fits` are the codecs its
// container holds, `encode` is how it encodes anything else. Audio that fits
// is copied, which is the one truly lossless step an encode has: no tool
// changes the sound, so there is nothing to gain from encoding it again.
// With a filtergraph nothing is mapped by default, so the first input's
// audio is asked for, if it has any.
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

// What a result may weigh when it went in as the same frame-list format,
// which has no rate control (GIF, WebP): what its source weighed, by the
// frame (a sped-up one keeps all of its frames), times `share`, plus a tenth
// for what a tool adds. Null for any other source: a GIF of a video is never
// the video's size.
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
  return size * (frames / sourceFrames) * share * 1.1;
}
