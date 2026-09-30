// Shared by the binary mirror, install and check scripts.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const hostPlatform = `${process.platform}-${process.arch}`;

const manifestPath = (tool) => path.join(root, `${tool}.json`);
export const readManifest = (tool) => JSON.parse(fs.readFileSync(manifestPath(tool), "utf8"));
export const writeManifest = (tool, manifest) =>
  fs.writeFileSync(manifestPath(tool), JSON.stringify(manifest, null, 2) + "\n");

// Must match api/_lib/binaries.ts, which finds the binary here at runtime.
export const binaryPath = (tool, key = hostPlatform) =>
  path.join(root, "api", "_bin", tool, key, key.startsWith("win32-") ? `${tool}.exe` : tool);

export function gh(args, options = {}) {
  const r = spawnSync("gh", args, { encoding: "utf8", ...options });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")}\n${r.stderr}`);
  return r.stdout;
}

// Windows' own tar (bsdtar) reads both .zip and .tar.xz; Git's GNU tar on
// the PATH reads neither zip nor, without xz installed, .tar.xz.
export const tar = process.platform === "win32"
  ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
  : "tar";

export const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });

// Gzips `binary` to `gz` for upload to this repo's release `tag`, and returns
// its manifest entry.
export async function pack(binary, gz, tag, bin) {
  await pipeline(fs.createReadStream(binary), zlib.createGzip({ level: 9 }), fs.createWriteStream(gz));
  console.log(
    `  ${bin}: ${(fs.statSync(binary).size / 1e6).toFixed(1)} MB, ` +
      `${(fs.statSync(gz).size / 1e6).toFixed(1)} MB gzipped`,
  );
  return {
    url: `https://github.com/sebastiangraz/videotools/releases/download/${tag}/${path.basename(gz)}`,
    sha256: await sha256(gz),
    binarySha256: await sha256(binary),
    bin,
  };
}

// Prints the manifest on a dry run. Otherwise uploads to release `tag` (a new
// one, or with `added` the platforms added to an existing one) and rewrites
// <tool>.json.
export function publish(tool, manifest, { tag, uploads, dryRun, added, notes, next }) {
  if (dryRun) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  if (added) {
    gh(["release", "upload", tag, ...uploads], { cwd: root });
  } else {
    const exists = spawnSync("gh", ["release", "view", tag], { cwd: root, encoding: "utf8" }).status === 0;
    if (exists) throw new Error(`release ${tag} already exists; delete it first to re-mirror`);
    gh([
      "release", "create", tag, ...uploads,
      "--title", `${tool} ${manifest.version}`,
      "--notes", notes,
      "--latest=false",
    ], { cwd: root });
  }
  writeManifest(tool, manifest);
  console.log(
    added
      ? `added ${added.join(", ")} to ${tag}. Next: ${next}`
      : `published ${tag}; ${tool}.json now pins ${manifest.version}. Next: ${next}`,
  );
}
