import type { VercelRequest, VercelResponse } from "@vercel/node";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { nanoid } from "nanoid";

import VideoProcessor from "./_lib/video-processor.js";
import { ffmpegPath, gifskiPath } from "./_lib/binaries.js";

// Renders the "mark" tool's preview: the browser sends the video's first
// frame (a small JPEG it grabbed itself) and the logo as data URLs, and gets
// back one frame composited by the same ffmpeg graph the encode uses. Both
// images travel inline: the frame is downscaled client-side and logos are
// small, so there is no need for Blob storage here.
const MAX_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

type PreviewBody = { frame?: unknown; logo?: unknown; filter?: unknown };

// Decodes an image data URL into bytes plus a file extension for ffmpeg's
// logs (the content is what it actually sniffs). Null when it isn't one.
function decodeDataUrl(
  value: unknown,
): { bytes: Uint8Array; ext: string } | null {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  return {
    bytes: new Uint8Array(Buffer.from(match[2], "base64")),
    ext: EXT[match[1]] ?? ".png",
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { frame, logo, filter } = (req.body ?? {}) as PreviewBody;
  const frameImage = decodeDataUrl(frame);
  const logoImage = decodeDataUrl(logo);
  if (!frameImage || !logoImage) {
    return res.status(400).json({ error: "Expected frame and logo images" });
  }
  if (frameImage.bytes.length + logoImage.bytes.length > MAX_BYTES) {
    return res.status(413).json({ error: "Preview images too large" });
  }

  const workDir = path.join(os.tmpdir(), `videotools-preview-${nanoid(8)}`);

  // A stale preview (the user toggled again) is abandoned client-side; stop
  // rendering it when the disconnect reaches the function.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });

  try {
    await fsp.mkdir(workDir, { recursive: true });
    const framePath = path.join(workDir, `frame${frameImage.ext}`);
    const logoPath = path.join(workDir, `logo${logoImage.ext}`);
    await fsp.writeFile(framePath, frameImage.bytes);
    await fsp.writeFile(logoPath, logoImage.bytes);

    const processor = new VideoProcessor(ffmpegPath, gifskiPath, abort.signal);
    const outputPath = await processor.renderWatermarkFrame(
      framePath,
      logoPath,
      workDir,
      filter === true,
    );

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(await fsp.readFile(outputPath));
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error("Preview error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Preview failed",
    });
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
