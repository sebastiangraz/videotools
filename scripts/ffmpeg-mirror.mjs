// Pins a new ffmpeg: takes the win64 and linux64 GPL builds of one ffmpeg
// release branch from BtbN/FFmpeg-Builds (one recipe for both platforms, so
// the same version, configure flags and library versions), plus the macOS
// release build of that same version from Martin Riedl's static builds
// (BtbN builds no macOS; Homebrew's ffmpeg has no libaom or libwebp), copies
// the ffmpeg binary out of each into a release on this repo (upstreams prune
// old builds; ours stay) and rewrites ffmpeg.json to point at them.
//
//   npm run ffmpeg:mirror -- 8.1            newest 8.1.x build
//   npm run ffmpeg:mirror -- 9.0 --from autobuild-2026-09-22-13-18
//                                           that BtbN release, not "latest"
//   npm run ffmpeg:mirror -- 8.1 --dry-run  fetch and hash, publish nothing
//
// When ffmpeg.json already pins a <major.minor> build that lacks some of the
// platforms below, it adds just those to the existing release and leaves the
// pinned ones as they are.
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
const RIEDL = "https://ffmpeg.martin-riedl.de";
// Where each platform's build comes from: BtbN's or Riedl's name for it, and
// the binary inside its archive.
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

// A pinned build of this branch that some platforms are missing from gets
// just those added; otherwise every platform is mirrored afresh.
const pinned = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
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

// Riedl builds releases only, each under /download/macos/<arch>/<unix
// time>_<version>/, and lists the newest on the front page. There's no
// branch head to match, so a BtbN branch head fails here: pick a --from
// whose builds are a point release.
let riedlPage;
async function riedlAsset([key, { riedl }], version) {
  riedlPage ??= await (await fetch(RIEDL)).text();
  const re = new RegExp(`/download/macos/${riedl}/\\d+_${version.replaceAll(".", "\\.")}/ffmpeg\\.zip`);
  const found = re.exec(riedlPage)?.[0];
  if (!found) throw new Error(`${RIEDL} lists no macOS ${riedl} release build of ffmpeg ${version}`);
  const url = `${RIEDL}${found}`;
  // Riedl publishes the zip's hash beside it; check what we mirror against it.
  const res = await fetch(`${url}.sha256`);
  if (!res.ok) throw new Error(`${url}.sha256: HTTP ${res.status}`);
  const sha256 = (await res.text()).trim().split(/\s+/)[0];
  return [key, {
    name: `ffmpeg-${version}-macos-${riedl}.zip`,
    url,
    sha256,
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
    const { bin } = PLATFORMS[key];
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
    const binary = path.join(out, asset.member);

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

  const sources = Object.values(picked).map((a) => a.source);
  const manifest = filling
    ? {
        version,
        sources: [...(pinned.sources ?? [pinned.source]), ...sources],
        platforms: { ...pinned.platforms, ...platforms },
      }
    : { version, sources, platforms };
  if (dryRun) {
    console.log(JSON.stringify(manifest, null, 2));
  } else if (filling) {
    gh(["release", "upload", tag, ...uploads], { cwd: root });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`added ${Object.keys(platforms).join(", ")} to ${tag}. Next: npm install && npm run smoke -- <label>`);
  } else {
    const exists = spawnSync("gh", ["release", "view", tag], { encoding: "utf8" }).status === 0;
    if (exists) throw new Error(`release ${tag} already exists; delete it first to re-mirror`);
    gh([
      "release", "create", tag, ...uploads,
      "--title", `ffmpeg ${version}`,
      "--notes",
      `ffmpeg binaries pinned by ffmpeg.json, unmodified from:\n\n${sources.map((s) => `- ${s}`).join("\n")}\n\n` +
        `GPL builds. Source: https://github.com/FFmpeg/FFmpeg (the n${version.replace(/-\d+-g.*/, "")} tag), ` +
        `the build recipes at https://github.com/${UPSTREAM} and the one behind ${RIEDL}.`,
      "--latest=false",
    ], { cwd: root });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`published ${tag}; ffmpeg.json now pins ${version}. Next: npm install && npm run smoke -- <label>`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
