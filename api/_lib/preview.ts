import fsp from "node:fs/promises";
import path from "node:path";

import { FFmpeg } from "./ffmpeg.js";
import { markLook, renderWatermarkFrames } from "./tools/mark.js";
import { ffmpegPath, gifskiPath } from "./binaries.js";
import { errorResponse, jsonBody, methodNotAllowed, runJob } from "./request.js";

// Frames and logo travel inline as data URLs (all small), skipping the
// uploads. A frame and the logo together, at most.
const MAX_BYTES = 8 * 1024 * 1024;

type PreviewBody = {
  frames?: unknown;
  logo?: unknown;
  filter?: unknown;
  size?: unknown;
  view?: unknown;
  tuning?: unknown;
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

    const body: PreviewBody = await jsonBody(request);
    const frames: Record<string, unknown>[] = Array.isArray(body.frames)
      ? body.frames.map(Object)
      : [];
    const frameImages = frames.map(({ image }) => decodeDataUrl(image));
    const logoImage = decodeDataUrl(body.logo);
    if (!frameImages.length || !frameImages.every((image) => image !== null) || !logoImage) {
      return errorResponse("Expected frame and logo images", 400);
    }
    if (frameImages.some((image) => image.length + logoImage.length > MAX_BYTES)) {
      return errorResponse("Preview images too large", 413);
    }

    return runJob(request, "Preview", async (workDir, signal) => {
      // Names are cosmetic; ffmpeg sniffs the content.
      const logoPath = path.join(workDir, "logo.png");
      await fsp.writeFile(logoPath, logoImage);

      const outputPaths = await renderWatermarkFrames(
        { ff: new FFmpeg(ffmpegPath, gifskiPath, signal), workDir },
        {
          ...markLook(body),
          logoFile: logoPath,
          frames: await Promise.all(
            frameImages.map(async (image, n) => {
              const file = path.join(workDir, `frame${n}.jpg`);
              await fsp.writeFile(file, image);
              return { file, position: markLook(frames[n]).position };
            }),
          ),
        },
      );

      return Response.json(
        await Promise.all(
          outputPaths.map(
            async (output) =>
              `data:image/jpeg;base64,${(await fsp.readFile(output)).toString("base64")}`,
          ),
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    });
  },
};
