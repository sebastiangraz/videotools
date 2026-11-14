import { type ChildProcess, spawn } from "node:child_process";
import type { Exec } from "@videotools/core/ffmpeg";

// Children still running, for a job to await before it removes their files.
export const running = new Set<ChildProcess>();

// Native runs. Kept out of core, which the app runs on WebAssembly
// (client/src/engine). `signal` kills a run, or one it would start, and
// rejects it.
export const execBinary = (
  command: string,
  args: string[],
  { cwd, onLine, signal }: Parameters<Exec>[2] & { signal?: AbortSignal },
): ReturnType<Exec> => {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    // A parent without a console would open one for each run.
    windowsHide: true,
    signal,
  });
  running.add(child);
  const output = { stdout: "", stderr: "" };
  // gifski's progress goes to stdout, ffmpeg's to stderr. A line is whole
  // once its \r or \n is in.
  for (const name of ["stdout", "stderr"] as const) {
    let partial = "";
    child[name].setEncoding("utf8").on("data", (chunk: string) => {
      output[name] += chunk;
      if (!onLine) return;
      const lines = (partial + chunk).split(/[\r\n]/);
      partial = lines.pop()!;
      lines.forEach(onLine);
    });
  }
  return new Promise((resolve, reject) => {
    child.on("close", (code) => {
      running.delete(child);
      resolve({ code, ...output });
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to start command: ${error.message}`, { cause: error }));
    });
  });
};
