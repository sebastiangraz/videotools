import path from "node:path";
import { formatById, type FormatId, type StillId } from "../../shared/formats.js";
import { InputError } from "./errors.js";
import type { SourceProfile } from "./ffmpeg.js";
import { blobExt } from "./request.js";
import type { ToolJob } from "./tools/types.js";

export type Source = {
  path: string;
  profile: SourceProfile;
  // null: readable (avi, mkv, a still, ...) but only convertible.
  format: FormatId | null;
  // PNG, JPEG or non-animated WebP (mark only).
  still: StillId | null;
};

// mov-family brands the app doesn't write: 3GPP and HEIF/AVIF stills.
const FOREIGN_BRANDS = /^(3g|heic|heix|hevc|hevx|mif1|msf1|avif)/;

// Codecs a WebM may hold; any other Matroska file is an .mkv.
const WEBM_VIDEO = ["vp8", "vp9", "av1"];
const WEBM_AUDIO = ["opus", "vorbis"];

// By content, not name: the mov and matroska demuxers each read several containers.
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
    const fits = WEBM_VIDEO.includes(codec) && (audio === null || WEBM_AUDIO.includes(audio.codec));
    return fits ? "webm" : null;
  }
  return null;
}

// ffmpeg reads a .jpg via image2 (by name), otherwise jpeg_pipe; Motion JPEG
// video has the codec but not the demuxer. APNG is "apng" on both counts.
export function sourceStill(profile: SourceProfile): StillId | null {
  const { formatNames, codec } = profile;
  if (formatNames.includes("png_pipe") && codec === "png") return "png";
  if (formatNames.includes("webp_pipe") && codec === "webp") return "webp";
  const jpeg = formatNames.includes("image2") || formatNames.includes("jpeg_pipe");
  return jpeg && codec === "mjpeg" ? "jpg" : null;
}

// GIF/WebP/AVIF output and mark ignore SAR, so anamorphic video would come out
// distorted. Stills and animations display as stored regardless.
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

// Deliberately no mp4 fallback: changing formats is convert's job.
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
