import fs from "node:fs/promises";
import path from "node:path";
import type { FormatId } from "../../../shared/formats.js";
import { InputError } from "../errors.js";
import { DEFAULT_FPS, isRgb, type FFmpeg } from "../ffmpeg.js";
import { encodePreserved } from "../encode/index.js";
import {
  frameRate,
  sourceRender,
  videoPad,
  type Render,
} from "../encode/render.js";
import { FASTSTART } from "../encode/video.js";
import { clamp, pick, singleVideo } from "../request.js";
import { openSource, preservedFormat, type Source } from "../source.js";
import type { Tool } from "./types.js";

// Mirrored in client/src/pages/Loop/Loop.tsx (TECHNIQUES)
const VALID_TECHNIQUES = ["reverse", "crossfade"] as const;

const STREAM_COPY: FormatId[] = ["mp4", "mov", "webm"];

// A start point within this of a keyframe snaps onto it for a lossless copy;
// further away it is encoded to the frame instead.
const KEYFRAME_SNAP_SECONDS = 0.5;

// reverse buffers every decoded frame. Measured to fit a 2GB function next to
// the encoder; raise only together with the function's memory.
const MAX_REVERSE_BYTES = 1.2e9;

// The output stage does the reversing (encode/render.ts), cheapest per format.
function reverseLoop(source: Source): Render {
  const { duration, fps, width, height, pixFmt } = source.profile;
  // GIF frames are files gifski reads twice; others buffer yuv420p (1.5 B/px)
  // or, for WebP, bgra (4 B/px).
  if (source.format !== "gif") {
    const bytesPerPixel = source.format === "webp" ? 4 : 1.5;
    const bytes =
      duration * (fps ?? DEFAULT_FPS) * width * height * bytesPerPixel;
    if (bytes > MAX_REVERSE_BYTES) {
      throw new InputError(
        `Video too long to reverse at this size: ${Math.round(duration)}s of ` +
          `${width}×${height} (${pixFmt}) doesn't fit in memory. Use a ` +
          `shorter or smaller clip, or the crossfade technique.`,
        "too-long",
      );
    }
  }
  return sourceRender(source, {
    keepAudio: false,
    palindrome: true,
    duration: duration * 2,
  });
}

// The source is opened twice so each input is read in order and only the fade
// is buffered (one input split would buffer most of the clip). Cut in frames,
// not timestamps, so the pieces meet exactly.
function crossfadeLoop(
  source: Source,
  fadeSeconds: number,
  startSeconds: number,
): Render {
  const { duration, pixFmt } = source.profile;
  if (fadeSeconds >= duration / 2) {
    throw new InputError(
      `Fade duration (${fadeSeconds}) must be less than half the video ` +
        `duration (${duration / 2})`,
      "invalid-option",
    );
  }
  const fps = source.profile.fps ?? DEFAULT_FPS;
  const frames = Math.round(duration * fps);
  const fade = Math.round(fadeSeconds * fps);
  // The opening frames only exist blended, so the start lies within [fade, frames - fade].
  const start = Math.max(
    fade,
    Math.min(Math.round(startSeconds * fps), frames - fade),
  );
  if (fade === 0 && (start === 0 || start >= frames)) {
    return sourceRender(source, { keepAudio: false });
  }

  // xfade needs planar formats; give RGB sources gbrap (keeps alpha) rather than YUV.
  const rgb = isRgb(pixFmt);
  const rate = `fps=${frameRate(fps)}`;
  const open = `${rate}${rgb ? ",format=gbrap" : ""}`;
  const piece = (from: number | null, to: number | null) =>
    "trim=" +
    [from != null && `start_frame=${from}`, to != null && `end_frame=${to}`]
      .filter(Boolean)
      .join(":") +
    ",setpts=PTS-STARTPTS";

  // Input 0: start → end (body, then fade-out). Input 1: fade-in, then rest up to start.
  const body = start < frames - fade;
  const rest = start > fade;
  const first = videoPad(source, 0);
  const second = videoPad(source, 1);
  const graph: string[] = [];
  const order: string[] = [];
  if (fade > 0) {
    graph.push(
      body
        ? `${first}${open},split[a0][a1];[a0]${piece(start, frames - fade)}[body];` +
            `[a1]${piece(frames - fade, null)}[end]`
        : `${first}${open},${piece(frames - fade, null)}[end]`,
      rest
        ? `${second}${open},split[b0][b1];[b0]${piece(null, fade)}[begin];` +
            `[b1]${piece(fade, start)}[rest]`
        : `${second}${open},${piece(null, fade)}[begin]`,
      `[end][begin]xfade=transition=fade:duration=${fade / fps}:offset=0[fade]`,
    );
    order.push(
      ...(body ? ["[body]"] : []),
      "[fade]",
      ...(rest ? ["[rest]"] : []),
    );
  } else {
    graph.push(
      `${first}${open},${piece(start, null)}[body]`,
      `${second}${open},${piece(null, start)}[rest]`,
    );
    order.push("[body]", "[rest]");
  }
  graph.push(
    order.length > 1
      ? `${order.join("")}concat=n=${order.length}:v=1:a=0[out]`
      : `${order[0]}null[out]`,
  );

  return sourceRender(source, {
    inputArgs: ["-i", source.path, "-i", source.path],
    filter: graph.join(";"),
    keepAudio: false,
    duration: (frames - fade) / fps,
    fps,
  });
}

