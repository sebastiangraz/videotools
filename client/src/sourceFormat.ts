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

// What a tool that hands its source's format back makes of a picked file.
// Every tool does but convert and sequence, which are asked for a format.
export type KeptFormat =
  // Comes back as this format.
  | { state: "kept"; format: Format }
  // One of the app's formats, but ffmpeg cannot read it (animated WebP).
  | { state: "unreadable"; format: Format }
  // Readable, but nothing the app writes (.avi, .mkv, ...): there is no
  // format to hand back, and picking another one is the convert tool's job.
  | { state: "foreign"; name: string };

export function keptFormat(file: File): KeptFormat {
  const format = fileFormat(file);
  if (!format) {
    const ext = extensionOf(file.name);
    return { state: "foreign", name: ext ? ext.toUpperCase() : "This" };
  }
  return { state: format.readable ? "kept" : "unreadable", format };
}

// Why a run can't start with this file, as the action button's tooltip;
// null = it can.
export function keptFormatBlocker(file: File): string | null {
  const kept = keptFormat(file);
  if (kept.state === "kept") return null;
  return kept.state === "foreign"
    ? "Convert this file first"
    : `${kept.format.label} can't be read`;
}
