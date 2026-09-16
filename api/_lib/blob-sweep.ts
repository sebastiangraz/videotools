import { del, list } from "@vercel/blob";

// Blob storage is only a transfer buffer: uploads live until the job that
// consumes them finishes, results until the browser has downloaded them.
// Both are deleted in-line on every path that runs to completion, but a hard
// kill (300 s timeout, out-of-memory) skips that code entirely, so each job
// also sweeps whatever an earlier one left behind. No schedule to keep alive:
// while nobody uses the app, nothing accrues either.
const UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;
const RESULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes blobs old enough that no running job can still be using them.
 * Returns how many were removed. Never throws: a failed sweep is retried by
 * the next job.
 */
export async function sweepStaleBlobs(exclude: string[] = []): Promise<number> {
  const now = Date.now();
  const stale: string[] = [];
  try {
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 1000, cursor });
      for (const blob of page.blobs) {
        if (exclude.includes(blob.url)) continue;
        const maxAge = blob.pathname.startsWith("results/")
          ? RESULT_MAX_AGE_MS
          : UPLOAD_MAX_AGE_MS;
        if (now - new Date(blob.uploadedAt).getTime() > maxAge) {
          stale.push(blob.url);
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    for (let i = 0; i < stale.length; i += 100) {
      await del(stale.slice(i, i + 100));
    }
  } catch (err) {
    console.warn("Blob sweep failed:", err);
    return 0;
  }
  if (stale.length) console.log(`Swept ${stale.length} stale blob(s)`);
  return stale.length;
}
