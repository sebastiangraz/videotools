// End-to-end smoke run of the api tools against real ffmpeg/gifski, without
// Vercel or Blob storage: each case goes through its tool's handler exactly
// as /api/process calls it (api/_lib/tools/, with `download` faked by a file
// copy) and the run records every command spawned plus what came out.
//
//   npm run smoke -- before            run all cases, save under .smoke/before
//   npm run smoke -- after --diff before
//                                      run again, then compare with that run
//   npm run smoke -- gif --only gif,webp
//                                      only the cases with "gif" or "webp" in
//                                      their name
//   npm run smoke -- v7 --ffmpeg C:/ffmpeg-7.0.2/bin/ffmpeg.exe
//                                      another ffmpeg than ffmpeg-static's
//                                      (Vercel runs 7.0.2, Windows gets 6.1.1)
//   npm run smoke -- real --assets D:/footage/smoke
//                                      your own inputs (default folder:
//                                      scripts/smoke-assets; roles below)
//
// A refactor should leave both the commands and the outputs identical. A
// deliberate encoding change shows up as exactly the commands that were
// meant to change, and the results table says what it did to the sizes.
// Outputs stay in .smoke/<label>/runs/<case>/ to look at.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeDir = path.join(root, ".smoke");

// The inputs, by role. Each is looked for in the assets folder first; what
// isn't there is synthesized (test patterns: fine for comparing commands and
// sizes between runs, useless for judging quality by eye — bring real
// footage for that). Keep clips to a few seconds: the slow encoders (AVIF,
// lossless WebP) run on them too, and the loop cases need about 4s.
//   video      video.<any extension>   the clip every video tool works on
//   animation  animation.gif           a GIF source; else made from `video`
//   logo       logo.png                the watermark (PNG with alpha)
//   images     images/*                the sequence tool's stills, in natural
//                                      filename order (1–100 files)
//   frame      —                       always the first frame of `video`
//                                      (what the browser sends /api/preview)
const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/i;

// Every case is a /api/process request: the tool, its uploads (asset roles)
// and its options. `preview` is the one exception, /api/preview's single
// frame.
const CASES = {
  "loop-reverse": { tool: "loop", files: ["video"], options: { technique: "reverse", quality: 100 } },
  "loop-reverse-q60": { tool: "loop", files: ["video"], options: { technique: "reverse", quality: 60 } },
  "loop-reverse-gif-source": { tool: "loop", files: ["animation"], options: { technique: "reverse", quality: 100 } },
  "loop-crossfade": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0.5, startSecond: 0, quality: 80 } },
  "loop-crossfade-start": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0.5, startSecond: 1.5, quality: 100 } },
  "loop-reorder": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0, startSecond: 1, quality: 100 } },
  "sequence-mp4": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "mp4", quality: 90 } },
  "sequence-gif": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "gif", quality: 90 } },
  "sequence-gif-q50": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "gif", quality: 50 } },
  "sequence-avif": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "avif", quality: 85 } },
  "sequence-avif-lossless": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "avif", quality: 100 } },
  "convert-mp4": { tool: "convert", files: ["video"], options: { target: "mp4", quality: 60 } },
  "convert-mov": { tool: "convert", files: ["video"], options: { target: "mov", quality: 90 } },
  "convert-webm": { tool: "convert", files: ["video"], options: { target: "webm", quality: 90 } },
  "convert-webp": { tool: "convert", files: ["video"], options: { target: "webp", quality: 90 } },
  "convert-webp-lossless": { tool: "convert", files: ["video"], options: { target: "webp", quality: 100 } },
  "convert-avif": { tool: "convert", files: ["video"], options: { target: "avif", quality: 70 } },
  "convert-gif": { tool: "convert", files: ["video"], options: { target: "gif", quality: 90, width: 200 } },
  "convert-gif-fps": { tool: "convert", files: ["video"], options: { target: "gif", quality: 70, fps: 10, width: 160 } },
  "speed-faster": { tool: "speed", files: ["video"], options: { speed: 1 } },
  "speed-slower": { tool: "speed", files: ["video"], options: { speed: -1 } },
  "mark-plain": { tool: "mark", files: ["video", "logo"], options: { filter: false, quality: 90 } },
  "mark-glass": { tool: "mark", files: ["video", "logo"], options: { filter: true, quality: 100 } },
  "mark-glass-gif-source": { tool: "mark", files: ["animation", "logo"], options: { filter: true, quality: 90 } },
  "preview-glass": { preview: true, files: ["frame", "logo"], options: { filter: true } },
};

