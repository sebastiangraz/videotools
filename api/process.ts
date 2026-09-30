import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put, del } from "@vercel/blob";
import fs from "node:fs";

import { mimeOf } from "../shared/formats.js";
import { isToolId } from "../shared/tools.js";
import { FFmpeg } from "./_lib/ffmpeg.js";
import { TOOLS } from "./_lib/tools/index.js";
import type { ToolRequest } from "./_lib/tools/types.js";
import {
  allowMethods,
  downloadBlob,
  isBlobUrl,
  runJob,
} from "./_lib/request.js";
import { ffmpegPath, gifskiPath } from "./_lib/binaries.js";
import { sweepStaleBlobs } from "./_lib/blob-sweep.js";

// req.body is untyped JSON; every field is validated before use (the tool's
// own fields by the tool, see _lib/tools/).
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

  // The client has already uploaded before it asks for processing, so a
  // rejected request still has to release whatever it uploaded.
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

  await runJob(res, "Processing", "videotools-", async (workDir, signal) => {
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
  // runJob answers every failure itself; the uploads go either way.
  await del(inputBlobUrls).catch(() => {});
  // Runs after the response has been sent, so the client never waits on it.
  await sweepStaleBlobs(inputBlobUrls);
}
