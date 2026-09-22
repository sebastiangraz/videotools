import fs from "node:fs";
import path from "node:path";

const platformDir = process.platform === "win32" ? "win" : "linux";

// The ffmpeg that ffmpeg.json pins, one version on every platform, fetched
// by the postinstall (scripts/ffmpeg-install.mjs). FFMPEG_BIN points
// elsewhere, e.g. at another version to compare against.
const pinnedFfmpeg = path.join(
  process.cwd(),
  "api",
  "_bin",
  "ffmpeg",
  `${process.platform}-${process.arch}`,
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
export const ffmpegPath: string = process.env.FFMPEG_BIN || pinnedFfmpeg;
if (!fs.existsSync(ffmpegPath)) {
  throw new Error(
    `No ffmpeg at ${ffmpegPath}; run \`node scripts/ffmpeg-install.mjs\` (npm install does)`,
  );
}

// Vendored gifski CLI (see api/_bin/gifski/README.md). The linux binary is
// static-pie linked, so it runs on the function runtime as-is; the exec bit
// is restored at spawn time (FFmpeg.runGifski in ffmpeg.ts).
export const gifskiPath: string = path.join(
  process.cwd(),
  "api",
  "_bin",
  "gifski",
  platformDir,
  process.platform === "win32" ? "gifski.exe" : "gifski",
);
