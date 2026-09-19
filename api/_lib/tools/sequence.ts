import fs from "node:fs/promises";
import path from "node:path";
import { SEQUENCE_FORMATS, type FormatId } from "../../../shared/formats.js";
import type { FFmpeg } from "../ffmpeg.js";
import { encodeRender, type EncodeOptions } from "../encode/index.js";
import type { Render } from "../encode/render.js";
import { blobExt, clamp, isBlobUrl, pick } from "../request.js";
import type { Tool } from "./types.js";

const MAX_IMAGES = 100;

// Stills, one after the other, each shown for `frameDuration` seconds. The
// one tool with a format of its own to pick: stills have none to hand back.
export async function imageSequence(
  ff: FFmpeg,
  imagePaths: string[],
  workDir: string,
  frameDuration: number,
  format: FormatId,
): Promise<Render> {
  // Target frame size: first image's dimensions, capped at 1920 on the
  // longest side (bounds gif/avif encode cost), floored to even for
  // yuv420p/x264.
  const { width: w, height: h } = await ff.mediaInfo(imagePaths[0]);
  const scaleFactor = Math.min(1, 1920 / Math.max(w, h));
  const W = Math.max(2, Math.floor((w * scaleFactor) / 2) * 2);
  const H = Math.max(2, Math.floor((h * scaleFactor) / 2) * 2);

  // Normalize every image to a uniform PNG frame (mixed formats and
  // dimensions are the norm for user uploads; the sequence demuxer
  // needs identical frames). Lossless, so nothing is spent before the one
  // encode.
  const framesDir = path.join(workDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });
  const frames: string[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    const framePath = path.join(
      framesDir,
      `norm_${String(i + 1).padStart(4, "0")}.png`,
    );
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

  // Video gets a constant 30 fps (each still repeated by the fps filter),
  // so every player handles it: a frame every few seconds is a rate many
  // of them refuse. The animated-image formats hold one frame per still.
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
  async run({ ff, workDir, inputs, options, download }) {
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
    console.log(
      `Assembling ${imagePaths.length} images into ${format} (quality ${quality})...`,
    );

    const render = await imageSequence(
      ff,
      imagePaths,
      workDir,
      frameDuration,
      format,
    );
    // The pictures as they are: one frame per still, at their own size.
    // Stills are pristine, which is what AVIF's lossless mode (at 100) and
    // full chroma resolution (from 90) are for; a video's frames have been
    // through both losses already, so conversions never ask for them.
    const encode: EncodeOptions = {
      quality,
      fps: render.fps,
      width: null,
      everyFrame: true,
      lossless: quality >= 100,
      chroma444: quality >= 90,
    };
    const outputPath = await encodeRender(ff, render, workDir, format, encode);
    return { outputPath, suffix: "video", ext: format };
  },
};
