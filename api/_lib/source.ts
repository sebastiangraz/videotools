import path from "node:path";
import {
  formatById,
  type FormatId,
  type StillId,
} from "../../shared/formats.js";
import { InputError } from "./errors.js";
import type { FFmpeg, SourceProfile } from "./ffmpeg.js";
import { blobExt } from "./request.js";
import type { ToolJob } from "./tools/types.js";

// An upload, on disk and probed. `format` is the one of the app's formats it
// is, or null for anything else ffmpeg reads (avi, mkv, ts, a still, ...):
// fine as something to convert, but no tool can hand it back as it came.
// `still` is the raster image it is instead (PNG, JPEG, a WebP that is not
// animated), which the mark tool takes and hands back; null for the rest.
export type Source = {
  path: string;
  profile: SourceProfile;
  format: FormatId | null;
  still: StillId | null;
};

// ftyp brands of the mov family that are no video the app writes: 3GPP, and
// the HEIF/AVIF still images.
const FOREIGN_BRANDS = /^(3g|heic|heix|hevc|hevx|mif1|msf1|avif)/;

// Codecs a WebM may hold; any other Matroska file is an .mkv.
const WEBM_VIDEO = ["vp8", "vp9", "av1"];
const WEBM_AUDIO = ["opus", "vorbis"];

// Goes by what the file is, not by what it is called: uploads arrive under
// any name, and the mov and matroska demuxers each read several containers.
export function sourceFormat(profile: SourceProfile): FormatId | null {
  const { formatNames, majorBrand, codec, audio } = profile;
  if (formatNames.includes("gif")) return "gif";
  // A still WebP is webp_pipe's (sourceStill).
  if (formatNames.includes("webp_anim")) return "webp";
  if (formatNames.includes("mov")) {
    if (majorBrand === "avis") return "avif";
    // QuickTime writes "qt"; files from before the brand existed have none.
    if (majorBrand === null || majorBrand === "qt") return "mov";
    return FOREIGN_BRANDS.test(majorBrand) ? null : "mp4";
  }
  if (formatNames.includes("webm")) {
    const fits =
      WEBM_VIDEO.includes(codec) &&
      (audio === null || WEBM_AUDIO.includes(audio.codec));
    return fits ? "webm" : null;
  }
  return null;
}

// Which still a source is, by content like sourceFormat. ffmpeg reads a
// .jpg through image2 (it goes by the name there) and one under any other
// name through jpeg_pipe; Motion JPEG video has the codec but not the
// demuxer. An animated PNG is "apng" on both counts, and an animated WebP
// has a demuxer of its own, webp_anim (sourceFormat).
export function sourceStill(profile: SourceProfile): StillId | null {
  const { formatNames, codec } = profile;
  if (formatNames.includes("png_pipe") && codec === "png") return "png";
  if (formatNames.includes("webp_pipe") && codec === "webp") return "webp";
  const jpeg = formatNames.includes("image2") || formatNames.includes("jpeg_pipe");
  return jpeg && codec === "mjpeg" ? "jpg" : null;
}

// Refuses a video with non-square pixels (an anamorphic export): GIF, WebP
// and AVIF would show it as stored, and the mark tool draws on it that way.
// Stills and animations are shown as stored anyway, whatever the tag says.
export function checkSquarePixels({ format, still, profile }: Source): void {
  if (still || (format && formatById(format).kind === "animation")) return;
  const { sar, width, height } = profile;
  if (sar === 1) return;
  throw new InputError(
    `This video has non-square pixels: it is stored at ${width}×${height} ` +
      `but plays at ${Math.round(width * sar)}×${height}. Re-export it with ` +
      `square pixels (in HandBrake: Dimensions → Anamorphic: None).`,
    "unsupported-source",
  );
}

// Downloads an upload into the job's work dir and probes it.
export async function openSource(
  { ff, workDir, download }: Pick<ToolJob, "ff" | "workDir" | "download">,
  url: string,
  name = "input",
): Promise<Source> {
  const file = path.join(workDir, `${name}${blobExt(url, ".mp4")}`);
  await download(url, file);
  const profile = await ff.mediaInfo(file);
  const source = {
    path: file,
    profile,
    format: sourceFormat(profile),
    still: sourceStill(profile),
  };
  checkSquarePixels(source);
  return source;
}

// The format a tool that keeps its source's format has to write. There is
// deliberately no fallback to mp4: a result in a format nobody asked for is
// the surprise this rule exists to prevent, and changing formats is the
// convert tool's job.
export function preservedFormat(source: Source): FormatId {
  if (source.format) return source.format;
  const ext = path.extname(source.path).slice(1).toUpperCase();
  const what = ext ? `${ext} file` : "file";
  throw new InputError(
    `This ${what} is in a format the app reads but does not write, and ` +
      `this tool gives back the format it was given. Run it through ` +
      `Convert first (to ${formatById("mp4").label}, say).`,
    "unsupported-source",
  );
}

// What the source's video stream spends per second, in kb/s: the summary's
// figure where there is one, else measured. Null when it cannot be known
// (a still, a stream without duration).
export async function sourceVideoKbps(
  ff: FFmpeg,
  source: Pick<Source, "path" | "profile">,
): Promise<number | null> {
  const { videoKbps, duration } = source.profile;
  if (videoKbps) return videoKbps;
  if (!(duration > 0)) return null;
  const packets = await ff.videoPackets(source.path);
  if (!packets) return null;
  const bytes = packets.reduce((sum, p) => sum + p.size, 0);
  return Math.round((bytes * 8) / 1000 / duration);
}
