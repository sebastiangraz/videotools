import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FORMATS, SEQUENCE_FORMATS, TOOL_IDS, type ToolId } from "@videotools/core/formats";
import { VALID_TECHNIQUES } from "@videotools/core/tools/loop";
import { MARK_FILTERS, POSITIONS } from "@videotools/core/tools/mark-config";
import { cliCommand } from "../../client/src/helpers.js";
import { execBinary } from "../exec.js";
import pkg from "../package.json" with { type: "json" };

// Every case is turned away before the binaries are fetched. On Bun: Node
// can't load core's source, whose imports name .js files.
const cli = (...args: string[]) =>
  execBinary("bun", [path.join(import.meta.dirname, "..", "index.ts"), ...args], {});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const clip = path.join(dir, "clip.mp4");
const logo = path.join(dir, "logo.svg");
fs.writeFileSync(clip, "");
fs.writeFileSync(logo, "");

describe.concurrent("videotools", () => {
  it("lists every tool", async () => {
    const { code, stdout } = await cli("--help");
    expect(code).toBe(0);
    for (const tool of TOOL_IDS)
      expect(stdout).toMatch(new RegExp(`^  ${tool.toUpperCase()} `, "m"));
  });

  it.each(TOOL_IDS)("shows the usage of %s", async (tool) => {
    const { code, stdout } = await cli(tool, "--help");
    expect(code).toBe(0);
    expect(stdout).toMatch(new RegExp(`^Usage: videotools ${tool.toUpperCase()} `));
  });

  it("prints its version", async () => {
    expect((await cli("--version")).stdout).toBe(`${pkg.version}\n`);
  });

  it.each([
    ["no tool", [], "<TOOL>"],
    ["an unknown tool", ["blur", clip], "<TOOL>"],
    ["an unknown flag", ["mark", clip, "--logo", logo, "--jobs", "2"], "MARK"],
    ["another tool's flag", ["speed", clip, "--quality", "50"], "SPEED"],
    ["no --logo", ["mark", clip], "MARK"],
    ["no files", ["mark", "--logo", logo], "MARK"],
  ])("shows the usage for %s", async (_, args, tool) => {
    const { code, stderr } = await cli(...args);
    expect(code).toBe(2);
    expect(stderr).toContain(`Usage: videotools ${tool} `);
  });

  it.each([
    [
      "loop",
      ["--technique", "boomerang"],
      `--technique must be one of ${VALID_TECHNIQUES.join(", ")}`,
    ],
    ["loop", ["--fade=-1"], "--fade must be a number from 0 to 10"],
    ["loop", ["--fade", "10.5"], "--fade must be a number from 0 to 10"],
    ["loop", ["--start", "soon"], "--start must be a number from 0 up"],
    [
      "loop",
      ["--technique", "reverse", "--fade", "1"],
      "--fade goes only with --technique crossfade",
    ],
    [
      "loop",
      ["--technique", "reverse", "--start", "2"],
      "--start goes only with --technique crossfade",
    ],
    ["sequence", ["--format", "mov"], `--format must be one of ${SEQUENCE_FORMATS.join(", ")}`],
    ["sequence", ["--frame-duration", "0.05"], "--frame-duration must be a number from 0.1 to 10"],
    ["sequence", ["--frame-duration", "11"], "--frame-duration must be a number from 0.1 to 10"],
    ["speed", ["--speed", "3.5"], "--speed must be a number from -3 to 3"],
    ["speed", ["--speed=-4"], "--speed must be a number from -3 to 3"],
    ["convert", ["--to", "mkv"], `--to must be one of ${FORMATS.map((f) => f.id).join(", ")}`],
    ["convert", ["--fps", "12"], "--fps goes only with --to gif"],
    ["convert", ["--to", "webm", "--width", "400"], "--width goes only with --to gif"],
    ["convert", ["--to", "gif", "--fps", "31"], "--fps must be a number from 1 to 30"],
    ["convert", ["--to", "gif", "--width", "99"], "--width must be a number from 100 to 800"],
    [
      "mark",
      ["--logo", logo, "--position", "nowhere"],
      `--position must be one of ${POSITIONS.join(", ")}`,
    ],
    ["mark", ["--logo", logo, "--size", "dev"], "--size must be one of small, medium, large"],
    [
      "mark",
      ["--logo", logo, "--filter", "frost"],
      `--filter must be one of ${MARK_FILTERS.join(", ")}`,
    ],
  ])("%s turns away %j, naming what its page offers", async (tool, flags, message) => {
    const { code, stderr } = await cli(tool, clip, ...flags);
    expect(code).toBe(2);
    expect(stderr).toContain(`${message}\n`);
  });

  it.each(["0", "101", "high", ""])("turns away --quality %j", async (quality) => {
    const { code, stderr } = await cli("mark", clip, "--logo", logo, "--quality", quality);
    expect(code).toBe(2);
    expect(stderr).toContain("--quality must be a number from 1 to 100\n");
  });

  // Each page shows its settings as a command (client/src/helpers.ts); a
  // spread of them, its controls' ends among them, must run this package and
  // pass its flags: each is turned away only for its files, which are not there.
  const shown: Record<ToolId, Parameters<typeof cliCommand>[2][]> = {
    loop: [
      { technique: "crossfade", fade: 0, start: 12.5, quality: 1 },
      { technique: "crossfade", fade: 10, start: 0, quality: 100 },
      { technique: "reverse", quality: 50 },
    ],
    sequence: [
      ...SEQUENCE_FORMATS.map((format) => ({ "frame-duration": 0.1, format, quality: 1 })),
      { "frame-duration": 10, format: "mp4", quality: 100 },
    ],
    speed: [-3, -0.1, 0, 3].map((speed) => ({ speed })),
    convert: [
      { to: null, quality: 1 },
      ...FORMATS.map(({ id }) => ({ to: id, quality: 100 })),
      { to: "gif", quality: 100, fps: null, width: 640 },
      { to: "gif", quality: 50, fps: 1, width: 100 },
      { to: "gif", quality: 50, fps: 30, width: 800 },
    ],
    mark: POSITIONS.map((position, n) => ({
      logo: n % 2 ? undefined : "my logo.svg",
      position,
      size: ["small", "medium", "large"][n % 3],
      filter: MARK_FILTERS[(n + 1) % 3],
      shuffle: n % 2 === 0,
      // The knob's ends and between
      quality: 1 + Math.round((n / (POSITIONS.length - 1)) * 99),
    })),
  };
  it.each(TOOL_IDS)("takes the commands %s's page shows", async (tool) => {
    await Promise.all(
      shown[tool].map(async (flags, n) => {
        const command = cliCommand(tool, n % 2 ? [new File([], "my clip.mp4")] : [], {
          ...flags,
          // As ToolPanel adds it while verbose names are on.
          "verbose-names": n % 2 === 0,
        });
        const [npx, name, ...args] = command
          .match(/"[^"]*"|\S+/g)!
          .map((arg) => arg.replace(/^"|"$/g, ""));
        expect([npx, name]).toEqual(["npx", pkg.name]);
        const { stderr } = await cli(...args);
        expect(stderr, command).toMatch(
          new RegExp(`^(Nothing for ${tool.toUpperCase()} in|No such logo:) `),
        );
      }),
    );
  });

  it("turns away a missing logo, naming it", async () => {
    const missing = path.join(dir, "missing.svg");
    const { code, stderr } = await cli("mark", clip, "--logo", missing);
    expect(code).toBe(2);
    expect(stderr).toContain(`No such logo: ${missing}\n`);
  });

  it.each([
    ["loop", ["still.png", "clip.mkv"]],
    ["speed", ["still.png", "clip.mkv"]],
    ["convert", ["still.png"]],
    ["sequence", ["clip.mp4", "clip.mkv"]],
    ["mark", ["clip.mkv"]],
  ])("%s takes none of %j from a folder, nor its subfolders", async (tool, names) => {
    const folder = path.join(dir, tool);
    fs.mkdirSync(path.join(folder, "sub"), { recursive: true });
    for (const name of ["notes.txt", ...names, "sub/clip.mp4", "sub/still.png"]) {
      fs.writeFileSync(path.join(folder, name), "");
    }
    const { code, stderr } = await cli(tool, folder, ...(tool === "mark" ? ["--logo", logo] : []));
    expect(code).toBe(2);
    expect(stderr).toContain(`Nothing for ${tool.toUpperCase()} in ${folder}\n`);
  });

  it.each([
    ["a glob", path.join(dir, "*.webm")],
    ["a missing file", path.join(dir, "missing.mp4")],
  ])("turns away %s that matches nothing", async (_, input) => {
    const { code, stderr } = await cli("mark", clip, input, "--logo", logo);
    expect(code).toBe(2);
    expect(stderr).toContain(`Nothing for MARK in ${input}\n`);
  });
});
