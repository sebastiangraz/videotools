// Pins a new ffmpeg: BtbN's win64/linux64 GPL builds of one branch plus Riedl's
// macOS build of the same version, mirrored into a release here (upstreams prune).
//
//   npm run ffmpeg:mirror -- 8.1            newest 8.1.x build
//   npm run ffmpeg:mirror -- 9.0 --from autobuild-2026-09-22-13-18
//                                           that BtbN release, not "latest"
//   npm run ffmpeg:mirror -- 8.1 --dry-run  fetch and hash, publish nothing
//
// If ffmpeg.json already pins this branch but lacks some platforms, only those
// are added to the existing release. Needs gh with write access to this repo.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { gh, pack, publish, readManifest, sha256, tar } from "./binaries.mjs";

const UPSTREAM = "BtbN/FFmpeg-Builds";
const RIEDL = "https://ffmpeg.martin-riedl.de";
const PLATFORMS = {
  "win32-x64": { btbn: "win64", bin: "ffmpeg.exe" },
  "linux-x64": { btbn: "linux64", bin: "ffmpeg" },
  "darwin-arm64": { riedl: "arm64", bin: "ffmpeg" },
  "darwin-x64": { riedl: "amd64", bin: "ffmpeg" },
};

const argv = process.argv.slice(2);
const branch = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--from");
const fromAt = argv.indexOf("--from");
const dryRun = argv.includes("--dry-run");
if (!branch || !/^\d+\.\d+$/.test(branch) || (fromAt !== -1 && !argv[fromAt + 1])) {
  console.error("usage: npm run ffmpeg:mirror -- <major.minor> [--from <btbn release tag>] [--dry-run]");
  process.exit(2);
}

// BtbN's "latest" release names its files by branch only (n8.1-latest), so
// take the newest dated one, whose files carry the exact version.
function newestAutobuild() {
  const tags = JSON.parse(gh(["release", "list", "-R", UPSTREAM, "-L", "10", "--json", "tagName"]));
  const tag = tags.map((t) => t.tagName).find((t) => t.startsWith("autobuild-"));
  if (!tag) throw new Error(`no autobuild-* release among ${UPSTREAM}'s newest`);
  return tag;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
}

const pinned = readManifest("ffmpeg");
const filling =
  pinned.version.startsWith(`${branch}.`) &&
  Object.keys(PLATFORMS).some((key) => !pinned.platforms[key]);
const wanted = Object.entries(PLATFORMS).filter(([key]) => !(filling && pinned.platforms[key]));

// e.g. ffmpeg-n8.1.3-win64-gpl-8.1.zip, or a branch head between point
// releases: ffmpeg-n9.0.2-3-ga5923073bf-linux64-gpl-9.0.tar.xz
function btbnAssets(platforms) {
  if (!platforms.length) return [];
  const from = fromAt === -1 ? newestAutobuild() : argv[fromAt + 1];
  const release = JSON.parse(
    gh(["release", "view", from, "-R", UPSTREAM, "--json", "tagName,assets"]),
  );
  return platforms.map(([key, { btbn }]) => {
    const re = new RegExp(
      `^ffmpeg-n([\\d.]+(?:-\\d+-g[0-9a-f]+)?)-${btbn}-gpl-${branch.replace(".", "\\.")}\\.(zip|tar\\.xz)$`,
    );
    const asset = release.assets.find((a) => re.test(a.name));
    if (!asset) throw new Error(`${UPSTREAM} ${release.tagName} has no ${btbn}-gpl build of ${branch}`);
    return [key, {
      name: asset.name,
      url: asset.url,
      source: `${UPSTREAM} ${release.tagName}: ${asset.name}`,
      member: `${asset.name.replace(/\.(zip|tar\.xz)$/, "")}/bin/${PLATFORMS[key].bin}`,
      version: re.exec(asset.name)[1],
    }];
  });
}

// Riedl builds point releases only (/download/macos/<arch>/<unixtime>_<version>/,
// newest listed on the front page), so a --from pointing at a BtbN branch head fails here.
let riedlPage;
async function riedlAsset([key, { riedl }], version) {
  riedlPage ??= await (await fetch(RIEDL)).text();
  const re = new RegExp(`/download/macos/${riedl}/\\d+_${version.replaceAll(".", "\\.")}/ffmpeg\\.zip`);
  const found = re.exec(riedlPage)?.[0];
  if (!found) throw new Error(`${RIEDL} lists no macOS ${riedl} release build of ffmpeg ${version}`);
  const url = `${RIEDL}${found}`;
  const res = await fetch(`${url}.sha256`);
  if (!res.ok) throw new Error(`${url}.sha256: HTTP ${res.status}`);
  return [key, {
    name: `ffmpeg-${version}-macos-${riedl}.zip`,
    url,
    sha256: (await res.text()).trim().split(/\s+/)[0],
    source: url,
    member: PLATFORMS[key].bin,
    version,
  }];
}

const fromBtbn = btbnAssets(wanted.filter(([, p]) => p.btbn));
const version = filling ? pinned.version : fromBtbn[0]?.[1].version;
const picked = Object.fromEntries([
  ...fromBtbn,
  ...(await Promise.all(wanted.filter(([, p]) => p.riedl).map((p) => riedlAsset(p, version)))),
]);
const versions = new Set(Object.values(picked).map((a) => a.version));
if (versions.size !== 1 || !versions.has(version)) {
  throw new Error(`the platforms' builds differ in version: ${[version, ...versions].join(" vs ")}`);
}
const tag = `ffmpeg-${version}`;
console.log(
  filling
    ? `adding ${Object.keys(picked).join(", ")} to the pinned ffmpeg ${version}`
    : `ffmpeg ${version}`,
);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-mirror-"));
const platforms = {};
const uploads = [];
try {
  for (const [key, asset] of Object.entries(picked)) {
    const archive = path.join(work, asset.name);
    console.log(`downloading ${asset.name}`);
    await download(asset.url, archive);
    if (asset.sha256 && (await sha256(archive)) !== asset.sha256) {
      throw new Error(`${asset.url}: sha256 differs from the one published beside it`);
    }

    const out = path.join(work, key);
    fs.mkdirSync(out);
    const x = spawnSync(tar, ["-xf", archive, "-C", out, asset.member], { encoding: "utf8" });
    if (x.status !== 0) throw new Error(`extracting ${asset.member}: ${x.stderr}`);

    const gz = path.join(work, `ffmpeg-${key}.gz`);
    uploads.push(gz);
    platforms[key] = await pack(path.join(out, asset.member), gz, tag, PLATFORMS[key].bin);
  }

  const sources = Object.values(picked).map((a) => a.source);
  const manifest = filling
    ? {
        version,
        sources: [...pinned.sources, ...sources],
        platforms: { ...pinned.platforms, ...platforms },
      }
    : { version, sources, platforms };
  publish("ffmpeg", manifest, {
    tag,
    uploads,
    dryRun,
    added: filling ? Object.keys(platforms) : undefined,
    notes:
      `ffmpeg binaries pinned by ffmpeg.json, unmodified from:\n\n${sources.map((s) => `- ${s}`).join("\n")}\n\n` +
      `GPL builds. Source: https://github.com/FFmpeg/FFmpeg (the n${version.replace(/-\d+-g.*/, "")} tag), ` +
      `the build recipes at https://github.com/${UPSTREAM} and the one behind ${RIEDL}.`,
    next: "npm install && npm run smoke -- <label>",
  });
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
