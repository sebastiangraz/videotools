import { spawn } from "node:child_process";
import fs from "node:fs/promises";

// Only `cwd` is ever passed through to spawn.
type RunOptions = { cwd?: string };

type RunResult = { code: number | null; stdout: string; stderr: string };

// What `ffmpeg -i` reports about an input. `fps` is null when no frame rate
// is printed; callers fall back to 30. `codec` is the decoder name ("h264",
// "png", "gif", ...): what the content is, whatever the file is called.
// `matrix` is the YUV↔RGB matrix the stream is tagged with, in the scale
// filter's names; RGB inputs (PNG, GIF) count as bt601, which is what their
// conversion to YUV produces, and null means an untagged YUV stream.
export type MediaInfo = {
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  codec: string;
  matrix: "bt709" | "bt601" | "bt2020" | null;
};

// Parses the `-i` summary, e.g.
//   Duration: 00:00:03.00, start: 0.000000, bitrate: 46 kb/s
//   Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661),
//     yuv420p(progressive), 320x240 [SAR 1:1 DAR 4:3], 40 kb/s, 29.97 fps,
//     29.97 tbr, 11988 tbn (default)
// The video line is split on ", " so a WxH field is matched whole: the
// codec tag (`0x31637661`) never starts a field. Stills report
// "Duration: N/A", which reads as 0.
export function parseMediaInfo(summary: string): MediaInfo | null {
  const video = summary
    .split("\n")
    .find((line) => /Stream #\d+:\d+.*: Video: /.test(line));
  if (!video) return null;
  const fields = video.slice(video.indexOf(": Video: ")).split(", ");
  const size = fields.map((f) => /^(\d+)x(\d+)\b/.exec(f)).find(Boolean);
  if (!size) return null;
  const codec = /: Video: (\w+)/.exec(video)?.[1] ?? "";
  // The pixel format field reads e.g. "yuv420p(tv, bt709, progressive)" or
  // "yuvj444p(pc, bt470bg/unknown/unknown)": the colour item is one name
  // when matrix, primaries and transfer agree, else matrix/primaries/trc.
  const [, pixFmt = "", tags = ""] =
    /, ([a-z]\w*)(?:\(([^)]*)\))?, \d+x\d+/.exec(video) ?? [];
  const tagged = tags.split(", ").map((t) => t.split("/")[0]);
  const matrix = tagged.includes("bt709")
    ? "bt709"
    : tagged.some((t) => t === "bt470bg" || t === "smpte170m") ||
        /^(rgb|bgr|gbr|argb|abgr|pal8|gray|ya|mono)/.test(pixFmt)
      ? "bt601"
      : tagged.some((t) => t.startsWith("bt2020"))
        ? "bt2020"
        : null;

  const rate =
    fields.map((f) => /^([\d.]+) fps\b/.exec(f)).find(Boolean) ??
    fields.map((f) => /^([\d.]+) tbr\b/.exec(f)).find(Boolean);
  const fps = rate ? parseFloat(rate[1]) : NaN;

  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(summary);
  const duration = dur
    ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
    : 0;

  return {
    duration,
    width: Number(size[1]),
    height: Number(size[2]),
    fps: Number.isFinite(fps) && fps > 0 ? fps : null,
    codec,
    matrix,
  };
}

/**
 * Runs the binaries for one job and probes its inputs: pure-Node ffmpeg
 * (ffmpeg-static, a real binary, no shell) plus the vendored gifski. The
 * tools (tools/) and encoders (encode/) are functions that take one of
 * these; it is the only state a job has.
 */
export class FFmpeg {
  ffmpeg: string;
  gifski: string;
  signal: AbortSignal | null;
  gifskiChmodDone = false;
  // Inputs are immutable for the life of a job, so probe each file once.
  private infoCache = new Map<string, MediaInfo>();

  // `signal` (optional AbortSignal) cancels the pipeline: the running child
  // process is killed and every later command rejects right away.
  constructor(
    ffmpegPath: string,
    gifskiPath: string,
    signal: AbortSignal | null = null,
  ) {
    this.ffmpeg = ffmpegPath;
    this.gifski = gifskiPath;
    this.signal = signal;
  }

  async duration(inputFile: string): Promise<number> {
    return (await this.mediaInfo(inputFile)).duration;
  }

  async fps(inputFile: string): Promise<number> {
    return (await this.mediaInfo(inputFile)).fps ?? 30;
  }

  // ffmpeg itself reports everything the tools need to know about an input,
  // so there is no separate ffprobe binary to ship. `ffmpeg -i` with no
  // output prints the stream summary to stderr and exits non-zero, which is
  // the expected outcome here rather than a failure.
  async mediaInfo(inputFile: string): Promise<MediaInfo> {
    const cached = this.infoCache.get(inputFile);
    if (cached) return cached;
    const { stderr } = await this.run(this.ffmpeg, [
      "-hide_banner",
      "-i",
      inputFile,
    ]);
    const info = parseMediaInfo(stderr);
    if (!info) {
      throw new Error(`Could not read media info: ${stderr.trim()}`);
    }
    this.infoCache.set(inputFile, info);
    return info;
  }

  runFFmpeg(args: string[], options: RunOptions = {}): Promise<string> {
    return this.runCommand(this.ffmpeg, args, options);
  }

  async runGifski(args: string[], options: RunOptions = {}): Promise<string> {
    if (!this.gifski) {
      throw new Error("gifski binary path not configured");
    }
    // The vendored binary's exec bit may not survive a Windows checkout or
    // the deploy bundling, so restore it before the first spawn.
    if (process.platform !== "win32" && !this.gifskiChmodDone) {
      await fs.chmod(this.gifski, 0o755).catch(() => {});
      this.gifskiChmodDone = true;
    }
    return this.runCommand(this.gifski, args, options);
  }

  // Resolves with the child's stdout; a non-zero exit is an error.
  async runCommand(
    command: string,
    args: string[],
    options: RunOptions = {},
  ): Promise<string> {
    const { code, stdout, stderr } = await this.run(command, args, options);
    if (code === 0) return stdout;
    console.error(`Command failed with code ${code}`);
    console.error(`Command: ${command} ${args.join(" ")}`);
    if (options.cwd) {
      console.error(`Working directory: ${options.cwd}`);
    }
    console.error(`stderr: ${stderr}`);
    throw new Error(`Command failed: ${stderr || `Exit code ${code}`}`);
  }

  // Runs the child to completion and reports its exit code and output;
  // rejects only when it could not be started or was cancelled.
  run(
    command: string,
    args: string[],
    options: RunOptions = {},
  ): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      console.log(`Running: ${command} ${args.join(" ")}`);
      if (options.cwd) {
        console.log(`Working directory: ${options.cwd}`);
      }

      // Node kills the child (SIGKILL: the partial output is discarded
      // anyway) when the signal fires, and emits 'error' if it already had.
      const signal = this.signal ?? undefined;
      const process = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        signal,
        killSignal: "SIGKILL",
        ...options,
      });

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      process.on("close", (code) => {
        if (signal?.aborted) {
          reject(new Error("Cancelled"));
        } else {
          resolve({ code, stdout, stderr });
        }
      });

      process.on("error", (error) => {
        if (signal?.aborted) {
          reject(new Error("Cancelled"));
          return;
        }
        console.error(`Failed to start command: ${command} ${args.join(" ")}`);
        console.error(`Error: ${error.message}`);
        reject(new Error(`Failed to start command: ${error.message}`));
      });
    });
  }
}
