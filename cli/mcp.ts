// The tools for AI assistants (`videotools mcp`): an MCP server over stdio. A
// batch runs in the background, and a call waits on it for a while at most,
// as a client may give up on a call long before a batch ends.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { McpServer, fromJsonSchema, type ServerContext } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { InputError } from "@videotools/core/errors";
import { FFmpeg } from "@videotools/core/ffmpeg";
import { TOOL_IDS, type ToolId } from "@videotools/core/formats";
import { fileExt, removeDir, sizeLabel } from "@videotools/core/helpers";
import {
  checkSquarePixels,
  preservedFormat,
  sourceFormat,
  sourceStill,
} from "@videotools/core/source";
import { markLook, renderWatermarkFrames } from "@videotools/core/tools/mark";
import { PREVIEW_MAX_WIDTH } from "@videotools/core/tools/mark-config";
import { binaryPath, install, resvgUrl } from "./binaries.js";
import {
  COMMANDS,
  expand,
  extension,
  failure,
  flagsOf,
  prepare,
  runJob,
  workDirs,
  type Flag,
  type Values,
} from "./commands.js";
import { execBinary } from "./exec.js";
import pkg from "./package.json" with { type: "json" };

// How long a call waits on a batch: Claude Desktop gives up on one at about 80 s.
const SLICE = 50_000;

const INSTRUCTIONS = `videotools edits the user's videos and images on this computer: seamless loops, image sequences to video, speed changes, format conversion and watermarks. Each tool takes files, folders or globs and writes new files, never changing or replacing one.

Before you start a batch:
- See what's in the user's files and folders with inspect before you ask anything.
- Settle what the user wants. Ask about each choice that changes the result and that they haven't made, in plain words, with the options the tool offers: for a watermark, the logo file, its style, position and size. Leave settings they're unlikely to care about at their defaults, which match the web app's.
- For a watermark, offer a preview_mark of one of their files in the chosen look, and adjust it until they're happy.
- Ask where results should go, suggesting a new folder next to the sources.
- Use absolute paths; ~ is the home folder.
- Sum up what will run (files, settings, folder) and start once the user agrees.

A batch runs in the background, one at a time. A call returns within a minute: while the status is "running", tell the user how far it got and call wait. Call stop only when the user asks to.`;

type Outcome = { source: string; file?: string; error?: string };
type Batch = {
  tool: ToolId;
  jobs: string[][];
  outcomes: Outcome[];
  // How far the running job has got, 0–1.
  progress: number;
  stop: AbortController;
  done: boolean;
  // Settles once the batch is done, its last job's folder removed.
  ended: Promise<void>;
  // Why the batch never started.
  error?: string;
};
// The running batch, or the last.
let batch: Batch | undefined;
// Previews under way, each until its folder is removed.
let previews = 0;

const text = (value: unknown, isError = false) => ({
  content: [
    { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) },
  ],
  isError,
});
const label = (job: string[]) => (job.length > 1 ? `${job[0]} and ${job.length - 1} more` : job[0]);

// `~` is the home folder, as a shell would have it. A relative path would be
// the client's working folder's, which is anyone's guess.
function local(file: string): string {
  const full = file.replace(/^~(?=$|[\\/])/, os.homedir());
  if (!path.isAbsolute(full))
    throw new InputError(`Not an absolute path: ${file}`, "invalid-option");
  return full;
}

// A flag as a JSON Schema property: what the command line spells out in --help.
const property = (flag: Flag) => ({
  type: flag.values || (flag.arg && !flag.range) ? "string" : flag.range ? "number" : "boolean",
  ...(flag.values && { enum: flag.values }),
  ...(flag.range && { minimum: flag.range[0] }),
  ...(flag.range && flag.range[1] !== Infinity && { maximum: flag.range[1] }),
  ...(flag.default !== undefined && { default: flag.range ? Number(flag.default) : flag.default }),
  ...((flag.help || flag.only) && {
    description: [flag.help, flag.only && `only with ${flag.only[0]} ${flag.only[1]}`]
      .filter(Boolean)
      .join("; "),
  }),
});

// The arguments: with a `taker`, the files, folders or globs to take files
// from; then the flags.
function inputSchema(taker: string | null, flags: Record<string, Flag> = {}) {
  return {
    type: "object",
    properties: {
      ...(taker && {
        inputs: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: `files, folders (the files directly in one that ${taker} takes) or globs`,
        },
      }),
      ...Object.fromEntries(Object.entries(flags).map(([name, flag]) => [name, property(flag)])),
    },
    required: [
      ...(taker ? ["inputs"] : []),
      ...Object.keys(flags).filter((name) => flags[name].required),
    ],
    additionalProperties: false,
  };
}

