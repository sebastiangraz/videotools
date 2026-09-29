// The formats the app writes, which makes them the only ones a tool can hand
// back unchanged. One table for both sides: the client reads it to say what a
// picked file will come back as and to fill the convert and sequence
// dropdowns, the functions to tell what a source is and to label a result.
// No imports and nothing but plain ES2020: both builds compile this file.

export type FormatId = "mp4" | "webm" | "mov" | "gif" | "webp" | "avif";

export type Format = {
  id: FormatId;
  label: string;
  // The extensions a source of this format goes by. Results get the id.
  extensions: readonly string[];
  mime: string;
  // Videos can carry audio; animations never do.
  kind: "video" | "animation";
};

// In the order the convert dropdown lists them.
export const FORMATS: readonly Format[] = [
  { id: "mp4", label: "MP4", extensions: ["mp4", "m4v"], mime: "video/mp4", kind: "video" },
  { id: "webm", label: "WebM", extensions: ["webm"], mime: "video/webm", kind: "video" },
  { id: "mov", label: "MOV", extensions: ["mov", "qt"], mime: "video/quicktime", kind: "video" },
  { id: "gif", label: "GIF", extensions: ["gif"], mime: "image/gif", kind: "animation" },
  { id: "webp", label: "WebP", extensions: ["webp"], mime: "image/webp", kind: "animation" },
  { id: "avif", label: "AVIF", extensions: ["avif"], mime: "image/avif", kind: "animation" },
];

export const FORMAT_IDS: readonly FormatId[] = FORMATS.map((f) => f.id);

// What the sequence tool offers: stills have no format of their own to keep.
export const SEQUENCE_FORMATS: readonly FormatId[] = ["mp4", "gif", "webp", "avif"];

export function formatById(id: FormatId): Format {
  // Every FormatId has its row, so the lookup cannot miss.
  return FORMATS.find((f) => f.id === id) as Format;
}

// The stills: raster images, which only the mark tool takes and, like every
// format-keeping tool, hands back as what they came as. A table of their own
// because nothing converts to them and they are no video to any other tool.
// "webp" is in both tables: the still here, the animation above, and only
// the content tells which one a file is.
export type StillId = "png" | "jpg" | "webp";

export type Still = {
  id: StillId;
  label: string;
  extensions: readonly string[];
  mime: string;
};

export const STILLS: readonly Still[] = [
  { id: "png", label: "PNG", extensions: ["png"], mime: "image/png" },
  { id: "jpg", label: "JPEG", extensions: ["jpg", "jpeg"], mime: "image/jpeg" },
  { id: "webp", label: "WebP", extensions: ["webp"], mime: "image/webp" },
];

// The content type of a result, whichever table its format is in.
export function mimeOf(id: FormatId | StillId): string {
  return (STILLS.find((s) => s.id === id) ?? formatById(id as FormatId)).mime;
}

// "clip.final.MOV" → "mov"; "" when the name has no extension.
export function extensionOf(filename: string): string {
  const match = /\.([^./\\]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : "";
}

// The still a file name claims, or null.
export function stillFromFilename(filename: string): Still | null {
  const ext = extensionOf(filename);
  return STILLS.find((s) => s.extensions.includes(ext)) ?? null;
}

// The format a file name claims, or null when it is none the app writes
// (.avi, .mkv, ...). The functions go by the content instead
// (api/_lib/source.ts); this is the browser's view, before any upload.
export function formatFromFilename(filename: string): Format | null {
  const ext = extensionOf(filename);
  return FORMATS.find((f) => f.extensions.includes(ext)) ?? null;
}
