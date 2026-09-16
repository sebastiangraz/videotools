import type { VercelRequest, VercelResponse } from "@vercel/node";
import { put, del } from "@vercel/blob";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { nanoid } from "nanoid";

import ffmpegStatic from "ffmpeg-static";
import ffprobe from "@ffprobe-installer/ffprobe";
import VideoProcessor from "./_lib/video-processor.js";
import { sweepStaleBlobs } from "./_lib/blob-sweep.js";

// ffmpeg-static is CommonJS (`module.exports = path | null`) but its .d.ts says
// `export default`, so under NodeNext TypeScript types the default import as
// the module namespace. At runtime Node hands ESM importers the string itself.
const maybeFfmpegPath = ffmpegStatic as unknown as string | null;
if (!maybeFfmpegPath) {
  throw new Error("ffmpeg-static has no ffmpeg binary for this platform");
}
const ffmpegPath: string = maybeFfmpegPath;
const ffprobePath: string = ffprobe.path;

// Vendored gifski CLI (see api/_bin/gifski/README.md). The linux binary is
// static-pie linked, so it runs on the function runtime as-is; the exec bit
// is restored at spawn time in VideoProcessor.
const gifskiPath: string = path.join(
  process.cwd(),
  "api",
  "_bin",
  "gifski",
  process.platform === "win32" ? "win" : "linux",
  process.platform === "win32" ? "gifski.exe" : "gifski",
);

// Mirrored in client/src/VideoToolUploader.tsx (TOOLS / TECHNIQUES / FORMATS
// / CONVERT_TARGETS)
const VALID_TOOLS = ["loop", "sequence", "speed", "convert"];
const VALID_TECHNIQUES = ["reverse", "crossfade"];
const VALID_FORMATS = ["mp4", "gif", "avif"];
const CONVERT_TARGETS = ["mp4", "webm", "mov", "gif", "webp", "avif"];
const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  gif: "image/gif",
  avif: "image/avif",
  webm: "video/webm",
  mov: "video/quicktime",
  webp: "image/webp",
};
const MAX_IMAGES = 100;

const BLOB_HOST_RE = /\.public\.blob\.vercel-storage\.com$/;

// req.body is untyped JSON; every field is validated below before use.
type ProcessBody = {
  tool?: unknown;
  filename?: unknown;
  blobUrl?: unknown;
  blobUrls?: unknown;
  options?: Record<string, unknown>;
};

function isBlobUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    return BLOB_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function pick(value: unknown, allowed: string[], fallback: string): string {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
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
    Readable.fromWeb(download.body as import("stream/web").ReadableStream),
    fs.createWriteStream(destPath),
  );
}

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
    options = {},
  } = (req.body ?? {}) as ProcessBody;

  // The client has already uploaded before it asks for processing, so a
  // rejected request still has to release whatever it uploaded.
  const uploaded = [
    blobUrl,
    ...(Array.isArray(blobUrls) ? (blobUrls as unknown[]) : []),
  ].filter(isBlobUrl);
  const reject = async (error: string) => {
    if (uploaded.length) await del(uploaded).catch(() => {});
    return res.status(400).json({ error });
  };

  if (typeof tool !== "string" || !VALID_TOOLS.includes(tool)) {
    return reject("Unknown tool");
  }

  let inputBlobUrls: string[];
  if (tool === "sequence") {
    if (
      !Array.isArray(blobUrls) ||
      blobUrls.length < 1 ||
      blobUrls.length > MAX_IMAGES ||
      !blobUrls.every(isBlobUrl)
    ) {
      return reject(`Expected 1–${MAX_IMAGES} valid blob URLs`);
    }
    inputBlobUrls = blobUrls;
  } else {
    if (!isBlobUrl(blobUrl)) {
      return reject("Invalid blob URL");
    }
    inputBlobUrls = [blobUrl];
  }

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

    const processor = new VideoProcessor(
      ffmpegPath,
      ffprobePath,
      gifskiPath,
      signal,
    );
    const base = String(filename)
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w.-]/g, "_");

    let outputPath: string;
    let outputName: string;
    let contentType: string;

    if (tool === "sequence") {
      const frameDuration = clamp(options.frameDuration, 0.02, 10, 1);
      const format = pick(options.format, VALID_FORMATS, "mp4");
      const quality = Math.round(clamp(options.quality, 1, 100, 100));

      const imagePaths: string[] = [];
      for (let i = 0; i < inputBlobUrls.length; i++) {
        // Keep the original extension for readability; ffmpeg sniffs the
        // actual codec from content, so a wrong/missing extension is fine.
        const urlExt = path.posix.extname(new URL(inputBlobUrls[i]).pathname);
        const ext = /^\.\w+$/.test(urlExt) ? urlExt : ".png";
        const imagePath = path.join(
          workDir,
          `src_${String(i + 1).padStart(4, "0")}${ext}`,
        );
        await downloadBlob(inputBlobUrls[i], imagePath, signal);
        imagePaths.push(imagePath);
      }

      outputPath = await processor.createImageSequenceVideo(
        imagePaths,
        workDir,
        frameDuration,
        format,
        quality,
      );
      outputName = `${base}_video.${format}`;
      contentType = CONTENT_TYPES[format];
    } else if (tool === "convert") {
      const target = pick(options.target, CONVERT_TARGETS, "mp4");
      const quality = Math.round(clamp(options.quality, 1, 100, 90));

      // Keep the original extension for readability; ffmpeg sniffs the
      // container from content, so a wrong/missing extension is fine.
      const urlExt = path.posix.extname(new URL(inputBlobUrls[0]).pathname);
      const ext = /^\.\w+$/.test(urlExt) ? urlExt : ".mp4";
      const inputPath = path.join(workDir, `input${ext}`);
      await downloadBlob(inputBlobUrls[0], inputPath, signal);

      if (target === "gif") {
        // Absent fps → match the source framerate (capped in videoToGif).
        // 30 is the practical GIF ceiling: delays are centiseconds, so
        // gifski alternates 3/4cs frames for 30fps; browsers clamp ≥50fps.
        const fps =
          options.fps == null ? null : Math.round(clamp(options.fps, 1, 30, 15));
        const width = Math.round(clamp(options.width, 100, 800, 640));
        outputPath = await processor.videoToGif(
          inputPath,
          workDir,
          quality,
          fps,
          width,
        );
      } else {
        outputPath = await processor.convertVideo(
          inputPath,
          workDir,
          target,
          quality,
        );
      }
      outputName = `${base}_converted.${target}`;
      contentType = CONTENT_TYPES[target];
    } else if (tool === "speed") {
      // Signed ratio: ±1 → 2× faster/slower, ±3 → 4×. Mirrored in
      // client/src/VideoToolUploader.tsx.
      const speed = clamp(options.speed, -3, 3, 0);
      const multiplier = speed >= 0 ? 1 + speed : 1 / (1 - speed);

      const inputPath = path.join(workDir, "input.mp4");
      await downloadBlob(inputBlobUrls[0], inputPath, signal);

      outputPath = await processor.changeSpeed(inputPath, multiplier);
      outputName = `${base}_speed.mp4`;
      contentType = "video/mp4";
    } else {
      const technique = pick(options.technique, VALID_TECHNIQUES, "reverse");
      const fadeDuration = clamp(options.fadeDuration, 0, 10, 0.5);
      const startSecond = clamp(
        options.startSecond,
        0,
        Number.MAX_SAFE_INTEGER,
        0,
      );
      const quality = Math.round(clamp(options.quality, 1, 100, 100));

      const inputPath = path.join(workDir, "input.mp4");
      await downloadBlob(inputBlobUrls[0], inputPath, signal);

      outputPath = await processor.createLoop(
        inputPath,
        technique,
        String(fadeDuration),
        String(startSecond),
        quality,
      );
      outputName = `${base}_loop.mp4`;
      contentType = "video/mp4";
    }

    const result = await put(
      `results/${outputName}`,
      fs.createReadStream(outputPath),
      {
        access: "public",
        contentType,
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
    // Input-shaped rejections (e.g. "Video too long...") are the user's to
    // fix, not server faults.
    const status =
      err instanceof Error && /too long/i.test(err.message) ? 400 : 500;
    return res.status(status).json({
      error: err instanceof Error ? err.message : "Processing failed",
    });
  } finally {
    await del(inputBlobUrls).catch(() => {});
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    // Runs after the response has been sent, so the client never waits on it.
    await sweepStaleBlobs(inputBlobUrls);
  }
}
