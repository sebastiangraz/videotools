// Runs the light tracker (api/_lib/light-track.ts) on a clip and prints where
// it put the light; with --out, also writes the clip with the tracked point
// boxed, to see it follow (or not).
//
//   bun scripts/light-track.mjs scripts/smoke-assets/light/pair.mp4 --out .smoke/pair-track.mp4
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { binaryPath, root } from "./binaries.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, ffmpeg: { type: "string" } },
});
if (positionals.length !== 1) {
  console.error("Usage: bun scripts/light-track.mjs <video> [--out <mp4>] [--ffmpeg <path>]");
  process.exit(1);
}
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { FFmpeg } = await load("api/_lib/ffmpeg.ts");
const { trackLight } = await load("api/_lib/light-track.ts");

const input = path.resolve(positionals[0]);
const ff = new FFmpeg(values.ffmpeg ?? binaryPath("ffmpeg"), "");
// The runner logs every command; only the result matters here.
console.log = () => {};
const print = (line) => process.stdout.write(`${line}\n`);

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "light-track-"));
try {
  const info = await ff.mediaInfo(input);
  const started = performance.now();
  const track = await trackLight(ff, input, info, workDir);
  const ms = performance.now() - started;
  const { points } = track;
  // Movement per analysed frame: a flip between two lights shows as a run of
  // big steps back and forth.
  const steps = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const diagonal = Math.hypot(info.width, info.height);
  print(`${path.basename(input)}: ${info.width}x${info.height}, ${info.duration.toFixed(2)}s`);
  print(`tracked ${points.length} frames in ${ms.toFixed(0)} ms`);
  print(`largest step ${((100 * Math.max(0, ...steps)) / diagonal).toFixed(1)}% of the diagonal`);
  for (const p of points.filter((_, i) => i % 5 === 0)) {
    print(
      `  ${p.time.toFixed(1).padStart(5)}s  x ${p.x.toFixed(0).padStart(5)}  y ${p.y.toFixed(0).padStart(5)}  strength ${p.strength.toFixed(2)}`,
    );
  }

  if (values.out) {
    // A box at the point, moved by sendcmd at each analysed frame.
    const side = Math.round(Math.min(info.width, info.height) * 0.06);
    const box = (p) => [Math.round(p.x - side / 2), Math.round(p.y - side / 2)];
    const commands = points
      .map(
        (p) => `${p.time.toFixed(3)} drawbox@light x ${box(p)[0]}, drawbox@light y ${box(p)[1]};`,
      )
      .join("\n");
    const cmdFile = path.join(workDir, "light.cmd");
    fs.writeFileSync(cmdFile, commands);
    const [x, y] = box(points[0] ?? { x: 0, y: 0 });
    const filterPath = cmdFile.replace(/\\/g, "/").replace(/:/g, "\\:");
    await ff.runFFmpeg([
      "-y",
      "-i",
      input,
      "-vf",
      `sendcmd=f='${filterPath}',drawbox@light=x=${x}:y=${y}:w=${side}:h=${side}:color=red:t=3`,
      "-c:v",
      "libx264",
      "-crf",
      "20",
      "-an",
      path.resolve(values.out),
    ]);
    print(`wrote ${path.relative(root, path.resolve(values.out))}`);
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
