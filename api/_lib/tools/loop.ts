import fs from "node:fs/promises";
import path from "node:path";
import type { FormatId } from "../../../shared/formats.js";
import { InputError } from "../errors.js";
import type { FFmpeg } from "../ffmpeg.js";
import { encodePreserved } from "../encode/index.js";
import {
  frameRate,
  sourceRender,
  videoPad,
  type Render,
} from "../encode/render.js";
import { clamp, pick, singleVideo } from "../request.js";
import { openSource, preservedFormat, type Source } from "../source.js";
import type { Tool } from "./types.js";

// Mirrored in client/src/pages/Loop/Loop.tsx (TECHNIQUES)
const VALID_TECHNIQUES = ["reverse", "crossfade"] as const;

// The formats whose streams can be cut and joined without decoding them.
const STREAM_COPY: FormatId[] = ["mp4", "mov", "webm"];

// Streams can only be cut at keyframes, which sit seconds apart. A start
// point this close to one is moved onto it and the loop is made without
// decoding; any further and that would not be the loop that was asked for,
// so it is encoded instead, to the frame.
const KEYFRAME_SNAP_SECONDS = 0.5;

// The reverse filter holds every frame of the clip in memory at once (there
// is no other way to play a stream backwards). This is what that may come
// to, in the encoder's own pixel format; past it the function would run out
// of memory mid-encode, so the clip is refused up front instead. Measured: the
// buffer costs what this estimate says on top of a plain encode (ffmpeg 6 and
// 7 alike), which leaves the encoder its share of a 2GB function. Raise it
// together with the memory the function gets, not on its own.
const MAX_REVERSE_BYTES = 1.2e9;

// Forward, then backward: the clip ends where it began. The output stage
// does the reversing (encode/render.ts), in whichever way is cheapest for
// the format.
function reverseLoop(source: Source): Render {
  const { duration, fps, width, height, pixFmt } = source.profile;
  // A GIF's frames are files that gifski reads twice; everything else
  // buffers decoded frames, at 1.5 bytes a pixel (yuv420p).
  if (source.format !== "gif") {
    const bytes = duration * (fps ?? 30) * width * height * 1.5;
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

// The end of the clip fades into its beginning, so the last frame leads into
// the first. One graph over the source opened twice: every piece is a run of
// consecutive frames of one input, in the order the output needs them, so
// ffmpeg streams it all and buffers no more than the fade. (Pieces of a
// single input would have to wait in memory for their turn: with a custom
// start that is most of the clip.)
//
// Counted in frames at the source's own rate: the pieces then meet exactly,
// which timestamps cut to the millisecond do not.
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
  const fps = source.profile.fps ?? 30;
  const frames = Math.round(duration * fps);
  const fade = Math.round(fadeSeconds * fps);
  // One round of the loop is the clip from the end of the fade-in frames to
  // the start of the fade-out frames, then the fade between them. The start
  // point picks where in that round the file begins, so it lies between
  // those two; the opening frames themselves only exist blended.
  const start = Math.max(
    fade,
    Math.min(Math.round(startSeconds * fps), frames - fade),
  );
  if (fade === 0 && (start === 0 || start >= frames)) {
    // Starting at either end is starting at the beginning.
    return sourceRender(source, { keepAudio: false });
  }

  // xfade works on planar formats only. RGB sources (GIF) get the planar RGB
  // one, alpha included, rather than the YUV it would pick by itself.
  const rgb = /^(rgb|bgr|gbr|argb|abgr|pal8)/.test(pixFmt);
  const rate = `fps=${frameRate(fps)}`;
  const open = `${rate}${rgb ? ",format=gbrap" : ""}`;
  const piece = (from: number | null, to: number | null) =>
    "trim=" +
    [from != null && `start_frame=${from}`, to != null && `end_frame=${to}`]
      .filter(Boolean)
      .join(":") +
    ",setpts=PTS-STARTPTS";
  // setpts leaves its output without a frame rate as of ffmpeg 7 (it could
  // be retiming anything), and two things downstream need one: xfade, which
  // refuses to run without, and the encoder, which assumes 25 fps and drops
  // the frames that don't fit. The frames are on the grid already, so
  // stating the rate again changes none of them. ffmpeg 6 carried the rate
  // through and never showed either problem: test graph changes on both.
  const faded = (from: number | null, to: number | null) =>
    `${piece(from, to)},${rate}`;

  // Input 0 runs from the start point to the end of the clip: what plays
  // before the fade, then the frames that fade out. Input 1 is the opening:
  // the frames that fade in, then what is left up to the start point.
  // Without a fade there is nothing to blend and the two runs just swap.
  const body = start < frames - fade;
  const rest = start > fade;
  // The source, as the graph's two inputs.
  const first = videoPad(source, 0);
  const second = videoPad(source, 1);
  const graph: string[] = [];
  const order: string[] = [];
  if (fade > 0) {
    graph.push(
      body
        ? `${first}${open},split[a0][a1];[a0]${piece(start, frames - fade)}[body];` +
            `[a1]${faded(frames - fade, null)}[end]`
        : `${first}${open},${faded(frames - fade, null)}[end]`,
      rest
        ? `${second}${open},split[b0][b1];[b0]${faded(null, fade)}[begin];` +
            `[b1]${piece(fade, start)}[rest]`
        : `${second}${open},${faded(null, fade)}[begin]`,
      `[end][begin]xfade=transition=fade:duration=${fade / fps}:offset=0[fade]`,
    );
    order.push(...(body ? ["[body]"] : []), "[fade]", ...(rest ? ["[rest]"] : []));
  } else {
    graph.push(
      `${first}${open},${piece(start, null)}[body]`,
      `${second}${open},${piece(null, start)}[rest]`,
    );
    order.push("[body]", "[rest]");
  }
  graph.push(
    order.length > 1
      ? `${order.join("")}concat=n=${order.length}:v=1:a=0,${rate}[out]`
      : `${order[0]}${rate}[out]`,
  );

  return sourceRender(source, {
    inputArgs: ["-i", source.path, "-i", source.path],
    filter: graph.join(";"),
    keepAudio: false,
    duration: (frames - fade) / fps,
    fps,
  });
}

// No fade and no new start: the clip already is the loop that was asked for.
// Video still loses its audio, like every loop does; that is a remux.
async function copyWhole(
  ff: FFmpeg,
  source: Source,
  format: FormatId,
  outputFile: string,
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
    ...(format === "mp4" ? ["-movflags", "+faststart"] : []),
    outputFile,
  ]);
}

