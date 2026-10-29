import { ENGINE } from "@api/formats";

// Class names, falsy ones left out: cx(styles.a, on && styles.b).
export const cx = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(" ");

// One, many or none, as a list.
export const toList = <T>(value: T | T[] | null): T[] =>
  value === null ? [] : Array.isArray(value) ? value : [value];

// This repo, at the commit this deployment was built from (on Vercel) or the
// branch tip (locally), so links show the code the visitor is running.
export const REPO = "sebastiangraz/videotools";
export const REF = __GIT_SHA__ || "main";

// "README.md#the-engine" → that file on GitHub, at REF.
export const repoFile = (path: string) => `https://github.com/${REPO}/blob/${REF}/${path}`;
export const repoRaw = (path: string) => `https://raw.githubusercontent.com/${REPO}/${REF}/${path}`;
export const repoRelease = (tag: string, file: string) =>
  `https://github.com/${REPO}/releases/download/${tag}/${file}`;

// The engine on the visitor's machine (api/_lib/serve.ts). `targetAddressSpace`
// lets a public page reach loopback once the visitor allows it (Chrome asks).
export const ENGINE_URL = `http://127.0.0.1:${ENGINE.port}`;

export const engineFetch = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${ENGINE_URL}${path}`, { ...init, targetAddressSpace: "loopback" } as RequestInit);

// A JSON request to the engine; the response is the caller's to read.
export const sendJson = (
  path: string,
  method: "POST" | "DELETE",
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> =>
  engineFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

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

export const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

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

// 6 characters of the source, the extras' names, then each option as key
// initials + value (fadeDuration 0.7 → fd0.7, true, a list or a group → Y, false or null
// left out), with the extension of the server's name.
export function verboseName(
  base: string,
  extraNames: string[],
  options: Record<string, unknown>,
  resultName: string,
): string {
  return (
    [
      base.slice(0, 6),
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
    ].join("_") + splitExtension(resultName)[1]
  );
}

export function shortenFilename(file: File, length = 24): string {
  if (file.name.length <= length) return file.name;
  const ext = splitExtension(file.name)[1].slice(1);
  return `${file.name.slice(0, length)} … ${ext}`;
}
