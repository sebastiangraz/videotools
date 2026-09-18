import fs from "node:fs/promises";
import path from "node:path";
import type { FFmpeg } from "../ffmpeg.js";
import { h264, x264Crf, INTERMEDIATE_CRF } from "../encode/h264.js";
import { clamp, pick, singleVideo } from "../request.js";
import type { Tool } from "./types.js";

// Mirrored in client/src/pages/Loop/Loop.tsx (TECHNIQUES)
const VALID_TECHNIQUES = ["reverse", "crossfade"] as const;

export async function createLoop(
  ff: FFmpeg,
  inputFile: string,
  technique = "reverse",
  fadeDuration = "0.5",
  startSecond = "0",
  quality = 100,
): Promise<string> {
  const outputFile = `${inputFile}_loop.mp4`;

  console.log(`Processing video: ${inputFile}`);
  console.log(`Output will be saved to: ${outputFile}`);
  console.log(`Using technique: ${technique}`);

  try {
    // Check if input file exists
    await fs.access(inputFile);

    const crf = x264Crf(quality);

    if (technique === "crossfade") {
      await createCrossfadeLoop(
        ff,
        inputFile,
        outputFile,
        fadeDuration,
        startSecond,
        crf,
      );
    } else {
      // Default to reverse technique
      await createReverseLoop(ff, inputFile, outputFile, crf);
    }

    // Verify output file was created
    await fs.access(outputFile);
    console.log(`Success! Seamless loop created at: ${outputFile}`);

    return outputFile;
  } catch (error) {
    console.error("Processing error:", error);
    throw error;
  }
}

