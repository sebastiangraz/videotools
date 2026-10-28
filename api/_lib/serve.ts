// The engine: runs the tools on the user's machine for the site's pages.
// `bun api/_lib/serve.ts` from the repo; `bun run build:engine` compiles it
// for the install scripts in scripts/. Listens on loopback only.
import fsp from "node:fs/promises";

import { ENGINE } from "./formats.js";
import { BINARIES, install } from "./binaries.js";
import processing, { UPLOADS, receive } from "./process.js";
import preview from "./preview.js";
import { errorResponse } from "./request.js";

// Pages that may send jobs. Browsers send Origin with every cross-origin and
// every POST request, so other sites are refused; tools like curl send none.
const ORIGINS = [
  /^https:\/\/videotools-client\.vercel\.app$/,
  /^https:\/\/videotools-[\w-]+-grazs-projects\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

const route = (request: Request): Promise<Response> | Response => {
  const { pathname } = new URL(request.url);
  const upload = /^\/upload\/([^/]+)$/.exec(pathname);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (pathname === "/health") {
    return Response.json({ version: ENGINE.version, ffmpeg: BINARIES.ffmpeg.version });
  }
  if (upload && request.method === "PUT") return receive(request, upload[1]);
  if (pathname === "/process") return processing.fetch(request);
  if (pathname === "/preview") return preview.fetch(request);
  return errorResponse("Not found", 404);
};

await install("ffmpeg");
await install("gifski");
await fsp.rm(UPLOADS, { recursive: true, force: true });
await fsp.mkdir(UPLOADS, { recursive: true });

Bun.serve({
  hostname: "127.0.0.1",
  port: ENGINE.port,
  // Uploads are whole videos, and a job sends nothing until it is done.
  maxRequestBodySize: Number.MAX_SAFE_INTEGER,
  idleTimeout: 0,
  async fetch(request) {
    const origin = request.headers.get("Origin");
    if (origin && !ORIGINS.some((re) => re.test(origin))) {
      return errorResponse("Unknown origin", 403);
    }
    const response = await route(request);
    if (origin) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
      response.headers.set("Access-Control-Allow-Headers", "Content-Type");
      response.headers.set("Access-Control-Allow-Private-Network", "true");
      response.headers.set("Access-Control-Expose-Headers", "X-Filename");
      response.headers.set("Vary", "Origin");
    }
    return response;
  },
});
console.log(`videotools engine ${ENGINE.version} on http://127.0.0.1:${ENGINE.port}`);
