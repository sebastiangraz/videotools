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

export type EncodeOptions = {
  // 1–100 slider; also the share of the source rate where there's rate control.
  quality: number;
  // Animated-image formats; absent = conversion defaults, null width = as is.
  fps?: number | null;
  width?: number | null;
  // Pictures already come at `fps`: skip the fps filter, which drops the
  // last frame of anything that went through an overlay.
  everyFrame?: boolean;
  // AVIF only, for stills (no prior subsampling or quantization).
  lossless?: boolean;
  chroma444?: boolean;
};

export type Encoder = (
  ff: FFmpeg,
  render: Render,
  target: EncodeOptions & { outputFile: string; cap: RateCap | null },
) => Promise<void>;

type EncodeJob = Pick<ToolJob, "ff" | "workDir">;

// Formats with rate control; gifski and libwebp only take a quality.
const CODECS: Partial<Record<FormatId, string>> = {
  mp4: "h264",
  mov: "h264",
  webm: "vp9",
  avif: "av1",
};

const ENCODERS: Record<FormatId, Encoder> = {
  mp4: encodeMp4,
  webm: encodeWebm,
  mov: encodeMov,
  gif: encodeGif,
  webp: encodeWebp,
  avif: encodeAvif,
};

// Same format out as in: skip a conversion's fps/size defaults.
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

// The summary only has it for the mov family; else sum the packets.
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
