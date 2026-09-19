import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put, del } from "@vercel/blob";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { nanoid } from "nanoid";

import { formatById } from "../shared/formats.js";
import { InputError } from "./_lib/errors.js";
import { FFmpeg } from "./_lib/ffmpeg.js";
import { TOOLS } from "./_lib/tools/index.js";
import type { ToolRequest } from "./_lib/tools/types.js";
import { downloadBlob, isBlobUrl } from "./_lib/request.js";
import { ffmpegPath, gifskiPath } from "./_lib/binaries.js";
import { sweepStaleBlobs } from "./_lib/blob-sweep.js";

// req.body is untyped JSON; every field is validated before use (the tool's
// own fields by the tool, see _lib/tools/).
type ProcessBody = Partial<ToolRequest> & {
  tool?: unknown;
  filename?: unknown;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "DELETE") {
    const { urls } = (req.body ?? {}) as { urls?: unknown };
    const valid = Array.isArray(urls) ? urls.filter(isBlobUrl) : [];
    if (valid.length) {
      await del(valid).catch(() => {});
    }
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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

  if (typeof tool !== "string" || !Object.hasOwn(TOOLS, tool)) {
    return reject("Unknown tool");
  }
  const { inputs, run } = TOOLS[tool];

  const picked = inputs({ blobUrl, blobUrls, watermarkUrl, options });
  if (!Array.isArray(picked)) {
    return reject(picked.error);
  }
  const inputBlobUrls = picked;

  const workDir = path.join(os.tmpdir(), `videotools-${nanoid(8)}`);

  // The client's Stop button aborts its request. When the disconnect
  // reaches the function (best effort: it depends on the platform
  // propagating it), stop encoding instead of finishing work nobody will
  // download. The response's 'close' fires on normal completion too, hence
  // the writableFinished check.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const { signal } = abort;

  try {
    await fsp.mkdir(workDir, { recursive: true });

    const base = String(filename)
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]/g, "_");

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
        contentType: formatById(ext).mime,
        addRandomSuffix: true,
        abortSignal: signal,
      },
    );

    return res.status(200).json({
      url: result.url,
      downloadUrl: result.downloadUrl,
      filename: outputName,
    });
  } catch (err) {
    if (signal.aborted) {
      // Nobody is listening any more; just clean up (finally).
      console.log("Processing cancelled by client");
      return;
    }
    console.error("Processing error:", err);
    // What is wrong with the input (a source the tool cannot hand back, a
    // clip too long for the format, ...) is the user's to fix, not a server
    // fault; the code lets the client tell these apart.
    if (err instanceof InputError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Processing failed",
    });
  } finally {
    await del(inputBlobUrls).catch(() => {});
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    // Runs after the response has been sent, so the client never waits on it.
    await sweepStaleBlobs(inputBlobUrls);
  }
}