type Copy = { format: FormatId; outputFile: string; startSeconds: number };

// False when the loop has to be encoded instead.
async function loopByCopy(
  ff: FFmpeg,
  source: Source,
  copy: Copy,
): Promise<boolean> {
  if (copy.startSeconds === 0) {
    console.log("No fade, no reorder: handing the source back");
    await copyWhole(ff, source, copy);
    return true;
  }
  if (!STREAM_COPY.includes(copy.format)) return false;
  try {
    console.log("No fade: reordering the streams without decoding");
    return await reorderCopy(ff, source, copy);
  } catch (err) {
    if (ff.signal?.aborted) throw err;
    console.log("Stream copy failed, encoding instead...");
    return false;
  }
}

// Video still drops its audio like every loop, hence a remux rather than a copy.
async function copyWhole(
  ff: FFmpeg,
  source: Source,
  { format, outputFile }: Copy,
): Promise<void> {
  if (!STREAM_COPY.includes(format)) {
    await fs.copyFile(source.path, outputFile);
    return;
  }
  await ff.runFFmpeg([
    "-y",
    "-i",
    source.path,
    "-map",
    `0:v:${source.profile.videoIndex}`,
    "-c",
    "copy",
    ...(format === "mp4" ? FASTSTART : []),
    outputFile,
  ]);
}

// Lossless reorder at a nearby keyframe. B-frame streams (most H.264) lose a
// frame at the cut, so the result is verified; false/throw means encode instead.
async function reorderCopy(
  ff: FFmpeg,
  source: Source,
  { format, outputFile, startSeconds }: Copy,
): Promise<boolean> {
  const packets = await ff.videoPackets(source.path);
  if (!packets) return false;
  const origin = Math.min(...packets.map((p) => p.time));
  const away = (i: number) => Math.abs(packets[i].time - origin - startSeconds);
  const index = packets
    .map((p, i) => (p.key && i > 0 ? i : -1))
    .filter((i) => i > 0)
    .sort((a, b) => away(a) - away(b))[0];
  if (index === undefined || away(index) > KEYFRAME_SNAP_SECONDS) {
    console.log("No keyframe near the start point");
    return false;
  }
  const keyframe = packets[index].time - origin;
  console.log(`Starting on the keyframe at ${keyframe}s`);

  const tempDir = path.join(path.dirname(source.path), "reorder");
  await fs.mkdir(tempDir, { recursive: true });
  try {
    const cut = (output: string[], input: string[], name: string) =>
      ff.runFFmpeg([
        "-y",
        ...input,
        "-i",
        source.path,
        ...output,
        "-map",
        `0:v:${source.profile.videoIndex}`,
        "-c",
        "copy",
        path.join(tempDir, name),
      ]);
    const parts = [`after.${format}`, `before.${format}`];
    // Cut "before" by packet count: stream copy compares decode times, which
    // run ahead of display. Seek half a frame past the keyframe (times print rounded).
    const halfFrame = 0.5 / (source.profile.fps ?? DEFAULT_FPS);
    await cut([], ["-ss", String(keyframe + halfFrame)], parts[0]);
    await cut(["-frames:v", String(index)], [], parts[1]);

    await fs.writeFile(
      path.join(tempDir, "list.txt"),
      parts.map((p) => `file '${p}'`).join("\n"),
    );
    await ff.runFFmpeg(
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "list.txt",
        "-c",
        "copy",
        ...(format === "mp4" ? FASTSTART : []),
        outputFile,
      ],
      { cwd: tempDir },
    );
    // ffmpeg silently drops a frame at a bad cut, so count the decoded result.
    const decoded = await ff.decodedFrames(outputFile);
    if (decoded !== packets.length) {
      console.log(`Frames: ${packets.length} in, ${decoded} out`);
      return false;
    }
    return true;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export const loop: Tool = {
  inputs: singleVideo,
  async run(job) {
    const { ff, workDir, inputs, options } = job;
    const technique = pick(options.technique, VALID_TECHNIQUES, "reverse");
    const fadeDuration = clamp(options.fadeDuration, 0, 10, 0.5);
    const startSecond = clamp(options.startSecond, 0, Infinity, 0);
    const quality = Math.round(clamp(options.quality, 1, 100, 100));

    const source = await openSource(job, inputs[0]);
    const format = preservedFormat(source);
    const result = (outputPath: string) => ({
      outputPath,
      suffix: "loop",
      ext: format,
    });
    console.log(`Looping ${format} (${technique})...`);

    const outputFile = path.join(workDir, `output.${format}`);
    const copy = { format, outputFile, startSeconds: startSecond };
    const unfaded = technique === "crossfade" && fadeDuration === 0;
    if (unfaded && (await loopByCopy(ff, source, copy))) {
      return result(outputFile);
    }

    const render =
      technique === "crossfade"
        ? crossfadeLoop(source, fadeDuration, startSecond)
        : reverseLoop(source);
    return result(await encodePreserved(job, render, { format, quality }));
  },
};
