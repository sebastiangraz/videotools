import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function singleVideo({ blobUrl }: ToolRequest) {
  return isBlobUrl(blobUrl) ? [blobUrl] : { error: "Invalid blob URL" };
}

export const methodNotAllowed = () =>
  Response.json({ error: "Method not allowed" }, { status: 405 });

// Parsed JSON body, or {} when there is none (or it isn't JSON).
export const jsonBody = async (request: Request): Promise<object> => {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" ? body : {};
};

// `request.signal` fires when the client disconnects (supportsCancellation in
// vercel.json). InputError → 400 with code; anything else → generic 500.
export async function runJob(
  request: Request,
  name: string,
  work: (workDir: string, signal: AbortSignal) => Promise<Response>,
): Promise<Response> {
  const { signal } = request;
  let workDir: string | undefined;
  try {
    const prefix = `videotools-${name.toLowerCase()}-`;
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    return await work(workDir, signal);
  } catch (err) {
    if (signal.aborted) {
      console.log(`${name} cancelled by client`);
      // Nobody is listening; any status will do.
      return new Response(null, { status: 499 });
    }
    console.error(`${name} error:`, err);
    return err instanceof InputError
      ? Response.json({ error: err.message, code: err.code }, { status: 400 })
      : Response.json({ error: `${name} failed` }, { status: 500 });
  } finally {
    if (workDir) {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
