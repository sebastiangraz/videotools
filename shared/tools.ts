// Keys both the api registry and the client tabs, so a one-sided addition is a
// compile error. Tab order. No imports, plain ES2020: both builds compile this.

export const TOOL_IDS = ["loop", "sequence", "speed", "convert", "mark"] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export function isToolId(id: unknown): id is ToolId {
  return TOOL_IDS.includes(id as ToolId);
}
