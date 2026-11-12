import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MARK_FILTERS, MARK_POSITIONS } from "@videotools/core/tools/mark-config";
import { execBinary } from "../exec.js";

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

describe("video-tools mark", () => {
  it.each([
    ["--position", "nowhere", Object.keys(MARK_POSITIONS).join(", ")],
    ["--size", "dev", "small, medium, large"],
    ["--filter", "frost", MARK_FILTERS.join(", ")],
  ])("turns away %s %s, naming what Mark's page offers", async (flag, value, offered) => {
    const { code, stderr } = await cli("mark", clip, "--logo", logo, flag, value);
    expect(code).toBe(2);
    expect(stderr).toContain(`${flag} must be one of ${offered}\n`);
  });

  it("turns away a missing logo, naming it", async () => {
    const missing = path.join(dir, "missing.svg");
    const { code, stderr } = await cli("mark", clip, "--logo", missing);
    expect(code).toBe(2);
    expect(stderr).toContain(`No such logo: ${missing}\n`);
  });

  it.each(["0", "101", "high", ""])("turns away --quality %j", async (quality) => {
    const { code, stderr } = await cli("mark", clip, "--logo", logo, "--quality", quality);
    expect(code).toBe(2);
    expect(stderr).toContain("--quality must be a number from 1 to 100\n");
  });

  it.each([
    ["an unknown flag", ["mark", clip, "--logo", logo, "--jobs", "2"]],
    ["no --logo", ["mark", clip]],
    ["no files", ["mark", "--logo", logo]],
    ["an unknown tool", ["loop", clip, "--logo", logo]],
  ])("shows the usage for %s", async (_, args) => {
    const { code, stderr } = await cli(...args);
    expect(code).toBe(2);
    expect(stderr).toContain("Usage: video-tools mark");
  });

  it("takes only the files Mark reads from a folder, not its subfolders", async () => {
    const folder = path.join(dir, "folder");
    fs.mkdirSync(path.join(folder, "sub"), { recursive: true });
    for (const name of ["notes.txt", "clip.mkv", "sub/clip.mp4"]) {
      fs.writeFileSync(path.join(folder, name), "");
    }
    const { code, stderr } = await cli("mark", folder, "--logo", logo);
    expect(code).toBe(2);
    expect(stderr).toContain(`Nothing to mark in ${folder}\n`);
  });

  it.each([
    ["a glob", path.join(dir, "*.webm")],
    ["a missing file", path.join(dir, "missing.mp4")],
  ])("turns away %s that matches nothing", async (_, input) => {
    const { code, stderr } = await cli("mark", clip, input, "--logo", logo);
    expect(code).toBe(2);
    expect(stderr).toContain(`Nothing to mark in ${input}\n`);
  });
});
