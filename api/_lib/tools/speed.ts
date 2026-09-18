import path from "node:path";
import type { FFmpeg } from "../ffmpeg.js";
import { h264 } from "../encode/h264.js";
import { clamp, singleVideo } from "../request.js";
import type { Tool } from "./types.js";

export async function changeSpeed(
  ff: FFmpeg,
  inputFile: string,
  multiplier: number,
): Promise<string> {
  console.log(`Changing playback speed by ${multiplier}x...`);

  const outputFile = `${inputFile}_speed.mp4`;
  const fps = await ff.fps(inputFile);

  // setpts rescales frame timestamps; keeping the source frame rate via
  // -r makes speed-ups drop frames (instead of raising the output fps)
  // and slow-downs duplicate frames. Audio is dropped like in the other
  // tools.
  await ff.runFFmpeg([
    "-y",
    "-i",
    inputFile,
    "-vf",
    `setpts=PTS/${multiplier}`,
    "-r",
    fps.toString(),
    "-an",
    ...h264("22"),
    "-pix_fmt",
    "yuv420p",
    outputFile,
  ]);

  return outputFile;
}

export const speed: Tool = {
  inputs: singleVideo,
  async run({ ff, workDir, inputs, options, download }) {
    // Signed ratio: ±1 → 2× faster/slower, ±3 → 4×. Mirrored in
    // client/src/pages/Speed/Speed.tsx.
    const ratio = clamp(options.speed, -3, 3, 0);
    const multiplier = ratio >= 0 ? 1 + ratio : 1 / (1 - ratio);

    const inputPath = path.join(workDir, "input.mp4");
    await download(inputs[0], inputPath);

    const outputPath = await changeSpeed(ff, inputPath, multiplier);
    return { outputPath, suffix: "speed", ext: "mp4" };
  },
};
