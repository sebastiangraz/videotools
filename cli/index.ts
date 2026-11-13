#!/usr/bin/env node
// The app's tools, run natively (binaries.ts, exec.ts) on many files, a job
// at a time: one per file, or one for all of a sequence's images. Results are
// named as the app names its downloads.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { InputError } from "@videotools/core/errors";
import { FFmpeg } from "@videotools/core/ffmpeg";
import {
  FOREIGN,
  FORMATS,
  SEQUENCE_FORMATS,
  STILLS,
  TOOL_IDS,
  isToolId,
  resultFile,
  verboseName,
  type ToolId,
} from "@videotools/core/formats";
import { removeDir } from "@videotools/core/helpers";
import { runTool } from "@videotools/core/tools/index";
import { VALID_TECHNIQUES } from "@videotools/core/tools/loop";
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

// A page's control. The tools take any value outside what the page offers as
// their default, so a typo is turned away here instead.
type Flag = {
  // The value's name in --help; a flag without one is a switch.
  arg?: string;
  values?: readonly string[];
  // A number's [min, max].
  range?: readonly [number, number];
  // Where the page starts.
  default?: string;
  required?: boolean;
  // The page shows the control only while that flag has that value.
  only?: readonly [string, string];
  help?: string;
};
type Values = Record<string, string | boolean | undefined>;

// Every page's slider starts at the top, above some tools' own fallback; the
// range is the one each tool clamps to.
const QUALITY: Flag = { arg: "n", range: [1, 100], default: "100" };

// What a folder gives a tool: the files its page's picker takes that the tool
// reads, by extension.
const VIDEOS = FORMATS.flatMap((format) => format.extensions);
// Sequence's picker takes image/*.
const IMAGES = [...FORMATS, ...STILLS]
  .filter((format) => format.mime.startsWith("image/"))
  .flatMap((format) => format.extensions);

// Ranges and lists that live only in the pages or as literals in the tools
// are written here, each once.
const COMMANDS: Record<
  ToolId,
  {
    about: string;
    takes: readonly string[];
    flags: Record<string, Flag>;
    // The tool's options for a job whose first file is `file`.
    options: (values: Values, file: string) => Record<string, unknown>;
    // One job of all the files, in the order given.
    together?: boolean;
  }
> = {
  loop: {
    about: "Loop each video seamlessly",
    takes: VIDEOS,
    flags: {
      technique: { arg: "how", values: VALID_TECHNIQUES, default: "crossfade" },
      fade: {
        arg: "seconds",
        range: [0, Infinity],
        default: "0.5",
        only: ["technique", "crossfade"],
      },
      start: {
        arg: "seconds",
        range: [0, Infinity],
        default: "0",
        only: ["technique", "crossfade"],
        help: "where the loop starts",
      },
      quality: QUALITY,
    },
    options: (values) => ({
      technique: values.technique,
      fadeDuration: Number(values.fade),
      startSecond: Number(values.start),
      quality: Number(values.quality),
    }),
  },
  sequence: {
    about: "Make one video or animation of all the images, in the order given",
    takes: IMAGES,
    together: true,
    flags: {
      "frame-duration": {
        arg: "seconds",
        range: [0.1, Infinity],
        default: "1",
        help: "how long each image shows",
      },
      format: { arg: "format", values: SEQUENCE_FORMATS, default: "mp4" },
      quality: QUALITY,
    },
    options: (values) => ({
      frameDuration: Number(values["frame-duration"]),
      format: values.format,
      quality: Number(values.quality),
    }),
  },
  speed: {
    about: "Speed each video up or slow it down",
    takes: VIDEOS,
    flags: {
      speed: {
        arg: "n",
        range: [-3, 3],
        default: "0",
        help: "1 is twice as fast, -1 half as fast, 3 and -3 four times; a negative as --speed=-1",
      },
    },
    options: (values) => ({ speed: Number(values.speed) }),
  },
  convert: {
    about: "Convert each video to another format",
    takes: [...VIDEOS, ...FOREIGN],
    flags: {
      to: {
        arg: "format",
        values: FORMATS.map((format) => format.id),
        help: "by default mp4, or webm for an mp4",
      },
      quality: QUALITY,
      fps: { arg: "n", range: [1, 30], only: ["to", "gif"], help: "by default the source's" },
      width: { arg: "px", range: [100, 800], default: "640", only: ["to", "gif"] },
    },
    options: (values, file) => ({
      // The page never offers a file's own format, so starts on the next.
      target:
        values.to ?? FORMATS.find((format) => !format.extensions.includes(extension(file)))!.id,
      quality: Number(values.quality),
      ...(values.to === "gif" && {
        // null: the source's, as the page's empty field.
        fps: values.fps === undefined ? null : Number(values.fps),
        width: Number(values.width),
      }),
    }),
  },
  mark: {
    about: "Watermark each video or image",
    takes: [...VIDEOS, ...STILLS.flatMap((still) => still.extensions)],
    flags: {
      logo: { arg: "png|svg", required: true, help: "the watermark" },
      position: { arg: "at", values: Object.keys(MARK_POSITIONS), default: "bottom-right" },
      size: {
        arg: "size",
        values: Object.keys(MARK_SIZES).filter((size) => size !== "dev"),
        default: "medium",
      },
      filter: { arg: "filter", values: MARK_FILTERS, default: "glass" },
      shuffle: { help: "move the mark around a video, from --position on" },
      quality: QUALITY,
    },
    options: (values) => ({
      filter: values.filter,
      size: values.size,
      position: values.position,
      // A new one each file, as the page draws one each export.
      route: values.shuffle ? shuffleRoute(values.position as MarkPosition) : null,
      quality: Number(values.quality),
    }),
  },
};
const OUT: Flag = { arg: "dir", help: "where results go, by default the current folder" };
const VERBOSE_NAMES: Flag = {
  help: "name results after the source's full name and their settings",
};