async function createReverseLoop(
  ff: FFmpeg,
  inputFile: string,
  outputFile: string,
  crf: string,
): Promise<void> {
  console.log("Creating simple reversed loop...");

  const tempDir = path.join(path.dirname(inputFile), `tmp_loop_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const reverseFile = path.join(tempDir, "reverse.mp4");

    // Create reversed video. The reversed half gets encoded again in the
    // concat below, so keep this intermediate near-lossless to avoid
    // generation loss.
    await ff.runFFmpeg([
      "-y",
      "-i",
      inputFile,
      "-vf",
      "reverse",
      ...h264(INTERMEDIATE_CRF),
      reverseFile,
    ]);

    // Concatenate original and reversed
    await ff.runFFmpeg([
      "-y",
      "-i",
      inputFile,
      "-i",
      reverseFile,
      "-filter_complex",
      // Normalize SAR on both inputs: re-encoding can round a source's
      // pixel aspect ratio differently, and concat rejects mismatched SARs.
      "[0:v]setsar=1[v0];[1:v]setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0",
      ...h264(crf),
      "-pix_fmt",
      "yuv420p",
      outputFile,
    ]);
  } finally {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function createCrossfadeLoop(
  ff: FFmpeg,
  inputFile: string,
  outputFile: string,
  fadeDuration: string,
  startSecond: string,
  crf: string,
): Promise<void> {
  console.log("Creating seamless loop with crossfade technique...");
  console.log(`Using fade duration: ${fadeDuration} seconds`);
  console.log(`Starting from: ${startSecond} seconds`);

  // Get video info
  const duration = await ff.duration(inputFile);
  const fps = await ff.fps(inputFile);

  console.log(`Video duration: ${duration} seconds, FPS: ${fps}`);

  // Validate fade duration
  if (parseFloat(fadeDuration) >= duration / 2) {
    throw new Error(
      `Fade duration (${fadeDuration}) must be less than half the video duration (${
        duration / 2
      })`,
    );
  }

  if (parseFloat(fadeDuration) === 0) {
    // No fade, just copy or reorder
    if (parseFloat(startSecond) === 0) {
      console.log("No fade, no reorder: copying original file");
      await fs.copyFile(inputFile, outputFile);
    } else {
      console.log("No fade, reordering segments...");
      await reorderSegments(ff, inputFile, outputFile, startSecond, crf);
    }
    return;
  }

  // Create crossfade loop
  const tempDir = path.join(path.dirname(inputFile), `tmp_loop_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  // One segment of the source, re-encoded at the source frame rate so the
  // pieces concatenate cleanly.
  const cut = (range: string[], clipCrf: string, clip: string) =>
    ff.runFFmpeg([
      "-y",
      "-i",
      inputFile,
      ...range,
      ...h264(clipCrf),
      "-r",
      fps.toString(),
      "-pix_fmt",
      "yuv420p",
      clip,
    ]);

  try {
    const startClip = path.join(tempDir, "start.mp4");
    const endClip = path.join(tempDir, "end.mp4");
    const crossfadeClip = path.join(tempDir, "crossfade.mp4");

    // Extract start and end segments. These are re-encoded again by the
    // xfade step, so keep them near-lossless to avoid generation loss.
    const endStartTime = duration - parseFloat(fadeDuration);

    await cut(["-t", fadeDuration], INTERMEDIATE_CRF, startClip);
    await cut(["-ss", endStartTime.toString()], INTERMEDIATE_CRF, endClip);

    // Create crossfade. This clip (and the segments below) land in the
    // output unchanged via stream-copy concat, so they use the user crf.
    await ff.runFFmpeg([
      "-y",
      "-i",
      endClip,
      "-i",
      startClip,
      "-filter_complex",
      `[0:v][1:v]xfade=transition=fade:duration=${fadeDuration}:offset=0[out]`,
      "-map",
      "[out]",
      ...h264(crf),
      "-r",
      fps.toString(),
      "-pix_fmt",
      "yuv420p",
      crossfadeClip,
    ]);

    // Create final video based on start second
    if (parseFloat(startSecond) === 0) {
      // Standard loop: main body + crossfade
      const mainClip = path.join(tempDir, "main.mp4");
      const mainStart = parseFloat(fadeDuration);
      const mainDuration = duration - 2 * parseFloat(fadeDuration);

      await cut(
        ["-ss", mainStart.toString(), "-t", mainDuration.toString()],
        crf,
        mainClip,
      );

      await concatenateVideos(
        ff,
        [mainClip, crossfadeClip],
        outputFile,
        tempDir,
        crf,
      );
    } else {
      // Custom start: segment after start + crossfade + segment before start
      const seg1 = path.join(tempDir, "seg1.mp4");
      const seg3 = path.join(tempDir, "seg3.mp4");

      const seg1Duration = endStartTime - parseFloat(startSecond);
      const seg3Duration = parseFloat(startSecond) - parseFloat(fadeDuration);

      const segments: string[] = [];

      if (seg1Duration > 0) {
        await cut(["-ss", startSecond, "-t", seg1Duration.toString()], crf, seg1);
        segments.push(seg1);
      }

      segments.push(crossfadeClip);

      if (seg3Duration > 0) {
        await cut(["-ss", fadeDuration, "-t", seg3Duration.toString()], crf, seg3);
        segments.push(seg3);
      }

      await concatenateVideos(ff, segments, outputFile, tempDir, crf);
    }
  } finally {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function reorderSegments(
  ff: FFmpeg,
  inputFile: string,
  outputFile: string,
  startSecond: string,
  crf: string,
): Promise<void> {
  const tempDir = path.join(path.dirname(inputFile), `tmp_loop_${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const afterPart = path.join(tempDir, "after.mp4");
    const beforePart = path.join(tempDir, "before.mp4");

    // Extract segment after start second
    await ff.runFFmpeg([
      "-y",
      "-i",
      inputFile,
      "-ss",
      startSecond,
      "-c",
      "copy",
      afterPart,
    ]);

    // Extract segment before start second
    await ff.runFFmpeg([
      "-y",
      "-i",
      inputFile,
      "-to",
      startSecond,
      "-c",
      "copy",
      beforePart,
    ]);

    await concatenateVideos(
      ff,
      [afterPart, beforePart],
      outputFile,
      tempDir,
      crf,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function concatenateVideos(
  ff: FFmpeg,
  videoFiles: string[],
  outputFile: string,
  tempDir: string,
  crf: string,
): Promise<void> {
  const listFile = path.join(tempDir, "concat_list.txt");
  const listContent = videoFiles
    .map((f) => `file '${path.basename(f)}'`)
    .join("\n");

  await fs.writeFile(listFile, listContent);

  console.log(`Created concat list at: ${listFile}`);
  console.log(`List content:\n${listContent}`);

  const concat = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    path.basename(listFile), // Use relative path within temp directory
  ];

  // Try fast copy first, fallback to re-encoding
  try {
    await ff.runFFmpeg(
      [
        ...concat,
        "-c",
        "copy",
        path.resolve(outputFile), // Use absolute path for output
      ],
      { cwd: tempDir },
    );
  } catch {
    console.log("Fast concatenation failed, trying with re-encoding...");
    await ff.runFFmpeg(
      [
        ...concat,
        ...h264(crf),
        "-pix_fmt",
        "yuv420p",
        path.resolve(outputFile), // Use absolute path for output
      ],
      { cwd: tempDir },
    );
  }
}

export const loop: Tool = {
  inputs: singleVideo,
  async run({ ff, workDir, inputs, options, download }) {
    const technique = pick(options.technique, VALID_TECHNIQUES, "reverse");
    const fadeDuration = clamp(options.fadeDuration, 0, 10, 0.5);
    const startSecond = clamp(
      options.startSecond,
      0,
      Number.MAX_SAFE_INTEGER,
      0,
    );
    const quality = Math.round(clamp(options.quality, 1, 100, 100));

    const inputPath = path.join(workDir, "input.mp4");
    await download(inputs[0], inputPath);

    const outputPath = await createLoop(
      ff,
      inputPath,
      technique,
      String(fadeDuration),
      String(startSecond),
      quality,
    );
    return { outputPath, suffix: "loop", ext: "mp4" };
  },
};
