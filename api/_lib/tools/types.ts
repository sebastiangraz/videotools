import type { FormatId, StillId } from "../formats.js";
import type { FFmpeg } from "../ffmpeg.js";

// Untyped JSON: every tool validates what it reads.
export type ToolRequest = {
  blobUrl?: unknown;
  blobUrls?: unknown;
  // mark only: the logo (PNG or SVG).
  watermarkUrl?: unknown;
  options: Record<string, unknown>;
};

export type ToolJob = {
  ff: FFmpeg;
  // Removed once the request is answered.
  workDir: string;
  inputs: string[];
  options: Record<string, unknown>;
  download: (url: string, destPath: string) => Promise<void>;
};

// Download is named `<source name>_<suffix>.<ext>`; ext also sets the content type.
// A `verbose` name replaces the suffix and keeps only the source name's first
// six characters.
type ToolResult = {
  outputPath: string;
  suffix: string;
  verbose?: string;
  ext: FormatId | StillId;
};

// `inputs` returns the blob URLs to use, or an error (a 400).
export type Tool = {
  inputs: (request: ToolRequest) => string[] | { error: string };
  run: (job: ToolJob) => Promise<ToolResult>;
};