const extension = (file: string) => path.extname(file).slice(1).toLowerCase();
const within = ([min, max]: readonly [number, number]) =>
  max === Infinity ? `from ${min} up` : `from ${min} to ${max}`;

// A tool in any case, as it's shown in capitals.
const tool = process.argv[2]?.toLowerCase();
const args = process.argv.slice(3);
const flags = {
  ...(isToolId(tool) && COMMANDS[tool].flags),
  out: OUT,
  "verbose-names": VERBOSE_NAMES,
};
const help = isToolId(tool)
  ? `Usage: videotools ${tool.toUpperCase()} <file|folder|glob>...${Object.entries(flags)
      .filter(([, flag]) => flag.required)
      .map(([name, flag]) => ` --${name} <${flag.arg}>`)
      .join("")} [options]

${COMMANDS[tool].about}.

Options:
${Object.entries(flags)
  .map(([name, flag]) => {
    const notes = [
      flag.default && `default: ${flag.default}`,
      flag.required && "required",
      flag.only && `only with --${flag.only[0]} ${flag.only[1]}`,
    ].filter(Boolean);
    return `  ${`--${name}${flag.arg ? ` <${flag.arg}>` : ""}`.padEnd(28)}${[
      flag.values?.join("|"),
      flag.range && within(flag.range),
      flag.help,
    ]
      .filter(Boolean)
      .join(": ")}${notes.length ? ` (${notes.join("; ")})` : ""}`;
  })
  .join("\n")}
`
  : `Usage: videotools <TOOL> <file|folder|glob>... [options]
       videotools <TOOL> --help
       videotools --version

The web app's tools on native ffmpeg, a job at a time: one per file, or one
for all of a sequence's images. A folder means the files in it that the tool
takes; a glob is expanded. Results are named as the app names its downloads,
or after their settings with --verbose-names. The first run downloads ffmpeg
and gifski.

Tools:
${TOOL_IDS.map((id) => `  ${id.toUpperCase().padEnd(10)}${COMMANDS[id].about}`).join("\n")}
`;

function usage(problem: string): never {
  process.stderr.write(`${problem}\n\n${help}`);
  process.exit(2);
}

if (tool === "--help") {
  process.stdout.write(help);
  process.exit(0);
}
if (tool === "--version") {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}
if (!isToolId(tool)) usage(tool ? `Unknown tool: ${tool.toUpperCase()}` : "No tool given");
const command = COMMANDS[tool];

