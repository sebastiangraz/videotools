import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { InputError } from "./errors.js";

const execFileAsync = promisify(execFile);

type RunOptions = { cwd?: string };

type RunResult = { code: number | null; stdout: string; stderr: string };

export const DEFAULT_FPS = 30;

// `codec` is the decoder name (content, not file extension). `matrix` uses
// scale's names; RGB inputs count as bt601, null is untagged YUV.
export type MediaInfo = {
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  codec: string;
  matrix: "bt709" | "bt601" | "bt2020" | null;
  sar: number;
};

// An animated AVIF lists a one-frame cover stream before the animation, and
// some files carry cover art as "attached pic". Prefer own bitrate, then fps.
const OWN_BITRATE_SCORE = 1e6;
function mainVideo(summary: string): { line: string; index: number } | null {
  const streams = summary
    .split("\n")
    .filter((line) => /Stream #\d+:\d+.*: Video: /.test(line))
    .map((line, index) => ({ line, index }));
  const real = streams.filter((s) => !s.line.includes("(attached pic)"));
  const score = ({ line }: { line: string }) =>
    (/, \d+x\d+\b.*\b\d+ kb\/s/.test(line) ? OWN_BITRATE_SCORE : 0) +
    Number(/, ([\d.]+) fps\b/.exec(line)?.[1] ?? 0);
  return (
    (real.length ? real : streams).reduce<(typeof streams)[number] | null>(
      (best, s) => (best === null || score(s) > score(best) ? s : best),
      null,
    ) ?? null
  );
}

export const isRgb = (pixFmt: string) => /^(rgb|bgr|gbr|argb|abgr|pal8)/.test(pixFmt);

function matrixOf(tags: string[], pixFmt: string): MediaInfo["matrix"] {
  if (tags.includes("bt709")) return "bt709";
  if (tags.some((t) => t === "bt470bg" || t === "smpte170m")) return "bt601";
  if (isRgb(pixFmt) || /^(gray|ya|mono)/.test(pixFmt)) return "bt601";
  if (tags.some((t) => t.startsWith("bt2020"))) return "bt2020";
  return null;
}

// Split on ", " so WxH is matched as a whole field, never inside the codec
// tag (`avc1 / 0x31637661`). Stills report "Duration: N/A" → 0.
export function parseMediaInfo(summary: string): MediaInfo | null {
  const video = mainVideo(summary)?.line;
  if (!video) return null;
  const fields = video.slice(video.indexOf(": Video: ")).split(", ");
  const size = fields.map((f) => /^(\d+)x(\d+)\b/.exec(f)).find(Boolean);
  if (!size) return null;
  const codec = /: Video: (\w+)/.exec(video)?.[1] ?? "";
  // e.g. "yuv420p(tv, bt709, progressive)" or "yuvj444p(pc, bt470bg/unknown/
  // unknown)": one name when all agree, else matrix/primaries/trc.
  const [, pixFmt = "", tags = ""] = /, ([a-z]\w*)(?:\(([^)]*)\))?, \d+x\d+/.exec(video) ?? [];
  const matrix = matrixOf(
    tags.split(", ").map((t) => t.split("/")[0]),
    pixFmt,
  );

  const rate =
    fields.map((f) => /^([\d.]+) fps\b/.exec(f)).find(Boolean) ??
    fields.map((f) => /^([\d.]+) tbr\b/.exec(f)).find(Boolean);
  const fps = rate ? parseFloat(rate[1]) : NaN;

  // A container SAR is printed after the codec's, and is the one ffmpeg uses.
  const ratios = [...video.matchAll(/\bSAR (\d+):(\d+)/g)];
  const [, num = 0, den = 0] = ratios.at(-1)?.map(Number) ?? [];

  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(summary);
  const duration = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;

  return {
    duration,
    width: Number(size[1]),
    height: Number(size[2]),
    fps: Number.isFinite(fps) && fps > 0 ? fps : null,
    codec,
    matrix,
    sar: num && den ? num / den : 1,
  };
}

export function parseOutputSize(log: string): { width: number; height: number } | null {
  const size = /^Output #0,[^]*?^\s*Stream #0:0.*: Video: .*?, (\d+)x(\d+)\b/m.exec(log);
  return size ? { width: Number(size[1]), height: Number(size[2]) } : null;
}

type VideoPacket = {
  time: number;
  duration: number;
  size: number;
  key: boolean;
};

