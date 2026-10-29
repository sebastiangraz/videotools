// Smoke runs: the real tool handlers, called as /api/process would call them,
// against the pinned ffmpeg and the assets in scripts/smoke/assets/:
//   images/   stills, which each suite picks by file name
//   vectors/  SVG logos, listed in natural filename order
//   videos/   clips, picked like stills
// Every suite writes to .smoke/<name>/<suite>/.
//
//   bun run smoke before          every suite
//   bun run smoke before mark     only these
//   bun run smoke before mark:depthmap,glass   only these parts, the rest kept
import fs from "node:fs";
import path from "node:path";
import { execBinary } from "../../api/_lib/binaries.ts";
import { FFmpeg } from "../../api/_lib/ffmpeg.ts";
import { TOOLS } from "../../api/_lib/tools/index.ts";
import { binaryPath, root } from "../binaries.mjs";
import { requireFfmpeg } from "../ffmpeg-check.mjs";
import { lightGrid, MARK_GRIDS, markGrid } from "./mark.mjs";
import { encodeLoss } from "./quality.mjs";

const SUITES = { mark: markGrid, light: lightGrid, quality: encodeLoss };
// Subfolders a suite can run on their own.
const PARTS = { mark: MARK_GRIDS };

const assetsDir = path.join(root, "scripts", "smoke", "assets");
const smokeDir = path.join(root, ".smoke");

const [label, ...names] = process.argv.slice(2);
const runs = (names.length ? names : Object.keys(SUITES)).map((arg) => {
  const [name, parts] = arg.split(":");
  return { name, parts: parts?.split(",") };
});
const unknown = runs.filter(
  ({ name, parts }) =>
    !Object.hasOwn(SUITES, name) || parts?.some((part) => !PARTS[name]?.includes(part)),
);
if (!label || unknown.length) {
  const suites = Object.keys(SUITES).map((name) =>
    PARTS[name] ? `${name}[:${PARTS[name].join(",")}]` : name,
  );
  console.error(`usage: bun run smoke <name> [${suites.join("|")}...]`);
  process.exit(2);
}

const ffmpegPath = binaryPath("ffmpeg");
requireFfmpeg(ffmpegPath, { pinned: true });
const ff = new FFmpeg(ffmpegPath, binaryPath("gifski"), execBinary);

const listed = (dir) =>
  fs
    .readdirSync(path.join(assetsDir, dir))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(assetsDir, dir, name));
const picked = (dir) => (names) => names.map((name) => path.join(assetsDir, dir, name));
const assets = {
  images: picked("images"),
  vectors: listed("vectors"),
  videos: picked("videos"),
};

// Files stand in for uploads: each gets its own blob URL, which `download` copies back.
const uploads = new Map();
const upload = (file) => {
  const url = `https://smoke.public.blob.vercel-storage.com/${uploads.size}/${encodeURIComponent(path.basename(file))}`;
  uploads.set(url, file);
  return url;
};
const download = async (url, destPath) => fs.copyFileSync(uploads.get(url), destPath);

// One /api/process request: `files` in upload order, results in `workDir`.
async function runTool(tool, files, options, workDir) {
  const urls = files.map(upload);
  const inputs = TOOLS[tool].inputs({
    blobUrl: urls[0],
    blobUrls: urls,
    watermarkUrl: urls[1],
    options,
  });
  if (!Array.isArray(inputs)) throw new Error(inputs.error);
  fs.mkdirSync(workDir, { recursive: true });
  return TOOLS[tool].run({ ff, workDir, inputs, options, download });
}

// Progress bar
const BAR_WIDTH = 20;
const tty = process.stdout.isTTY;
let bar = "";
const write = (text) => process.stdout.write(tty ? `\r\x1b[2K${text}${bar}` : text);
const say = (text) => write(`${text}\n`);
console.log = console.error = () => {};

const progressFor = (name) => (total) => {
  let done = 0;
  let shown;
  const draw = () => {
    const filled = Math.floor((done / total) * BAR_WIDTH);
    const fill = filled && done < total ? `${"█".repeat(filled - 1)}▌` : "█".repeat(filled);
    bar = `${name} ▕${fill.padEnd(BAR_WIDTH, "░")}▏ ${done}/${total}`;
    if (tty) write("");
    else if (filled !== shown) write(`${bar}\n`);
    shown = filled;
  };
  draw();
  return () => {
    done += 1;
    draw();
  };
};

let failed = false;
for (const { name, parts } of runs) {
  const outDir = path.join(smokeDir, label, name);
  for (const dir of parts?.map((part) => path.join(outDir, part)) ?? [outDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  let result;
  try {
    const progress = progressFor(name);
    const output = await SUITES[name]({ ff, assets, outDir, parts, runTool, say, progress });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    result = `${name}: ${path.relative(root, output)} (${seconds}s)`;
  } catch (err) {
    failed = true;
    result = `${name}: FAILED ${String(err?.message ?? err).trim()}`;
  }
  bar = "";
  say(result);
}
process.exit(failed ? 1 : 0);
