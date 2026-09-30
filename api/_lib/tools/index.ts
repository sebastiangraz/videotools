import type { ToolId } from "../../../shared/tools.js";
import type { Tool } from "./types.js";
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
