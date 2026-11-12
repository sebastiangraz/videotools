import fs from "node:fs/promises";
import path from "node:path";
import type { FFmpeg } from "../ffmpeg.js";
import type { ToolId } from "../formats.js";
import type { Tool, ToolInput } from "./types.js";
import { loop } from "./loop.js";
import { sequence } from "./sequence.js";
import { speed } from "./speed.js";
import { convert } from "./convert.js";
import { mark } from "./mark.js";

export const TOOLS: Record<ToolId, Tool> = {
  loop,
  sequence,
  speed,
  convert,
  mark,
};

// One tool run on files on disk: `files` in the order the tool takes them,
// results in `workDir`.
export async function runTool(
  ff: FFmpeg,
  tool: ToolId,
  files: string[],
  options: Record<string, unknown>,
  workDir: string,
) {
  await fs.mkdir(workDir, { recursive: true });
  const inputs: ToolInput[] = files.map((file) => ({
    name: path.basename(file),
    save: (destPath) => fs.copyFile(file, destPath),
  }));
  return TOOLS[tool]({ ff, workDir, inputs, options });
}
