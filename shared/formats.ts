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
  // false: ffmpeg has no decoder for it (animated WebP), so the format is a
  // convert target and never a source.
  readable: boolean;
};

// In the order the convert dropdown lists them.
export const FORMATS: readonly Format[] = [
  { id: "mp4", label: "MP4", extensions: ["mp4", "m4v"], mime: "video/mp4", kind: "video", readable: true },
  { id: "webm", label: "WebM", extensions: ["webm"], mime: "video/webm", kind: "video", readable: true },
  { id: "mov", label: "MOV", extensions: ["mov", "qt"], mime: "video/quicktime", kind: "video", readable: true },
  { id: "gif", label: "GIF", extensions: ["gif"], mime: "image/gif", kind: "animation", readable: true },
  { id: "webp", label: "WebP", extensions: ["webp"], mime: "image/webp", kind: "animation", readable: false },
  { id: "avif", label: "AVIF", extensions: ["avif"], mime: "image/avif", kind: "animation", readable: true },
];

export const FORMAT_IDS: readonly FormatId[] = FORMATS.map((f) => f.id);

// What the sequence tool offers: stills have no format of their own to keep.
export const SEQUENCE_FORMATS: readonly FormatId[] = ["mp4", "gif", "avif"];

export function formatById(id: FormatId): Format {
  // Every FormatId has its row, so the lookup cannot miss.
  return FORMATS.find((f) => f.id === id) as Format;
}

// "clip.final.MOV" → "mov"; "" when the name has no extension.
export function extensionOf(filename: string): string {
  const match = /\.([^./\\]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : "";
}

// The format a file name claims, or null when it is none the app writes
// (.avi, .mkv, ...). The functions go by the content instead
// (api/_lib/source.ts); this is the browser's view, before any upload.
export function formatFromFilename(filename: string): Format | null {
  const ext = extensionOf(filename);
  return FORMATS.find((f) => f.extensions.includes(ext)) ?? null;
}
