import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { InputError } from "./errors.js";
import type { ToolRequest } from "./tools/types.js";

const BLOB_HOST_RE = /\.public\.blob\.vercel-storage\.com$/;

// Cosmetic only: ffmpeg sniffs the container from content.
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

export function singleVideo({ blobUrl }: ToolRequest) {
  return isBlobUrl(blobUrl) ? [blobUrl] : { error: "Invalid blob URL" };
}

export function allowMethods(
  req: VercelRequest,
  res: VercelResponse,
  ...methods: string[]
): boolean {
  if (methods.includes(req.method ?? "")) return true;
  res.status(405).json({ error: "Method not allowed" });
  return false;
}

// `signal` fires when the client disconnects (best effort: depends on the
// platform propagating it). InputError → 400 with code; anything else → generic 500.
export async function runJob(
  res: VercelResponse,
  name: string,
  work: (workDir: string, signal: AbortSignal) => Promise<unknown>,
): Promise<void> {
  const abort = new AbortController();
  // 'close' also fires on normal completion.
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const { signal } = abort;
  let workDir: string | undefined;
  try {
    const prefix = `videotools-${name.toLowerCase()}-`;
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    await work(workDir, signal);
  } catch (err) {
    if (signal.aborted) {
      console.log(`${name} cancelled by client`);
      return;
    }
    console.error(`${name} error:`, err);
    if (err instanceof InputError) {
      res.status(400).json({ error: err.message, code: err.code });
    } else {
      res.status(500).json({ error: `${name} failed` });
    }
  } finally {
    if (workDir) {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
