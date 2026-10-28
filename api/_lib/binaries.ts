// The pinned ffmpeg and gifski. Each platform's binary is gzipped, unmodified,
// in this repo's <tool>-<version> release; sha256 is the unpacked binary's.
// `bun install` fetches the host's (postinstall), the engine does on start.
//
//   BIN_PLATFORM=linux-x64 bun api/_lib/binaries.ts
//                         another platform's binaries (to inspect them; the
//                         app only uses the host's)
//
// To upgrade (rare): gzip each platform's new binary, `gh release create
// <tool>-<version>` with the .gz files attached, update the entry below, then
// `bun install` and `bun run smoke`.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

type Tool = "ffmpeg" | "gifski";
type Pin = { url: string; sha256: string };

const release = (tag: string, file: string) =>
  `https://github.com/sebastiangraz/videotools/releases/download/${tag}/${file}`;

export const BINARIES: Record<Tool, { version: string; platforms: Record<string, Pin> }> = {
  // GPL builds of the n9.0.2 tag (https://github.com/FFmpeg/FFmpeg): BtbN/FFmpeg-Builds
  // autobuild-2026-09-19-13-11 for Windows and Linux, ffmpeg.martin-riedl.de 9.0.2 for macOS.
  ffmpeg: {
    version: "9.0.2",
    platforms: {
      "win32-x64": {
        url: release("ffmpeg-9.0.2", "ffmpeg-win32-x64.gz"),
        sha256: "c0206dea70e1dd0e759ebbc61fc826834a943cd9c93c7c094c529b685f0b8f67",
      },
      "linux-x64": {
        url: release("ffmpeg-9.0.2", "ffmpeg-linux-x64.gz"),
        sha256: "a4ffb15bfd918552ecac91353a87d777175d820a6ac4aa4898dfaf9c90bed704",
      },
      "darwin-arm64": {
        url: release("ffmpeg-9.0.2", "ffmpeg-darwin-arm64.gz"),
        sha256: "2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384",
      },
      "darwin-x64": {
        url: release("ffmpeg-9.0.2", "ffmpeg-darwin-x64.gz"),
        sha256: "b25689cf2211c0582d317e849912769a1f1c93904fe102c485b5364a425633d1",
      },
    },
  },
  // AGPL-3.0, from https://github.com/ImageOptim/gifski/releases/tag/1.34.0
  // (gifski-1.34.0.tar.xz); the macOS binary is universal.
  gifski: {
    version: "1.34.0",
    platforms: {
      "win32-x64": {
        url: release("gifski-1.34.0", "gifski-win32-x64.gz"),
        sha256: "9da8553cbe71c0facf544634b4e377262ea30d34becdc0ca077306342e776295",
      },
      "linux-x64": {
        url: release("gifski-1.34.0", "gifski-linux-x64.gz"),
        sha256: "937ebdad4ec80c7ef647bc838083fd3948f92d6af206cf341724501eb640b8f7",
      },
      "darwin-arm64": {
        url: release("gifski-1.34.0", "gifski-darwin.gz"),
        sha256: "f5f73e09fba870a21e8c502f3191e58633e5081b1914f71e32d5ee714450e839",
      },
      "darwin-x64": {
        url: release("gifski-1.34.0", "gifski-darwin.gz"),
        sha256: "f5f73e09fba870a21e8c502f3191e58633e5081b1914f71e32d5ee714450e839",
      },
    },
  },
};

const hostPlatform = `${process.platform}-${process.arch}`;

// Under the working directory: the repo, or the engine's install folder.
export const binaryPath = (tool: Tool, key = hostPlatform): string =>
  path.join(
    process.cwd(),
    "api",
    "_bin",
    tool,
    key,
    key.startsWith("win32-") ? `${tool}.exe` : tool,
  );

// FFMPEG_BIN overrides, e.g. to compare another version.
export const ffmpegPath: string = process.env.FFMPEG_BIN || binaryPath("ffmpeg");
export const gifskiPath: string = binaryPath("gifski");

export async function install(tool: Tool, key = hostPlatform): Promise<void> {
  const { version, platforms } = BINARIES[tool];
  const pinned = platforms[key];
  if (!pinned) {
    // Not fatal, so the rest of the install goes through; point FFMPEG_BIN
    // at an ffmpeg of the pinned version to run the tools here.
    console.warn(`no ${tool} pinned for ${key} (only ${Object.keys(platforms).join(", ")})`);
    return;
  }

  const binary = binaryPath(tool, key);
  const dir = path.dirname(binary);
  const stamp = path.join(dir, ".sha256");
  const current =
    fs.existsSync(binary) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim();
  if (current === pinned.sha256) {
    console.log(`${tool} ${version} (${key}) already installed`);
    return;
  }

  console.log(`fetching ${tool} ${version} (${key}) from ${pinned.url}`);
  const res = await fetch(pinned.url);
  if (!res.ok || !res.body) throw new Error(`${pinned.url}: HTTP ${res.status}`);
  fs.mkdirSync(dir, { recursive: true });
  // Hashed while streaming into a temporary name, so an interrupted or
  // tampered download never sits where ffmpegPath/gifskiPath point.
  const partial = `${binary}.partial`;
  const hash = createHash("sha256");
  await pipeline(
    res.body,
    zlib.createGunzip(),
    async function* (source: AsyncIterable<Buffer>) {
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
      `${pinned.url}: sha256 of the binary is ${got}, BINARIES pins ${pinned.sha256}`,
    );
  }
  fs.renameSync(partial, binary);
  fs.chmodSync(binary, 0o755);
  fs.writeFileSync(stamp, pinned.sha256 + "\n");
  console.log(`installed ${tool} ${version} at ${binary}`);
}

// The postinstall. Vercel only builds the static client.
if (import.meta.main && !process.env.VERCEL) {
  const key = process.env.BIN_PLATFORM ?? hostPlatform;
  await install("ffmpeg", key);
  await install("gifski", key);
}
