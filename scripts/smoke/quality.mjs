// Encode loss: each tool's output scored (SSIM, PSNR, VMAF) against a lossless FFV1
// render of the same pictures, or against its input when the tool copied
// instead of encoding. Nothing here asks for loss, so quality is 100 throughout.
// Mark rows split in two: in (the mark itself) and out (the video around it).
import fs from "node:fs";
import path from "node:path";
import { ENCODERS } from "../../api/_lib/encode/index.ts";
import { graphArgs } from "../../api/_lib/encode/render.ts";
import { CONCURRENCY, pool } from "./mark.mjs";

// Worst frame of any step.
const MIN_SSIM = 0.95;
const MIN_PSNR = 35;
const MIN_VMAF = 90;

const VIDEOS = [
  "bokeh.mp4",
  "gradient.mp4",
  "paint.mp4",
  "radial.mp4",
  "ui.mp4",
  "video.mp4",
  "sweep.mp4",
];

// Multi-step cases are round trips: the last output is also scored against the source.
const CASES = {
  "speed-1x": [["speed", { speed: 0 }]],
  "speed-2x": [["speed", { speed: 1 }]],
  "loop-copy": [["loop", { technique: "crossfade", fadeDuration: 0 }]],
  "loop-reverse": [["loop", { technique: "reverse" }]],
  "loop-crossfade": [["loop", { technique: "crossfade" }]],
  mark: [["mark", { filter: "plain", quality: 100 }]],
  "mark-glass": [["mark", { filter: "glass", size: "dev", position: "center", quality: 100 }]],
  "webm-and-back": [
    ["convert", { target: "webm", quality: 100 }],
    ["convert", { target: "mp4", quality: 100 }],
  ],
};

export async function encodeLoss({ ff, assets, outDir, runTool, say }) {
  const { videos, vectors } = assets;
  const encoders = { ...ENCODERS };
  for (const [format, encode] of Object.entries(encoders)) {
    ENCODERS[format] = async (ff, render, target) => {
      const reference = path.join(path.dirname(target.outputFile), "reference.mkv");
      await ff.runFFmpeg([...graphArgs(render, [], "gbrp"), "-an", "-c:v", "ffv1", reference]);
      return encode(ff, render, target);
    };
  }
  const runs = Object.entries(CASES).flatMap(([name, steps]) =>
    videos(VIDEOS).map((source) => ({ name, steps, source })),
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
        const label = steps.length > 1 ? `${name} ${i + 1}` : name;
        if (tool === "mark") {
          // The mark dilutes in a whole frame, so it is scored within the box
          // of every pixel it changed in any frame, against the marked
          // pictures, and the rest of the frame against the source.
          const paired = "settb=1,setpts=N,format=gray";
          const { stderr } = await ff.run(ff.ffmpeg, [
            "-hide_banner",
            "-i",
            reference,
            "-i",
            input,
            "-filter_complex",
            `[0:v]${paired}[a];[1:v]${paired}[b];[a][b]blend=all_mode=difference,bbox=min_val=0`,
            "-f",
            "null",
            "-",
          ]);
          const boxes = [...stderr.matchAll(/x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/g)];
          if (!boxes.length) throw new Error(`${name} left ${clip} unchanged`);
          const [x1, x2, y1, y2] = [Math.min, Math.max, Math.min, Math.max].map((pick, k) =>
            pick(...boxes.map((box) => Number(box[k + 1]))),
          );
          const [w, h] = [x2 - x1 + 1, y2 - y1 + 1];
          // drawbox lacks gbrp and would score in yuv444p; rgb24 repacks losslessly.
          const blank = `format=rgb24,drawbox=${x1}:${y1}:${w}:${h}:black:fill,format=gbrp`;
          scores.push(
            [`${label} in`, await score(ff, outputPath, reference, `crop=${w}:${h}:${x1}:${y1}`)],
            [`${label} out`, await score(ff, outputPath, input, blank)],
          );
        } else scores.push([label, await score(ff, outputPath, against)]);
        fs.rmSync(reference, { force: true });
        input = outputPath;
      }
      if (steps.length > 1) scores.push([`${name} src`, await score(ff, input, source)]);
      return scores.map(([label, { ssim, psnr, vmaf }]) => {
        const failed = ssim.min < MIN_SSIM || psnr.min < MIN_PSNR || vmaf.min < MIN_VMAF;
        const row =
          `${failed ? "FAIL" : "ok  "} ${label.padEnd(17)} ${clip.padEnd(15)}` +
          ` SSIM ${ssim.mean.toFixed(2)} (min ${ssim.min.toFixed(2)})` +
          `  PSNR ${decibels(psnr.mean)} (min ${decibels(psnr.min)})` +
          `  VMAF ${vmaf.mean.toFixed(1)} (min ${vmaf.min.toFixed(1)})`;
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

const decibels = (value) => (value === Infinity ? "∞" : value.toFixed(1));

// Per-frame scores over RGB (VMAF: luma only), paired by frame index, with the
// reference fitted to the output's size and both then passed through `region`.
async function score(ff, output, reference, region = "null") {
  const { width, height } = await ff.mediaInfo(output);
  const fit = `settb=1,setpts=N,scale=${width}:${height}:flags=lanczos,format=gbrp,${region},split=3`;
  // VMAF logs frames only to a file, and a drive letter's colon breaks the
  // filter's options, hence a relative path from the output's directory.
  const dir = path.dirname(output);
  const stats = await ff.runFFmpeg(
    [
      "-i",
      output,
      "-i",
      reference,
      "-filter_complex",
      `[0:v]${fit}[a][b][c];[1:v]${fit}[d][e][f];[a][d]ssim=f=-;[b][e]psnr=f=-;` +
        `[c][f]libvmaf=log_fmt=json:log_path=vmaf.json`,
      "-f",
      "null",
      "-",
    ],
    { cwd: dir },
  );
  const frames = (key) =>
    [...stats.matchAll(new RegExp(`${key}:(\\S+)`, "g"))].map(([, v]) =>
      v === "inf" ? Infinity : Number(v),
    );
  const summary = (values) => ({
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    min: Math.min(...values),
  });
  return {
    ssim: summary(frames("All")),
    psnr: summary(frames("psnr_avg")),
    vmaf: summary(
      JSON.parse(fs.readFileSync(path.join(dir, "vmaf.json"), "utf8")).frames.map(
        (frame) => frame.metrics.vmaf,
      ),
    ),
  };
}
