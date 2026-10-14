// Smoke runs: the real tool handlers, called as /api/process would call them,
// against the pinned ffmpeg and the assets in scripts/smoke/assets/:
//   images/   stills
//   videos/   clips
//   light/    clips for Mark's light tracking
//   vectors/  SVG logos
// each listed in natural filename order. Every suite writes to .smoke/<name>/<suite>/.
//
//   bun run smoke before          every suite
//   bun run smoke before mark     only these
import fs from "node:fs";
import path from "node:path";
import { FFmpeg } from "../../api/_lib/ffmpeg.ts";
import { TOOLS } from "../../api/_lib/tools/index.ts";
import { binaryPath, root } from "../binaries.mjs";
import { requireFfmpeg } from "../ffmpeg-check.mjs";
import { lightGrid, markGrid } from "./mark.mjs";

const SUITES = { mark: markGrid, light: lightGrid };

const assetsDir = path.join(root, "scripts", "smoke", "assets");
const smokeDir = path.join(root, ".smoke");

const [label, ...names] = process.argv.slice(2);
const unknown = names.filter((name) => !Object.hasOwn(SUITES, name));
if (!label || unknown.length) {
  console.error(`usage: bun run smoke <name> [${Object.keys(SUITES).join("|")}...]`);
  process.exit(2);
}

const ffmpegPath = binaryPath("ffmpeg");
requireFfmpeg(ffmpegPath, { pinned: true });
const ff = new FFmpeg(ffmpegPath, binaryPath("gifski"));

const listed = (dir) =>
  fs
    .readdirSync(path.join(assetsDir, dir))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(assetsDir, dir, name));
const assets = {
  images: listed("images"),
  videos: listed("videos"),
  light: listed("light"),
  vectors: listed("vectors"),
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

// The tools log every step and command; suites report through `say`.
const say = console.log;
console.log = console.error = () => {};

let failed = false;
for (const name of names.length ? names : Object.keys(SUITES)) {
  const outDir = path.join(smokeDir, label, name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  try {
    const output = await SUITES[name]({ ff, assets, outDir, runTool, say });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    say(`${name}: ${path.relative(root, output)} (${seconds}s)`);
  } catch (err) {
    failed = true;
    say(`${name}: FAILED ${String(err?.message ?? err).trim()}`);
  }
}
process.exit(failed ? 1 : 0);
