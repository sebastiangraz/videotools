// The tools and formats the app offers. No imports: the client compiles this too.

// Keys the core registry, the client's tabs and pages, and the CLI's commands,
// so a one-sided addition is a compile error. Tab order.
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

// Extensions ffmpeg reads but no tool writes: sources for Convert only.
export const FOREIGN = ["avi", "mkv", "wmv", "mpg", "mpeg", "3gp", "ts"];

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

// A result's download name, `<source name>_<suffix>.<ext>`, and its type.
export function resultFile(source: string, suffix: string, ext: FormatId | StillId) {
  const base = source.replace(/\.[^.]+$/, "").replace(/[^\w.-]/g, "_");
  const mime = (STILLS.find((s) => s.id === ext) ?? formatById(ext as FormatId)).mime;
  return { name: `${base}_${suffix}.${ext}`, mime };
}

// A result's verbose name: the base (the app's is the start of the source's
// name, the CLI's all of it), the extras' names, then each option as key
// initials + value (fadeDuration 0.7 → fd0.7, true, a list or a group → Y,
// false or null left out), with the result's extension.
export function verboseName(
  base: string,
  extraNames: string[],
  options: Record<string, unknown>,
  ext: string,
): string {
  return (
    [
      base,
      ...extraNames,
      ...Object.entries(options)
        .filter(([, value]) => value !== false && value !== null)
        .map(
          ([key, value]) =>
            key.replace(/\B[a-z]+/g, "").toLowerCase() +
            (typeof value === "string" || typeof value === "number"
              ? String(value).replace(/(?:^|-)(.)/g, (_, c: string) => c.toUpperCase())
              : "Y"),
        ),
    ].join("_") + `.${ext}`
  );
}
