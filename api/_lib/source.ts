import path from "node:path";
import { formatById, type FormatId } from "../../shared/formats.js";
import { InputError } from "./errors.js";
import type { FFmpeg, SourceProfile } from "./ffmpeg.js";
import { blobExt } from "./request.js";
import type { ToolJob } from "./tools/types.js";

// An upload, on disk and probed. `format` is the one of the app's formats it
// is, or null for anything else ffmpeg reads (avi, mkv, ts, a still, ...):
// fine as something to convert, but no tool can hand it back as it came.
export type Source = {
  path: string;
  profile: SourceProfile;
  format: FormatId | null;
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

// Downloads an upload into the job's work dir and probes it.
export async function openSource(
  { ff, workDir, download }: Pick<ToolJob, "ff" | "workDir" | "download">,
  url: string,
  name = "input",
): Promise<Source> {
  const file = path.join(workDir, `${name}${blobExt(url, ".mp4")}`);
  await download(url, file);
  const profile = await ff.mediaInfo(file);
  return { path: file, profile, format: sourceFormat(profile) };
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
