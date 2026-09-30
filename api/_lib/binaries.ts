import fs from "node:fs";
import path from "node:path";

// Installed by scripts/binaries-install.mjs from <tool>.json.
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
      `No ${tool} at ${file}; run \`bun scripts/binaries-install.mjs\` (bun install does)`,
    );
  }
  return file;
};

// FFMPEG_BIN overrides, e.g. to compare another version.
export const ffmpegPath: string = required("ffmpeg", process.env.FFMPEG_BIN || pinned("ffmpeg"));

// The linux build is static-pie, so it runs on the function runtime as-is.
export const gifskiPath: string = required("gifski", pinned("gifski"));
