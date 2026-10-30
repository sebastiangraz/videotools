// The engine: runs the tools on the user's machine for the site's pages.
// `bun api/_lib/serve.ts` from the repo; `bun run build:engine` compiles it
// into the executables Homebrew and winget install. Listens on loopback only.
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

// The installed engine on Windows. winget runs the downloaded exe with
// --install and the installed one with --uninstall; Homebrew runs it as a
// service on macOS and Linux and needs neither.
const HOME = path.join(os.homedir(), ".videotools");
const EXE = path.join(HOME, "videotools-engine.exe");
const RUN = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "videotools engine";
// The Apps & Features entry: winget offers upgrades by its DisplayVersion.
const ARP = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\videotools-engine";

const reg = (...args: string[]) => Bun.spawnSync(["reg", ...args, "/f"]);

async function stopRunning(): Promise<void> {
  const running = await fetch(`http://127.0.0.1:${ENGINE.port}/health`)
    .then((res) => res.json())
    .catch(() => null);
  if (running?.pid) process.kill(running.pid);
}

async function moveIn(): Promise<void> {
  await stopRunning();
  // Renamed into place: Windows holds the old exe for a moment after the kill.
  await fsp.mkdir(HOME, { recursive: true });
  await fsp.copyFile(process.execPath, `${EXE}.partial`);
  for (let tries = 0; ; tries++) {
    try {
      await fsp.rename(`${EXE}.partial`, EXE);
      break;
    } catch (error) {
      if (tries === 50) throw error;
      await Bun.sleep(100);
    }
  }
  reg("add", RUN, "/v", RUN_VALUE, "/d", `"${EXE}"`);
  const entry = {
    DisplayName: "videotools engine",
    DisplayVersion: String(ENGINE.version),
    Publisher: "Sebastian Graz",
    InstallLocation: HOME,
    DisplayIcon: EXE,
    UninstallString: `"${EXE}" --uninstall`,
    QuietUninstallString: `"${EXE}" --uninstall`,
  };
  for (const [name, value] of Object.entries(entry)) reg("add", ARP, "/v", name, "/d", value);
  for (const name of ["NoModify", "NoRepair"]) {
    reg("add", ARP, "/v", name, "/t", "REG_DWORD", "/d", "1");
  }
  spawn(EXE, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

async function moveOut(): Promise<void> {
  await stopRunning();
  await fsp.rm(UPLOADS, { recursive: true, force: true });
  reg("delete", RUN, "/v", RUN_VALUE);
  reg("delete", ARP);
  // A running exe can't be deleted, so a hidden cmd does it once this one has quit.
  spawn("cmd", ["/c", `ping -n 3 127.0.0.1 >nul & rmdir /s /q "${HOME}"`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: true,
  }).unref();
}

const command = compiled ? process.argv[2] : undefined;
if (command === "--install" || command === "--uninstall") {
  await (command === "--install" ? moveIn() : moveOut());
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
