// The engine: runs the tools on the user's machine for the site's pages.
// `bun api/_lib/serve.ts` from the repo; `bun run build:engine` compiles it
// into the executables Homebrew and winget install. Listens on loopback only.
// The tools themselves are the logic (logic.ts), which the site serves and
// this loads, so whatever this imports is frozen into each release.
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ENGINE } from "./formats.js";
import { compiled } from "./helpers.js";
import { UPLOADS, errorResponse } from "./request.js";

// Pages that may send jobs. Browsers send Origin with every cross-origin and
// every POST request, so other sites are refused; tools like curl send none.
const ORIGINS = [
  /^https:\/\/videotools-client\.vercel\.app$/,
  /^https:\/\/videotools-[\w-]+-grazs-projects\.vercel\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

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
  // A running exe can't be deleted, so a hidden cmd does it once this one has
  // quit, retrying while a scanner still holds the deleted exe (the folder
  // isn't empty until it lets go). winget starts this one inside HOME, which
  // cmd must not inherit.
  const remove = `rmdir /s /q "${HOME}" 2>nul & if not exist "${HOME}" (exit) else ping -n 2 127.0.0.1 >nul`;
  spawn("cmd", ["/c", `ping -n 3 127.0.0.1 >nul & for /l %i in (1,1,20) do @${remove}`], {
    cwd: os.homedir(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: true,
  }).unref();
}

const command = compiled() ? process.argv[2] : undefined;
if (command === "--install" || command === "--uninstall") {
  await (command === "--install" ? moveIn() : moveOut());
  process.exit(0);
}

// The logic a page names by its bundle's sha256: from HOME, else from the
// production site, never from the page, so a page can only pick code the site
// has served. Run from source, it is logic.ts, whatever the page names. Its
// default export starts it and resolves to the handler.
const LOGIC_URL = "https://videotools-client.vercel.app/engine.js";
type Logic = (request: Request, path: string) => Promise<Response> | Response;
const logics = new Map<string, Promise<Logic>>();

async function importLogic(hash: string): Promise<Logic> {
  let file = path.join(import.meta.dir, "logic.ts");
  if (compiled()) {
    const dir = path.join(HOME, "logic");
    file = path.join(dir, `${hash}.js`);
    if (!(await Bun.file(file).exists())) {
      const res = await fetch(LOGIC_URL, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${LOGIC_URL}: HTTP ${res.status}`);
      const code = await res.bytes();
      // The site has been deployed again since the page loaded.
      if (new Bun.CryptoHasher("sha256").update(code).digest("hex") !== hash) {
        throw errorResponse("The site has been updated: reload the page", 409);
      }
      await Bun.write(`${file}.partial`, code);
      await fsp.rename(`${file}.partial`, file);
      // Only the newest is kept; older ones stay loaded until a restart.
      for (const name of await fsp.readdir(dir)) {
        if (name !== `${hash}.js`)
          await fsp.rm(path.join(dir, name), { force: true }).catch(() => {});
      }
    }
  }
  return (await import(pathToFileURL(file).href)).default();
}

// Once per logic; a failed load or start is dropped, so the next request
// tries again.
function load(hash: string): Promise<Logic> {
  let logic = logics.get(hash);
  if (!logic) {
    logic = importLogic(hash);
    logic.catch(() => logics.delete(hash));
    logics.set(hash, logic);
  }
  return logic;
}

const health = () => Response.json({ version: ENGINE.version, pid: process.pid });

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (pathname === "/health") return health();
  const named = /^\/([0-9a-f]{64})(\/.*)$/.exec(pathname);
  if (!named) return errorResponse("Not found", 404);
  let logic: Logic;
  try {
    logic = await load(named[1]);
  } catch (error) {
    if (error instanceof Response) return error.clone();
    console.error("Logic failed to load:", error);
    return errorResponse("Logic failed to load", 500);
  }
  return named[2] === "/health" ? health() : logic(request, named[2]);
}

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
