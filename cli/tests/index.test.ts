import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FORMATS, SEQUENCE_FORMATS, TOOL_IDS } from "@videotools/core/formats";
import { VALID_TECHNIQUES } from "@videotools/core/tools/loop";
import {
  MARK_FILTERS,
  MARK_POSITIONS,
  type MarkPosition,
} from "@videotools/core/tools/mark-config";
import { markCommand } from "../../client/src/helpers.js";
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

describe("videotools", () => {
  it("lists every tool", async () => {
    const { code, stdout } = await cli("--help");
    expect(code).toBe(0);
    for (const tool of TOOL_IDS) expect(stdout).toMatch(new RegExp(`^  ${tool} `, "m"));
  });

  it.each(TOOL_IDS)("shows the usage of %s", async (tool) => {
    const { code, stdout } = await cli(tool, "--help");
    expect(code).toBe(0);
    expect(stdout).toMatch(new RegExp(`^Usage: videotools ${tool} `));
  });

  it("prints its version", async () => {
    expect((await cli("--version")).stdout).toBe(`${pkg.version}\n`);
  });

  it.each([
    ["no tool", [], "<tool>"],
    ["an unknown tool", ["blur", clip], "<tool>"],
    ["an unknown flag", ["mark", clip, "--logo", logo, "--jobs", "2"], "mark"],
    ["another tool's flag", ["speed", clip, "--quality", "50"], "speed"],
    ["no --logo", ["mark", clip], "mark"],
    ["no files", ["mark", "--logo", logo], "mark"],
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
    ["loop", ["--fade=-1"], "--fade must be a number from 0 up"],
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
    ["sequence", ["--frame-duration", "0.05"], "--frame-duration must be a number from 0.1 up"],
    ["sequence", ["--quality", "0"], "--quality must be a number from 1 to 100"],
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
      `--position must be one of ${Object.keys(MARK_POSITIONS).join(", ")}`,
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

  // Mark's page copies its settings as a command (client/src/helpers.ts); a
  // spread of them must run this package and give only flags and values
  // --help offers.
  it("takes the commands Mark's page copies", async () => {
    const { stdout } = await cli("mark", "--help");
    // "  --size <size>   small|medium|large (default: medium)"
    const offered = new Map(
      [...stdout.matchAll(/^ {2}(--\S+)( <\S+>)? +(.*)$/gm)].map(([, flag, arg, about]) => [
        flag,
        { arg, about },
      ]),
    );
    const positions = Object.keys(MARK_POSITIONS) as MarkPosition[];
    for (const [n, position] of positions.entries()) {
      const command = markCommand({
        source: n % 2 ? "my clip.mp4" : undefined,
        logo: n % 2 ? undefined : "my logo.svg",
        position,
        size: (["small", "medium", "large"] as const)[n % 3],
        filter: MARK_FILTERS[(n + 1) % 3],
        shuffle: n % 2 === 0,
        // The knob's ends and between
        quality: Math.round((n / (positions.length - 1)) * 100),
      });
      const [npx, name, tool, source, ...args] = command.match(/"[^"]*"|\S+/g)!;
      expect([npx, name, tool, source]).toEqual([
        "npx",
        pkg.name,
        "mark",
        expect.stringMatching(/^"/),
      ]);
      for (let i = 0; i < args.length; i++) {
        const flag = offered.get(args[i]);
        expect(flag, `${args[i]} in ${command}`).toBeDefined();
        if (!flag?.arg) continue;
        const value = args[++i];
        const [, min, max] = /^from (\S+) to (\S+)/.exec(flag.about) ?? [];
        const values = /^\S+\|\S+/.exec(flag.about)?.[0].split("|");
        if (min) {
          expect(Number(value) >= Number(min) && Number(value) <= Number(max), command).toBe(true);
        } else if (values) {
          expect(values, command).toContain(value);
        } else {
          // A file
          expect(value, command).toMatch(/^".+"$/);
        }
      }
    }
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
    expect(stderr).toContain(`Nothing for ${tool} in ${folder}\n`);
  });

  it("turns away a sequence of mixed formats, as its page does", async () => {
    const images = ["a.png", "b.jpg", "c.jpeg"].map((name) => path.join(dir, name));
    for (const image of images) fs.writeFileSync(image, "");
    const { code, stderr } = await cli("sequence", ...images);
    expect(code).toBe(2);
    expect(stderr).toContain("Use images of one format, not png, jpg\n");
  });

  it.each([
    ["a glob", path.join(dir, "*.webm")],
    ["a missing file", path.join(dir, "missing.mp4")],
  ])("turns away %s that matches nothing", async (_, input) => {
    const { code, stderr } = await cli("mark", clip, input, "--logo", logo);
    expect(code).toBe(2);
    expect(stderr).toContain(`Nothing for mark in ${input}\n`);
  });
});
