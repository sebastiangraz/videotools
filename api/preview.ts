import fsp from "node:fs/promises";
import path from "node:path";

import { FFmpeg } from "./_lib/ffmpeg.js";
import { renderWatermarkFrame } from "./_lib/tools/mark.js";
import { isMarkFilter, isMarkPosition, isMarkSize, isMarkView } from "./_lib/tools/mark-graph.js";
import { ffmpegPath, gifskiPath } from "./_lib/binaries.js";
import { jsonBody, methodNotAllowed, runJob } from "./_lib/request.js";

// Frame and logo travel inline as data URLs (both small), skipping Blob storage.
const MAX_BYTES = 8 * 1024 * 1024;

type PreviewBody = {
  frame?: unknown;
  logo?: unknown;
  filter?: unknown;
  size?: unknown;
  position?: unknown;
  view?: unknown;
};

function decodeDataUrl(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const match = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  return new Uint8Array(Buffer.from(match[1], "base64"));
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return methodNotAllowed();

    const { frame, logo, filter, size, position, view }: PreviewBody = await jsonBody(request);
    const frameImage = decodeDataUrl(frame);
    const logoImage = decodeDataUrl(logo);
    if (!frameImage || !logoImage) {
      return Response.json({ error: "Expected frame and logo images" }, { status: 400 });
    }
    if (frameImage.length + logoImage.length > MAX_BYTES) {
      return Response.json({ error: "Preview images too large" }, { status: 413 });
    }

    return runJob(request, "Preview", async (workDir, signal) => {
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
          position: isMarkPosition(position) ? position : "bottom-right",
          view: isMarkView(view) ? view : "render",
        },
      );

      return new Response(await fsp.readFile(outputPath), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
      });
    });
  },
};
