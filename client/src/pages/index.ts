import type { ComponentType } from "react";
import type { ToolId } from "../tools";
import { Loop } from "./Loop/Loop";
import { Sequence } from "./Sequence/Sequence";
import { Speed } from "./Speed/Speed";
import { Convert } from "./Convert/Convert";
import { Mark } from "./Mark/Mark";

// The page behind each tool's tab. `satisfies` makes a TOOLS entry without a
// page a compile error.
export const PAGES = {
  loop: Loop,
  sequence: Sequence,
  speed: Speed,
  convert: Convert,
  mark: Mark,
} satisfies Record<ToolId, ComponentType>;
