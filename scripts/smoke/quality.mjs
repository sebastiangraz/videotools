// Encode loss: each tool's output scored (SSIM, PSNR, VMAF) against a lossless FFV1
// render of the same pictures, or against its input when the tool copied
// instead of encoding. Nothing here asks for loss, so quality is 100 throughout.
// Mark rows split in two: in (the mark itself) and out (the video around it).
// Scores alone would pass a bloated or frame-dropping output, so each step's
// video bitrate is held to its rate cap and its frames to the reference's too.
import fs from "node:fs";
import path from "node:path";
import { ENCODERS } from "../../api/_lib/encode/index.ts";
import { formatBytes } from "../../client/src/helpers.ts";
import { graphArgs } from "../../api/_lib/encode/render.ts";
import { FORMATS, SEQUENCE_FORMATS } from "../../api/_lib/formats.ts";
import { LOOP_LIMITS } from "../../api/_lib/tools/loop.ts";
import { CONCURRENCY, pool } from "./mark.mjs";

// Worst frame of any step.
const MIN_SSIM = 0.95;
const MIN_PSNR = 35;
const MIN_VMAF = 90;
// Over the encoder's rate cap: the buffer lets it run a little past.
const MAX_RATE = 1.15;
// Container durations run a frame or two past the video's.
const MAX_DRIFT = 0.02;
// gifski and libwebp_anim merge repeated frames.
const MERGES_FRAMES = [".gif", ".webp"];

const VIDEOS = [
  "bokeh.mp4",
  "paint.mp4",
  "radial.mp4",
  "ui.mp4",
  "colorrotate.mp4",
  "sweep.mp4",
  "gif.gif",
  "hold.mp4",
  "glow.mp4",
  "caption.mp4",
  "screen.mp4",
];
// Round trips run on one clip only.
const ROUND_TRIP_VIDEOS = ["video.mp4"];
// Sequence runs on opaque stills only.
const SEQUENCE_IMAGES = ["image1.png", "image2.png", "image3.png"];

// Multi-step cases are round trips: the last output is also scored against the source.
const CASES = {
  "speed-1x": [["speed", { speed: 0 }]],
  "speed-2x": [["speed", { speed: 1 }]],
  "loop-copy": [["loop", { technique: "crossfade", fadeDuration: 0 }]],
  "loop-reverse": [["loop", { technique: "reverse" }]],
  "loop-crossfade": [["loop", { technique: "crossfade" }]],
  mark: [["mark", { filter: "plain", quality: 100 }]],
  "mark-glass": [["mark", { filter: "glass", size: "dev", position: "center", quality: 100 }]],
  ...Object.fromEntries(
    SEQUENCE_FORMATS.map((id) => [`sequence-${id}`, [["sequence", { format: id, quality: 100 }]]]),
  ),
  ...Object.fromEntries(
    FORMATS.filter(({ id }) => id !== "mp4").map(({ id }) => [
      `${id}-and-back`,
      [
        ["convert", { target: id, quality: 100 }],
        ["convert", { target: "mp4", quality: 100 }],
      ],
    ]),
  ),
};

