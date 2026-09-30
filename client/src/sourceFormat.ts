import {
  FORMATS,
  STILLS,
  extensionOf,
  formatFromFilename,
  stillFromFilename,
  type Format,
  type Still,
} from "../../shared/formats";

// By name, else by browser MIME type; null = none the app writes. The server
// goes by content; this is only the pre-upload guess.
export function fileFormat(file: File): Format | null {
  return (
    formatFromFilename(file.name) ??
    FORMATS.find((f) => f.mime === file.type) ??
    null
  );
}

// A .webp counts as a still here; only its content says if it's animated
// (isAnimatedWebp).
export function stillFormat(file: File): Still | null {
  return (
    stillFromFilename(file.name) ??
    STILLS.find((s) => s.mime === file.type) ??
    null
  );
}

const CONVERT_TARGETS = FORMATS.map((f) => ({ value: f.id, label: f.label }));

// Drops the source's own format: every other tool already hands that back.
export function targetsFor(source: File | null) {
  const own = source ? fileFormat(source)?.id : undefined;
  return CONVERT_TARGETS.filter((t) => t.value !== own);
}

// Natural order: img2 before img10.
export const byFilename = (a: File, b: File) =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

// Image sources (decoded by ImageDecoder, not a <video>). A .webp counts as a
// still here, whether or not it is animated.
export const isStillImage = (file: File) => stillFormat(file) !== null;
export const isAnimatedImage = (file: File) =>
  !isStillImage(file) && fileFormat(file)?.kind === "animation";

// "May": the accept list is broader than browsers decode, so opening can fail.
export const hasFrames = (file: File) =>
  file.type.startsWith("video/") || isAnimatedImage(file) || isStillImage(file);

// Animation bit 0x02 of the VP8X flags at byte 20 ("RIFF" size "WEBP" "VP8X"
// size flags); no VP8X = still. Cached: several consumers ask per file.
const webpHeaders = new WeakMap<File, Promise<boolean>>();
export function isAnimatedWebp(file: File): Promise<boolean> {
  let answer = webpHeaders.get(file);
  if (!answer) {
    answer = readWebpHeader(file);
    webpHeaders.set(file, answer);
  }
  return answer;
}

async function readWebpHeader(file: File): Promise<boolean> {
  const head = await file.slice(0, 21).bytes();
  const tag = (at: number) => String.fromCharCode(...head.subarray(at, at + 4));
  return (
    head.length > 20 &&
    tag(0) === "RIFF" &&
    tag(8) === "WEBP" &&
    tag(12) === "VP8X" &&
    (head[20] & 0x02) !== 0
  );
}

// Why a tool can't take a picked file; null = it can.
export type FormatBlock =
  // Readable but not a format the app writes, so there is none to hand back.
  | { state: "foreign"; name: string }
  // ffmpeg reads a sequence through one image demuxer: mixed formats come
  // back blank or missing.
  | { state: "mixed"; labels: string[] }
  // Anamorphic video: GIF/WebP/AVIF can't show it in shape. Only known once
  // the video opens (useVideoSource).
  | { state: "nonSquare" };

// stills: also takes raster images (mark). foreign: false when the tool
// picks the output format itself (sequence). oneFormat: many files, one
// format (sequence).
export type FormatOptions = {
  stills?: boolean;
  foreign?: boolean;
  oneFormat?: boolean;
};

// stillWebp: the header proved a .webp is not animated; until then it passes
// as whichever the tool accepts.
export function formatBlock(
  file: File,
  { stills = false, foreign = true }: FormatOptions = {},
  stillWebp = false,
): FormatBlock | null {
  if ((stills && stillFormat(file)) || !foreign) return null;
  if (stillWebp) return { state: "foreign", name: "Still WebP" };
  if (fileFormat(file)) return null;
  const ext = extensionOf(file.name);
  return { state: "foreign", name: ext ? ext.toUpperCase() : "This" };
}

// short: button tooltip. long: error text; the foreign line stops before
// "converted" because useFormatBlocker appends the convert link there.
type BlockerText = {
  short: string;
  long: string;
};

export function blockerText(block: FormatBlock): BlockerText {
  switch (block.state) {
    case "foreign":
      return {
        short: "Convert this file first",
        long: `${block.name} files need to be`,
      };
    case "mixed":
      return {
        short: "Use images of one format",
        long: "Mixed formats are not supported.",
      };
    case "nonSquare":
      return {
        short: "Re-export with square pixels",
        long: "Non-square pixels are not supported.",
      };
  }
}

export function pickedFormats(files: readonly File[]): string[] {
  const labels = new Set<string>();
  for (const file of files) {
    const known = stillFormat(file) ?? fileFormat(file);
    labels.add(
      known?.label ?? (extensionOf(file.name).toUpperCase() || "Unknown"),
    );
  }
  return [...labels];
}

export function formatBlocker(
  file: File,
  options?: FormatOptions,
  stillWebp = false,
): string | null {
  const block = formatBlock(file, options, stillWebp);
  return block && blockerText(block).short;
}
