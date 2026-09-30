import fs from "node:fs/promises";
import path from "node:path";
import { SEQUENCE_FORMATS, type FormatId } from "../formats.js";
import { encodeRender } from "../encode/index.js";
import type { Render } from "../encode/render.js";
import { blobExt, clamp, isBlobUrl, pick } from "../request.js";
import type { Tool, ToolJob } from "./types.js";

const MAX_IMAGES = 100;

// Bounds gif/avif encode cost.
const MAX_SIDE = 1920;

async function imageSequence(
  { ff, workDir }: Pick<ToolJob, "ff" | "workDir">,
  imagePaths: string[],
  { frameDuration, format }: { frameDuration: number; format: FormatId },
): Promise<Render> {
  // Floored to even for yuv420p/x264.
  const { width: w, height: h } = await ff.mediaInfo(imagePaths[0]);
  const scaleFactor = Math.min(1, MAX_SIDE / Math.max(w, h));
  const W = Math.max(2, Math.floor((w * scaleFactor) / 2) * 2);
  const H = Math.max(2, Math.floor((h * scaleFactor) / 2) * 2);

  // The image2 demuxer needs identical frames; PNG keeps this step lossless.
  const framesDir = path.join(workDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const frames: string[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const framePath = path.join(framesDir, `norm_${String(i + 1).padStart(4, "0")}.png`);
    await ff.runFFmpeg([
      "-y",
      "-i",
      imagePaths[i],
      "-vf",
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
      "-frames:v",
      "1",
      framePath,
    ]);
    frames.push(framePath);
  }

  // Many players refuse a video at one frame every few seconds, so mp4 gets a
  // constant 30 fps; animated images hold one frame per still.
  const video = format === "mp4";
  return {
    inputArgs: [
      "-framerate",
      (1 / frameDuration).toString(),
      "-i",
      path.join(framesDir, "norm_%04d.png"),
    ],
    ...(video ? { filter: "[0:v]fps=30[out]" } : {}),
    keepAudio: false,
    source: null,
    duration: imagePaths.length * frameDuration,
    fps: video ? 30 : 1 / frameDuration,
    width: W,
    height: H,
    frames,
  };
}

export const sequence: Tool = {
  inputs({ blobUrls }) {
    if (
      !Array.isArray(blobUrls) ||
      blobUrls.length < 1 ||
      blobUrls.length > MAX_IMAGES ||
      !blobUrls.every(isBlobUrl)
    ) {
      return { error: `Expected 1–${MAX_IMAGES} valid blob URLs` };
    }
    return blobUrls;
  },
  async run(job) {
    const { workDir, inputs, options, download } = job;
    const frameDuration = clamp(options.frameDuration, 0.02, 10, 1);
    const format = pick(options.format, SEQUENCE_FORMATS, "mp4");
    const quality = Math.round(clamp(options.quality, 1, 100, 100));

    const imagePaths: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const imagePath = path.join(
        workDir,
        `src_${String(i + 1).padStart(4, "0")}${blobExt(inputs[i], ".png")}`,
      );
      await download(inputs[i], imagePath);
      imagePaths.push(imagePath);
    }
    console.log(`Assembling ${imagePaths.length} images into ${format} (quality ${quality})...`);

    const render = await imageSequence(job, imagePaths, {
      frameDuration,
      format,
    });
    // Stills are pristine, so they alone get AVIF's lossless and 4:4:4 modes.
    const outputPath = await encodeRender(job, render, {
      format,
      quality,
      fps: render.fps,
      width: null,
      everyFrame: true,
      lossless: quality >= 100,
      chroma444: quality >= 90,
    });
    return { outputPath, suffix: "video", ext: format };
  },
};