function start(tool: ToolId, values: Values, jobs: string[][]): Batch {
  const run = {
    tool,
    jobs,
    outcomes: [] as Outcome[],
    progress: 0,
    stop: new AbortController(),
    done: false,
    error: undefined as string | undefined,
  };
  const ended = (async () => {
    try {
      await Promise.all([install("ffmpeg"), install("gifski")]);
    } catch (err) {
      run.error = `Couldn't fetch ffmpeg and gifski: ${(err as Error).message}`;
    }
    for (const job of jobs) {
      if (run.error || run.stop.signal.aborted) break;
      run.progress = 0;
      const outcome = await runJob(tool, values, job, run.stop.signal, (done) => {
        run.progress = done;
      });
      if (!run.stop.signal.aborted) run.outcomes.push({ source: label(job), ...outcome });
    }
    run.done = true;
  })();
  return Object.assign(run, { ended });
}

// The batch's state. Results are listed once it's done, failures as they come.
function status(run: Batch) {
  const now = run.jobs[run.outcomes.length];
  return {
    status: run.error
      ? "failed"
      : !run.done
        ? "running"
        : run.stop.signal.aborted
          ? "stopped"
          : "done",
    ...(run.error && { error: run.error }),
    tool: run.tool,
    done: run.outcomes.length,
    of: run.jobs.length,
    ...(!run.done && now && { now: label(now), progress: Math.floor(run.progress * 100) / 100 }),
    ...(run.done
      ? { results: run.outcomes }
      : { failed: run.outcomes.filter((outcome) => outcome.error) }),
  };
}

// Waits on the batch for a slice at most, telling a client that asks for
// progress how far it got. A cancelled call only stops the waiting.
async function report(run: Batch, ctx: ServerContext) {
  const token = ctx.mcpReq._meta?.progressToken;
  const until = Date.now() + SLICE;
  let sent = 0;
  while (!run.done && Date.now() < until && !ctx.mcpReq.signal.aborted) {
    await Promise.race([run.ended, sleep(1000)]);
    const progress = run.outcomes.length + run.progress;
    if (token !== undefined && progress > sent) {
      sent = progress;
      await ctx.mcpReq.notify({
        method: "notifications/progress",
        params: { progressToken: token, progress, total: run.jobs.length },
      });
    }
  }
  return text(status(run));
}

