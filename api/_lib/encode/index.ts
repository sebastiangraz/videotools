import path from "node:path";
import type { FormatId } from "../../../shared/formats.js";
import type { FFmpeg } from "../ffmpeg.js";
import type { Source } from "../source.js";
import type { ToolJob } from "../tools/types.js";
import { codecFactor, rateCap, type RateCap } from "./rate.js";
import type { Render } from "./render.js";
import { encodeMp4, encodeMov, encodeWebm } from "./video.js";
import { encodeGif } from "./gif.js";
import { encodeWebp } from "./webp.js";
import { encodeAvif } from "./avif.js";

// What an encode can be asked for. `quality` is the UI's 1–100 slider: each
// encoder maps it onto its codec's own scale, and where the codec has rate
// control it is also the share of the source's bitrate the result may spend
// (rate.ts). `fps` and `width` are the animated-image formats': absent, a
// format applies its own defaults, which suit a conversion (GIF: up to 30 fps
// and 640px, WebP and AVIF: 30 fps and 800px); a null width keeps the
// pictures' size.
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
  target: EncodeOptions & { outputFile: string; cap: RateCap | null },
) => Promise<void>;

// What an encode needs of the job that asks for it.
type EncodeJob = Pick<ToolJob, "ff" | "workDir">;

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
const ENCODERS: Record<FormatId, Encoder> = {
  mp4: encodeMp4,
  webm: encodeWebm,
  mov: encodeMov,
  gif: encodeGif,
  webp: encodeWebp,
  avif: encodeAvif,
};

// For the tools that hand their source's format back: nothing about the
// pictures changes that the tool didn't change itself, so no format gets to
// apply a conversion's frame rate and size defaults.
export function encodePreserved(
  job: EncodeJob,
  render: Render,
  { format, quality }: { format: FormatId; quality: number },
): Promise<string> {
  return encodeRender(job, render, {
    format,
    quality,
    fps: render.fps,
    width: null,
    everyFrame: true,
  });
}

export async function encodeRender(
  { ff, workDir }: EncodeJob,
  render: Render,
  { format: target, ...options }: EncodeOptions & { format: FormatId },
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
          codecFactor(render.source.profile.codec, codec) * (render.pace ?? 1),
        )
      : null;
  if (cap) console.log(`At most ${cap.maxrate} kb/s, going by the source`);
  const outputFile = path.join(workDir, `output.${target}`);
  await ENCODERS[target](ff, render, { ...options, outputFile, cap });
  return outputFile;
}

// What the source's video stream spends per second, in kb/s: the summary's
// figure where there is one, else measured. Null when it cannot be known
// (a still, a stream without duration).
async function sourceVideoKbps(
  ff: FFmpeg,
  source: Source,
): Promise<number | null> {
  const { videoKbps, duration } = source.profile;
  if (videoKbps) return videoKbps;
  if (!(duration > 0)) return null;
  const packets = await ff.videoPackets(source.path);
  if (!packets) return null;
  const bytes = packets.reduce((sum, p) => sum + p.size, 0);
  return Math.round((bytes * 8) / 1000 / duration);
}
