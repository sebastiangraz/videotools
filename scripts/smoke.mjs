// Runs each tool's handler as /api/process would, against real ffmpeg/gifski
// (no Vercel/Blob), recording every command and output. Refactors must diff
// identical; failed `expect`s exit 1. Outputs: .smoke/<label>/runs/<case>/.
//
//   bun run smoke -- before                        run all cases into .smoke/before
//   bun run smoke -- after --diff before           run again and compare
//   bun run smoke -- gif --only gif,webp           only cases whose name contains these
//   bun run smoke -- next --ffmpeg <path>          an ffmpeg other than the pinned one
//   bun run smoke -- real --assets D:/footage      own inputs (default scripts/smoke-assets)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { checkFfmpeg, pinnedVersion } from "./ffmpeg-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeDir = path.join(root, ".smoke");

// Input roles. The first five come from the assets folder, which must have
// them all. Keep clips a few seconds (AVIF/lossless WebP are slow; loop cases
// need ~4s).
//   video      video.<ext>     the clip every video tool works on
//   animation  animation.gif   GIF source
//   logo       logo.png        watermark with alpha
//   svglogo    logo.svg        watermark as SVG
//   images     images/*        sequence stills, natural order (1–100)
// Always derived from `video`:
//   frame                      first frame (what the browser sends /api/preview)
//   mov, webm                  remuxed .mov, VP9/Opus .webm
//   avif, slides               2s AVIF; 3 frames at 1 fps (a slideshow AVIF)
//   animwebp(-lossless)        2s animated WebP, lossy / lossless
//   mkv, anamorphic            rejected: read-only container; 4:3 SAR pixels
//   png, jpg, webp             first frame as stills (mark tool)
//   turned                     still.jpg with EXIF orientation 6
const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/i;

const args = readArgs(process.argv.slice(2));
const outDir = path.join(smokeDir, args.label);
fs.rmSync(outDir, { recursive: true, force: true });
// Bun runs the api's TypeScript as is (its .js specifiers resolve to .ts).
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { GENERATION } = await load("api/_lib/encode/rate.ts");

