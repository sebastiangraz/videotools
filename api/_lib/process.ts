import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { STILLS, formatById, isToolId, type FormatId } from "./formats.js";
import { FFmpeg } from "./ffmpeg.js";
import { TOOLS } from "./tools/index.js";
import type { ToolRequest } from "./tools/types.js";
import { errorResponse, isUploadId, jsonBody, methodNotAllowed, runJob } from "./request.js";
import { ffmpegPath, gifskiPath } from "./binaries.js";

type ProcessBody = Partial<ToolRequest> & {
  tool?: unknown;
  filename?: unknown;
};

// Uploads wait here for their job, results for their download; the engine
// empties it on start, which catches whatever an aborted run left.
export const UPLOADS = path.join(os.tmpdir(), "videotools-engine");

const uploadPath = (id: string) => path.join(UPLOADS, id);

// PUT /upload/<id>: the body, streamed to disk.
export async function receive(request: Request, id: string): Promise<Response> {
  if (!isUploadId(id) || !request.body) return errorResponse("Invalid upload", 400);
  try {
    await pipeline(request.body, fs.createWriteStream(uploadPath(id)));
  } catch {
    await discard([id]);
    return new Response(null, { status: 499 });
  }
  return new Response(null, { status: 204 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      const { uploads }: { uploads?: unknown } = await jsonBody(request);
      await discard(Array.isArray(uploads) ? uploads.filter(isUploadId) : []);
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST") return methodNotAllowed();

    const {
      tool,
      filename = "video",
      upload,
      uploads,
      watermark,
      options = {},
    }: ProcessBody = await jsonBody(request);

    // Uploads happen first, so a rejected request must still delete them.
    const uploaded = [upload, watermark, ...(Array.isArray(uploads) ? uploads : [])].filter(
      isUploadId,
    );
    const reject = async (error: string) => {
      await discard(uploaded);
      return errorResponse(error, 400);
    };

    if (!isToolId(tool)) {
      return reject("Unknown tool");
    }
    const { inputs, run } = TOOLS[tool];

    const inputIds = inputs({ upload, uploads, watermark, options });
    if (!Array.isArray(inputIds)) {
      return reject(inputIds.error);
    }

    const base = String(filename)
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]/g, "_");

    const response = await runJob(request, "Processing", async (workDir, signal) => {
      const { outputPath, suffix, ext } = await run({
        ff: new FFmpeg(ffmpegPath, gifskiPath, signal),
        workDir,
        inputs: inputIds,
        options,
        take: (id, destPath) => fsp.rename(uploadPath(id), destPath),
      });
      const outputName = `${base}_${suffix}.${ext}`;

      // Out of the work dir, which goes before the body has streamed.
      const result = uploadPath(`${crypto.randomUUID()}.${ext}`);
      await fsp.rename(outputPath, result);
      const body = Bun.file(result)
        .stream()
        .pipeThrough(new TransformStream({ flush: () => discard([path.basename(result)]) }));

      return new Response(body, {
        headers: {
          "Content-Type": (STILLS.find((s) => s.id === ext) ?? formatById(ext as FormatId)).mime,
          "X-Filename": encodeURIComponent(outputName),
        },
      });
    });
    // Inputs a failed job never took.
    await discard(inputIds);
    return response;
  },
};

// Best effort: the next start clears what this misses.
async function discard(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => fsp.rm(uploadPath(id), { force: true }).catch(() => {})));
}
