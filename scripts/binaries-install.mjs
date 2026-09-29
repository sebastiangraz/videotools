// Fetches the binaries that ffmpeg.json and gifski.json pin into
// api/_bin/<tool>/<platform>/, where api/_lib/binaries.ts finds them. Runs
// as the postinstall, so on Vercel they land during `npm install`, before
// the functions are bundled (vercel.json ships the linux-x64 folders with
// them). A no-op for a binary that is already there.
//
//   BIN_PLATFORM=linux-x64 node scripts/binaries-install.mjs
//                         another platform's binaries (to inspect them; the
//                         app only uses the host's)
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = process.env.BIN_PLATFORM ?? `${process.platform}-${process.arch}`;

async function install(tool) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, `${tool}.json`), "utf8"));
  const pinned = manifest.platforms[key];
  if (!pinned) {
    // Not fatal, so the rest of the install goes through; point FFMPEG_BIN
    // at an ffmpeg of the pinned version to run the api here.
    console.warn(
      `${tool}.json pins no ${tool} for ${key} (only ${Object.keys(manifest.platforms).join(", ")})`,
    );
    return;
  }

  const dir = path.join(root, "api", "_bin", tool, key);
  const binary = path.join(dir, pinned.bin);
  const stamp = path.join(dir, ".sha256");
  const current = fs.existsSync(binary) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim();
  if (current === pinned.binarySha256) {
    console.log(`${tool} ${manifest.version} (${key}) already installed`);
    return;
  }

  console.log(`fetching ${tool} ${manifest.version} (${key}) from ${pinned.url}`);
  const res = await fetch(pinned.url);
  if (!res.ok) throw new Error(`${pinned.url}: HTTP ${res.status}`);
  fs.mkdirSync(dir, { recursive: true });
  // Hash both what came down and what it unpacks to while streaming, into a
  // temporary name, so an interrupted or tampered download never sits where
  // binaries.ts looks.
  const partial = `${binary}.partial`;
  const downloaded = createHash("sha256");
  const unpacked = createHash("sha256");
  await pipeline(
    Readable.fromWeb(res.body),
    async function* (source) {
      for await (const chunk of source) {
        downloaded.update(chunk);
        yield chunk;
      }
    },
    zlib.createGunzip(),
    async function* (source) {
      for await (const chunk of source) {
        unpacked.update(chunk);
        yield chunk;
      }
    },
    fs.createWriteStream(partial, { mode: 0o755 }),
  );
  const got = { sha256: downloaded.digest("hex"), binarySha256: unpacked.digest("hex") };
  for (const field of ["sha256", "binarySha256"]) {
    if (got[field] !== pinned[field]) {
      fs.rmSync(partial, { force: true });
      throw new Error(`${pinned.url}: ${field} is ${got[field]}, ${tool}.json pins ${pinned[field]}`);
    }
  }
  fs.renameSync(partial, binary);
  // The bundle keeps this mode, and the function's filesystem is read-only.
  fs.chmodSync(binary, 0o755);
  fs.writeFileSync(stamp, pinned.binarySha256 + "\n");
  console.log(`installed ${tool} ${manifest.version} at ${path.relative(root, binary)}`);
}

await install("ffmpeg");
await install("gifski");
