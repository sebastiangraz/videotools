import type { FormatId, StillId } from "../../../shared/formats.js";
import type { FFmpeg } from "../ffmpeg.js";

// The part of the /api/process body a tool gets to look at. It is untyped
// JSON: every tool validates what it reads.
export type ToolRequest = {
  blobUrl?: unknown;
  blobUrls?: unknown;
  // "mark" only: the logo (a PNG), uploaded like the video.
  watermarkUrl?: unknown;
  options: Record<string, unknown>;
};

// Everything a run needs from the function around it.
export type ToolJob = {
  ff: FFmpeg;
  // Scratch directory of this request, removed once it is answered.
  workDir: string;
  // The blob URLs the tool's `inputs` returned, in that order.
  inputs: string[];
  options: Record<string, unknown>;
  download: (url: string, destPath: string) => Promise<void>;
};

// `suffix` and `ext` name the download (`<source name>_<suffix>.<ext>`);
// `ext` is the result's format, which also gives the content type. Every
// tool hands back the format of its source, except the two that are asked
// for one: convert and sequence. Only mark's can be a still.
export type ToolResult = {
  outputPath: string;
  suffix: string;
  ext: FormatId | StillId;
};

// One tool of /api/process. `inputs` picks the uploads the tool works on out
// of the request, or says what is wrong with them (a 400); `run` downloads
// them, validates the options and does the work.
export type Tool = {
  inputs: (request: ToolRequest) => string[] | { error: string };
  run: (job: ToolJob) => Promise<ToolResult>;
};
