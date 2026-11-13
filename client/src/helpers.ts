import type { ToolId } from "@videotools/core/formats";

// Class names, falsy ones left out: cx(styles.a, on && styles.b).
export const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(" ");

// One, many or none, as a list.
export const toList = <T>(value: T | T[] | null): T[] =>
  value === null ? [] : Array.isArray(value) ? value : [value];

// "clip.final.MOV" → ["clip.final", ".MOV"]; the extension is "" when there is none.
export function splitExtension(filename: string): [base: string, ext: string] {
  const [, base, ext = ""] = /^(.*?)(\.[^.]+)?$/.exec(filename) ?? [];
  return [base, ext];
}

// "clip.final.MOV" → "mov"; "" when the name has no extension.
export const extensionOf = (filename: string): string =>
  splitExtension(filename)[1].slice(1).toLowerCase();

// Natural order: img2 before img10.
export const byFilename = (a: File, b: File) =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

// Dropped files skip the native picker's accept filtering, so mirror it:
// entries are either MIME patterns ("video/*") or bare extensions (".mkv").
export function matchesAccept(file: File, accept: string): boolean {
  return accept.split(",").some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (pattern.startsWith(".")) return file.name.toLowerCase().endsWith(pattern);
    if (pattern.endsWith("/*")) return file.type.startsWith(pattern.slice(0, -1));
    return file.type === pattern;
  });
}

// Shrinks a width×height to fit `maxSide`, never enlarges.
export const fitScale = (width: number, height: number, maxSide: number): number =>
  Math.min(1, maxSide / Math.max(width, height));

// CSS aspect-ratio of a picture, 16 / 9 until its size is known.
export const aspectRatioOf = (size: { w: number; h: number } | null): string =>
  size ? `${size.w} / ${size.h}` : "16 / 9";

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// 75 → "1:15".
export const formatClock = (seconds: number) => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

// An ISO date as "3 days ago".
export function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (seconds >= size) {
      return rtf.format(-Math.floor(seconds / size), unit);
    }
  }
  return "just now";
}

// A page's settings as the CLI command (cli/index.ts) that does the same,
// through npx so Node is all it needs, every flag spelled out so it keeps its
// meaning if a default changes. True is a switch; false, or null for a value
// left to the tool, leaves the flag out.
// The browser knows only the files' names; each goes in double quotes, which
// hold spaces in PowerShell and POSIX shells alike, and one that is not picked,
// or has a character both shells read inside them, is a placeholder to fill in.
export function cliCommand(
  tool: ToolId,
  files: File[],
  flags: Record<string, string | number | boolean | null | undefined>,
): string {
  const quoted = (name: string | undefined, placeholder: string) =>
    `"${name && !/["$`]/.test(name) ? name : placeholder}"`;
  return [
    `npx @videotools/cli ${tool.toUpperCase()}`,
    ...(files.length ? files : [undefined]).map((file) => quoted(file?.name, "<file|folder|glob>")),
    ...Object.entries(flags).flatMap(([name, value]) => {
      // Mark's logo, the one flag that names a file.
      if (name === "logo") return `--logo ${quoted(value as string | undefined, "<png|svg>")}`;
      if (value === true) return `--${name}`;
      if (value === false || value == null) return [];
      // A negative number goes after "=", or it reads as a flag.
      return Number(value) < 0 ? `--${name}=${value}` : `--${name} ${value}`;
    }),
  ].join(" ");
}

export function shortenFilename(file: File, length = 24): string {
  if (file.name.length <= length) return file.name;
  const ext = splitExtension(file.name)[1].slice(1);
  return `${file.name.slice(0, length)} … ${ext}`;
}
