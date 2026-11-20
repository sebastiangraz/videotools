// Header icons: each tool with a storyboard here (<tool>.ts) rendered over the
// clips in assets/ into client/src/icons/<tool>-<theme>.webp, an atlas of every
// frame that Layout's ToolIcon plays on a canvas.
//
//   bun run icons          every tool with a storyboard
//   bun run icons loop     only these
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FFmpeg } from "@videotools/core/ffmpeg";
import { TOOL_IDS } from "@videotools/core/formats";
import { svgToPng } from "@videotools/core/svg";
import { binaryPath, install, resvgUrl } from "../../cli/binaries.js";
import { execBinary } from "../../cli/exec.js";
import { formatBytes } from "../../client/src/helpers.js";
import { ICON } from "../../client/src/tools.js";

// --fg and --bg from client/src/index.css. Its other colours are fg at an
// opacity: color-mix(fg N%, bg) is fg at N% over bg.
const PALETTES = {
  light: { fg: "hsl(152, 74%, 5%)", bg: "hsl(156, 20%, 94%)" },
  dark: { fg: "hsl(150, 28%, 85%)", bg: "hsl(150, 10%, 6%)" },
};

// The atlas holds each frame at twice this.
const CELL = 108;

// A tool's icon, simulated. `frame` draws time `t`, in [0, duration), as SVG in
// a CELL square: the subject in its middle 72, everything a few px clear of the
// edges, where VP8 blocks straddle cells. frame(duration) must equal frame(0).
// `clips` name files in assets/; frame gets each as PNG data URIs at ICON.fps,
// a still as one. resvg draws no <text> and ignores pathLength, CSS transforms
// and color-mix().
export type Storyboard = {
  duration: number;
  clips: Record<string, string>;
  frame: (t: number, clips: Record<string, string[]>, palette: typeof PALETTES.light) => string;
};

const dir = import.meta.dirname;
const root = path.join(dir, "..", "..");
const available: string[] = TOOL_IDS.filter((id) => fs.existsSync(path.join(dir, `${id}.ts`)));
const names = process.argv.slice(2);
if (names.some((name) => !available.includes(name))) {
  console.error(`usage: bun run icons [${available.join("|")}...]`);
  process.exit(2);
}

await install("ffmpeg");
const ff = new FFmpeg(binaryPath("ffmpeg"), "", "", execBinary);
// The runner logs every command; only the sizes matter here.
console.log = () => {};

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "icons-"));
try {
  for (const tool of names.length ? names : available) {
    const storyboard: Storyboard = (await import(`./${tool}.ts`)).default;
    const count = storyboard.duration * ICON.fps;
    // Full rows, so the player can count frames from the atlas's height.
    if (count % ICON.columns) {
      throw new Error(`${tool}: ${count} frames don't fill rows of ${ICON.columns}`);
    }
    const rows = count / ICON.columns;

    const clips: Record<string, string[]> = {};
    for (const [name, file] of Object.entries(storyboard.clips)) {
      const frames = path.join(workDir, `${tool}-${name}`);
      fs.mkdirSync(frames);
      await ff.runFFmpeg([
        "-i",
        path.join(dir, "assets", file),
        // Covering twice the subject, the atlas's density.
        "-vf",
        `fps=${ICON.fps},scale=144:144:force_original_aspect_ratio=increase:flags=lanczos`,
        path.join(frames, "%04d.png"),
      ]);
      clips[name] = fs
        .readdirSync(frames)
        .sort()
        .map(
          (png) =>
            `data:image/png;base64,${fs.readFileSync(path.join(frames, png)).toString("base64")}`,
        );
    }

    for (const [theme, palette] of Object.entries(PALETTES)) {
      const cells = Array.from(
        { length: count },
        (_, i) =>
          `<svg x="${(i % ICON.columns) * CELL}" y="${Math.floor(i / ICON.columns) * CELL}" width="${CELL}" height="${CELL}">` +
          `${storyboard.frame(i / ICON.fps, clips, palette)}</svg>`,
      );
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON.columns * CELL}" height="${rows * CELL}">${cells.join("")}</svg>`;
      const png = await svgToPng(
        resvgUrl,
        new TextEncoder().encode(svg),
        Math.max(ICON.columns, rows) * CELL * 2,
      );
      const atlas = path.join(workDir, `${tool}-${theme}.png`);
      fs.writeFileSync(atlas, png);
      const webp = path.join(root, "client", "src", "icons", `${tool}-${theme}.webp`);
      // Lossy, its alpha lossless.
      await ff.runFFmpeg([
        "-y",
        "-i",
        atlas,
        "-c:v",
        "libwebp",
        "-pix_fmt",
        "bgra",
        "-preset",
        "icon",
        "-q:v",
        "85",
        "-compression_level",
        "6",
        webp,
      ]);
      process.stdout.write(
        `${path.relative(root, webp)}  ${formatBytes(fs.statSync(webp).size)}\n`,
      );
    }
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
