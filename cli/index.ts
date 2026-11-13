#!/usr/bin/env node
// The app's tools (commands.ts) on many files, a job at a time: one per file,
// or one for all of a sequence's images. Results are named as the app names
// its downloads.
import path from "node:path";
import { parseArgs } from "node:util";
import { InputError } from "@videotools/core/errors";
import { TOOL_IDS, isToolId } from "@videotools/core/formats";
import { progressBar } from "@videotools/core/helpers";
import { install } from "./binaries.js";
import { COMMANDS, flagsOf, prepare, runJob, within, type Flag, type Values } from "./commands.js";
import pkg from "./package.json" with { type: "json" };

// A tool in any case, as it's shown in capitals.
const tool = process.argv[2]?.toLowerCase();
const flags: Record<string, Flag> = isToolId(tool) ? flagsOf(tool) : {};
const help = isToolId(tool)
  ? `Usage: videotools ${tool.toUpperCase()} <file|folder|glob>...${Object.entries(flags)
      .filter(([, flag]) => flag.required)
      .map(([name, flag]) => ` --${name} <${flag.arg}>`)
      .join("")} [options]

${COMMANDS[tool].about}.

Options:
${Object.entries(flags)
  .map(([name, flag]) => {
    const spelled = `--${name}${flag.arg ? ` <${flag.arg}>` : ""}`;
    const about = [flag.values?.join("|"), flag.range && within(flag.range), flag.help]
      .filter(Boolean)
      .join(": ");
    const notes = [
      flag.default && `default: ${flag.default}`,
      flag.required && "required",
      flag.only && `only with --${flag.only[0]} ${flag.only[1]}`,
    ].filter(Boolean);
    return `  ${spelled.padEnd(28)}${about}${notes.length ? ` (${notes.join("; ")})` : ""}`;
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

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(3),
    options: {
      ...Object.fromEntries(
        Object.entries(flags).map(([name, flag]) => [
          name,
          { type: flag.arg ? "string" : "boolean" } as const,
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
let prepared;
try {
  prepared = prepare(tool, given, parsed.positionals);
} catch (err) {
  if (!(err instanceof InputError)) throw err;
  usage(err.message);
}
const { values, jobs } = prepared;

await Promise.all([install("ffmpeg"), install("gifski")]);
// The runner logs every command; the lines below are the user's.
console.log = console.error = () => {};

// From here, Ctrl+C stops the running job, which removes its folder.
const stop = new AbortController();
const abort = () => {
  stop.abort();
  process.exitCode = 130;
};
process.on("SIGINT", abort).on("SIGTERM", abort);

const tty = process.stdout.isTTY;
for (const [n, job] of jobs.entries()) {
  if (stop.signal.aborted) break;
  const more = job.length > 1 ? ` and ${job.length - 1} more` : "";
  const label = `[${n + 1}/${jobs.length}] ${path.basename(job[0])}${more}`;
  const bar = (done: number) =>
    process.stdout.write(`\r\x1b[2K${label} ${progressBar(done)} ${Math.floor(done * 100)}%`);
  if (tty) bar(0);
  else process.stdout.write(`${label}\n`);
  const outcome = await runJob(tool, values, job, stop.signal, tty ? bar : null);
  if (tty) process.stdout.write("\n");
  if ("file" in outcome) {
    process.stdout.write(`  ${outcome.file}\n`);
  } else if (!stop.signal.aborted) {
    process.exitCode = 1;
    process.stderr.write(`  ${outcome.error}\n`);
  }
}
