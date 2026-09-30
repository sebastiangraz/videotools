import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put, del, list } from "@vercel/blob";
import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

import { mimeOf } from "../shared/formats.js";
import { isToolId } from "../shared/tools.js";
import { FFmpeg } from "./_lib/ffmpeg.js";
import { TOOLS } from "./_lib/tools/index.js";
import type { ToolRequest } from "./_lib/tools/types.js";
import { allowMethods, isBlobUrl, runJob } from "./_lib/request.js";
import { ffmpegPath, gifskiPath } from "./_lib/binaries.js";

type ProcessBody = Partial<ToolRequest> & {
  tool?: unknown;
  filename?: unknown;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethods(req, res, "DELETE", "POST")) return;

  if (req.method === "DELETE") {
    const { urls } = (req.body ?? {}) as { urls?: unknown };
    const valid = Array.isArray(urls) ? urls.filter(isBlobUrl) : [];
    if (valid.length) {
      await del(valid).catch(() => {});
    }
    return res.status(204).end();
  }

  const {
    tool,
    filename = "video",
    blobUrl,
    blobUrls,
    watermarkUrl,
    options = {},
  } = (req.body ?? {}) as ProcessBody;

  // Uploads happen first, so a rejected request must still delete them.
  const uploaded = [
    blobUrl,
    watermarkUrl,
    ...(Array.isArray(blobUrls) ? (blobUrls as unknown[]) : []),
  ].filter(isBlobUrl);
  const reject = async (error: string) => {
    if (uploaded.length) await del(uploaded).catch(() => {});
    return res.status(400).json({ error });
  };

  if (!isToolId(tool)) {
    return reject("Unknown tool");
  }
  const { inputs, run } = TOOLS[tool];

  const picked = inputs({ blobUrl, blobUrls, watermarkUrl, options });
  if (!Array.isArray(picked)) {
    return reject(picked.error);
  }
  const inputBlobUrls = picked;

  const base = String(filename)
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]/g, "_");

  await runJob(res, "Processing", async (workDir, signal) => {
    const { outputPath, suffix, ext } = await run({
      ff: new FFmpeg(ffmpegPath, gifskiPath, signal),
      workDir,
      inputs: inputBlobUrls,
      options,
      download: (url, destPath) => downloadBlob(url, destPath, signal),
    });
    const outputName = `${base}_${suffix}.${ext}`;

    const result = await put(
      `results/${outputName}`,
      fs.createReadStream(outputPath),
      {
        access: "public",
        contentType: mimeOf(ext),
        addRandomSuffix: true,
        abortSignal: signal,
      },
    );

    res.status(200).json({
      url: result.url,
      downloadUrl: result.downloadUrl,
      filename: outputName,
    });
  });
  await del(inputBlobUrls).catch(() => {});
  // After the response is sent, so the client never waits on it.
  await sweepStaleBlobs(inputBlobUrls);
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
    return;
  }
  if (stale.length) console.log(`Swept ${stale.length} stale blob(s)`);
}

async function downloadBlob(
  url: string,
  destPath: string,
  signal: AbortSignal,
): Promise<void> {
  const download = await fetch(url, { signal });
  if (!download.ok || !download.body) {
    throw new Error(`Failed to fetch uploaded file (${download.status})`);
  }
  await pipeline(
    Readable.fromWeb(download.body as ReadableStream),
    fs.createWriteStream(destPath),
  );
}
