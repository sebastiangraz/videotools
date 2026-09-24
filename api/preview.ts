import type { VercelRequest, VercelResponse } from "@vercel/node";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { nanoid } from "nanoid";

import { InputError } from "./_lib/errors.js";
import { FFmpeg } from "./_lib/ffmpeg.js";
import { renderWatermarkFrame } from "./_lib/tools/mark.js";
import { isMarkSize } from "./_lib/tools/mark-graph.js";
import { ffmpegPath, gifskiPath } from "./_lib/binaries.js";

// Renders the "mark" tool's preview: the browser sends the video's first
// frame (a small JPEG it grabbed itself) and the logo (a PNG) as data URLs,
// and gets back one frame composited by the same ffmpeg graph the encode
// uses. Both images travel inline: the frame is downscaled client-side and
// logos are small, so there is no need for Blob storage here.
const MAX_BYTES = 8 * 1024 * 1024;

type PreviewBody = {
  frame?: unknown;
  logo?: unknown;
  filter?: unknown;
  size?: unknown;
};

// Decodes an image data URL into bytes. Null when it isn't one.
function decodeDataUrl(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const match = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  return new Uint8Array(Buffer.from(match[1], "base64"));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { frame, logo, filter, size } = (req.body ?? {}) as PreviewBody;
  const frameImage = decodeDataUrl(frame);
  const logoImage = decodeDataUrl(logo);
  if (!frameImage || !logoImage) {
    return res.status(400).json({ error: "Expected frame and logo images" });
  }
  if (frameImage.length + logoImage.length > MAX_BYTES) {
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
    // (The names only make ffmpeg's logs readable; it sniffs the content.)
    const framePath = path.join(workDir, "frame.jpg");
    const logoPath = path.join(workDir, "logo.png");
    await fsp.writeFile(framePath, frameImage);
    await fsp.writeFile(logoPath, logoImage);

    const outputPath = await renderWatermarkFrame(
      new FFmpeg(ffmpegPath, gifskiPath, abort.signal),
      framePath,
      logoPath,
      workDir,
      filter === true,
      isMarkSize(size) ? size : "large",
    );

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(await fsp.readFile(outputPath));
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error("Preview error:", err);
    // A logo that isn't a PNG is the caller's to fix, not a server fault.
    if (err instanceof InputError) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Preview failed",
    });
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
