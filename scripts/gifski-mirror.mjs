// Pins a new gifski: splits one ImageOptim/gifski release tarball into per-platform
// binaries in a release here, so the postinstall fetches only the host's.
//
//   npm run gifski:mirror -- 1.34.0            that gifski release
//   npm run gifski:mirror -- 1.34.0 --dry-run  fetch and hash, publish nothing
//
// Needs gh with write access to this repo.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gh, pack, publish, tar } from "./binaries.mjs";

const UPSTREAM = "ImageOptim/gifski";
// The macOS binary is universal, so both Macs share one asset.
const PLATFORMS = {
  "win32-x64": { member: "win/gifski.exe", asset: "gifski-win32-x64.gz", bin: "gifski.exe" },
  "linux-x64": { member: "linux/gifski", asset: "gifski-linux-x64.gz", bin: "gifski" },
  "darwin-arm64": { member: "mac/gifski", asset: "gifski-darwin.gz", bin: "gifski" },
  "darwin-x64": { member: "mac/gifski", asset: "gifski-darwin.gz", bin: "gifski" },
};

const argv = process.argv.slice(2);
const version = argv.find((a) => !a.startsWith("--"));
const dryRun = argv.includes("--dry-run");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: npm run gifski:mirror -- <version> [--dry-run]");
  process.exit(2);
}

const tag = `gifski-${version}`;
const tarball = `gifski-${version}.tar.xz`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "gifski-mirror-"));
try {
  console.log(`downloading ${UPSTREAM} ${version}: ${tarball}`);
  gh(["release", "download", version, "-R", UPSTREAM, "-p", tarball, "-D", work]);
  const x = spawnSync(tar, ["-xf", path.join(work, tarball), "-C", work], { encoding: "utf8" });
  if (x.status !== 0) throw new Error(`extracting ${tarball}: ${x.stderr}`);

  const platforms = {};
  const packed = new Map();
  for (const [key, { member, asset, bin }] of Object.entries(PLATFORMS)) {
    const gz = path.join(work, asset);
    if (!packed.has(gz)) packed.set(gz, await pack(path.join(work, member), gz, tag, bin));
    platforms[key] = packed.get(gz);
  }

  const source = `https://github.com/${UPSTREAM}/releases/download/${version}/${tarball}`;
  publish("gifski", { version, sources: [source], platforms }, {
    tag,
    uploads: [path.join(work, "LICENSE"), ...packed.keys()],
    dryRun,
    notes:
      `gifski binaries pinned by gifski.json, unmodified from ${source}.\n\n` +
      `AGPL-3.0 (LICENSE attached). Source: https://github.com/${UPSTREAM} (the ${version} tag).`,
    next: "npm install && npm run smoke -- <label> --only gif",
  });
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