export async function encodeLoss({ ff, assets, outDir, runTool, say, progress }) {
  const { images, videos, vectors } = assets;
  const stills = images(SEQUENCE_IMAGES);
  const encoders = { ...ENCODERS };
  // By output file: the duration its render asks for, and its rate cap in kb/s.
  const encoded = new Map();
  for (const [format, encode] of Object.entries(encoders)) {
    ENCODERS[format] = async (ff, render, target) => {
      const reference = path.join(path.dirname(target.outputFile), "reference.mkv");
      await ff.runFFmpeg([...graphArgs(render, [], "gbrp"), "-an", "-c:v", "ffv1", reference]);
      encoded.set(target.outputFile, {
        duration: render.duration,
        maxrate: target.cap?.maxrate,
      });
      return encode(ff, render, target);
    };
  }
  // The reverse cap guards a 2GB function; locally it would only skip clips.
  const limits = { ...LOOP_LIMITS };
  LOOP_LIMITS.maxReverseBytes = Infinity;
  // Sequence takes all its stills at once, its source named after their folder.
  const runs = Object.entries(CASES).flatMap(([name, steps]) => {
    const sources =
      steps[0][0] === "sequence"
        ? [path.dirname(stills[0])]
        : videos(steps.length > 1 ? ROUND_TRIP_VIDEOS : VIDEOS);
    return sources.map((source) => ({ name, steps, source }));
  });
  const tick = progress(runs.reduce((n, { steps }) => n + steps.length, 0));
  const header = columns("", "case", "clip", "SSIM      · PSNR      · VMAF     ", "size", "cap", [
    "problems",
  ]);
  say(header);
  let rows;
  try {
    rows = await pool(runs, CONCURRENCY, async ({ name, steps, source }) => {
      const clip = path.parse(source).name;
      let input = source;
      const scores = [];
      for (const [i, [tool, options]] of steps.entries()) {
        const workDir = path.join(outDir, name, clip, String(i));
        const files = { mark: [input, vectors[0]], sequence: stills }[tool] ?? [input];
        const { outputPath } = await runTool(tool, files, options, workDir);
        const reference = path.join(workDir, "reference.mkv");
        const against = fs.existsSync(reference) ? reference : input;
        const label = steps.length > 1 ? `${name} ${i + 1}` : name;
        const size = [files, [outputPath]]
          .map((list) => formatBytes(list.reduce((n, file) => n + fs.statSync(file).size, 0)))
          .join(" → ");
        const problems = [];
        const asked = encoded.get(outputPath);
        const [packets, expected] = await Promise.all(
          [outputPath, against].map((file) => ff.videoPackets(file)),
        );
        let cap = "";
        if (asked?.maxrate) {
          const kbps = (packets.reduce((sum, p) => sum + p.size, 0) * 8) / 1000 / asked.duration;
          const ratio = kbps / asked.maxrate;
          cap = `${Math.round(ratio * 100)}%`;
          if (ratio > MAX_RATE) problems.push("over its rate cap");
        }
        if (asked) {
          const { duration } = await ff.mediaInfo(reference);
          if (Math.abs(duration - asked.duration) > MAX_DRIFT * asked.duration) {
            problems.push(`rendered ${duration}s for ${asked.duration}s`);
          }
        }
        const frames = packets?.length;
        if (!MERGES_FRAMES.includes(path.extname(outputPath)) && frames !== expected?.length) {
          problems.push(`${frames} frames for ${expected?.length}`);
        }
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
            [
              `${label} in`,
              await score(ff, outputPath, reference, `crop=${w}:${h}:${x1}:${y1}`, false),
              size,
              cap,
              problems,
            ],
            [`${label} out`, await score(ff, outputPath, input, blank)],
          );
        } else scores.push([label, await score(ff, outputPath, against), size, cap, problems]);
        fs.rmSync(reference, { force: true });
        input = outputPath;
        tick();
      }
      if (steps.length > 1) scores.push([`${name} src`, await score(ff, input, source)]);
      return scores.map(([label, { ssim, psnr, vmaf }, size = "", cap = "", problems = []]) => {
        const failed =
          problems.length > 0 ||
          ssim.min < MIN_SSIM ||
          psnr.min < MIN_PSNR ||
          (vmaf && vmaf.min < MIN_VMAF);
        const row = columns(
          failed ? "FAIL" : "ok",
          label,
          clip,
          [
            `${ssim.min.toFixed(2)}-${ssim.mean.toFixed(2)}`,
            `${decibels(psnr.min)}-${decibels(psnr.mean)}`,
            vmaf ? `${vmaf.min.toFixed(1)}-${vmaf.mean.toFixed(1)}` : "-",
          ].join(" · "),
          size,
          cap,
          problems,
        );
        say(row);
        return row;
      });
    });
  } finally {
    Object.assign(ENCODERS, encoders);
    Object.assign(LOOP_LIMITS, limits);
  }
  rows = rows.flat();
  const report = path.join(outDir, "quality.txt");
  fs.writeFileSync(report, [header, ...rows].join("\n"));
  const failures = rows.filter((row) => row.startsWith("FAIL")).length;
  if (failures) throw new Error(`${failures} failed, see ${report}`);
  return report;
}

const decibels = (value) => (value === Infinity ? "Infy" : value.toFixed(1));

// Each metric as min-mean: the worst frame, then the average. Size: the
// step's input files, then its output. Cap: the video bitrate as a share of
// the encoder's rate cap.
const columns = (status, label, clip, scores, size, cap, problems) =>
  [
    status.padEnd(4),
    label.padEnd(17),
    clip.padEnd(15),
    scores.padEnd(34),
    size.padEnd(17),
    cap.padEnd(5),
    problems.join(", "),
  ]
    .join(" ")
    .trimEnd();

// Per-frame scores (PSNR over RGB, SSIM over YUV, VMAF luma only), paired by
// frame index, with the reference fitted to the output's size and both then
// passed through `region`. Unequal frame counts pair by time instead: gifski
// keeps a repeated frame as one longer frame. SSIM over RGB put a channel
// resting at 0 (saturated colours) near 0.2 for a lossless yuv444p copy.
// VMAF models whole frames: on a crop as small as a mark it stays near 90
// for an identical copy, so `vmaf` false skips it.
async function score(ff, output, reference, region = "null", vmaf = true) {
  const { width, height, videoIndex } = await ff.mediaInfo(output);
  const [count, referenceCount] = await Promise.all(
    [output, reference].map(async (file) => (await ff.videoPackets(file))?.length),
  );
  const pace = count === referenceCount ? "" : `fps=${(await ff.mediaInfo(reference)).fps},`;
  const fit = `${pace}settb=1,setpts=N,scale=${width}:${height}:flags=lanczos,format=gbrp,${region},split=3`;
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
      `[0:v:${videoIndex}]${fit}[a][b][c];[1:v]${fit}[d][e][f];[b][e]psnr=f=-;` +
        `[a]format=yuv444p[y];[d]format=yuv444p[z];[y][z]ssim=f=-;` +
        (vmaf ? `[c][f]libvmaf=log_fmt=json:log_path=vmaf.json` : `[c]nullsink;[f]nullsink`),
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
    vmaf:
      vmaf &&
      summary(
        JSON.parse(fs.readFileSync(path.join(dir, "vmaf.json"), "utf8")).frames.map(
          (frame) => frame.metrics.vmaf,
        ),
      ),
  };
}
