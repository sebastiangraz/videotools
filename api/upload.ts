import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { jsonBody, methodNotAllowed } from "./_lib/request.js";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return methodNotAllowed();

    try {
      const jsonResponse = await handleUpload({
        body: (await jsonBody(request)) as HandleUploadBody,
        request,
        onBeforeGenerateToken: () =>
          Promise.resolve({
            // octet-stream: browsers can't type .mkv/.avi on some systems.
            allowedContentTypes: [
              "video/*",
              "image/*",
              "application/octet-stream",
            ],
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            addRandomSuffix: true,
          }),
        // Not invoked on localhost (Blob can't reach a local callback URL) — harmless.
        onUploadCompleted: async () => {},
      });
      return Response.json(jsonResponse);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Upload token error" },
        { status: 400 },
      );
    }
  },
};
