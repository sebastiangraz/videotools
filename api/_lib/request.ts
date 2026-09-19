import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";
import type { ToolRequest } from "./tools/types.js";

const BLOB_HOST_RE = /\.public\.blob\.vercel-storage\.com$/;

// Keeps a downloaded blob's extension for readability; ffmpeg sniffs the
// actual container/codec from content, so a wrong or missing one is fine.
export function blobExt(url: string, fallback: string): string {
  const urlExt = path.posix.extname(new URL(url).pathname);
  return /^\.\w+$/.test(urlExt) ? urlExt : fallback;
}

export function isBlobUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    return BLOB_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

export function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// `inputs` of the tools that work on one uploaded video.
export function singleVideo({ blobUrl }: ToolRequest) {
  return isBlobUrl(blobUrl) ? [blobUrl] : { error: "Invalid blob URL" };
}

export async function downloadBlob(
  url: string,
  destPath: string,
  signal: AbortSignal,
): Promise<void> {
  const download = await fetch(url, { signal });
  if (!download.ok || !download.body) {
    throw new Error(`Failed to fetch uploaded file (${download.status})`);
  }
  await pipeline(
    Readable.fromWeb(download.body as import("stream/web").ReadableStream),
    fs.createWriteStream(destPath),
  );
}