function server() {
  const mcp = new McpServer(
    { name: "videotools", version: pkg.version },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of TOOL_IDS) {
    const { about, takes, together } = COMMANDS[tool];
    mcp.registerTool(
      tool,
      {
        description: `${about}. Takes ${[...new Set(takes)].join(", ")} files; ${together ? "one result of them all" : "one result each"}.`,
        inputSchema: fromJsonSchema<{ inputs: string[] } & Record<string, unknown>>(
          inputSchema("the tool", {
            ...flagsOf(tool),
            out: { arg: "dir", required: true, help: "the folder results go to, made if missing" },
          }),
        ),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ inputs, ...flags }, ctx) => {
        if (batch && !batch.done) {
          return text(`A ${batch.tool} batch is running: wait for it, or stop it.`, true);
        }
        let prepared;
        try {
          // As the command line gives them: numbers as text, paths in full.
          const given: Values = Object.fromEntries(
            Object.entries(flags).map(([name, value]) => [
              name,
              name === "out" || name === "logo"
                ? local(String(value))
                : typeof value === "number"
                  ? String(value)
                  : (value as string | boolean),
            ]),
          );
          prepared = prepare(tool, given, inputs.map(local));
        } catch (err) {
          if (err instanceof InputError) return text(err.message, true);
          throw err;
        }
        batch = start(tool, prepared.values, prepared.jobs);
        return report(batch, ctx);
      },
    );
  }
  mcp.registerTool(
    "inspect",
    {
      description:
        "Show what's in files, folders or globs: each file a tool takes, with the tools that take it, its format, resolution and size in bytes, and a clip's seconds, fps and audio.",
      inputSchema: fromJsonSchema<{ inputs: string[] }>(inputSchema("some tool")),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ inputs }) => {
      try {
        const files = new Set(inputs.map(local).flatMap((input) => expand(input, TOOL_IDS)));
        await install("ffmpeg");
        const ff = new FFmpeg(binaryPath("ffmpeg"), binaryPath("gifski"), resvgUrl, execBinary);
        const listing = [];
        for (const file of files) {
          const tools = TOOL_IDS.filter((tool) => COMMANDS[tool].takes.includes(extension(file)));
          try {
            const profile = await ff.mediaInfo(file);
            const still = sourceStill(profile);
            listing.push({
              file,
              tools,
              format: still ?? sourceFormat(profile) ?? extension(file),
              resolution: sizeLabel(profile.width, profile.height),
              ...(!still && {
                seconds: profile.duration,
                fps: profile.fps,
                audio: profile.audio !== null,
              }),
              bytes: fs.statSync(file).size,
            });
          } catch (err) {
            listing.push({ file, tools, error: failure(err) });
          }
        }
        return text(listing);
      } catch (err) {
        return text(failure(err), true);
      }
    },
  );
  const { logo, position, size, filter } = COMMANDS.mark.flags;
  mcp.registerTool(
    "preview_mark",
    {
      description:
        "Show how mark will watermark a video or image: a frame from its middle (an image's only one), marked as a batch would mark it.",
      inputSchema: fromJsonSchema<{ file: string; logo: string } & Values>(
        inputSchema(null, {
          file: { arg: "file", required: true, help: "the video or image to show it on" },
          logo,
          position,
          size,
          filter,
        }),
      ),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ file, ...flags }) => {
      fs.mkdirSync(workDirs, { recursive: true });
      const workDir = fs.mkdtempSync(path.join(workDirs, "preview-"));
      // Its own runs, not a batch's, to wait on before the folder goes: a
      // failed step can leave another going, and Windows won't delete a file
      // a child has open.
      const runs: ReturnType<typeof execBinary>[] = [];
      previews++;
      try {
        const { values, jobs } = prepare("mark", { ...flags, logo: local(flags.logo) }, [
          local(file),
        ]);
        const source = jobs[0][0];
        await install("ffmpeg");
        const ff = new FFmpeg(
          binaryPath("ffmpeg"),
          binaryPath("gifski"),
          resvgUrl,
          (command, args, options) => {
            const run = execBinary(command, args, options);
            runs.push(run);
            return run;
          },
        );
        const profile = await ff.mediaInfo(source);
        const opened = {
          path: source,
          profile,
          format: sourceFormat(profile),
          still: sourceStill(profile),
        };
        // Turned away as mark turns it away.
        checkSquarePixels(opened);
        if (!opened.still) preservedFormat(opened);
        // From the middle, downscaled as the page's preview.
        const frame = path.join(workDir, "frame.png");
        await ff.runFFmpeg([
          "-ss",
          String(profile.duration / 2),
          "-i",
          source,
          "-map",
          `0:v:${profile.videoIndex}`,
          "-frames:v",
          "1",
          "-vf",
          `scale='min(iw,${PREVIEW_MAX_WIDTH})':-1`,
          frame,
        ]);
        // Copied as mark copies it: an SVG's raster goes next to it.
        const logoFile = path.join(workDir, `logo${fileExt(flags.logo, ".png")}`);
        fs.copyFileSync(values.logo as string, logoFile);
        const look = markLook(values);
        const [preview] = await renderWatermarkFrames(
          { ff, workDir },
          { ...look, logoFile, frames: [{ file: frame, position: look.position }] },
        );
        return {
          content: [
            {
              type: "image" as const,
              data: fs.readFileSync(preview, "base64"),
              mimeType: "image/jpeg",
            },
          ],
        };
      } catch (err) {
        return text(failure(err), true);
      } finally {
        await Promise.allSettled(runs);
        await removeDir(workDir);
        previews--;
      }
    },
  );
  mcp.registerTool(
    "wait",
    {
      description:
        "Wait up to a minute on the running batch, then tell how far it got; once it's done, every result.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (ctx) => (batch ? report(batch, ctx) : text("No batch has run yet.", true)),
  );
  mcp.registerTool(
    "stop",
    {
      description:
        "Stop the running batch. Its finished results stay; the file it's on is dropped.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      if (!batch || batch.done) return text("No batch is running.", true);
      batch.stop.abort();
      await batch.ended;
      return text(status(batch));
    },
  );
  return mcp;
}

// Until the client closes stdin; a batch then stops and a preview ends, their
// folders removed.
export async function serve(): Promise<void> {
  // stdout carries the protocol, so the runner's lines go to stderr.
  console.log = console.error;
  serveStdio(server);
  await new Promise((closed) => process.stdin.on("end", closed));
  batch?.stop.abort();
  await batch?.ended;
  while (previews) await sleep(100);
}
