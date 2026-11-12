#!/usr/bin/env node
// The app's tools, run natively (binaries.ts, exec.ts) on many files: one
// job per file, one at a time, each named as the app names its download.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { InputError } from "@videotools/core/errors";
import { FFmpeg } from "@videotools/core/ffmpeg";
import { FORMATS, STILLS, resultFile } from "@videotools/core/formats";
import { removeDir } from "@videotools/core/helpers";
import { runTool } from "@videotools/core/tools/index";
import {
  MARK_FILTERS,
  MARK_POSITIONS,
  MARK_SIZES,
  shuffleRoute,
  type MarkPosition,
} from "@videotools/core/tools/mark-config";
import { binaryPath, install, resvgUrl } from "./binaries.js";
import { execBinary, running } from "./exec.js";
import pkg from "./package.json" with { type: "json" };

// What Mark's page offers. The tool takes any other value as its default, so
// a typo is turned away here instead.
const CHOICES: Record<"position" | "size" | "filter", readonly string[]> = {
  position: Object.keys(MARK_POSITIONS),
  size: Object.keys(MARK_SIZES).filter((size) => size !== "dev"),
  filter: MARK_FILTERS,
};

// Defaults are what the page starts on.
const OPTIONS = {
  logo: { type: "string" },
  position: { type: "string", default: "bottom-right" },
  size: { type: "string", default: "medium" },
  filter: { type: "string", default: "glass" },
  shuffle: { type: "boolean" },
  // The page's slider starts at the top; the tool's own fallback is lower.
  quality: { type: "string", default: "100" },
  out: { type: "string", default: "." },
  help: { type: "boolean" },
  version: { type: "boolean" },
} as const;

// The range mark.ts clamps quality to.
const QUALITY = { min: 1, max: 100 };

const USAGE = `Usage: video-tools mark <file|folder|glob>... --logo <png|svg> [options]
       video-tools --help | --version

Watermarks each file as the web app's Mark does. A folder means the files in
it that Mark takes; a glob is expanded. The first run downloads ffmpeg and
gifski.

Options:
  --position <at>    ${CHOICES.position.join("|")}
                     (default: ${OPTIONS.position.default})
  --size <size>      ${CHOICES.size.join("|")} (default: ${OPTIONS.size.default})
  --filter <filter>  ${CHOICES.filter.join("|")} (default: ${OPTIONS.filter.default})
  --shuffle          move the mark around a video, from --position on
  --quality <n>      ${QUALITY.min}-${QUALITY.max} (default: ${OPTIONS.quality.default})
  --out <dir>        where results go (default: the current folder)
`;

function usage(problem: string): never {
  process.stderr.write(`${problem}\n\n${USAGE}`);
  process.exit(2);
}

let args;
try {
  args = parseArgs({ options: OPTIONS, allowPositionals: true });
} catch (err) {
  usage((err as Error).message);
}
const { values, positionals } = args;
if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (values.version) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

const [tool, ...inputs] = positionals;
if (tool !== "mark") usage(tool ? `Unknown tool: ${tool}` : "No tool given");
if (!inputs.length) usage("No files given");
const logo = values.logo ?? usage("No --logo given");
if (!fs.existsSync(logo)) usage(`No such logo: ${logo}`);
for (const [flag, allowed] of Object.entries(CHOICES)) {
  const value = values[flag as keyof typeof CHOICES];
  if (!allowed.includes(value)) usage(`--${flag} must be one of ${allowed.join(", ")}`);
}
const quality = Number(values.quality);
if (!(quality >= QUALITY.min && quality <= QUALITY.max)) {
  usage(`--quality must be a number from ${QUALITY.min} to ${QUALITY.max}`);
}

// The extensions Mark's page takes that the tool can read.
const MARKABLE = [...FORMATS, ...STILLS].flatMap((format) => format.extensions);
const files = new Set<string>();
for (const input of inputs) {
  // A path that exists is that path, glob characters and all.
  const found = (fs.existsSync(input) ? [input] : fs.globSync(input)).flatMap((name) =>
    fs.statSync(name).isDirectory()
      ? fs
          .readdirSync(name, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isFile() && MARKABLE.includes(path.extname(entry.name).slice(1).toLowerCase()),
          )
          .map((entry) => path.join(name, entry.name))
      : [name],
  );
  if (!found.length) usage(`Nothing to mark in ${input}`);
  for (const file of found) files.add(path.resolve(file));
}
const sources = [...files].sort();

fs.mkdirSync(values.out, { recursive: true });

// The folder of the file being marked, for Ctrl+C to remove.
let workDir: string | undefined;
const abort = () => {
  for (const child of running) child.kill("SIGKILL");
  // Windows holds a child's files a moment past its kill.
  for (let tries = 0; workDir && fs.existsSync(workDir) && tries < 100; tries++) {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  process.exit(130);
};
process.on("SIGINT", abort).on("SIGTERM", abort);

await install("ffmpeg");
await install("gifski");
// The runner logs every command; the lines below are the user's.
console.log = console.error = () => {};

const tty = process.stdout.isTTY;
const written = new Set<string>();
let failed = false;
for (const [n, file] of sources.entries()) {
  const label = `[${n + 1}/${sources.length}] ${path.basename(file)}`;
  process.stdout.write(tty ? label : `${label}\n`);
  const ff = new FFmpeg(binaryPath("ffmpeg"), binaryPath("gifski"), resvgUrl, execBinary);
  if (tty) {
    ff.onProgress = (done) => process.stdout.write(`\r\x1b[2K${label} ${Math.floor(done * 100)}%`);
  }
  // Sync, so no Ctrl+C lands between the folder and workDir.
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "videotools-"));
  try {
    const options = {
      filter: values.filter,
      size: values.size,
      position: values.position,
      // A new one each file, as the page draws one each export.
      route: values.shuffle ? shuffleRoute(values.position as MarkPosition) : null,
      quality,
    };
    const { outputPath, suffix, ext } = await runTool(ff, "mark", [file, logo], options, workDir);
    const { name } = resultFile(path.basename(file), suffix, ext);
    if (written.has(name)) throw new Error(`An earlier file was written as ${name}`);
    written.add(name);
    const result = path.join(values.out, name);
    // Sync, so Ctrl+C never leaves half a result.
    fs.copyFileSync(outputPath, result);
    process.stdout.write(`${tty ? "\n" : ""}  ${result}\n`);
  } catch (err) {
    failed = true;
    // Short of an InputError's advice, the last line (ffmpeg's or the
    // system's) says what went wrong.
    const message =
      err instanceof InputError
        ? err.message
        : `Failed: ${String(err instanceof Error ? err.message : err)
            .trim()
            .split(/[\r\n]+/)
            .at(-1)}`;
    process.stdout.write(tty ? "\n" : "");
    process.stderr.write(`  ${message}\n`);
  } finally {
    await removeDir(workDir);
  }
}
process.exitCode = failed ? 1 : 0;