function parseArgs(argv) {
  const args = { label: null, diff: null, only: null, ffmpeg: null, assets: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = /^--(diff|only|ffmpeg|assets)$/.exec(argv[i]);
    if (flag) args[flag[1]] = argv[++i];
    else if (!args.label) args.label = argv[i];
  }
  if (!args.label || !/^[\w.-]+$/.test(args.label)) {
    console.error(
      "usage: npm run smoke -- <label> [--diff <label>] [--only <text,text>] " +
        "[--ffmpeg <path>] [--assets <dir>]",
    );
    process.exit(2);
  }
  return args;
}

// The functions are TypeScript with no build of their own (Vercel compiles
// them at deploy), so emit one. It lands inside the repo, where the emitted
// modules still resolve their packages.
function build(outDir) {
  const require = createRequire(path.join(root, "package.json"));
  const tsc = spawnSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "-p", path.join(root, "tsconfig.json"),
      "--noEmit", "false",
      "--outDir", outDir,
      "--rootDir", path.join(root, "api"),
    ],
    { stdio: "inherit" },
  );
  if (tsc.status !== 0) process.exit(tsc.status ?? 1);
}

// Finds each role's file(s): the user's where there is one, otherwise made
// into `madeDir` (fresh on every run, so what a run used sits next to what
// it produced). Returns role → paths, plus which roles were the user's own.
function resolveAssets(ffmpeg, userDir, madeDir) {
  fs.mkdirSync(madeDir, { recursive: true });
  const ff = (...args) => {
    const r = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args]);
    if (r.status !== 0) throw new Error(`could not make an asset: ${r.stderr}`);
  };
  const lavfi = (graph) => ["-f", "lavfi", "-i", graph];
  const made = (name) => path.join(madeDir, name);
  const listed = fs.existsSync(userDir) ? fs.readdirSync(userDir) : [];
  const own = (pattern) => {
    const name = listed.find((f) => pattern.test(f));
    return name && path.join(userDir, name);
  };
  const assets = {};
  const owned = [];
  const use = (role, ownPaths, make) => {
    if (ownPaths?.length) owned.push(role);
    assets[role] = ownPaths?.length ? ownPaths : make();
  };

  use("video", [own(/^video\.\w+$/i)].filter(Boolean), () => {
    ff(
      ...lavfi("testsrc2=size=320x240:rate=30:duration=4"),
      ...lavfi("sine=frequency=440:duration=4"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", made("video.mp4"),
    );
    return [made("video.mp4")];
  });
  const [video] = assets.video;

  use("animation", [own(/^animation\.gif$/i)].filter(Boolean), () => {
    ff("-i", video, "-t", "2", "-vf", "fps=10,scale=160:-2", made("animation.gif"));
    return [made("animation.gif")];
  });

  // The alpha comes from geq on purpose: drawbox and friends leave the
  // canvas opaque or empty, and a logo with nothing visible skips the mark
  // tool's bounds cropping.
  use("logo", [own(/^logo\.png$/i)].filter(Boolean), () => {
    ff(
      ...lavfi(
        "color=c=black:size=300x120,format=rgba," +
          "geq=r=255:g=255:b=255:a='255*between(X,40,240)*between(Y,30,90)'",
      ),
      "-frames:v", "1", made("logo.png"),
    );
    return [made("logo.png")];
  });

  const imagesDir = path.join(userDir, "images");
  const ownImages = fs.existsSync(imagesDir)
    ? fs
        .readdirSync(imagesDir)
        .filter((f) => IMAGE_EXT.test(f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((f) => path.join(imagesDir, f))
    : [];
  // Mixed sizes: the sequence tool pads everything to the first image.
  use("images", ownImages, () =>
    [1, 2, 3].map((i) => {
      ff(
        "-ss", String(i),
        ...lavfi(`testsrc2=size=${200 + i * 10}x150:rate=1`),
        "-frames:v", "1", made(`img${i}.png`),
      );
      return made(`img${i}.png`);
    }),
  );

  ff("-i", video, "-frames:v", "1", made("frame.jpg"));
  assets.frame = [made("frame.jpg")];

  return { assets, owned };
}

// Old and new side by side, case by case; only what differs is printed.
function diff(name, before, after, format) {
  const changed = Object.keys({ ...before, ...after }).filter(
    (k) => k in before && k in after && format(before[k]) !== format(after[k]),
  );
  if (!changed.length) {
    console.log(`${name}: identical`);
    return true;
  }
  console.log(`${name}: ${changed.length} case(s) differ`);
  for (const k of changed) {
    console.log(`  ${k}`);
    const [a, b] = [before[k], after[k]].map((v) => format(v).split("\n"));
    for (const line of a) if (!b.includes(line)) console.log(`    - ${line}`);
    for (const line of b) if (!a.includes(line)) console.log(`    + ${line}`);
  }
  return false;
}

const args = parseArgs(process.argv.slice(2));
const outDir = path.join(smokeDir, args.label);
fs.rmSync(outDir, { recursive: true, force: true });
const buildDir = path.join(outDir, "build");
build(buildDir);

const load = (rel) => import(pathToFileURL(path.join(buildDir, rel)).href);
const { FFmpeg } = await load("_lib/ffmpeg.js");
const { TOOLS } = await load("_lib/tools/index.js");
const { renderWatermarkFrame } = await load("_lib/tools/mark.js");
// binaries.js resolves gifski from the cwd, as it does on Vercel.
process.chdir(root);
const binaries = await load("_lib/binaries.js");
const ffmpegPath = args.ffmpeg ?? binaries.ffmpegPath;

const userDir = path.resolve(root, args.assets ?? "scripts/smoke-assets");
const userDirShown = userDir.startsWith(root) ? path.relative(root, userDir) : userDir;
const { assets, owned } = resolveAssets(ffmpegPath, userDir, path.join(outDir, "assets"));
const bytesOf = (paths) => paths.reduce((sum, p) => sum + fs.statSync(p).size, 0);
const describe = (paths) =>
  paths.length === 1
    ? `${path.basename(paths[0])} ${bytesOf(paths)}`
    : `${paths.length} files ${bytesOf(paths)}`;

// "Uploads" are addressed by file name, like blobs are.
const byName = new Map();
for (const file of Object.values(assets).flat()) {
  const name = path.basename(file);
  if (byName.has(name) && byName.get(name) !== file) {
    throw new Error(`Two assets are called ${name}; rename one of them`);
  }
  byName.set(name, file);
}
const BLOB = "https://smoke.public.blob.vercel-storage.com/";
const download = async (url, destPath) =>
  fs.copyFileSync(byName.get(decodeURIComponent(path.basename(new URL(url).pathname))), destPath);

// Paths differ per run and machine; the commands should not.
let workDir = "";
const recorded = [];
const normalize = (arg) =>
  arg
    .split(workDir).join("<work>")
    .split(ffmpegPath).join("ffmpeg")
    .split(binaries.gifskiPath).join("gifski")
    .replace(/tmp_loop_\d+/g, "tmp_loop_N");
class Recorder extends FFmpeg {
  run(command, commandArgs, options) {
    recorded.push([command, ...commandArgs].map(normalize).join(" "));
    return super.run(command, commandArgs, options);
  }
}

// The tools narrate every step; keep the terminal for the table.
const say = console.log;
console.log = console.error = () => {};

say(
  owned.length
    ? `assets from ${userDirShown}: ${owned.join(", ")}` +
        ` (the rest synthesized)\n`
    : `synthetic assets (none found in ${userDirShown})\n`,
);

const commands = {};
// Part of the results, so comparing runs made from different inputs says so.
const results = {
  "(assets)": Object.fromEntries(
    Object.entries(assets).map(([role, paths]) => [role, describe(paths)]),
  ),
};
const only = args.only?.split(",").filter(Boolean);
const names = Object.keys(CASES).filter((n) => !only || only.some((o) => n.includes(o)));
for (const name of names) {
  const { tool, preview, files: roles, options } = CASES[name];
  const files = roles.flatMap((role) => assets[role]);
  // What the result is measured against: the tool's source, not the logo.
  const source = assets[roles[0]];
  workDir = path.join(outDir, "runs", name);
  fs.mkdirSync(workDir, { recursive: true });
  recorded.length = 0;
  const ff = new Recorder(ffmpegPath, binaries.gifskiPath);
  const started = Date.now();
  try {
    let outputPath;
    let downloadName;
    if (preview) {
      const [frame, logo] = files.map((f) => {
        const copy = path.join(workDir, path.basename(f));
        fs.copyFileSync(f, copy);
        return copy;
      });
      outputPath = await renderWatermarkFrame(ff, frame, logo, workDir, options.filter);
      downloadName = path.basename(outputPath);
    } else {
      const urls = files.map((f) => BLOB + encodeURIComponent(path.basename(f)));
      const request =
        tool === "sequence"
          ? { blobUrls: urls, options }
          : { blobUrl: urls[0], watermarkUrl: urls[1], options };
      const inputs = TOOLS[tool].inputs(request);
      if (!Array.isArray(inputs)) throw new Error(inputs.error);
      const result = await TOOLS[tool].run({ ff, workDir, inputs, options, download });
      outputPath = result.outputPath;
      downloadName = `${path.parse(source[0]).name}_${result.suffix}.${result.ext}`;
    }
    // Probed with a fresh instance, so the probe isn't part of the record.
    // Best effort: ffmpeg has no decoder for animated WebP, so those read
    // as having no video. Anywhere else, "no video stream" is a finding.
    const info = await new FFmpeg(ffmpegPath, "")
      .mediaInfo(outputPath)
      .catch(() => null);
    const bytes = fs.statSync(outputPath).size;
    results[name] = {
      source: describe(source),
      output: downloadName,
      bytes,
      ratio: Number((bytes / bytesOf(source)).toFixed(2)),
      ...(info
        ? {
            codec: info.codec,
            size: `${info.width}x${info.height}`,
            duration: info.duration,
            fps: info.fps,
          }
        : { codec: "NO VIDEO STREAM" }),
    };
  } catch (err) {
    results[name] = { error: String(err?.message ?? err).trim().split("\n").pop() };
  }
  commands[name] = [...recorded];
  const r = results[name];
  say(
    `${name.padEnd(26)} ${String(((Date.now() - started) / 1000).toFixed(1) + "s").padStart(6)}  ` +
      (r.error
        ? `ERROR ${r.error.slice(0, 90)}`
        : `${r.output.padEnd(24)} ${String(r.bytes).padStart(9)} B  ${String(r.ratio).padStart(6)}x source  ` +
          (r.size ? `${r.codec} ${r.size} ${r.duration}s` : r.codec)),
  );
}

fs.writeFileSync(path.join(outDir, "commands.json"), JSON.stringify(commands, null, 1));
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 1));
fs.rmSync(buildDir, { recursive: true, force: true });
say(`\nsaved to ${path.relative(root, outDir)}`);

if (args.diff) {
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.join(smokeDir, args.diff, file), "utf8"));
  say(`\ncompared with "${args.diff}":`);
  console.log = say;
  const sameCommands = diff("commands", read("commands.json"), commands, (c) => c.join("\n"));
  const sameResults = diff("results", read("results.json"), results, (r) =>
    Object.entries(r).map(([k, v]) => `${k}: ${v}`).join("\n"),
  );
  process.exit(sameCommands && sameResults ? 0 : 1);
}
