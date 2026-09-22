import {
  FORMATS,
  STILLS,
  extensionOf,
  formatFromFilename,
  stillFromFilename,
  type Format,
  type Still,
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

// The still a picked file is, the same way: by its name, else by its type.
// A .webp counts as one although it may be animated, which only its content
// tells (isAnimatedWebp).
export function stillFormat(file: File): Still | null {
  return (
    stillFromFilename(file.name) ??
    STILLS.find((s) => s.mime === file.type) ??
    null
  );
}

// Whether a WebP is the animated kind, which ffmpeg cannot read: the
// animation bit (0x02) in the flags of the VP8X chunk, which an animated file
// has to start with ("RIFF" size "WEBP" "VP8X" size flags, so byte 20). A
// file too short or without the chunk is a plain still. (Through FileReader:
// jsdom's Blob has no arrayBuffer.)
export function isAnimatedWebp(file: File): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const head = new Uint8Array(reader.result as ArrayBuffer);
      const tag = (at: number) => String.fromCharCode(...head.subarray(at, at + 4));
      resolve(
        head.length > 20 &&
          tag(0) === "RIFF" &&
          tag(8) === "WEBP" &&
          tag(12) === "VP8X" &&
          (head[20] & 0x02) !== 0,
      );
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file.slice(0, 21));
  });
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

// `stills`: the tool takes raster images too (mark), so a file that is one
// goes through.
export function formatBlock(file: File, stills = false): FormatBlock | null {
  if (stills && stillFormat(file)) return null;
  const format = fileFormat(file);
  if (!format) {
    const ext = extensionOf(file.name);
    return { state: "foreign", name: ext ? ext.toUpperCase() : "This" };
  }
  return format.readable ? null : { state: "unreadable", format };
}

// The same, as the action button's tooltip; null = the run can start.
export function formatBlocker(file: File, stills = false): string | null {
  const block = formatBlock(file, stills);
  if (!block) return null;
  return block.state === "foreign"
    ? "Convert this file first"
    : `${block.format.label} can't be read`;
}
