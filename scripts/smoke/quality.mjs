// Encode loss: each tool's output scored (SSIM, PSNR) against a lossless FFV1
// render of the same pictures, or against its input when the tool copied
// instead of encoding. Nothing here asks for loss, so quality is 100 throughout.
import fs from "node:fs";
import path from "node:path";
import { ENCODERS } from "../../api/_lib/encode/index.ts";
import { graphArgs } from "../../api/_lib/encode/render.ts";
import { CONCURRENCY, pool } from "./mark.mjs";

// Worst frame of any step.
const MIN_SSIM = 0.95;
const MIN_PSNR = 35;

// Multi-step cases are round trips: the last output is also scored against the source.
const CASES = {
  "speed-1x": [["speed", { speed: 0 }]],
  "speed-2x": [["speed", { speed: 1 }]],
  "loop-copy": [["loop", { technique: "crossfade", fadeDuration: 0 }]],
  "loop-reverse": [["loop", { technique: "reverse" }]],
  "loop-crossfade": [["loop", { technique: "crossfade" }]],
  mark: [["mark", { filter: "plain", quality: 100 }]],
  "webm-and-back": [
    ["convert", { target: "webm", quality: 100 }],
    ["convert", { target: "mp4", quality: 100 }],
  ],
};

export async function encodeLoss({ ff, assets, outDir, runTool, say }) {
  const { quality, vectors } = assets;
  const encoders = { ...ENCODERS };
  for (const [format, encode] of Object.entries(encoders)) {
    ENCODERS[format] = async (ff, render, target) => {
      const reference = path.join(path.dirname(target.outputFile), "reference.mkv");
      await ff.runFFmpeg([...graphArgs(render, [], "gbrp"), "-an", "-c:v", "ffv1", reference]);
      return encode(ff, render, target);
    };
  }
  const runs = Object.entries(CASES).flatMap(([name, steps]) =>
    quality.map((source) => ({ name, steps, source })),
  );
  let rows;
  try {
    rows = await pool(runs, CONCURRENCY, async ({ name, steps, source }) => {
      const clip = path.parse(source).name;
      let input = source;
      const scores = [];
      for (const [i, [tool, options]] of steps.entries()) {
        const workDir = path.join(outDir, name, clip, String(i));
        const files = tool === "mark" ? [input, vectors[0]] : [input];
        const { outputPath } = await runTool(tool, files, options, workDir);
        const reference = path.join(workDir, "reference.mkv");
        const against = fs.existsSync(reference) ? reference : input;
        scores.push([
          steps.length > 1 ? `${name} ${i + 1}` : name,
          await score(ff, outputPath, against),
        ]);
        fs.rmSync(reference, { force: true });
        input = outputPath;
      }
      if (steps.length > 1) scores.push([`${name} src`, await score(ff, input, source)]);
      return scores.map(([label, { ssim, psnr }]) => {
        const failed = ssim.min < MIN_SSIM || psnr.min < MIN_PSNR;
        const row =
          `${failed ? "FAIL" : "ok  "} ${label.padEnd(17)} ${clip.padEnd(15)}` +
          ` SSIM ${ssim.mean.toFixed(4)} (min ${ssim.min.toFixed(4)})` +
          `  PSNR ${psnr.mean.toFixed(1)} (min ${psnr.min.toFixed(1)})`;
        say(row);
        return row;
      });
    });
  } finally {
    Object.assign(ENCODERS, encoders);
  }
  rows = rows.flat();
  const report = path.join(outDir, "quality.txt");
  fs.writeFileSync(report, rows.join("\n"));
  const failures = rows.filter((row) => row.startsWith("FAIL")).length;
  if (failures) throw new Error(`${failures} below the floor, see ${report}`);
  return report;
}

// Per-frame scores over RGB, paired by frame index, with the reference fitted to the output's size.
async function score(ff, output, reference) {
  const { width, height } = await ff.mediaInfo(output);
  const fit = `settb=1,setpts=N,scale=${width}:${height}:flags=lanczos,format=gbrp,split`;
  const stats = await ff.runFFmpeg([
    "-i",
    output,
    "-i",
    reference,
    "-filter_complex",
    `[0:v]${fit}[a][b];[1:v]${fit}[c][d];[a][c]ssim=f=-;[b][d]psnr=f=-`,
    "-f",
    "null",
    "-",
  ]);
  const frames = (key) =>
    [...stats.matchAll(new RegExp(`${key}:(\\S+)`, "g"))].map(([, v]) =>
      v === "inf" ? Infinity : Number(v),
    );
  const summary = (values) => ({
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    min: Math.min(...values),
  });
  return { ssim: summary(frames("All")), psnr: summary(frames("psnr_avg")) };
}
