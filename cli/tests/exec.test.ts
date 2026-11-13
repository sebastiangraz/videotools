import { describe, expect, it } from "vitest";
import { execBinary } from "../exec.js";

describe("execBinary", () => {
  it("hands on each line of both streams, ended by \\r or \\n", async () => {
    // gifski's progress on stdout, a line of it split across two writes.
    const script = `
      process.stderr.write("frame=1\\nframe=2\\n");
      process.stdout.write("Frame 1");
      setTimeout(() => process.stdout.write(" / 2\\rFrame 2 / 2\\n"), 50);
      process.exitCode = 3;
    `;
    const lines: string[] = [];
    const result = await execBinary(process.execPath, ["-e", script], {
      onLine: (line) => lines.push(line),
    });
    expect(result).toEqual({
      code: 3,
      stdout: "Frame 1 / 2\rFrame 2 / 2\n",
      stderr: "frame=1\nframe=2\n",
    });
    expect(lines.sort()).toEqual(["Frame 1 / 2", "Frame 2 / 2", "frame=1", "frame=2"]);
  });

  it("kills a run its signal stops", async () => {
    const stop = new AbortController();
    const run = execBinary(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
      signal: stop.signal,
    });
    stop.abort();
    await expect(run).rejects.toThrow();
  });
});
