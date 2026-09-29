// Pins a new gifski: takes one release of ImageOptim/gifski (a single
// tarball with every platform's CLI), copies each binary out of it into a
// release on this repo, so the postinstall fetches just the host's, and
// rewrites gifski.json to point at them. The macOS binary is universal, so
// both Mac platforms get the same one.
//
//   npm run gifski:mirror -- 1.34.0            that gifski release
//   npm run gifski:mirror -- 1.34.0 --dry-run  fetch and hash, publish nothing
//
// Needs the gh CLI, logged in with write access to this repo. Then run
// `npm install` (fetches the new binary) and `npm run smoke -- <label> --only
// gif` before committing gifski.json.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "gifski.json");
const UPSTREAM = "ImageOptim/gifski";
// Each platform's binary inside the upstream tarball, and the name it is
// mirrored under.
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

function gh(args, options = {}) {
  const r = spawnSync("gh", args, { encoding: "utf8", ...options });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")}\n${r.stderr}`);
  return r.stdout;
}

const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// Windows' own tar (bsdtar) reads .tar.xz; Git's GNU tar on the PATH does
// not without xz installed.
const tar = process.platform === "win32"
  ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
  : "tar";

const tag = `gifski-${version}`;
const tarball = `gifski-${version}.tar.xz`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "gifski-mirror-"));
try {
  console.log(`downloading ${UPSTREAM} ${version}: ${tarball}`);
  gh(["release", "download", version, "-R", UPSTREAM, "-p", tarball, "-D", work]);
  const x = spawnSync(tar, ["-xf", path.join(work, tarball), "-C", work], { encoding: "utf8" });
  if (x.status !== 0) throw new Error(`extracting ${tarball}: ${x.stderr}`);

  const platforms = {};
  const uploads = new Set([path.join(work, "LICENSE")]);
  for (const [key, { member, asset, bin }] of Object.entries(PLATFORMS)) {
    const binary = path.join(work, member);
    const gz = path.join(work, asset);
    if (!uploads.has(gz)) {
      await pipeline(fs.createReadStream(binary), zlib.createGzip({ level: 9 }), fs.createWriteStream(gz));
      uploads.add(gz);
      console.log(
        `  ${member}: ${(fs.statSync(binary).size / 1e6).toFixed(1)} MB, ` +
          `${(fs.statSync(gz).size / 1e6).toFixed(1)} MB gzipped`,
      );
    }
    platforms[key] = {
      url: `https://github.com/sebastiangraz/videotools/releases/download/${tag}/${asset}`,
      sha256: sha256(gz),
      binarySha256: sha256(binary),
      bin,
    };
  }

  const manifest = {
    version,
    sources: [`https://github.com/${UPSTREAM}/releases/download/${version}/${tarball}`],
    platforms,
  };
  if (dryRun) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    const exists = spawnSync("gh", ["release", "view", tag], { encoding: "utf8" }).status === 0;
    if (exists) throw new Error(`release ${tag} already exists; delete it first to re-mirror`);
    gh([
      "release", "create", tag, ...uploads,
      "--title", `gifski ${version}`,
      "--notes",
      `gifski binaries pinned by gifski.json, unmodified from ${manifest.sources[0]}.\n\n` +
        `AGPL-3.0 (LICENSE attached). Source: https://github.com/${UPSTREAM} (the ${version} tag).`,
      "--latest=false",
    ], { cwd: root });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`published ${tag}; gifski.json now pins ${version}. Next: npm install && npm run smoke -- <label> --only gif`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
