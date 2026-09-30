// The pinned ffmpeg and gifski, installed by binaries-install.mjs. Each
// platform's binary is gzipped, unmodified, in this repo's <tool>-<version>
// release; sha256 is the unpacked binary's.
//
// To upgrade (rare): gzip each platform's new binary, `gh release create
// <tool>-<version>` with the .gz files attached, update the entry below, then
// `bun install` and `bun run smoke -- <label> --diff <previous label>`.
import path from "node:path";
import { fileURLToPath } from "node:url";

const release = (tag, file) =>
  `https://github.com/sebastiangraz/videotools/releases/download/${tag}/${file}`;

export const BINARIES = {
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

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const hostPlatform = `${process.platform}-${process.arch}`;

// Must match api/_lib/binaries.ts, which finds the binary here at runtime.
export const binaryPath = (tool, key = hostPlatform) =>
  path.join(root, "api", "_bin", tool, key, key.startsWith("win32-") ? `${tool}.exe` : tool);
