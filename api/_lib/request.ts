import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { InputError } from "./errors.js";
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

// Answers anything but the given methods with a 405; true when the request
// may go on.
export function allowMethods(
  req: VercelRequest,
  res: VercelResponse,
  ...methods: string[]
): boolean {
  if (methods.includes(req.method ?? "")) return true;
  res.status(405).json({ error: "Method not allowed" });
  return false;
}

// Runs a job's `work` in a fresh temp directory (removed afterwards) and
// answers its failure. The client abandons a request it no longer wants
// (Stop, or a newer preview); when the disconnect reaches the function
// (best effort: it depends on the platform propagating it), `signal` fires
// and the job stops instead of finishing work nobody will download. The
// response's 'close' fires on normal completion too, hence the
// writableFinished check.
// What is wrong with the input is the user's to fix: a 400 with the message
// and the code the client tells these apart by. Anything else is a server
// fault, logged in full and answered with only "<name> failed".
export async function runJob(
  res: VercelResponse,
  name: string,
  tmpPrefix: string,
  work: (workDir: string, signal: AbortSignal) => Promise<unknown>,
): Promise<void> {
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const { signal } = abort;
  let workDir: string | undefined;
  try {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), tmpPrefix));
    await work(workDir, signal);
  } catch (err) {
    if (signal.aborted) {
      // Nobody is listening any more; just clean up (finally).
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
