// Postinstall: fetches the binaries BINARIES (binaries.mjs) pins into
// api/_bin/<tool>/<platform>/ (on Vercel, before the functions are bundled).
//
//   BIN_PLATFORM=linux-x64 bun scripts/binaries-install.mjs
//                         another platform's binaries (to inspect them; the
//                         app only uses the host's)
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { BINARIES, binaryPath, hostPlatform, root } from "./binaries.mjs";

const key = process.env.BIN_PLATFORM ?? hostPlatform;

async function install(tool) {
  const { version, platforms } = BINARIES[tool];
  const pinned = platforms[key];
  if (!pinned) {
    // Not fatal, so the rest of the install goes through; point FFMPEG_BIN
    // at an ffmpeg of the pinned version to run the api here.
    console.warn(
      `no ${tool} pinned for ${key} (only ${Object.keys(platforms).join(", ")})`,
    );
    return;
  }

  const binary = binaryPath(tool, key);
  const dir = path.dirname(binary);
  const stamp = path.join(dir, ".sha256");
  const current =
    fs.existsSync(binary) &&
    fs.existsSync(stamp) &&
    fs.readFileSync(stamp, "utf8").trim();
  if (current === pinned.sha256) {
    console.log(`${tool} ${version} (${key}) already installed`);
    return;
  }

  console.log(`fetching ${tool} ${version} (${key}) from ${pinned.url}`);
  const res = await fetch(pinned.url);
  if (!res.ok) throw new Error(`${pinned.url}: HTTP ${res.status}`);
  fs.mkdirSync(dir, { recursive: true });
  // Hashed while streaming into a temporary name, so an interrupted or
  // tampered download never sits where binaries.ts looks.
  const partial = `${binary}.partial`;
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(res.body),
    zlib.createGunzip(),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    fs.createWriteStream(partial, { mode: 0o755 }),
  );
  const got = hash.digest("hex");
  if (got !== pinned.sha256) {
    fs.rmSync(partial, { force: true });
    throw new Error(
      `${pinned.url}: sha256 of the binary is ${got}, binaries.mjs pins ${pinned.sha256}`,
    );
  }
  fs.renameSync(partial, binary);
  // The bundle keeps this mode, and the function's filesystem is read-only.
  fs.chmodSync(binary, 0o755);
  fs.writeFileSync(stamp, pinned.sha256 + "\n");
  console.log(`installed ${tool} ${version} at ${path.relative(root, binary)}`);
}

await install("ffmpeg");
await install("gifski");
