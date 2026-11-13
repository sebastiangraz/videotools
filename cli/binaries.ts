// The pinned ffmpeg and gifski for native runs, fetched into the user's cache
// on first use. Each platform's binary is gzipped, unmodified, in this repo's
// <tool>-<version> release; sha256 is the unpacked binary's.
//
// To upgrade (rare): gzip each platform's new binary, `gh release create
// <tool>-<version>` with the .gz files attached, update the entry below, then
// `bun run smoke <name>`.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
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
  // (gifski-1.34.0.tar.xz); the macOS binary is universal. Windows is built from
  // that tag, as the release's exe needs the VC++ runtime. Only vcruntime is static:
  // a static UCRT doubles the encode time. In rust:1-slim-bookworm with clang, lld,
  // llvm and cargo-xwin, RUSTFLAGS="-C target-feature=+crt-static" cargo xwin rustc
  // --release --locked --target x86_64-pc-windows-msvc --bin gifski --
  // -C link-arg=/NODEFAULTLIB:libucrt.lib -C link-arg=ucrt.lib
  gifski: {
    version: "1.34.0",
    platforms: {
      "win32-x64": {
        url: release("gifski-1.34.0", "gifski-win32-x64-hybrid.gz"),
        sha256: "92848333da77d4a00f61b141451b0ee1426d70ca6b61e5e71d4acf3a76ec1bfd",
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

// One folder per pinned binary, shared by every checkout and install. Its name
// ends in the start of the pin's sha256, so a binary in it is a verified one.
export const binaryPath = (tool: Tool): string =>
  path.join(
    os.homedir(),
    ".videotools",
    `${tool}-${BINARIES[tool].version}-${BINARIES[tool].platforms[hostPlatform].sha256.slice(0, 8)}`,
    process.platform === "win32" ? `${tool}.exe` : tool,
  );

// resvg's WebAssembly comes from its package, a dependency kept out of the bundle.
export const resvgUrl = import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm");

export async function install(tool: Tool): Promise<void> {
  const { version, platforms } = BINARIES[tool];
  const pinned = platforms[hostPlatform];
  if (!pinned) {
    throw new Error(
      `no ${tool} pinned for ${hostPlatform} (only ${Object.keys(platforms).join(", ")})`,
    );
  }

  const binary = binaryPath(tool);
  if (fs.existsSync(binary)) return;

  process.stdout.write(`fetching ${tool} ${version} from ${pinned.url}\n`);
  const res = await fetch(pinned.url);
  if (!res.ok || !res.body) throw new Error(`${pinned.url}: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  // Hashed while streaming into a temporary name, so an interrupted or
  // tampered download never sits where binaryPath points.
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
}