let parsed;
try {
  parsed = parseArgs({
    args,
    options: {
      ...Object.fromEntries(
        Object.entries(flags).map(([name, flag]) => [
          name,
          { type: flag.arg ? ("string" as const) : ("boolean" as const) },
        ]),
      ),
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });
} catch (err) {
  usage((err as Error).message);
}
const given: Values = parsed.values;
if (given.help) {
  process.stdout.write(help);
  process.exit(0);
}
const inputs = parsed.positionals;
if (!inputs.length) usage("No files given");
const values: Values = {
  ...Object.fromEntries(Object.entries(flags).map(([name, flag]) => [name, flag.default])),
  ...given,
};
for (const [name, flag] of Object.entries(flags)) {
  const value = given[name];
  if (value === undefined) {
    if (flag.required) usage(`No --${name} given`);
    continue;
  }
  if (flag.values && !flag.values.includes(String(value))) {
    usage(`--${name} must be one of ${flag.values.join(", ")}`);
  }
  if (flag.range && !(Number(value) >= flag.range[0] && Number(value) <= flag.range[1])) {
    usage(`--${name} must be a number ${within(flag.range)}`);
  }
  if (flag.only && values[flag.only[0]] !== flag.only[1]) {
    usage(`--${name} goes only with --${flag.only[0]} ${flag.only[1]}`);
  }
}
const logo = values.logo as string | undefined;
if (logo !== undefined && !fs.existsSync(logo)) usage(`No such logo: ${logo}`);

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const found = inputs.map((input) => {
  // A path that exists is that path, glob characters and all.
  const files = (fs.existsSync(input) ? [input] : fs.globSync(input))
    .flatMap((name) =>
      fs.statSync(name).isDirectory()
        ? fs
            .readdirSync(name, { withFileTypes: true })
            .filter((entry) => entry.isFile() && command.takes.includes(extension(entry.name)))
            .map((entry) => path.join(name, entry.name))
        : [name],
    )
    .map((file) => path.resolve(file))
    .sort(natural);
  if (!files.length) usage(`Nothing for ${tool.toUpperCase()} in ${input}`);
  return files;
});
// A sequence's images in the order given, repeats and all; any other tool
// takes each file once.
const sources = command.together ? found.flat() : [...new Set(found.flat())].sort(natural);
// ffmpeg reads a sequence's images through one demuxer: a mix of formats comes
// back blank or missing, so the page turns one away too.
if (command.together) {
  const formats = new Set(
    sources.map(
      (file) =>
        [...FORMATS, ...STILLS].find((format) => format.extensions.includes(extension(file)))?.id ??
        extension(file),
    ),
  );
  if (formats.size > 1) usage(`Use images of one format, not ${[...formats].join(", ")}`);
}
const jobs = command.together ? [sources] : sources.map((source) => [source]);

const out = (values.out as string | undefined) ?? ".";
// Resolved: on Windows, Bun's recursive mkdir throws for "." and "..".
fs.mkdirSync(path.resolve(out), { recursive: true });

// The folder of the job running, for Ctrl+C to remove.
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
for (const [n, job] of jobs.entries()) {
  const more = job.length > 1 ? ` and ${job.length - 1} more` : "";
  const label = `[${n + 1}/${jobs.length}] ${path.basename(job[0])}${more}`;
  process.stdout.write(tty ? label : `${label}\n`);
  const ff = new FFmpeg(binaryPath("ffmpeg"), binaryPath("gifski"), resvgUrl, execBinary);
  if (tty) {
    ff.onProgress = (done) => process.stdout.write(`\r\x1b[2K${label} ${Math.floor(done * 100)}%`);
  }
  // Sync, so no Ctrl+C lands between the folder and workDir.
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "videotools-"));
  try {
    // Mark's logo is its last input.
    const files = logo === undefined ? job : [...job, logo];
    const options = command.options(values, job[0]);
    const { outputPath, suffix, ext } = await runTool(ff, tool, files, options, workDir);
    const source = path.parse(job[0]);
    const name = values["verbose-names"]
      ? verboseName(source.name, logo === undefined ? [] : [path.basename(logo)], options, ext)
      : resultFile(source.base, suffix, ext).name;
    if (written.has(name)) throw new Error(`An earlier file was written as ${name}`);
    written.add(name);
    const result = path.join(out, name);
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
