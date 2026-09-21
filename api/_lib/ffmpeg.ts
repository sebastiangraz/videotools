import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { InputError } from "./errors.js";

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

// The video stream to work on, and its place among the file's video streams
// (ffmpeg's `v:N`). Nearly always the only one. The exceptions are why this
// exists: ffmpeg 7 lists an animated AVIF as two, its one-frame cover image
// first and the animation second (ffmpeg 6 only showed the animation), and
// audio files and some mp4s carry cover art as an "attached pic" stream.
// The animation is the one with a bitrate of its own; failing that, the
// higher frame rate; failing that, the first.
function mainVideo(summary: string): { line: string; index: number } | null {
  const streams = summary
    .split("\n")
    .filter((line) => /Stream #\d+:\d+.*: Video: /.test(line))
    .map((line, index) => ({ line, index }));
  const real = streams.filter((s) => !s.line.includes("(attached pic)"));
  const score = ({ line }: { line: string }) =>
    (/, \d+x\d+\b.*\b\d+ kb\/s/.test(line) ? 1e6 : 0) +
    Number(/, ([\d.]+) fps\b/.exec(line)?.[1] ?? 0);
  return (
    (real.length ? real : streams).reduce<(typeof streams)[number] | null>(
      (best, s) => (best === null || score(s) > score(best) ? s : best),
      null,
    ) ?? null
  );
}

// Parses the `-i` summary, e.g.
//   Duration: 00:00:03.00, start: 0.000000, bitrate: 46 kb/s
//   Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661),
//     yuv420p(progressive), 320x240 [SAR 1:1 DAR 4:3], 40 kb/s, 29.97 fps,
//     29.97 tbr, 11988 tbn (default)
// The video line is split on ", " so a WxH field is matched whole: the
// codec tag (`0x31637661`) never starts a field. Stills report
// "Duration: N/A", which reads as 0.
export function parseMediaInfo(summary: string): MediaInfo | null {
  const video = mainVideo(summary)?.line;
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

// The size of the pictures a run wrote, off its log's output stream line:
//   Output #0, null, to 'pipe:':
//     Stream #0:0: Video: wrapped_avframe, yuvj444p(pc, bt470bg/unknown/
//       unknown, progressive), 240x320 [SAR 1:1 DAR 3:4], q=2-31, ...
export function parseOutputSize(
  log: string,
): { width: number; height: number } | null {
  const size =
    /^Output #0,[^]*?^\s*Stream #0:0.*: Video: .*?, (\d+)x(\d+)\b/m.exec(log);
  return size ? { width: Number(size[1]), height: Number(size[2]) } : null;
}

export type VideoPacket = { time: number; size: number; key: boolean };

// What else the same summary says about a source: enough to tell which
// format it is (source.ts) and what it spends per second, which is what the
// output stage holds a result to (encode/rate.ts).
export type SourceProfile = MediaInfo & {
  // Which of the file's video streams all of this is about (mainVideo): the
  // N of ffmpeg's `0:v:N`. Anything that names the source's video has to go
  // by it, since "the first video stream" can be a cover image.
  videoIndex: number;
  // The demuxer's names, e.g. ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"]:
  // a family of containers rather than one.
  formatNames: string[];
  // What tells that family apart: the ftyp brand ("isom", "qt", "avis").
  // Null outside it, where the tag is only ever a leftover (a webm made
  // from an mp4 carries the mp4's as MAJOR_BRAND, in capitals).
  majorBrand: string | null;
  // kb/s of the whole file, and of the video stream alone. ffmpeg prints
  // the latter for the mov family only; FFmpeg.videoBytes measures it for
  // the rest.
  bitrateKbps: number | null;
  videoKbps: number | null;
  pixFmt: string;
  audio: { codec: string; kbps: number | null } | null;
};

export function parseSourceProfile(output: string): SourceProfile | null {
  // ffmpeg on Windows ends its lines in CRLF.
  const summary = output.replace(/\r/g, "");
  const info = parseMediaInfo(summary);
  if (!info) return null;
  const lines = summary.split("\n");
  const formatNames =
    /^Input #0, (.+?), from /m.exec(summary)?.[1].split(",") ?? [];
  const brand = formatNames.includes("mov")
    ? /^\s*major_brand\s*:\s*(\S+)/m.exec(summary)?.[1]
    : undefined;
  const kbps = (text: string | undefined) => {
    const match = /(\d+) kb\/s/.exec(text ?? "");
    return match ? Number(match[1]) : null;
  };
  const main = mainVideo(summary);
  const video = main?.line ?? "";
  const audio = lines.find((l) => /Stream #\d+:\d+.*: Audio: /.test(l));
  return {
    ...info,
    videoIndex: main?.index ?? 0,
    formatNames,
    majorBrand: brand ?? null,
    bitrateKbps: kbps(/Duration: .*bitrate: ([^\n]*)/.exec(summary)?.[1]),
    // Past the WxH field, so the codec tag's digits never match.
    videoKbps: kbps(/, \d+x\d+\b(.*)$/.exec(video)?.[1]),
    pixFmt: /, ([a-z]\w*)(?:\([^)]*\))?, \d+x\d+/.exec(video)?.[1] ?? "",
    audio: audio
      ? {
          codec: /: Audio: (\w+)/.exec(audio)?.[1] ?? "",
          kbps: kbps(audio),
        }
      : null,
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
  // When the job began: what is left of the function's time limit decides
  // whether an optional second pass is worth starting (encode/gif.ts).
  startedAt = Date.now();
  // Inputs are immutable for the life of a job, so probe each file once.
  private infoCache = new Map<string, SourceProfile>();

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
  async mediaInfo(inputFile: string): Promise<SourceProfile> {
    const cached = this.infoCache.get(inputFile);
    if (cached) return cached;
    const { stderr } = await this.run(this.ffmpeg, [
      "-hide_banner",
      "-i",
      inputFile,
    ]);
    const info = parseSourceProfile(stderr);
    if (!info) {
      // ffmpeg reads a WebP still but has no decoder for the animated kind:
      // it finds the stream and no picture in it.
      if (/^Input #0, webp_pipe,/m.test(stderr)) {
        throw new InputError(
          "Animated WebP can't be read (ffmpeg has no decoder for it). " +
            "Use the file it was made from instead.",
          "unreadable-source",
        );
      }
      throw new Error(`Could not read media info: ${stderr.trim()}`);
    }
    this.infoCache.set(inputFile, info);
    return info;
  }

  // The size a still's picture has once decoded, which is not always the
  // summary's: ffmpeg turns a JPEG by its EXIF orientation on the way in (as
  // browsers do when they show one), and the summary gives the size as
  // stored. Nothing says so before a run, so this is one, of the one frame,
  // to nowhere. Null when its log can't be read.
  async shownSize(
    inputFile: string,
  ): Promise<{ width: number; height: number } | null> {
    const { stderr } = await this.run(this.ffmpeg, [
      "-hide_banner",
      "-i",
      inputFile,
      "-frames:v",
      "1",
      "-f",
      "null",
      "-",
    ]);
    return parseOutputSize(stderr.replace(/\r/g, ""));
  }

  // The packets of the video stream, in the order they are stored: when
  // each is shown (seconds), its size, and whether it is a keyframe. A
  // stream copy into the framecrc muxer only demuxes, so this takes
  // milliseconds and decodes nothing; it prints a line per packet,
  //   0,       -1000,          0,     1000,    15373, 0xea0a89e8
  //   0,           0,       2000,     1000,    14397, 0xf34943f6, F=0x0
  // (stream, dts, pts, duration, size, crc, and the flags of any packet that
  // is not a plain keyframe) under a header that has the time base,
  //   #tb 0: 1/30000
  // Null when the stream cannot be listed.
  async videoPackets(inputFile: string): Promise<VideoPacket[] | null> {
    const { videoIndex } = await this.mediaInfo(inputFile);
    const { code, stdout } = await this.run(this.ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputFile,
      "-map",
      `0:v:${videoIndex}`,
      "-c",
      "copy",
      "-f",
      "framecrc",
      "-",
    ]);
    const tb = /^#tb 0: (\d+)\/(\d+)/m.exec(stdout);
    if (code !== 0 || !tb) return null;
    const timeBase = Number(tb[1]) / Number(tb[2]);
    const packets = stdout
      .split("\n")
      .filter((line) => /^\d/.test(line))
      .map((line) => {
        const fields = line.split(",").map((f) => f.trim());
        return {
          time: Number(fields[2]) * timeBase,
          size: Number(fields[4]),
          key: !fields.some((f) => f.startsWith("F=")),
        };
      });
    const readable = packets.every(
      (p) => Number.isFinite(p.time) && Number.isFinite(p.size),
    );
    return packets.length && readable ? packets : null;
  }

  // How many frames of the video stream actually decode. Unlike the packet
  // count this reads every frame, at decoding speed.
  async decodedFrames(inputFile: string): Promise<number | null> {
    const { videoIndex } = await this.mediaInfo(inputFile);
    const { code, stderr } = await this.run(this.ffmpeg, [
      "-hide_banner",
      "-i",
      inputFile,
      "-map",
      `0:v:${videoIndex}`,
      "-fps_mode",
      "passthrough",
      "-f",
      "null",
      "-",
    ]);
    const frames = [...stderr.matchAll(/\bframe=\s*(\d+)/g)].pop();
    return code === 0 && frames ? Number(frames[1]) : null;
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
