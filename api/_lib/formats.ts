// The tools and formats the app offers. No imports: the client compiles this too.

// Keys both the api registry and the client tabs, so a one-sided addition is a
// compile error. Tab order.
export const TOOL_IDS = ["loop", "sequence", "speed", "convert", "mark"] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export function isToolId(id: unknown): id is ToolId {
  return TOOL_IDS.includes(id as ToolId);
}

// The formats the app writes.
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
  {
    id: "mp4",
    label: "MP4",
    extensions: ["mp4", "m4v"],
    mime: "video/mp4",
    kind: "video",
  },
  {
    id: "webm",
    label: "WebM",
    extensions: ["webm"],
    mime: "video/webm",
    kind: "video",
  },
  {
    id: "mov",
    label: "MOV",
    extensions: ["mov", "qt"],
    mime: "video/quicktime",
    kind: "video",
  },
  {
    id: "gif",
    label: "GIF",
    extensions: ["gif"],
    mime: "image/gif",
    kind: "animation",
  },
  {
    id: "webp",
    label: "WebP",
    extensions: ["webp"],
    mime: "image/webp",
    kind: "animation",
  },
  {
    id: "avif",
    label: "AVIF",
    extensions: ["avif"],
    mime: "image/avif",
    kind: "animation",
  },
];

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
