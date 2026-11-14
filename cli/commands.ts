// The app's tools as commands, run natively (binaries.ts, exec.ts): their
// flags, the jobs for some files, and a job's run. For the terminal
// (index.ts) and MCP clients alike.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InputError } from "@videotools/core/errors";
import { FFmpeg } from "@videotools/core/ffmpeg";
import {
  FOREIGN,
  FORMATS,
  RANGES,
  SEQUENCE_FORMATS,
  STILLS,
  resultFile,
  verboseName,
  type ToolId,
} from "@videotools/core/formats";
import { removeDir } from "@videotools/core/helpers";
import { runTool } from "@videotools/core/tools/index";
import { VALID_TECHNIQUES } from "@videotools/core/tools/loop";
import {
  MARK_FILTERS,
  MARK_SIZES,
  POSITIONS,
  shuffleRoute,
  type MarkPosition,
} from "@videotools/core/tools/mark-config";
import { binaryPath, resvgUrl } from "./binaries.js";
import { execBinary, running } from "./exec.js";

// A page's control. A tool runs a value its page doesn't offer as its default,
// or a number as the nearest end, so a typo is turned away here instead.
export type Flag = {
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
export type Values = Record<string, string | boolean | undefined>;

// Every page's slider starts at the top, above some tools' own fallback.
const QUALITY: Flag = {
  arg: "n",
  range: RANGES.quality,
  default: "100",
  help: "100 keeps the source's quality, lower makes a smaller file",
};

// What a folder gives a tool: the files its page's picker takes that the tool
// reads, by extension.
const VIDEOS = FORMATS.flatMap((format) => format.extensions);
// Sequence's picker takes image/*.
const IMAGES = [...FORMATS, ...STILLS]
  .filter((format) => format.mime.startsWith("image/"))
  .flatMap((format) => format.extensions);

export const COMMANDS: Record<
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
      technique: {
        arg: "how",
        values: VALID_TECHNIQUES,
        default: "crossfade",
        help: "reverse plays forwards then backwards, crossfade fades the end into the start",
      },
      fade: {
        arg: "seconds",
        range: RANGES.fadeDuration,
        default: "0.5",
        help: "how long the fade lasts",
        only: ["technique", "crossfade"],
      },
      start: {
        arg: "seconds",
        range: RANGES.startSecond,
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
        range: RANGES.frameDuration,
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
        range: RANGES.speed,
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
      fps: { arg: "n", range: RANGES.fps, only: ["to", "gif"], help: "by default the source's" },
      width: { arg: "px", range: RANGES.width, default: "640", only: ["to", "gif"] },
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
      logo: { arg: "png|svg", required: true, help: "the watermark, a PNG or SVG" },
      position: { arg: "at", values: POSITIONS, default: "bottom-right" },
      size: {
        arg: "size",
        values: Object.keys(MARK_SIZES).filter((size) => size !== "dev"),
        default: "medium",
      },
      filter: {
        arg: "filter",
        values: MARK_FILTERS,
        default: "glass",
        help: "plain lays the logo on as it is, glass turns it into frosted glass that bends what is behind it, blur into a blur of what is behind it",
      },
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

// A tool's flags, and those every tool has.
export const flagsOf = (tool: ToolId): Record<string, Flag> => ({
  ...COMMANDS[tool].flags,
  out: { arg: "dir", help: "where results go, by default the current folder" },
  "verbose-names": { help: "name results after the source's full name and their settings" },
});

const extension = (file: string) => path.extname(file).slice(1).toLowerCase();
export const within = ([min, max]: readonly [number, number]) =>
  max === Infinity ? `from ${min} up` : `from ${min} to ${max}`;
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const refuse = (problem: string) => new InputError(problem, "invalid-option");

// The flags given over their defaults, and the jobs for `inputs`. Throws an
// InputError for a value the tool's page doesn't offer, or a missing file.
export function prepare(tool: ToolId, given: Values, inputs: string[]) {
  if (!inputs.length) throw refuse("No files given");
  const flags = flagsOf(tool);
  const values: Values = {
    ...Object.fromEntries(Object.entries(flags).map(([name, flag]) => [name, flag.default])),
    ...given,
  };
  for (const [name, flag] of Object.entries(flags)) {
    const value = given[name];
    if (value === undefined) {
      if (flag.required) throw refuse(`No --${name} given`);
      continue;
    }
    if (flag.values && !flag.values.includes(String(value))) {
      throw refuse(`--${name} must be one of ${flag.values.join(", ")}`);
    }
    // Number("") is 0.
    const n = Number(value || NaN);
    if (flag.range && !(n >= flag.range[0] && n <= flag.range[1])) {
      throw refuse(`--${name} must be a number ${within(flag.range)}`);
    }
    if (flag.only && values[flag.only[0]] !== flag.only[1]) {
      throw refuse(`--${name} goes only with --${flag.only[0]} ${flag.only[1]}`);
    }
  }
  const logo = values.logo as string | undefined;
  if (logo !== undefined && !fs.existsSync(logo)) throw refuse(`No such logo: ${logo}`);

  const found = inputs.map((input) => {
    // A path that exists is that path, glob characters and all.
    const files = (fs.existsSync(input) ? [input] : fs.globSync(input))
      .flatMap((name) =>
        fs.statSync(name).isDirectory()
          ? fs
              .readdirSync(name, { withFileTypes: true })
              .filter(
                (entry) => entry.isFile() && COMMANDS[tool].takes.includes(extension(entry.name)),
              )
              .map((entry) => path.join(name, entry.name))
          : [name],
      )
      .map((file) => path.resolve(file))
      .sort(natural);
    if (!files.length) throw refuse(`Nothing for ${tool.toUpperCase()} in ${input}`);
    return files;
  });
  // A sequence's images in the order given, repeats and all, as one job; any
  // other tool takes each file once, a job each.
  const jobs = COMMANDS[tool].together
    ? [found.flat()]
    : [...new Set(found.flat())].sort(natural).map((source) => [source]);
  return { values, jobs };
}

// Every job's folder, in one, so a leftover is easy to find.
const workDirs = path.join(os.tmpdir(), "videotools-cli");

// One job: its result's path, or what went wrong. `signal` stops it, its
// folder removed all the same.
export async function runJob(
  tool: ToolId,
  values: Values,
  job: string[],
  signal: AbortSignal,
  onProgress: ((done: number) => void) | null,
): Promise<{ file: string } | { error: string }> {
  const ff = new FFmpeg(
    binaryPath("ffmpeg"),
    binaryPath("gifski"),
    resvgUrl,
    (command, args, options) => execBinary(command, args, { ...options, signal }),
  );
  ff.onProgress = onProgress;
  fs.mkdirSync(workDirs, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(workDirs, "job-"));
  try {
    const logo = values.logo as string | undefined;
    // Mark's logo is its last input.
    const files = logo === undefined ? job : [...job, logo];
    const options = COMMANDS[tool].options(values, job[0]);
    const { outputPath, suffix, ext } = await runTool(ff, tool, files, options, workDir);
    const source = path.parse(job[0]);
    const name = values["verbose-names"]
      ? verboseName(source.name, logo === undefined ? [] : [path.basename(logo)], options, ext)
      : resultFile(source.base, suffix, ext).name;
    const out = (values.out as string | undefined) ?? ".";
    const result = path.join(out, name);
    if (fs.existsSync(result)) throw refuse(`${result} already exists`);
    // Resolved: on Windows, Bun's recursive mkdir throws for "." and "..".
    fs.mkdirSync(path.resolve(out), { recursive: true });
    fs.copyFileSync(outputPath, result, fs.constants.COPYFILE_FICLONE);
    return { file: result };
  } catch (err) {
    // Short of an InputError's advice, the last line (ffmpeg's or the
    // system's) says what went wrong.
    return {
      error:
        err instanceof InputError
          ? err.message
          : `Failed: ${String(err instanceof Error ? err.message : err)
              .trim()
              .split(/[\r\n]+/)
              .at(-1)}`,
    };
  } finally {
    // A failed run can leave others going, and Windows won't delete a file a
    // child has open.
    await Promise.all([...running].map((child) => new Promise((done) => child.on("close", done))));
    await removeDir(workDir);
  }
}
