import { put, del, list } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

import { isToolId, resultFile } from "./_lib/formats.js";
import { FFmpeg } from "./_lib/ffmpeg.js";
import { TOOLS } from "./_lib/tools/index.js";
import type { ToolRequest } from "./_lib/tools/types.js";
import { errorResponse, isBlobUrl, jsonBody, methodNotAllowed, runJob } from "./_lib/request.js";
import { execBinary, ffmpegPath, gifskiPath } from "./_lib/binaries.js";

type ProcessBody = Partial<ToolRequest> & {
  tool?: unknown;
  filename?: unknown;
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      const { urls }: { urls?: unknown } = await jsonBody(request);
      await discard(Array.isArray(urls) ? urls.filter(isBlobUrl) : []);
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST") return methodNotAllowed();

    const {
      tool,
      filename = "video",
      blobUrl,
      blobUrls,
      watermarkUrl,
      options = {},
    }: ProcessBody = await jsonBody(request);

    // Uploads happen first, so a rejected request must still delete them.
    const uploaded = [
      blobUrl,
      watermarkUrl,
      ...(Array.isArray(blobUrls) ? (blobUrls as unknown[]) : []),
    ].filter(isBlobUrl);
    const reject = async (error: string) => {
      await discard(uploaded);
      return errorResponse(error, 400);
    };

    if (!isToolId(tool)) {
      return reject("Unknown tool");
    }
    const { inputs, run } = TOOLS[tool];

    const inputBlobUrls = inputs({ blobUrl, blobUrls, watermarkUrl, options });
    if (!Array.isArray(inputBlobUrls)) {
      return reject(inputBlobUrls.error);
    }

    const response = await runJob(request, "Processing", async (workDir, signal) => {
      const { outputPath, suffix, ext } = await run({
        ff: new FFmpeg(ffmpegPath, gifskiPath, execBinary, signal),
        workDir,
        inputs: inputBlobUrls,
        options,
        download: (url, destPath) => downloadBlob(url, destPath, signal),
      });
      const { name: outputName, mime } = resultFile(String(filename), suffix, ext);

      const result = await put(`results/${outputName}`, fs.createReadStream(outputPath), {
        access: "public",
        contentType: mime,
        addRandomSuffix: true,
        abortSignal: signal,
      });

      return Response.json({
        url: result.url,
        downloadUrl: result.downloadUrl,
        filename: outputName,
      });
    });
    // After the response is sent, so the client never waits on it.
    waitUntil(discard(inputBlobUrls).then(() => sweepStaleBlobs(inputBlobUrls)));
    return response;
  },
};

// Best effort: the sweep gets what this misses.
async function discard(urls: string[]): Promise<void> {
  if (urls.length) await del(urls).catch(() => {});
}

// A hard kill (timeout, OOM) skips the in-line deletes, so each job sweeps
// leftovers; no cron needed since nothing accrues while the app is idle.
const UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;
const RESULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Never throws: a failed sweep is retried by the next job.
async function sweepStaleBlobs(exclude: string[]): Promise<void> {
  const now = Date.now();
  const stale: string[] = [];
  try {
    let cursor: string | undefined;
    do {
      const page = await list({ limit: 1000, cursor });
      for (const blob of page.blobs) {
        if (exclude.includes(blob.url)) continue;
        const maxAge = blob.pathname.startsWith("results/") ? RESULT_MAX_AGE_MS : UPLOAD_MAX_AGE_MS;
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
    return;
  }
  if (stale.length) console.log(`Swept ${stale.length} stale blob(s)`);
}

async function downloadBlob(url: string, destPath: string, signal: AbortSignal): Promise<void> {
  const download = await fetch(url, { signal });
  if (!download.ok || !download.body) {
    throw new Error(`Failed to fetch uploaded file (${download.status})`);
  }
  await pipeline(Readable.fromWeb(download.body as ReadableStream), fs.createWriteStream(destPath));
}
