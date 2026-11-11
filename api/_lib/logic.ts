// The engine's logic. `bun run build` bundles it into the site as engine.js,
// and the engine (serve.ts) loads it by its sha256, starts it and hands the
// handler it resolves to every /<logic>/<path> request, so it ships with the
// site, not with the engine.
import { install } from "./binaries.js";
import processing, { receive } from "./process.js";
import preview from "./preview.js";
import { errorResponse } from "./request.js";

export default async () => {
  await install("ffmpeg");
  await install("gifski");
  return (request: Request, path: string): Promise<Response> | Response => {
    const upload = /^\/upload\/([^/]+)$/.exec(path);
    if (upload && request.method === "PUT") return receive(request, upload[1]);
    if (path === "/process") return processing.fetch(request);
    if (path === "/preview") return preview.fetch(request);
    return errorResponse("Not found", 404);
  };
};