export type SourceProfile = MediaInfo & {
  // `0:v:N` of the main stream; "the first video stream" can be a cover image.
  videoIndex: number;
  // e.g. ["mov", "mp4", "m4a", ...]: a family, told apart by majorBrand.
  formatNames: string[];
  // mov family only; elsewhere it's a leftover (a webm from an mp4 keeps it).
  majorBrand: string | null;
  // ffmpeg prints videoKbps for the mov family only.
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
  const formatNames = /^Input #0, (.+?), from /m.exec(summary)?.[1].split(",") ?? [];
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

// One job's binaries and probe cache; the only state a job has.
export class FFmpeg {
  ffmpeg: string;
  gifski: string;
  signal: AbortSignal | null;
  // Time left in the function limit decides optional second passes (gif.ts).
  startedAt = Date.now();
  private infoCache = new Map<string, SourceProfile>();

  constructor(ffmpegPath: string, gifskiPath: string, signal: AbortSignal | null = null) {
    this.ffmpeg = ffmpegPath;
    this.gifski = gifskiPath;
    this.signal = signal;
  }

  // Saves shipping ffprobe. `ffmpeg -i` with no output exits non-zero by design.
  async summary(inputFile: string): Promise<string> {
    const { stderr } = await this.run(this.ffmpeg, ["-hide_banner", "-i", inputFile]);
    return stderr;
  }

  async mediaInfo(inputFile: string, summary?: string): Promise<SourceProfile> {
    const cached = this.infoCache.get(inputFile);
    if (cached) return cached;
    const stderr = summary ?? (await this.summary(inputFile));
    const info = parseSourceProfile(stderr);
    // The client can't validate WebP, so a bad one is the user's error.
    if (!info && /^Input #0, webp_(pipe|anim),/m.test(stderr)) {
      throw new InputError("This WebP file can't be read.", "unreadable-source");
    }
    if (!info) throw new Error(`Could not read media info: ${stderr.trim()}`);
    // The animated WebP demuxer prints "Duration: N/A"; sum the packets.
    if (!info.duration && info.formatNames.includes("webp_anim")) {
      const packets = await this.listPackets(inputFile, info.videoIndex);
      if (!packets) {
        throw new InputError("This WebP file can't be read.", "unreadable-source");
      }
      let start = Infinity;
      let end = 0;
      for (const p of packets) {
        start = Math.min(start, p.time);
        end = Math.max(end, p.time + p.duration);
      }
      info.duration = end - start;
    }
    this.infoCache.set(inputFile, info);
    return info;
  }

  // ffmpeg applies a JPEG's EXIF rotation on decode but the summary gives the
  // stored size, so decode one frame to learn the shown one.
  async shownSize(inputFile: string): Promise<{ width: number; height: number } | null> {
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

  // Stream copy to framecrc only demuxes (milliseconds). Lines are
  // "stream, dts, pts, duration, size, crc[, F=flags]" (flags = not a
  // keyframe) under "#tb 0: 1/30000".
  async videoPackets(inputFile: string): Promise<VideoPacket[] | null> {
    const { videoIndex } = await this.mediaInfo(inputFile);
    return this.listPackets(inputFile, videoIndex);
  }

  private async listPackets(inputFile: string, videoIndex: number): Promise<VideoPacket[] | null> {
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
          duration: Number(fields[3]) * timeBase,
          size: Number(fields[4]),
          key: !fields.some((f) => f.startsWith("F=")),
        };
      });
    const readable = packets.every(
      (p) => Number.isFinite(p.time) && Number.isFinite(p.duration) && Number.isFinite(p.size),
    );
    return packets.length && readable ? packets : null;
  }

  // Full decode: slow, unlike the packet count.
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

  runGifski(args: string[], options: RunOptions = {}): Promise<string> {
    return this.runCommand(this.gifski, args, options);
  }

  private async runCommand(command: string, args: string[], options: RunOptions): Promise<string> {
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

  // Non-zero exits resolve (`ffmpeg -i` probes always end in one); rejects
  // only when not started or cancelled.
  async run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    console.log(`Running: ${command} ${args.join(" ")}`);
    if (options.cwd) {
      console.log(`Working directory: ${options.cwd}`);
    }

    // SIGKILL: partial output is discarded anyway.
    const signal = this.signal ?? undefined;
    const cancelled = () => new Error("Cancelled");
    try {
      const running = execFileAsync(command, args, {
        cwd: options.cwd,
        signal,
        killSignal: "SIGKILL",
        maxBuffer: Infinity,
      });
      // Immediate EOF, like an ignored stdin.
      running.child.stdin?.end();
      const { stdout, stderr } = await running;
      if (signal?.aborted) throw cancelled();
      return { code: 0, stdout, stderr };
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      const failure = error as NodeJS.ErrnoException & {
        code?: number | string | null;
        stdout?: string;
        stderr?: string;
      };
      // A child that never started has a syscall ("spawn ...").
      if (failure.syscall === undefined && typeof failure.stderr === "string") {
        return {
          code: typeof failure.code === "number" ? failure.code : null,
          stdout: failure.stdout ?? "",
          stderr: failure.stderr,
        };
      }
      console.error(`Failed to start command: ${command} ${args.join(" ")}`);
      console.error(`Error: ${failure.message}`);
      throw new Error(`Failed to start command: ${failure.message}`, {
        cause: error,
      });
    }
  }
}
