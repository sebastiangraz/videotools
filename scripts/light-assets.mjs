// Writes the light tracker's test clips into scripts/smoke-assets/light/:
//
//   sweep.mp4  one radial gradient crossing from the left edge to the right
//   pair.mp4   two equally bright gradients wandering over the frame, meeting
//              now and then: a tracker must stay on one, not flip between them
//
//   bun scripts/light-assets.mjs [<ffmpeg path>]    default: the pinned one
//
// The paths are fixed sums of sines, so a rerun writes the same pictures.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { binaryPath, root } from "./binaries.mjs";

const ffmpeg = process.argv[2] ?? binaryPath("ffmpeg");
const outDir = path.join(root, "scripts", "smoke-assets", "light");
fs.mkdirSync(outDir, { recursive: true });

const [W, H, FPS] = [640, 360, 30];
// Gradient radius (1/e² falloff) as a fraction of the height.
const RADIUS = 0.22;
const s = (RADIUS * H) / 2;
const glow = (x, y) => `exp(-(pow(X-(${x}),2)+pow(Y-(${y}),2))/${(2 * s * s).toFixed(1)})`;

// Each coordinate wanders between 10% and 90% of its side: two sines of
// unrelated frequencies, so the paths never repeat within a clip.
const wander = (side, [f1, p1, f2, p2]) =>
  `${side}*(0.5+0.24*sin(${f1}*T+${p1})+0.16*sin(${f2}*T+${p2}))`;

const CLIPS = {
  sweep: { seconds: 6, lum: glow(`W*T/6`, "H/2") },
  // max(), not a sum: where they overlap neither gets brighter than the other.
  pair: {
    seconds: 12,
    lum: `max(${glow(wander("W", [0.9, 0, 2.3, 1.1]), wander("H", [1.3, 2, 2.9, 0.4]))},${glow(wander("W", [1.1, 3, 2.1, 4.2]), wander("H", [0.7, 5, 3.1, 2.6]))})`,
  },
};

for (const [name, { seconds, lum }] of Object.entries(CLIPS)) {
  const file = path.join(outDir, `${name}.mp4`);
  const { status, stderr } = spawnSync(ffmpeg, [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=black:s=${W}x${H}:r=${FPS}:d=${seconds},format=gray`,
    "-vf",
    `geq=lum='16+219*${lum}',format=yuv420p`,
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "slow",
    "-movflags",
    "+faststart",
    file,
  ]);
  if (status !== 0) {
    console.error(stderr.toString());
    process.exit(1);
  }
  console.log(`${path.relative(root, file)}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
