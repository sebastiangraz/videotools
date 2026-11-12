import type { FormatId, StillId } from "../formats.js";
import type { FFmpeg } from "../ffmpeg.js";

// A picked file: `save` writes it where the tool wants it.
export type ToolInput = {
  name: string;
  save: (destPath: string) => Promise<void>;
};

export type ToolJob = {
  ff: FFmpeg;
  // The job's own directory.
  workDir: string;
  inputs: ToolInput[];
  // Untyped: every tool validates what it reads.
  options: Record<string, unknown>;
};

// Download is named `<source name>_<suffix>.<ext>`; ext also sets the content type.
type ToolResult = {
  outputPath: string;
  suffix: string;
  ext: FormatId | StillId;
};

export type Tool = (job: ToolJob) => Promise<ToolResult>;
