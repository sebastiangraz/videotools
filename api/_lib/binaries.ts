import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Exec } from "./ffmpeg.js";

const execFileAsync = promisify(execFile);

// Installed by scripts/binaries-install.mjs from <tool>.json.
const pinned = (tool: string): string =>
  path.join(
    process.cwd(),
    "api",
    "_bin",
    tool,
    `${process.platform}-${process.arch}`,
    process.platform === "win32" ? `${tool}.exe` : tool,
  );

const required = (tool: string, file: string): string => {
  if (!fs.existsSync(file)) {
    throw new Error(
      `No ${tool} at ${file}; run \`bun scripts/binaries-install.mjs\` (bun install does)`,
    );
  }
  return file;
};

// FFMPEG_BIN overrides, e.g. to compare another version.
export const ffmpegPath: string = required("ffmpeg", process.env.FFMPEG_BIN || pinned("ffmpeg"));

// The linux build is static-pie, so it runs on the function runtime as-is.
export const gifskiPath: string = required("gifski", pinned("gifski"));

// SIGKILL on abort: partial output is discarded anyway.
export const execBinary: Exec = async (command, args, { cwd, signal }) => {
  try {
    const running = execFileAsync(command, args, {
      cwd,
      signal,
      killSignal: "SIGKILL",
      maxBuffer: Infinity,
    });
    // Immediate EOF, like an ignored stdin.
    running.child.stdin?.end();
    const { stdout, stderr } = await running;
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (signal?.aborted) throw error;
    const failure = error as NodeJS.ErrnoException & {
      code?: number | string | null;
      stdout?: string;
      stderr?: string;
    };
    // A child that never started has a syscall ("spawn ...").
    if (failure.syscall === undefined && typeof failure.stderr === "string") {
      return {
        code: typeof failure.code === "number" ? failure.code : null,
        stdout: failure.stdout ?? "",
        stderr: failure.stderr,
      };
    }
    console.error(`Failed to start command: ${command} ${args.join(" ")}`);
    console.error(`Error: ${failure.message}`);
    throw new Error(`Failed to start command: ${failure.message}`, {
      cause: error,
    });
  }
};