// No fade, new start: the part from the start point on, then the part before
// it, joined without decoding either, which is truly lossless. Only where
// a keyframe is close enough to start on, and only if every frame survives:
// streams with B-frames (most H.264) lose one where they are cut, streams
// without (most VP9, anything intra-only) come through whole. Returns false
// (or throws) otherwise; the caller encodes then, to the frame.
async function reorderCopy(
  ff: FFmpeg,
  source: Source,
  format: FormatId,
  startSeconds: number,
  outputFile: string,
): Promise<boolean> {
  const packets = await ff.videoPackets(source.path);
  if (!packets) return false;
  const origin = Math.min(...packets.map((p) => p.time));
  const away = (i: number) =>
    Math.abs(packets[i].time - origin - startSeconds);
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
    // Cut by position, not by time: a copy compares the times packets are
    // decoded at, which run a frame or two ahead of when they are shown. The
    // part before is every packet ahead of the keyframe; the part after
    // comes from seeking the input, which lands on the keyframe at or before
    // the target (half a frame past it, since times are printed rounded).
    const halfFrame = 0.5 / (source.profile.fps ?? 30);
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
        ...(format === "mp4" ? ["-movflags", "+faststart"] : []),
        outputFile,
      ],
      { cwd: tempDir },
    );
    // A frame that goes missing at a cut is no error to ffmpeg, and it is
    // the one thing this path must not do. So the result is decoded, and
    // has to show as many frames as the source holds.
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
    const startSecond = clamp(
      options.startSecond,
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    );
    const quality = Math.round(clamp(options.quality, 1, 100, 100));

    const source = await openSource(job, inputs[0]);
    // A loop comes back in the format it came in.
    const format = preservedFormat(source);
    const result = (outputPath: string) => ({
      outputPath,
      suffix: "loop",
      ext: format,
    });
    console.log(`Looping ${format} (${technique})...`);

    if (technique === "crossfade" && fadeDuration === 0) {
      const outputFile = path.join(workDir, `output.${format}`);
      if (startSecond === 0) {
        console.log("No fade, no reorder: handing the source back");
        await copyWhole(ff, source, format, outputFile);
        return result(outputFile);
      }
      if (STREAM_COPY.includes(format)) {
        try {
          console.log("No fade: reordering the streams without decoding");
          if (await reorderCopy(ff, source, format, startSecond, outputFile)) {
            return result(outputFile);
          }
        } catch (err) {
          if (ff.signal?.aborted) throw err;
          console.log("Stream copy failed, encoding instead...");
        }
      }
    }

    const render =
      technique === "crossfade"
        ? crossfadeLoop(source, fadeDuration, startSecond)
        : reverseLoop(source);
    return result(await encodePreserved(ff, render, workDir, format, quality));
  },
};
