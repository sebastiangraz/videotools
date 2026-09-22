import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// ffmpeg-static is CommonJS (`module.exports = path | null`) but its .d.ts says
// `export default`, so under NodeNext TypeScript types the default import as
// the module namespace. At runtime Node hands ESM importers the string itself.
const maybeFfmpegPath = ffmpegStatic as unknown as string | null;
if (!maybeFfmpegPath) {
  throw new Error("ffmpeg-static has no ffmpeg binary for this platform");
}
export const ffmpegPath: string = maybeFfmpegPath;

// Vendored gifski CLI (see api/_bin/gifski/README.md). The linux binary is
// static-pie linked, so it runs on the function runtime as-is; the exec bit
// is restored at spawn time (FFmpeg.runGifski in ffmpeg.ts).
export const gifskiPath: string = path.join(
  process.cwd(),
  "api",
  "_bin",
  "gifski",
  process.platform === "win32" ? "win" : "linux",
  process.platform === "win32" ? "gifski.exe" : "gifski",
);
