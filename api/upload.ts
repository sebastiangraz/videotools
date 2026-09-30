import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { allowMethods } from "./_lib/request.js";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethods(req, res, "POST")) return;

  try {
    const jsonResponse = await handleUpload({
      body: req.body as HandleUploadBody,
      request: req,
      onBeforeGenerateToken: () =>
        Promise.resolve({
          // ffmpeg detects the container from the file content, so accept any
          // video/image type; octet-stream covers formats the browser can't
          // identify (e.g. .mkv or .avi on some systems).
          allowedContentTypes: ["video/*", "image/*", "application/octet-stream"],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
        }),
      // Not invoked on localhost (Blob can't reach a local callback URL) — harmless.
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(jsonResponse);
  } catch (err) {
    return res
      .status(400)
      .json({ error: err instanceof Error ? err.message : "Upload token error" });
  }
}
