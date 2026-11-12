import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Exec } from "../core/ffmpeg.js";

const execFileAsync = promisify(execFile);

// Native runs, for the scripts. Kept out of core, which the app runs on
// WebAssembly (client/src/engine).
export const execBinary: Exec = async (command, args, { cwd }) => {
  try {
    const running = execFileAsync(command, args, { cwd, maxBuffer: Infinity });
    // Immediate EOF, like an ignored stdin.
    running.child.stdin?.end();
    const { stdout, stderr } = await running;
    return { code: 0, stdout, stderr };
  } catch (error) {
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
