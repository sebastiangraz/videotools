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
//                                      another ffmpeg than the one ffmpeg.json
//                                      pins (say, the next version to pin)
//   npm run smoke -- real --assets D:/footage/smoke
//                                      your own inputs (default folder:
//                                      scripts/smoke-assets; roles below)
//
// A refactor should leave both the commands and the outputs identical. A
// deliberate encoding change shows up as exactly the commands that were
// meant to change, and the results table says what it did to the sizes.
// Outputs stay in .smoke/<label>/runs/<case>/ to look at.
//
// Apart from the comparison, every case carries what must hold for it
// whatever the encoders do (`expect` in CASES): the format that comes back,
// how big it may get next to its source, or the rejection a source the app
// cannot write back has to get. A run that breaks one exits 1 and lists them.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkFfmpeg, pinnedVersion } from "./ffmpeg-check.mjs";

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
//   mov, webm  —                       always `video` again, as source.mov
//                                      (remuxed) and source.webm (VP9/Opus):
//                                      sources in the other video formats
//   avif       —                       the first two seconds of `video` as
//                                      a small source.avif (AV1 is slow)
//   mkv        —                       `video` remuxed to reject.mkv, a
//                                      container the app reads but never
//                                      writes
//   png, jpg,  —                       the first frame of `video` as still.png,
//   webp                               still.jpg and still.webp (lossy): the
//                                      mark tool's still sources
//   turned     —                       still.jpg again as turned.jpg, with an
//                                      EXIF orientation that stands it on end
const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/i;

