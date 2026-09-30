import type { VercelRequest, VercelResponse } from "@vercel/node";
import fsp from "node:fs/promises";
import path from "node:path";

import { FFmpeg } from "./_lib/ffmpeg.js";
import { renderWatermarkFrame } from "./_lib/tools/mark.js";
import {
  isMarkFilter,
  isMarkSize,
  isMarkView,
} from "./_lib/tools/mark-graph.js";
import { ffmpegPath, gifskiPath } from "./_lib/binaries.js";
import { allowMethods, runJob } from "./_lib/request.js";

// Frame and logo travel inline as data URLs (both small), skipping Blob storage.
const MAX_BYTES = 8 * 1024 * 1024;

type PreviewBody = {
  frame?: unknown;
  logo?: unknown;
  filter?: unknown;
  size?: unknown;
  view?: unknown;
};

function decodeDataUrl(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const match = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  return new Uint8Array(Buffer.from(match[1], "base64"));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethods(req, res, "POST")) return;

  const { frame, logo, filter, size, view } = (req.body ?? {}) as PreviewBody;
  const frameImage = decodeDataUrl(frame);
  const logoImage = decodeDataUrl(logo);
  if (!frameImage || !logoImage) {
    return res.status(400).json({ error: "Expected frame and logo images" });
  }
  if (frameImage.length + logoImage.length > MAX_BYTES) {
    return res.status(413).json({ error: "Preview images too large" });
  }

  await runJob(res, "Preview", async (workDir, signal) => {
    // Names are cosmetic; ffmpeg sniffs the content.
    const framePath = path.join(workDir, "frame.jpg");
    const logoPath = path.join(workDir, "logo.png");
    await fsp.writeFile(framePath, frameImage);
    await fsp.writeFile(logoPath, logoImage);

    const outputPath = await renderWatermarkFrame(
      { ff: new FFmpeg(ffmpegPath, gifskiPath, signal), workDir },
      {
        frameFile: framePath,
        logoFile: logoPath,
        filter: isMarkFilter(filter) ? filter : "glass",
        size: isMarkSize(size) ? size : "large",
        view: isMarkView(view) ? view : "render",
      },
    );

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(await fsp.readFile(outputPath));
  });
}
