// The formats the app writes. No imports, plain ES2020: both builds compile this file.

export type FormatId = "mp4" | "webm" | "mov" | "gif" | "webp" | "avif";

export type Format = {
  id: FormatId;
  label: string;
  // Source extensions; results get the id.
  extensions: readonly string[];
  mime: string;
  // Videos can carry audio; animations never do.
  kind: "video" | "animation";
};

// Convert dropdown order.
export const FORMATS: readonly Format[] = [
  { id: "mp4", label: "MP4", extensions: ["mp4", "m4v"], mime: "video/mp4", kind: "video" },
  { id: "webm", label: "WebM", extensions: ["webm"], mime: "video/webm", kind: "video" },
  { id: "mov", label: "MOV", extensions: ["mov", "qt"], mime: "video/quicktime", kind: "video" },
  { id: "gif", label: "GIF", extensions: ["gif"], mime: "image/gif", kind: "animation" },
  { id: "webp", label: "WebP", extensions: ["webp"], mime: "image/webp", kind: "animation" },
  { id: "avif", label: "AVIF", extensions: ["avif"], mime: "image/avif", kind: "animation" },
];

export const FORMAT_IDS: readonly FormatId[] = FORMATS.map((f) => f.id);

export const SEQUENCE_FORMATS: readonly FormatId[] = ["mp4", "gif", "webp", "avif"];

export function formatById(id: FormatId): Format {
  return FORMATS.find((f) => f.id === id) as Format;
}

// Stills only mark takes. "webp" is in both tables; only content tells which.
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

export function mimeOf(id: FormatId | StillId): string {
  return (STILLS.find((s) => s.id === id) ?? formatById(id as FormatId)).mime;
}

// "clip.final.MOV" → "mov"; "" when the name has no extension.
export function extensionOf(filename: string): string {
  const match = /\.([^./\\]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : "";
}

export function stillFromFilename(filename: string): Still | null {
  const ext = extensionOf(filename);
  return STILLS.find((s) => s.extensions.includes(ext)) ?? null;
}

// The browser's pre-upload guess; the api goes by content (api/_lib/source.ts).
export function formatFromFilename(filename: string): Format | null {
  const ext = extensionOf(filename);
  return FORMATS.find((f) => f.extensions.includes(ext)) ?? null;
}