// Every case is a /api/process request: the tool, its uploads (asset roles)
// and its options. `preview` is the one exception, /api/preview's single
// frame.
//
// `expect` is what has to hold for the result:
//   ext        its extension; "source" = the same as the first upload's,
//              which is every tool's rule but convert's and sequence's
//   maxRatio   its size next to the source's, at most (quality is relative
//   minRatio   to the source: 100 spends the source's bitrate, so size only
//              follows duration — a reverse loop is twice its source)
//   frames     "source": as many frames as the source has, for the results
//              that only rearrange or redraw them; "double": twice as many,
//              for the reverse loops
//   turned     the picture has to come back on end: its source's height wide
//              and its width high (a JPEG that EXIF says to show that way)
//   errorCode  the run has to be refused, with this InputError code
const CASES = {
  "loop-reverse": { tool: "loop", files: ["video"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", frames: "double", maxRatio: 2.2 } },
  "loop-reverse-q60": { tool: "loop", files: ["video"], options: { technique: "reverse", quality: 60 }, expect: { ext: "source", frames: "double", maxRatio: 1.4 } },
  "loop-reverse-gif-source": { tool: "loop", files: ["animation"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", frames: "double", maxRatio: 2.2 } },
  "loop-reverse-mov-source": { tool: "loop", files: ["mov"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", frames: "double", maxRatio: 2.2 } },
  // One-pass VP9 lands well under the bitrate it is given, hence a range.
  "loop-reverse-webm-source": { tool: "loop", files: ["webm"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", frames: "double", maxRatio: 2.2, minRatio: 0.8 } },
  // A few dozen kB, where the container counts and libaom holds its one-pass
  // rate only loosely: more headroom than the other reverse loops get.
  "loop-reverse-avif-source": { tool: "loop", files: ["avif"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", frames: "double", maxRatio: 2.5 } },
  "loop-reject-mkv-source": { tool: "loop", files: ["mkv"], options: { technique: "reverse", quality: 100 }, expect: { errorCode: "unsupported-source" } },
  "loop-crossfade": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0.5, startSecond: 0, quality: 80 }, expect: { ext: "source", maxRatio: 0.9 } },
  "loop-crossfade-start": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0.5, startSecond: 1.5, quality: 100 }, expect: { ext: "source", maxRatio: 1.1 } },
  "loop-crossfade-gif-source": { tool: "loop", files: ["animation"], options: { technique: "crossfade", fadeDuration: 0.5, startSecond: 0, quality: 100 }, expect: { ext: "source", maxRatio: 1.1 } },
  "loop-reorder": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0, startSecond: 1, quality: 100 }, expect: { ext: "source", maxRatio: 1.1, frames: "source" } },
  // A start point next to a keyframe of the footage in scripts/smoke-assets
  // (2.03s), where the streams are reordered without decoding. Test patterns
  // have no keyframe there and are encoded, like loop-reorder.
  "loop-reorder-keyframe": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0, startSecond: 2, quality: 100 }, expect: { ext: "source", maxRatio: 1.1, frames: "source" } },
  // The same in WebM, whose VP9 has no B-frames for a cut to break: the first
  // keyframe past the start of source.webm is at 4.27s.
  "loop-reorder-webm-keyframe": { tool: "loop", files: ["webm"], options: { technique: "crossfade", fadeDuration: 0, startSecond: 4.2, quality: 100 }, expect: { ext: "source", maxRatio: 1.1, frames: "source" } },
  "loop-reorder-gif-source": { tool: "loop", files: ["animation"], options: { technique: "crossfade", fadeDuration: 0, startSecond: 1, quality: 100 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  "sequence-mp4": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "mp4", quality: 90 }, expect: { ext: "mp4" } },
  "sequence-gif": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "gif", quality: 90 }, expect: { ext: "gif" } },
  "sequence-gif-q50": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "gif", quality: 50 }, expect: { ext: "gif" } },
  "sequence-avif": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "avif", quality: 85 }, expect: { ext: "avif" } },
  "sequence-avif-lossless": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "avif", quality: 100 }, expect: { ext: "avif" } },
  "convert-mp4": { tool: "convert", files: ["video"], options: { target: "mp4", quality: 60 }, expect: { ext: "mp4", maxRatio: 0.75, frames: "source" } },
  "convert-mov": { tool: "convert", files: ["video"], options: { target: "mov", quality: 90 }, expect: { ext: "mov", maxRatio: 1.05, frames: "source" } },
  "convert-webm": { tool: "convert", files: ["video"], options: { target: "webm", quality: 90 }, expect: { ext: "webm", maxRatio: 1, minRatio: 0.4, frames: "source" } },
  "convert-webp": { tool: "convert", files: ["video"], options: { target: "webp", quality: 90 }, expect: { ext: "webp" } },
  "convert-webp-lossless": { tool: "convert", files: ["video"], options: { target: "webp", quality: 100 }, expect: { ext: "webp" } },
  "convert-avif": { tool: "convert", files: ["video"], options: { target: "avif", quality: 70 }, expect: { ext: "avif", maxRatio: 0.75 } },
  "convert-gif": { tool: "convert", files: ["video"], options: { target: "gif", quality: 90, width: 200 }, expect: { ext: "gif" } },
  "convert-gif-fps": { tool: "convert", files: ["video"], options: { target: "gif", quality: 70, fps: 10, width: 160 }, expect: { ext: "gif" } },
  "speed-faster": { tool: "speed", files: ["video"], options: { speed: 1 }, expect: { ext: "source", maxRatio: 0.6 } },
  "speed-slower": { tool: "speed", files: ["video"], options: { speed: -1 }, expect: { ext: "source", maxRatio: 2.2 } },
  "speed-gif-source": { tool: "speed", files: ["animation"], options: { speed: 1 }, expect: { ext: "source", frames: "source", maxRatio: 1.2 } },
  "mark-plain": { tool: "mark", files: ["video", "logo"], options: { filter: false, quality: 90 }, expect: { ext: "source", maxRatio: 1.15, frames: "source" } },
  "mark-glass": { tool: "mark", files: ["video", "logo"], options: { filter: true, quality: 100 }, expect: { ext: "source", maxRatio: 1.15, frames: "source" } },
  "mark-glass-gif-source": { tool: "mark", files: ["animation", "logo"], options: { filter: true, quality: 90 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  "mark-plain-avif-source": { tool: "mark", files: ["avif", "logo"], options: { filter: false, quality: 100 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  // Stills come back as the image they are. A PNG is lossless both ways; a
  // JPEG or lossy WebP is held to its source's size (encode/still.ts), which
  // the codecs' finest settings would pass several times over.
  "mark-plain-png-source": { tool: "mark", files: ["png", "logo"], options: { filter: false, quality: 100 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  "mark-glass-png-source": { tool: "mark", files: ["png", "logo"], options: { filter: true, quality: 100 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  "mark-glass-jpg-source": { tool: "mark", files: ["jpg", "logo"], options: { filter: true, quality: 100 }, expect: { ext: "source", maxRatio: 1.15, frames: "source" } },
  "mark-plain-jpg-turned": { tool: "mark", files: ["turned", "logo"], options: { filter: false, quality: 90 }, expect: { ext: "source", turned: true } },
  "mark-glass-webp-source": { tool: "mark", files: ["webp", "logo"], options: { filter: true, quality: 100 }, expect: { ext: "source", maxRatio: 1.15, frames: "source" } },
  "preview-glass": { preview: true, files: ["frame", "logo"], options: { filter: true } },
};

// What a result does to its case's `expect`, as lines to print; none = holds.
function violations(expect, result, sourceFile) {
  if (!expect) return [];
  if (expect.errorCode) {
    return result.code === expect.errorCode
      ? []
      : [
          `has to be refused as "${expect.errorCode}", but ` +
            (result.error ? `failed with: ${result.error}` : `came back as ${result.output}`),
        ];
  }
  if (result.error) return [`failed: ${result.error}`];
  const found = [];
  const ext = path.extname(result.output).slice(1);
  const wanted =
    expect.ext === "source" ? path.extname(sourceFile).slice(1).toLowerCase() : expect.ext;
  if (wanted && ext !== wanted) found.push(`came back as .${ext}, has to be .${wanted}`);
  if (expect.maxRatio != null && result.ratio > expect.maxRatio) {
    found.push(`${result.ratio}x its source, at most ${expect.maxRatio}x allowed`);
  }
  if (expect.minRatio != null && result.ratio < expect.minRatio) {
    found.push(`${result.ratio}x its source, at least ${expect.minRatio}x expected`);
  }
  if (expect.turned && result.size !== result.sourceSize.split("x").reverse().join("x")) {
    found.push(`came back ${result.size}, has to be its source's ${result.sourceSize} on end`);
  }
  const wantedFrames = result.sourceFrames * (expect.frames === "double" ? 2 : 1);
  if (expect.frames && result.frames !== wantedFrames) {
    found.push(
      `${result.frames} frames, has to be ${wantedFrames} (its source has ${result.sourceFrames})`,
    );
  }
  return found;
}

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
      // The repo, not api/: the functions import shared/ from next to it.
      "--rootDir", root,
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

  // The same clip in the other containers. A remux where the streams fit;
  // footage that doesn't (say, a video.webm) is encoded instead.
  const remux = (name, ...streams) => {
    try {
      ff("-i", video, ...streams, "-c", "copy", made(name));
    } catch {
      ff("-i", video, ...streams, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", made(name));
    }
    return [made(name)];
  };
  assets.mov = remux("source.mov");
  assets.mkv = remux("reject.mkv", "-map", "0:v:0");
  ff(
    "-i", video,
    "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-cpu-used", "5", "-row-mt", "1",
    "-pix_fmt", "yuv420p", "-c:a", "libopus", "-ac", "2", made("source.webm"),
  );
  assets.webm = [made("source.webm")];
  ff(
    "-i", video, "-t", "2",
    "-vf", "fps=15,scale=320:-2",
    "-c:v", "libaom-av1", "-crf", "30", "-b:v", "0", "-cpu-used", "8", "-row-mt", "1",
    "-pix_fmt", "yuv420p", "-an", "-f", "avif", made("source.avif"),
  );
  assets.avif = [made("source.avif")];

  ff("-i", video, "-frames:v", "1", made("still.png"));
  assets.png = [made("still.png")];
  ff("-i", video, "-frames:v", "1", "-q:v", "4", made("still.jpg"));
  assets.jpg = [made("still.jpg")];
  ff("-i", video, "-frames:v", "1", "-c:v", "libwebp", "-q:v", "85", made("still.webp"));
  assets.webp = [made("still.webp")];
  // An EXIF block (APP1, right behind the SOI marker) of one tag:
  // Orientation (0x0112) = 6, "show me turned a quarter clockwise", the way
  // a phone held upright saves its photos.
  const tiff = Buffer.alloc(26);
  tiff.write("II");
  [[42, 2], [1, 8], [0x0112, 10], [3, 12], [6, 18]].forEach(([v, at]) => tiff.writeUInt16LE(v, at));
  [[8, 4], [1, 14]].forEach(([v, at]) => tiff.writeUInt32LE(v, at));
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.from([0xff, 0xe1, 0, exif.length + 2]);
  const jpeg = fs.readFileSync(made("still.jpg"));
  fs.writeFileSync(made("turned.jpg"), Buffer.concat([jpeg.subarray(0, 2), app1, exif, jpeg.subarray(2)]));
  assets.turned = [made("turned.jpg")];

  return { assets, owned };
}

// x264 under a bitrate ceiling is not bit-exact from run to run (its rate
// control reacts to how the encoder's threads happen to interleave), so the
// same command lands within about a percent of itself. Sizes this close are
// the same result.
const SIZE_TOLERANCE = 0.02;
function sameResult(before, after) {
  const keys = Object.keys({ ...before, ...after });
  return keys.every((k) => {
    if (k === "bytes") {
      return Math.abs(before.bytes - after.bytes) <= SIZE_TOLERANCE * before.bytes;
    }
    if (k === "ratio") return Math.abs(before.ratio - after.ratio) <= 0.05;
    return before[k] === after[k];
  });
}

// Old and new side by side, case by case; only what differs is printed.
function diff(name, before, after, format, same = (a, b) => format(a) === format(b)) {
  const changed = Object.keys({ ...before, ...after }).filter(
    (k) => k in before && k in after && !same(before[k], after[k]),
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
const { FFmpeg } = await load("api/_lib/ffmpeg.js");
const { TOOLS } = await load("api/_lib/tools/index.js");
const { renderWatermarkFrame } = await load("api/_lib/tools/mark.js");
// binaries.js resolves gifski from the cwd, as it does on Vercel.
process.chdir(root);
const binaries = await load("api/_lib/binaries.js");
const ffmpegPath = args.ffmpeg ?? binaries.ffmpegPath;
// Before any case: the pinned version (unless --ffmpeg asks for another), with
// every encoder and filter the api uses.
const ffmpegCheck = checkFfmpeg(ffmpegPath, { version: args.ffmpeg ? undefined : pinnedVersion() });
if (ffmpegCheck.problems.length) {
  console.error(
    `${ffmpegPath} (${ffmpegCheck.version}) won't do:\n  ${ffmpegCheck.problems.join("\n  ")}`,
  );
  process.exit(1);
}

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
const broken = {};
// Part of the results, so comparing runs made from different inputs says so.
const results = {
  "(ffmpeg)": ffmpegCheck.version,
  "(assets)": Object.fromEntries(
    Object.entries(assets).map(([role, paths]) => [role, describe(paths)]),
  ),
};
const only = args.only?.split(",").filter(Boolean);
const names = Object.keys(CASES).filter((n) => !only || only.some((o) => n.includes(o)));
for (const name of names) {
  const { tool, preview, files: roles, options, expect } = CASES[name];
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
    // Best effort: ffmpeg before 9.0 had no decoder for animated WebP, so
    // there those read as having no video. Otherwise "no video stream" is a
    // finding.
    const info = await new FFmpeg(ffmpegPath, "")
      .mediaInfo(outputPath)
      .catch(() => null);
    const bytes = fs.statSync(outputPath).size;
    // Counted, not computed from duration and rate: a frame lost at a cut
    // shows in neither.
    const prober = new FFmpeg(ffmpegPath, "");
    const countFrames = (file) => prober.decodedFrames(file);
    results[name] = {
      source: describe(source),
      output: downloadName,
      bytes,
      ratio: Number((bytes / bytesOf(source)).toFixed(2)),
      ...(expect?.frames
        ? { frames: await countFrames(outputPath), sourceFrames: await countFrames(source[0]) }
        : {}),
      ...(expect?.turned
        ? await prober.mediaInfo(source[0]).then((s) => ({ sourceSize: `${s.width}x${s.height}` }))
        : {}),
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
    results[name] = {
      error: String(err?.message ?? err).trim().split("\n").pop(),
      ...(typeof err?.code === "string" ? { code: err.code } : {}),
    };
  }
  commands[name] = [...recorded];
  const r = results[name];
  const found = violations(expect, r, source[0]);
  if (found.length) broken[name] = found;
  say(
    `${name.padEnd(26)} ${String(((Date.now() - started) / 1000).toFixed(1) + "s").padStart(6)}  ` +
      (found.length ? "✗ " : "  ") +
      (r.error
        ? `${expect?.errorCode && !found.length ? "refused:" : "ERROR"} ${r.error.slice(0, 90)}`
        : `${r.output.padEnd(24)} ${String(r.bytes).padStart(9)} B  ${String(r.ratio).padStart(6)}x source  ` +
          (r.size ? `${r.codec} ${r.size} ${r.duration}s` : r.codec)),
  );
}

fs.writeFileSync(path.join(outDir, "commands.json"), JSON.stringify(commands, null, 1));
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 1));
fs.rmSync(buildDir, { recursive: true, force: true });
say(`\nsaved to ${path.relative(root, outDir)}`);

const brokenNames = Object.keys(broken);
if (brokenNames.length) {
  say(`\n${brokenNames.length} case(s) break what is expected of them:`);
  for (const name of brokenNames) {
    for (const line of broken[name]) say(`  ✗ ${name}: ${line}`);
  }
} else {
  say("\nevery expectation holds");
}

if (args.diff) {
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.join(smokeDir, args.diff, file), "utf8"));
  say(`\ncompared with "${args.diff}":`);
  console.log = say;
  const sameCommands = diff("commands", read("commands.json"), commands, (c) => c.join("\n"));
  const sameResults = diff(
    "results",
    read("results.json"),
    results,
    (r) => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join("\n"),
    sameResult,
  );
  process.exit(sameCommands && sameResults && !brokenNames.length ? 0 : 1);
}
process.exit(brokenNames.length ? 1 : 0);
