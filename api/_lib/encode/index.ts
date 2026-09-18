import path from "node:path";
import type { FFmpeg } from "../ffmpeg.js";
import { encodeMp4, encodeMov } from "./h264.js";
import { encodeWebm } from "./webm.js";
import { encodeGif } from "./gif.js";
import { encodeWebp } from "./webp.js";
import { encodeAvif } from "./avif.js";

// What an encode can be asked for. `quality` is the UI's 1–100 slider, which
// each encoder maps onto its codec's own scale; `fps` (null = match the
// source) and `width` are GIF's.
export type EncodeOptions = {
  quality: number;
  fps?: number | null;
  width?: number;
};

// Writes `inputFile` (any video ffmpeg reads) to `outputFile` in one format.
export type Encoder = (
  ff: FFmpeg,
  inputFile: string,
  outputFile: string,
  options: EncodeOptions,
) => Promise<void>;

// The app's output stage: the one way a video becomes each format, whichever
// tool asks. Video targets keep audio; animated-image targets drop it.
// Mirrored in client/src/pages/Convert/Convert.tsx (CONVERT_TARGETS).
export const ENCODERS = {
  mp4: encodeMp4,
  webm: encodeWebm,
  mov: encodeMov,
  gif: encodeGif,
  webp: encodeWebp,
  avif: encodeAvif,
} satisfies Record<string, Encoder>;

export type EncodeTarget = keyof typeof ENCODERS;

export const ENCODE_TARGETS = Object.keys(ENCODERS) as EncodeTarget[];

export async function encodeVideo(
  ff: FFmpeg,
  inputFile: string,
  workDir: string,
  target: EncodeTarget,
  options: EncodeOptions,
): Promise<string> {
  if (target !== "gif") {
    console.log(`Converting to ${target} (quality ${options.quality})...`);
  }
  const outputFile = path.join(workDir, `output.${target}`);
  await ENCODERS[target](ff, inputFile, outputFile, options);
  return outputFile;
}
