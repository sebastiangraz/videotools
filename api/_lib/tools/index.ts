import type { ToolId } from "../../../shared/tools.js";
import type { Tool } from "./types.js";
import { loop } from "./loop.js";
import { sequence } from "./sequence.js";
import { speed } from "./speed.js";
import { convert } from "./convert.js";
import { mark } from "./mark.js";

// The tools /api/process runs, one per id in shared/tools.ts.
export const TOOLS: Record<ToolId, Tool> = {
  loop,
  sequence,
  speed,
  convert,
  mark,
};
