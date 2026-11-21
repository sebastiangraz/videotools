// Header icon clips: every file in assets/, cropped to ICON.clip at ICON.fps,
// as AVIF into client/src/icons/, where the icons (<tool>.ts) import them.
//
//   bun run icons
import fs from "node:fs";
import path from "node:path";
import { FFmpeg } from "@videotools/core/ffmpeg";
import { STILLS } from "@videotools/core/formats";
import { binaryPath, install } from "../../cli/binaries.js";
import { execBinary } from "../../cli/exec.js";
import { formatBytes } from "../../client/src/helpers.js";
import { ICON } from "../../client/src/tools.js";

const dir = import.meta.dirname;
const root = path.join(dir, "..", "..");
const [width, height] = ICON.clip;

await install("ffmpeg");
const ff = new FFmpeg(binaryPath("ffmpeg"), "", "", execBinary);
// The runner logs every command; only the sizes matter here.
console.log = () => {};

for (const file of fs.readdirSync(path.join(dir, "assets"))) {
  const { name, ext } = path.parse(file);
  const avif = path.join(root, "client", "src", "icons", `${name}.avif`);
  await ff.runFFmpeg([
    "-y",
    "-i",
    path.join(dir, "assets", file),
    "-vf",
    `fps=${ICON.fps},scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`,
    // A still stays one frame, which fps would repeat.
    ...(STILLS.some((still) => still.extensions.includes(ext.slice(1))) ? ["-frames:v", "1"] : []),
    "-c:v",
    "libaom-av1",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    avif,
  ]);
  process.stdout.write(`${path.relative(root, avif)}  ${formatBytes(fs.statSync(avif).size)}\n`);
}
