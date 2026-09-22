// Pins a new ffmpeg: takes the win64 and linux64 GPL builds of one ffmpeg
// release branch from BtbN/FFmpeg-Builds (one recipe for both platforms, so
// the same version, configure flags and library versions), copies the
// ffmpeg binary out of each into a release on this repo (BtbN prunes old
// builds; ours stay) and rewrites ffmpeg.json to point at them.
//
//   npm run ffmpeg:mirror -- 8.1            newest 8.1.x build
//   npm run ffmpeg:mirror -- 9.0 --from autobuild-2026-09-22-13-18
//                                           that BtbN release, not "latest"
//   npm run ffmpeg:mirror -- 8.1 --dry-run  fetch and hash, publish nothing
//
// Needs the gh CLI, logged in with write access to this repo. Then run
// `npm install` (fetches the new binary) and `npm run smoke` before
// committing ffmpeg.json.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "ffmpeg.json");
const UPSTREAM = "BtbN/FFmpeg-Builds";
// Where each platform's build comes from: BtbN's name for it, and the binary
// inside its archive.
const PLATFORMS = {
  "win32-x64": { btbn: "win64", bin: "ffmpeg.exe" },
  "linux-x64": { btbn: "linux64", bin: "ffmpeg" },
};

const argv = process.argv.slice(2);
const branch = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--from");
const fromAt = argv.indexOf("--from");
const from = fromAt === -1 ? newestAutobuild() : argv[fromAt + 1];
const dryRun = argv.includes("--dry-run");
if (!branch || !/^\d+\.\d+$/.test(branch) || !from) {
  console.error("usage: npm run ffmpeg:mirror -- <major.minor> [--from <btbn release tag>] [--dry-run]");
  process.exit(2);
}

function gh(args, options = {}) {
  const r = spawnSync("gh", args, { encoding: "utf8", ...options });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")}\n${r.stderr}`);
  return r.stdout;
}

// BtbN's "latest" release names its files by branch only (n8.1-latest), so
// take the newest dated one, whose files carry the exact version.
function newestAutobuild() {
  const tags = JSON.parse(gh(["release", "list", "-R", UPSTREAM, "-L", "10", "--json", "tagName"]));
  const tag = tags.map((t) => t.tagName).find((t) => t.startsWith("autobuild-"));
  if (!tag) throw new Error(`no autobuild-* release among ${UPSTREAM}'s newest`);
  return tag;
}

const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

// Windows' own tar (bsdtar) reads both .zip and .tar.xz; Git's GNU tar on
// the PATH reads neither zip nor, without xz installed, .tar.xz.
const tar = process.platform === "win32"
  ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
  : "tar";

const release = JSON.parse(
  gh(["release", "view", from, "-R", UPSTREAM, "--json", "tagName,assets"]),
);
// e.g. ffmpeg-n8.1.3-win64-gpl-8.1.zip, or a branch head between point
// releases: ffmpeg-n9.0.2-3-ga5923073bf-linux64-gpl-9.0.tar.xz
const assetFor = (btbn) => {
  const re = new RegExp(
    `^ffmpeg-n([\\d.]+(?:-\\d+-g[0-9a-f]+)?)-${btbn}-gpl-${branch.replace(".", "\\.")}\\.(zip|tar\\.xz)$`,
  );
  const asset = release.assets.find((a) => re.test(a.name));
  if (!asset) throw new Error(`${UPSTREAM} ${release.tagName} has no ${btbn}-gpl build of ${branch}`);
  return { ...asset, version: re.exec(asset.name)[1] };
};
const picked = Object.fromEntries(
  Object.entries(PLATFORMS).map(([key, p]) => [key, assetFor(p.btbn)]),
);
const versions = new Set(Object.values(picked).map((a) => a.version));
if (versions.size !== 1) {
  throw new Error(`the platforms' builds differ in version: ${[...versions].join(" vs ")}`);
}
const [version] = versions;
const tag = `ffmpeg-${version}`;
console.log(`${UPSTREAM} ${release.tagName}: ffmpeg ${version}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-mirror-"));
const platforms = {};
const uploads = [];
try {
  for (const [key, { bin }] of Object.entries(PLATFORMS)) {
    const asset = picked[key];
    const archive = path.join(work, asset.name);
    console.log(`downloading ${asset.name} (${(asset.size / 1e6).toFixed(0)} MB)`);
    await download(asset.url, archive);

    const member = `${asset.name.replace(/\.(zip|tar\.xz)$/, "")}/bin/${bin}`;
    const out = path.join(work, key);
    fs.mkdirSync(out);
    const x = spawnSync(tar, ["-xf", archive, "-C", out, member], { encoding: "utf8" });
    if (x.status !== 0) throw new Error(`extracting ${member}: ${x.stderr}`);
    const binary = path.join(out, member);

    const gz = path.join(work, `ffmpeg-${key}.gz`);
    await pipeline(fs.createReadStream(binary), zlib.createGzip({ level: 9 }), fs.createWriteStream(gz));
    uploads.push(gz);
    platforms[key] = {
      url: `https://github.com/sebastiangraz/videotools/releases/download/${tag}/${path.basename(gz)}`,
      sha256: await sha256(gz),
      binarySha256: await sha256(binary),
      bin,
    };
    console.log(
      `  ${bin}: ${(fs.statSync(binary).size / 1e6).toFixed(0)} MB, ` +
        `${(fs.statSync(gz).size / 1e6).toFixed(0)} MB gzipped`,
    );
  }

  const manifest = {
    version,
    source: `${UPSTREAM} ${release.tagName}: ${Object.values(picked).map((a) => a.name).join(", ")}`,
    platforms,
  };
  if (dryRun) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    const exists = spawnSync("gh", ["release", "view", tag], { encoding: "utf8" }).status === 0;
    if (exists) throw new Error(`release ${tag} already exists; delete it first to re-mirror`);
    gh([
      "release", "create", tag, ...uploads,
      "--title", `ffmpeg ${version}`,
      "--notes",
      `ffmpeg binaries pinned by ffmpeg.json, unmodified from ${manifest.source}.\n\n` +
        `GPL builds. Source: https://github.com/FFmpeg/FFmpeg (the n${version.replace(/-\d+-g.*/, "")} tag) ` +
        `and the build recipe at https://github.com/${UPSTREAM}.`,
      "--latest=false",
    ], { cwd: root });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`published ${tag}; ffmpeg.json now pins ${version}. Next: npm install && npm run smoke -- <label>`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