// Each case is a /api/process request (`preview`: /api/preview's single frame).
// `expect`:
//   ext        extension; "source" = the first upload's
//   maxRatio   output/source size bounds; rate-controlled formats may spend up
//   minRatio   to GENERATION x the source bitrate, so a reverse loop can be ~4x
//   frames     "source" = same frame count, "double" = twice (reverse loops)
//   turned     width/height swapped (EXIF-rotated JPEG)
//   errorCode  must be refused with this InputError code
// prettier-ignore
const CASES = {
  "loop-reverse": { tool: "loop", files: ["video"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", frames: "double", maxRatio: 2.2 * GENERATION } },
  "loop-reverse-q60": { tool: "loop", files: ["video"], options: { technique: "reverse", quality: 60 }, expect: { ext: "source", frames: "double", maxRatio: 1.4 * GENERATION } },
  "loop-reverse-gif-source": { tool: "loop", files: ["animation"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", frames: "double", maxRatio: 2.2 } },
  "loop-reverse-mov-source": { tool: "loop", files: ["mov"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", frames: "double", maxRatio: 2.2 * GENERATION } },
  // One-pass VP9 lands well under the bitrate it is given, hence a range.
  "loop-reverse-webm-source": { tool: "loop", files: ["webm"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", frames: "double", maxRatio: 2.2 * GENERATION, minRatio: 0.8 } },
  // No frame count for WebP results: libwebp_anim merges identical consecutive
  // frames (e.g. where the palindrome turns).
  "loop-reverse-webp-source": { tool: "loop", files: ["animwebp"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", maxRatio: 2.2 } },
  // Tiny file: container overhead counts and libaom's one-pass rate is loose.
  "loop-reverse-avif-source": { tool: "loop", files: ["avif"], options: { technique: "reverse", quality: 100 }, expect: { ext: "source", frames: "double", maxRatio: 2.5 * GENERATION } },
  "loop-reject-mkv-source": { tool: "loop", files: ["mkv"], options: { technique: "reverse", quality: 100 }, expect: { errorCode: "unsupported-source" } },
  "loop-crossfade": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0.5, startSecond: 0, quality: 80 }, expect: { ext: "source", maxRatio: 0.9 * GENERATION } },
  "loop-crossfade-start": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0.5, startSecond: 1.5, quality: 100 }, expect: { ext: "source", maxRatio: 1.1 * GENERATION } },
  "loop-crossfade-gif-source": { tool: "loop", files: ["animation"], options: { technique: "crossfade", fadeDuration: 0.5, startSecond: 0, quality: 100 }, expect: { ext: "source", maxRatio: 1.1 } },
  "loop-crossfade-webp-source": { tool: "loop", files: ["animwebp"], options: { technique: "crossfade", fadeDuration: 0.5, startSecond: 0.5, quality: 100 }, expect: { ext: "source", maxRatio: 1.1 } },
  "loop-reorder": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0, startSecond: 1, quality: 100 }, expect: { ext: "source", maxRatio: 1.1 * GENERATION, frames: "source" } },
  // Next to a keyframe (2.03s) of the real smoke-assets footage, so it reorders
  // without re-encoding; synthetic clips have none there and get encoded.
  "loop-reorder-keyframe": { tool: "loop", files: ["video"], options: { technique: "crossfade", fadeDuration: 0, startSecond: 2, quality: 100 }, expect: { ext: "source", maxRatio: 1.1 * GENERATION, frames: "source" } },
  // VP9 has no B-frames for a cut to break; source.webm's next keyframe is 4.27s.
  "loop-reorder-webm-keyframe": { tool: "loop", files: ["webm"], options: { technique: "crossfade", fadeDuration: 0, startSecond: 4.2, quality: 100 }, expect: { ext: "source", maxRatio: 1.1, frames: "source" } },
  "loop-reorder-gif-source": { tool: "loop", files: ["animation"], options: { technique: "crossfade", fadeDuration: 0, startSecond: 1, quality: 100 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  "sequence-mp4": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "mp4", quality: 90 }, expect: { ext: "mp4" } },
  "sequence-gif": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "gif", quality: 90 }, expect: { ext: "gif" } },
  "sequence-gif-q50": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "gif", quality: 50 }, expect: { ext: "gif" } },
  "sequence-webp": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "webp", quality: 90 }, expect: { ext: "webp" } },
  "sequence-avif": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "avif", quality: 85 }, expect: { ext: "avif" } },
  "sequence-avif-lossless": { tool: "sequence", files: ["images"], options: { frameDuration: 0.5, format: "avif", quality: 100 }, expect: { ext: "avif" } },
  "convert-mp4": { tool: "convert", files: ["video"], options: { target: "mp4", quality: 60 }, expect: { ext: "mp4", maxRatio: 0.75 * GENERATION, frames: "source" } },
  "convert-mov": { tool: "convert", files: ["video"], options: { target: "mov", quality: 90 }, expect: { ext: "mov", maxRatio: 1.05 * GENERATION, frames: "source" } },
  "convert-webm": { tool: "convert", files: ["video"], options: { target: "webm", quality: 90 }, expect: { ext: "webm", maxRatio: 1 * GENERATION, minRatio: 0.4, frames: "source" } },
  "convert-webp": { tool: "convert", files: ["video"], options: { target: "webp", quality: 90 }, expect: { ext: "webp" } },
  // 100 is lossless only for a lossless source (encode/webp.ts); intra-only
  // WebP still outweighs inter-predicted video, AV1 sources most of all.
  "convert-webp-q100": { tool: "convert", files: ["video"], options: { target: "webp", quality: 100 }, expect: { ext: "webp", maxRatio: 3 } },
  "convert-gif-to-webp": { tool: "convert", files: ["animation"], options: { target: "webp", quality: 100 }, expect: { ext: "webp", maxRatio: 2 } },
  "convert-avif": { tool: "convert", files: ["video"], options: { target: "avif", quality: 70 }, expect: { ext: "avif", maxRatio: 0.75 } },
  "convert-avif-to-webp": { tool: "convert", files: ["avif"], options: { target: "webp", quality: 100 }, expect: { ext: "webp", maxRatio: 14 } },
  "convert-avif-to-webp-q90": { tool: "convert", files: ["avif"], options: { target: "webp", quality: 90 }, expect: { ext: "webp", maxRatio: 11 } },
  "convert-webp-source": { tool: "convert", files: ["animwebp"], options: { target: "mp4", quality: 90 }, expect: { ext: "mp4", frames: "source" } },
  "convert-gif": { tool: "convert", files: ["video"], options: { target: "gif", quality: 90, width: 200 }, expect: { ext: "gif" } },
  "convert-gif-fps": { tool: "convert", files: ["video"], options: { target: "gif", quality: 70, fps: 10, width: 160 }, expect: { ext: "gif" } },
  "convert-reject-anamorphic-source": { tool: "convert", files: ["anamorphic"], options: { target: "gif", quality: 90 }, expect: { errorCode: "unsupported-source" } },
  "speed-faster": { tool: "speed", files: ["video"], options: { speed: 1 }, expect: { ext: "source", maxRatio: 0.6 * GENERATION } },
  "speed-slower": { tool: "speed", files: ["video"], options: { speed: -1 }, expect: { ext: "source", maxRatio: 2.2 * GENERATION } },
  "speed-gif-source": { tool: "speed", files: ["animation"], options: { speed: 1 }, expect: { ext: "source", frames: "source", maxRatio: 1.2 } },
  // Only delays change; lossy stays lossy. No frame counts (see loop-reverse-webp-source).
  "speed-webp-source": { tool: "speed", files: ["animwebp"], options: { speed: 1 }, expect: { ext: "source", maxRatio: 1.3 } },
  "speed-webp-lossless-source": { tool: "speed", files: ["animwebp-lossless"], options: { speed: -1 }, expect: { ext: "source", maxRatio: 1.2 } },
  // Every AVIF frame must survive at roughly the source's bytes (guards against
  // dropped slideshow frames and halved bitrate).
  "speed-avif-source": { tool: "speed", files: ["avif"], options: { speed: 1 }, expect: { ext: "source", frames: "source", maxRatio: 1.2 * GENERATION, minRatio: 0.6 } },
  "speed-avif-slides": { tool: "speed", files: ["slides"], options: { speed: 1 }, expect: { ext: "source", frames: "source", maxRatio: 1.2 * GENERATION, minRatio: 0.6 } },
  "speed-slower-avif-slides": { tool: "speed", files: ["slides"], options: { speed: -1 }, expect: { ext: "source", frames: "source", maxRatio: 1.2 * GENERATION, minRatio: 0.6 } },
  "mark-plain": { tool: "mark", files: ["video", "logo"], options: { filter: "plain", quality: 90 }, expect: { ext: "source", maxRatio: 1.15 * GENERATION, frames: "source" } },
  "mark-glass": { tool: "mark", files: ["video", "logo"], options: { filter: "glass", quality: 100 }, expect: { ext: "source", maxRatio: 1.15 * GENERATION, frames: "source" } },
  "mark-glass-gif-source": { tool: "mark", files: ["animation", "logo"], options: { filter: "glass", quality: 90 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  "mark-glass-webp-anim-source": { tool: "mark", files: ["animwebp", "logo"], options: { filter: "glass", quality: 90 }, expect: { ext: "source", maxRatio: 1.2 } },
  "mark-plain-avif-source": { tool: "mark", files: ["avif", "logo"], options: { filter: "plain", quality: 100 }, expect: { ext: "source", maxRatio: 1.2 * GENERATION, frames: "source" } },
  // JPEG/lossy WebP stills are held to the source's size (encode/still.ts).
  "mark-plain-png-source": { tool: "mark", files: ["png", "logo"], options: { filter: "plain", quality: 100 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  "mark-glass-png-source": { tool: "mark", files: ["png", "logo"], options: { filter: "glass", quality: 100 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  "mark-glass-jpg-source": { tool: "mark", files: ["jpg", "logo"], options: { filter: "glass", quality: 100 }, expect: { ext: "source", maxRatio: 1.15, frames: "source" } },
  "mark-plain-jpg-turned": { tool: "mark", files: ["turned", "logo"], options: { filter: "plain", quality: 90 }, expect: { ext: "source", turned: true } },
  "mark-glass-webp-source": { tool: "mark", files: ["webp", "logo"], options: { filter: "glass", quality: 100 }, expect: { ext: "source", maxRatio: 1.15, frames: "source" } },
  "mark-blur": { tool: "mark", files: ["video", "logo"], options: { filter: "blur", quality: 100 }, expect: { ext: "source", maxRatio: 1.15 * GENERATION, frames: "source" } },
  "mark-blur-png-source": { tool: "mark", files: ["png", "logo"], options: { filter: "blur", quality: 100 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  "mark-glass-svg-logo": { tool: "mark", files: ["video", "svglogo"], options: { filter: "glass", quality: 100 }, expect: { ext: "source", maxRatio: 1.15 * GENERATION, frames: "source" } },
  "mark-plain-svg-logo-png-source": { tool: "mark", files: ["png", "svglogo"], options: { filter: "plain", quality: 100 }, expect: { ext: "source", maxRatio: 1.2, frames: "source" } },
  "preview-glass": { preview: true, files: ["frame", "logo"], options: { filter: "glass" } },
  "preview-blur": { preview: true, files: ["frame", "logo"], options: { filter: "blur" } },
  "preview-glass-svg": { preview: true, files: ["frame", "svglogo"], options: { filter: "glass" } },
};

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

function readArgs(argv) {
  const usage = () => {
    console.error(
      "usage: bun run smoke -- <label> [--diff <label>] [--only <text,text>] " +
        "[--ffmpeg <path>] [--assets <dir>]",
    );
    process.exit(2);
  };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        diff: { type: "string" },
        only: { type: "string" },
        ffmpeg: { type: "string" },
        assets: { type: "string" },
      },
    });
  } catch {
    usage();
  }
  const [label] = parsed.positionals;
  // A plain name: "." or ".." would make the rmSync below wipe .smoke or the repo.
  if (!label || !/^\w[\w.-]*$/.test(label)) usage();
  return { label, ...parsed.values };
}

function resolveAssets(ffmpeg, userDir, madeDir) {
  fs.mkdirSync(madeDir, { recursive: true });
  const ff = (...args) => {
    const r = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args]);
    if (r.status !== 0) throw new Error(`could not make an asset: ${r.stderr}`);
  };
  const made = (name) => path.join(madeDir, name);
  const listed = fs.existsSync(userDir) ? fs.readdirSync(userDir) : [];
  const own = (pattern) => {
    const name = listed.find((f) => pattern.test(f));
    return name ? [path.join(userDir, name)] : [];
  };
  const imagesDir = path.join(userDir, "images");
  const assets = {
    video: own(/^video\.\w+$/i),
    animation: own(/^animation\.gif$/i),
    logo: own(/^logo\.png$/i),
    svglogo: own(/^logo\.svg$/i),
    images: fs.existsSync(imagesDir)
      ? fs
          .readdirSync(imagesDir)
          .filter((f) => IMAGE_EXT.test(f))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .map((f) => path.join(imagesDir, f))
      : [],
  };
  const missing = Object.keys(assets).filter((role) => !assets[role].length);
  if (missing.length) {
    throw new Error(`missing smoke assets in ${userDir}: ${missing.join(", ")}`);
  }
  const [video] = assets.video;

  ff("-i", video, "-frames:v", "1", made("frame.jpg"));
  assets.frame = [made("frame.jpg")];

  // Falls back to encoding when the streams don't fit the container.
  const remux = (name, ...streams) => {
    try {
      ff("-i", video, ...streams, "-c", "copy", made(name));
    } catch {
      ff(
        "-i",
        video,
        ...streams,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        made(name),
      );
    }
    return [made(name)];
  };
  assets.mov = remux("source.mov");
  assets.mkv = remux("reject.mkv", "-map", "0:v:0");
  ff(
    "-i",
    video,
    "-t",
    "2",
    "-vf",
    "scale=160:-2,setsar=4/3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-an",
    made("reject-anamorphic.mp4"),
  );
  assets.anamorphic = [made("reject-anamorphic.mp4")];
  ff(
    "-i",
    video,
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-cpu-used",
    "5",
    "-row-mt",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "libopus",
    "-ac",
    "2",
    made("source.webm"),
  );
  assets.webm = [made("source.webm")];
  ff(
    "-i",
    video,
    "-t",
    "2",
    "-vf",
    "fps=15,scale=320:-2",
    "-c:v",
    "libaom-av1",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-cpu-used",
    "8",
    "-row-mt",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-f",
    "avif",
    made("source.avif"),
  );
  assets.avif = [made("source.avif")];
  ff(
    "-i",
    video,
    "-t",
    "3",
    "-vf",
    "fps=1,scale=320:-2",
    "-c:v",
    "libaom-av1",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-cpu-used",
    "8",
    "-row-mt",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-f",
    "avif",
    made("slides.avif"),
  );
  assets.slides = [made("slides.avif")];
  const animWebp = (name, ...codec) => {
    ff(
      "-i",
      video,
      "-t",
      "2",
      "-vf",
      "fps=10,scale=160:-2",
      "-c:v",
      "libwebp_anim",
      ...codec,
      "-loop",
      "0",
      "-an",
      made(name),
    );
    return [made(name)];
  };
  assets.animwebp = animWebp("anim.webp", "-q:v", "80");
  assets["animwebp-lossless"] = animWebp("anim-lossless.webp", "-lossless", "1");

  ff("-i", video, "-frames:v", "1", made("still.png"));
  assets.png = [made("still.png")];
  ff("-i", video, "-frames:v", "1", "-q:v", "4", made("still.jpg"));
  assets.jpg = [made("still.jpg")];
  ff("-i", video, "-frames:v", "1", "-c:v", "libwebp", "-q:v", "85", made("still.webp"));
  assets.webp = [made("still.webp")];
  // APP1 EXIF after SOI with one tag: Orientation (0x0112) = 6, rotate 90° CW.
  const tiff = Buffer.alloc(26);
  tiff.write("II");
  [
    [42, 2],
    [1, 8],
    [0x0112, 10],
    [3, 12],
    [6, 18],
  ].forEach(([v, at]) => tiff.writeUInt16LE(v, at));
  [
    [8, 4],
    [1, 14],
  ].forEach(([v, at]) => tiff.writeUInt32LE(v, at));
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.from([0xff, 0xe1, 0, exif.length + 2]);
  const jpeg = fs.readFileSync(made("still.jpg"));
  fs.writeFileSync(
    made("turned.jpg"),
    Buffer.concat([jpeg.subarray(0, 2), app1, exif, jpeg.subarray(2)]),
  );
  assets.turned = [made("turned.jpg")];

  return assets;
}

// x264 under a bitrate cap isn't bit-exact across runs (thread timing affects
// rate control); sizes within ~1% are the same result.
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

const { FFmpeg } = await load("api/_lib/ffmpeg.ts");
const { TOOLS } = await load("api/_lib/tools/index.ts");
const { renderWatermarkFrame } = await load("api/_lib/tools/mark.ts");
// binaries.ts resolves gifski from the cwd, as it does on Vercel.
process.chdir(root);
const binaries = await load("api/_lib/binaries.ts");
const ffmpegPath = args.ffmpeg ?? binaries.ffmpegPath;
const ffmpegCheck = checkFfmpeg(ffmpegPath, {
  version: args.ffmpeg ? undefined : pinnedVersion(),
});
if (ffmpegCheck.problems.length) {
  console.error(
    `${ffmpegPath} (${ffmpegCheck.version}) won't do:\n  ${ffmpegCheck.problems.join("\n  ")}`,
  );
  process.exit(1);
}

const userDir = path.resolve(root, args.assets ?? "scripts/smoke-assets");
const userDirShown = userDir.startsWith(root) ? path.relative(root, userDir) : userDir;
const assets = resolveAssets(ffmpegPath, userDir, path.join(outDir, "assets"));
const bytesOf = (paths) => paths.reduce((sum, p) => sum + fs.statSync(p).size, 0);
const describe = (paths) =>
  paths.length === 1
    ? `${path.basename(paths[0])} ${bytesOf(paths)}`
    : `${paths.length} files ${bytesOf(paths)}`;

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

let workDir = "";
const recorded = [];
const normalize = (arg) =>
  arg
    .split(workDir)
    .join("<work>")
    .split(ffmpegPath)
    .join("ffmpeg")
    .split(binaries.gifskiPath)
    .join("gifski")
    .replace(/tmp_loop_\d+/g, "tmp_loop_N");
class Recorder extends FFmpeg {
  run(command, commandArgs, options) {
    recorded.push([command, ...commandArgs].map(normalize).join(" "));
    return super.run(command, commandArgs, options);
  }
}

// Silence the tools' step logging.
const say = console.log;
console.log = console.error = () => {};

say(`assets from ${userDirShown}\n`);

const commands = {};
const broken = {};
// Recorded so diffs across different inputs/ffmpeg builds show it.
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
      outputPath = await renderWatermarkFrame(
        { ff, workDir },
        { frameFile: frame, logoFile: logo, filter: options.filter },
      );
      downloadName = path.basename(outputPath);
    } else {
      const urls = files.map((f) => BLOB + encodeURIComponent(path.basename(f)));
      const request =
        tool === "sequence"
          ? { blobUrls: urls, options }
          : { blobUrl: urls[0], watermarkUrl: urls[1], options };
      const inputs = TOOLS[tool].inputs(request);
      if (!Array.isArray(inputs)) throw new Error(inputs.error);
      const result = await TOOLS[tool].run({
        ff,
        workDir,
        inputs,
        options,
        download,
      });
      outputPath = result.outputPath;
      downloadName = `${path.parse(source[0]).name}_${result.suffix}.${result.ext}`;
    }
    // Fresh instance so probes aren't recorded.
    const info = await new FFmpeg(ffmpegPath, "").mediaInfo(outputPath).catch(() => null);
    const bytes = fs.statSync(outputPath).size;
    // Decoded, not duration*fps: a frame lost at a cut shows in neither.
    const prober = new FFmpeg(ffmpegPath, "");
    const countFrames = (file) => prober.decodedFrames(file);
    results[name] = {
      source: describe(source),
      output: downloadName,
      bytes,
      ratio: Number((bytes / bytesOf(source)).toFixed(2)),
      ...(expect?.frames
        ? {
            frames: await countFrames(outputPath),
            sourceFrames: await countFrames(source[0]),
          }
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
      error: String(err?.message ?? err)
        .trim()
        .split("\n")
        .pop(),
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
  const read = (file) => JSON.parse(fs.readFileSync(path.join(smokeDir, args.diff, file), "utf8"));
  say(`\ncompared with "${args.diff}":`);
  console.log = say;
  const sameCommands = diff("commands", read("commands.json"), commands, (c) => c.join("\n"));
  const sameResults = diff(
    "results",
    read("results.json"),
    results,
    (r) =>
      Object.entries(r)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n"),
    sameResult,
  );
  process.exit(sameCommands && sameResults && !brokenNames.length ? 0 : 1);
}
process.exit(brokenNames.length ? 1 : 0);
