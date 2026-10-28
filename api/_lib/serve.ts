// The engine: runs the tools on the user's machine for the site's pages.
// `bun api/_lib/serve.ts` from the repo; `bun run build:engine` compiles it
// into the executables the site offers. Listens on loopback only.
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ENGINE } from "./formats.js";
import { BINARIES, compiled, install } from "./binaries.js";
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
    return Response.json({
      version: ENGINE.version,
      ffmpeg: BINARIES.ffmpeg.version,
      pid: process.pid,
    });
  }
  if (upload && request.method === "PUT") return receive(request, upload[1]);
  if (pathname === "/process") return processing.fetch(request);
  if (pathname === "/preview") return preview.fetch(request);
  return errorResponse("Not found", 404);
};

// The installed engine. One opened from anywhere else (the download) takes
// the running engine's place there, so the site only has to offer a file.
const HOME = path.join(os.homedir(), ".videotools");

async function moveIn(): Promise<void> {
  const exe = path.join(HOME, `videotools-engine${process.platform === "win32" ? ".exe" : ""}`);
  const running = await fetch(`http://127.0.0.1:${ENGINE.port}/health`)
    .then((res) => res.json())
    .catch(() => null);
  if (running?.pid) process.kill(running.pid);

  // Renamed into place: a running binary must not be overwritten (macOS kills
  // the next launch), and Windows holds it for a moment after the kill.
  await fsp.mkdir(HOME, { recursive: true });
  await fsp.copyFile(process.execPath, `${exe}.partial`);
  for (let tries = 0; ; tries++) {
    try {
      await fsp.rename(`${exe}.partial`, exe);
      break;
    } catch (error) {
      if (tries === 50) throw error;
      await Bun.sleep(100);
    }
  }

  if (process.platform === "darwin") {
    const plist = path.join(
      os.homedir(),
      "Library",
      "LaunchAgents",
      "io.graz.videotools-engine.plist",
    );
    const log = path.join(HOME, "engine.log");
    await fsp.mkdir(path.dirname(plist), { recursive: true });
    await fsp.writeFile(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>io.graz.videotools-engine</string>
  <key>ProgramArguments</key><array><string>${exe}</string></array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`,
    );
    const domain = `gui/${process.getuid?.()}`;
    Bun.spawnSync(["launchctl", "bootout", domain, plist]);
    Bun.spawnSync(["launchctl", "bootstrap", domain, plist]);
    return;
  }
  if (process.platform === "win32") {
    const run = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    Bun.spawnSync(["reg", "add", run, "/v", "videotools engine", "/d", `"${exe}"`, "/f"]);
  }
  // Linux has no start at login.
  spawn(exe, { detached: true, stdio: "ignore" }).unref();
}

if (compiled && path.dirname(process.execPath) !== HOME) {
  await moveIn();
  console.log(`videotools engine installed in ${HOME} and running`);
  process.exit(0);
}

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
