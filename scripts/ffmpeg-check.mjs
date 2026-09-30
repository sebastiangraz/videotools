// Checks an ffmpeg has the pinned version and everything api/_lib/ spawns it
// with, so a build missing a library fails here rather than on a user's file.
//
//   node scripts/ffmpeg-check.mjs [<ffmpeg path>]   default: the pinned one
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { binaryPath, readManifest } from "./binaries.mjs";

export const pinnedVersion = () => readManifest("ffmpeg").version;

const NEEDS = {
  encoders: [
    "libx264", "aac", "libvpx-vp9", "libopus", "libaom-av1",
    "libwebp", "libwebp_anim", "mjpeg", "png",
  ],
  muxers: ["mp4", "webm", "avif", "webp", "image2", "framecrc", "null"],
  demuxers: ["concat", "image2", "webp_anim"],
  // What the sources are read with where a build could lack it: animated
  // WebP has a decoder of its own (source.ts goes by its demuxer), and an
  // SVG logo is drawn by librsvg (tools/mark.ts)
  decoders: ["webp", "webp_anim", "librsvg"],
  // lavfi, which the smoke run synthesizes its inputs through, is a device
  devices: ["lavfi"],
  filters: [
    "fps", "scale", "pad", "setsar", "format", "split", "reverse", "concat",
    "trim", "setpts", "xfade", "crop", "null", "overlay",
    "premultiply", "unpremultiply", "alphaextract", "alphamerge", "bbox",
    "gblur", "lut", "lutrgb", "convolution", "extractplanes", "mergeplanes",
    "remap", "negate", "colorchannelmixer", "erosion", "blend", "geq",
    // lavfi sources the smoke run synthesizes its inputs from
    "testsrc2", "sine",
  ],
};

// `ffmpeg -version`'s first line, e.g. "ffmpeg version n8.1.3-20260922 …".
function ffmpegVersion(ffmpeg) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-version"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${ffmpeg} -version: ${r.stderr || r.error}`);
  return /^ffmpeg version (\S+)/.exec(r.stdout)?.[1] ?? "unknown";
}

// Everything that's wrong with this ffmpeg; empty when it will do. With
// `version`, a different version counts as wrong too.
export function checkFfmpeg(ffmpeg, { version } = {}) {
  const problems = [];
  const found = ffmpegVersion(ffmpeg);
  // BtbN builds say "n8.1.3-20260922", a branch head "n9.0.2-3-ga5923073bf-…".
  const bare = found.replace(/^n/, "");
  if (version && !(bare === version || bare.startsWith(`${version}-`))) {
    problems.push(`version ${found}, ffmpeg.json pins ${version}`);
  }
  for (const [kind, names] of Object.entries(NEEDS)) {
    const r = spawnSync(ffmpeg, ["-hide_banner", `-${kind}`], { encoding: "utf8" });
    // Each listing row is "<flags> <name>[,<alias>] <description>".
    const listed = new Set(
      r.stdout.split("\n").flatMap((line) => line.trim().split(/\s+/)[1]?.split(",") ?? []),
    );
    const missing = names.filter((n) => !listed.has(n));
    if (missing.length) problems.push(`no ${kind}: ${missing.join(", ")}`);
  }
  return { version: found, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ffmpeg = process.argv[2] ?? binaryPath("ffmpeg");
  const { version, problems } = checkFfmpeg(ffmpeg, {
    version: process.argv[2] ? undefined : pinnedVersion(),
  });
  if (problems.length) {
    console.error(`${ffmpeg} (${version}) won't do:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`${ffmpeg}: ffmpeg ${version}, has everything the api uses`);
}
