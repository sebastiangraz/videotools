import type { FormatId, StillId } from "../formats.js";
import type { FFmpeg } from "../ffmpeg.js";

// Untyped JSON: every tool validates what it reads.
export type ToolRequest = {
  upload?: unknown;
  uploads?: unknown;
  // mark only: the logo (PNG or SVG).
  watermark?: unknown;
  options: Record<string, unknown>;
};

export type ToolJob = {
  ff: FFmpeg;
  // Removed once the request is answered.
  workDir: string;
  inputs: string[];
  options: Record<string, unknown>;
  take: (upload: string, destPath: string) => Promise<void>;
};

// Download is named `<source name>_<suffix>.<ext>`; ext also sets the content type.
type ToolResult = {
  outputPath: string;
  suffix: string;
  ext: FormatId | StillId;
};

// `inputs` returns the upload ids to use, or an error (a 400).
export type Tool = {
  inputs: (request: ToolRequest) => string[] | { error: string };
  run: (job: ToolJob) => Promise<ToolResult>;
};
