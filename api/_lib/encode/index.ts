import path from "node:path";
import { FORMAT_IDS, type FormatId } from "../../../shared/formats.js";
import type { FFmpeg } from "../ffmpeg.js";
import { sourceVideoKbps } from "../source.js";
import { codecFactor, rateCap, type RateCap } from "./rate.js";
import type { Render } from "./render.js";
import { encodeMp4, encodeMov } from "./h264.js";
import { encodeWebm } from "./webm.js";
import { encodeGif } from "./gif.js";
import { encodeWebp } from "./webp.js";
import { encodeAvif } from "./avif.js";

// What an encode can be asked for. `quality` is the UI's 1–100 slider: each
// encoder maps it onto its codec's own scale, and where the codec has rate
// control it is also the share of the source's bitrate the result may spend
// (rate.ts). `fps` and `width` are the animated-image formats': absent, a
// format applies its own defaults, which suit a conversion (GIF: up to 30 fps
// and 640px, AVIF: 30 fps and 800px); a null width keeps the pictures' size.
// `everyFrame` says the pictures already come at `fps`, one for each frame
// the result is to have, so they are not resampled to that rate. (Resampling
// is not harmless: ffmpeg's fps filter loses the last frame of anything
// that went through an overlay.) `lossless` and `chroma444` are AVIF's, for
// pictures that are worth it: stills, which have no chroma subsampling or
// quantization behind them yet.
export type EncodeOptions = {
  quality: number;
  fps?: number | null;
  width?: number | null;
  everyFrame?: boolean;
  lossless?: boolean;
  chroma444?: boolean;
};

// Writes what a tool rendered (render.ts) to `outputFile` in one format.
// `cap` is null for the formats without rate control and for pictures with
// no source to measure them by.
export type Encoder = (
  ff: FFmpeg,
  render: Render,
  outputFile: string,
  options: EncodeOptions,
  cap: RateCap | null,
) => Promise<void>;

// The video codec of each format that has rate control. GIF and WebP have
// none: gifski and libwebp take a quality and the size is what it is.
const CODECS: Partial<Record<FormatId, string>> = {
  mp4: "h264",
  mov: "h264",
  webm: "vp9",
  avif: "av1",
};

// The app's output stage: the one way pictures become each format, whichever
// tool asks. Video formats can keep audio; animated-image formats drop it.
// The formats themselves are shared/formats.ts.
export const ENCODERS: Record<FormatId, Encoder> = {
  mp4: encodeMp4,
  webm: encodeWebm,
  mov: encodeMov,
  gif: encodeGif,
  webp: encodeWebp,
  avif: encodeAvif,
};

export const ENCODE_TARGETS = FORMAT_IDS;

// For the tools that hand their source's format back: nothing about the
// pictures changes that the tool didn't change itself, so no format gets to
// apply a conversion's frame rate and size defaults.
export function encodePreserved(
  ff: FFmpeg,
  render: Render,
  workDir: string,
  format: FormatId,
  quality: number,
): Promise<string> {
  return encodeRender(ff, render, workDir, format, {
    quality,
    fps: render.fps,
    width: null,
    everyFrame: true,
  });
}

export async function encodeRender(
  ff: FFmpeg,
  render: Render,
  workDir: string,
  target: FormatId,
  options: EncodeOptions,
): Promise<string> {
  if (target !== "gif") {
    console.log(`Encoding ${target} (quality ${options.quality})...`);
  }
  const codec = CODECS[target];
  const cap =
    codec && render.source
      ? rateCap(
          await sourceVideoKbps(ff, render.source),
          options.quality,
          render.duration,
          codecFactor(render.source.profile.codec, codec),
        )
      : null;
  if (cap) console.log(`At most ${cap.maxrate} kb/s, going by the source`);
  const outputFile = path.join(workDir, `output.${target}`);
  await ENCODERS[target](ff, render, outputFile, options, cap);
  return outputFile;
}
