import fs from "node:fs";
import path from "node:path";

// Where the postinstall (scripts/binaries-install.mjs) puts the binary that
// <tool>.json pins for this platform.
const pinned = (tool: string): string =>
  path.join(
    process.cwd(),
    "api",
    "_bin",
    tool,
    `${process.platform}-${process.arch}`,
    process.platform === "win32" ? `${tool}.exe` : tool,
  );

const required = (tool: string, file: string): string => {
  if (!fs.existsSync(file)) {
    throw new Error(
      `No ${tool} at ${file}; run \`node scripts/binaries-install.mjs\` (npm install does)`,
    );
  }
  return file;
};

// The ffmpeg that ffmpeg.json pins, one version on every platform.
// FFMPEG_BIN points elsewhere, e.g. at another version to compare against.
export const ffmpegPath: string = required(
  "ffmpeg",
  process.env.FFMPEG_BIN || pinned("ffmpeg"),
);

// The gifski CLI that gifski.json pins (see api/_bin/gifski/README.md). The
// linux binary is static-pie linked, so it runs on the function runtime
// as-is.
export const gifskiPath: string = required("gifski", pinned("gifski"));
