import type { Tool } from "./types.js";
import { loop } from "./loop.js";
import { sequence } from "./sequence.js";
import { speed } from "./speed.js";
import { convert } from "./convert.js";
import { mark } from "./mark.js";

// The tools /api/process runs, by the `tool` id of the request. Mirrored in
// client/src/tools.ts (TOOLS) and client/src/pages/index.ts (PAGES).
export const TOOLS: Record<string, Tool> = {
  loop,
  sequence,
  speed,
  convert,
  mark,
};
