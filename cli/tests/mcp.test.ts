import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { TOOL_IDS } from "@videotools/core/formats";
import { MARK_FILTERS } from "@videotools/core/tools/mark-config";

type Tool = {
  name: string;
  inputSchema: { required: string[]; properties: Record<string, object> };
};
type Result = {
  instructions?: string;
  tools?: Tool[];
  isError?: boolean;
  content?: { text: string }[];
};

// As a client starts it, on Bun as in index.test.ts. Every call is turned away
// before a batch starts, so the binaries are never fetched.
const server = spawn("bun", [path.join(import.meta.dirname, "..", "index.ts"), "mcp"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const replies = new Map<number, (result: Result) => void>();
let buffer = "";
server.stdout.setEncoding("utf8").on("data", (chunk: string) => {
  buffer += chunk;
  // Every line a message: anything else on stdout would break a client.
  for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    replies.get(message.id)?.(message.result);
  }
});
let id = 0;
const request = (method: string, params: object = {}) =>
  new Promise<Result>((done) => {
    replies.set(++id, done);
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
const call = async (name: string, args: object = {}) => {
  const result = await request("tools/call", { name, arguments: args });
  return { error: result.isError, text: result.content![0].text };
};
const opened = request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test", version: "0" },
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
afterAll(() => {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});
const clip = path.join(dir, "clip.mp4");
const logo = path.join(dir, "logo.svg");
fs.writeFileSync(clip, "");
fs.writeFileSync(logo, "");

describe("videotools mcp", () => {
  it("serves every tool, wait and stop, and how to use them", async () => {
    expect((await opened).instructions).toContain("call wait");
    const { tools } = await request("tools/list");
    expect(tools!.map((tool) => tool.name)).toEqual([...TOOL_IDS, "wait", "stop"]);
  });

  it("spells out a tool's flags as the command line takes them", async () => {
    const { tools } = await request("tools/list");
    const mark = tools!.find((tool) => tool.name === "mark")!.inputSchema;
    expect(mark.required).toEqual(["inputs", "logo", "out"]);
    expect(mark.properties.filter).toMatchObject({ enum: MARK_FILTERS, default: "glass" });
    expect(mark.properties.quality).toMatchObject({ type: "number", maximum: 100, default: 100 });
    expect(mark.properties.shuffle).toMatchObject({ type: "boolean" });
  });

  it.each([
    [
      "a relative path",
      "mark",
      { inputs: ["clips"], out: dir, logo },
      "Not an absolute path: clips",
    ],
    [
      "~ as the home folder",
      "mark",
      { inputs: ["~/videotools-missing.mp4"], out: dir, logo },
      `Nothing for MARK in ${os.homedir()}/videotools-missing.mp4`,
    ],
    [
      "a missing logo",
      "mark",
      { inputs: [clip], out: dir, logo: path.join(dir, "missing.svg") },
      `No such logo: ${path.join(dir, "missing.svg")}`,
    ],
    [
      "a number its page hides",
      "loop",
      { inputs: [clip], out: dir, technique: "reverse", fade: 1 },
      "--fade goes only with --technique crossfade",
    ],
    [
      "a folder of none of its files",
      "sequence",
      { inputs: [dir], out: dir },
      `Nothing for SEQUENCE in ${dir}`,
    ],
  ])("turns away %s, saying why", async (_, tool, args, message) => {
    expect(await call(tool, args)).toEqual({ error: true, text: message });
  });

  it.each([
    ["wait", "No batch has run yet."],
    ["stop", "No batch is running."],
  ])("answers %s with no batch", async (tool, message) => {
    expect(await call(tool)).toEqual({ error: true, text: message });
  });

  it("ends when its client closes stdin", async () => {
    server.stdin.end();
    expect(await new Promise((done) => server.on("close", done))).toBe(0);
  });
});
