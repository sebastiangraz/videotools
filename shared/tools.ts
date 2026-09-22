// The tools, by the `tool` id of an /api/process request. One list for both
// sides: the functions key their registry on it (api/_lib/tools/index.ts),
// the client its tabs, routes and pages (client/src/tools.ts, pages/index.ts),
// so a tool added on one side only is a compile error on the other. In the
// order the tabs show them.
// No imports and nothing but plain ES2020: both builds compile this file.

export const TOOL_IDS = ["loop", "sequence", "speed", "convert", "mark"] as const;

export type ToolId = (typeof TOOL_IDS)[number];

// Whether an untyped request field names a tool.
export function isToolId(id: unknown): id is ToolId {
  return TOOL_IDS.includes(id as ToolId);
}
