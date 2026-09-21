import {
  FORMATS,
  extensionOf,
  formatFromFilename,
  type Format,
} from "../../shared/formats";

// The format of a picked file, as far as the browser can tell: by its name,
// else by the type the browser reports for it. Null = none the app writes.
// (The functions go by the file's content; this is the view from before any
// upload, there to say up front what a run would do.)
export function fileFormat(file: File): Format | null {
  return (
    formatFromFilename(file.name) ??
    FORMATS.find((f) => f.mime === file.type) ??
    null
  );
}

// Why a tool that hands its source's format back can't take a picked file.
// Every tool does but convert and sequence, which are asked for a format.
// Null = it can, which the app says nothing about: the result is the format
// that was picked, and only a dead end is worth a word.
export type FormatBlock =
  // One of the app's formats, but ffmpeg cannot read it (animated WebP).
  | { state: "unreadable"; format: Format }
  // Readable, but nothing the app writes (.avi, .mkv, ...): there is no
  // format to hand back, and picking another one is the convert tool's job.
  | { state: "foreign"; name: string };

export function formatBlock(file: File): FormatBlock | null {
  const format = fileFormat(file);
  if (!format) {
    const ext = extensionOf(file.name);
    return { state: "foreign", name: ext ? ext.toUpperCase() : "This" };
  }
  return format.readable ? null : { state: "unreadable", format };
}

// The same, as the action button's tooltip; null = the run can start.
export function formatBlocker(file: File): string | null {
  const block = formatBlock(file);
  if (!block) return null;
  return block.state === "foreign"
    ? "Convert this file first"
    : `${block.format.label} can't be read`;
}
