import fs from "node:fs/promises";
import path from "node:path";
import type { FFmpeg } from "../ffmpeg.js";
import { h264, x264Crf } from "../encode/h264.js";
import { blobExt, clamp, isBlobUrl, pick } from "../request.js";
import type { Tool } from "./types.js";

// Mirrored in client/src/pages/Sequence/Sequence.tsx (FORMATS)
const VALID_FORMATS = ["mp4", "gif", "avif"] as const;
const MAX_IMAGES = 100;

// The encodes below start from stills rather than a video, with quality
// curves of their own (lossless AVIF, palette-sized GIF), so they live here
// and not in encode/.
export async function createImageSequenceVideo(
  ff: FFmpeg,
  imagePaths: string[],
  workDir: string,
  frameDuration: number,
  format: string,
  quality = 100,
): Promise<string> {
  console.log(
    `Assembling ${imagePaths.length} images into ${format} (quality ${quality})...`,
  );

  const outputFile = path.join(workDir, `output.${format}`);

  // Target frame size: first image's dimensions, capped at 1920 on the
  // longest side (bounds gif/avif encode cost), floored to even for
  // yuv420p/x264.
  const { width: w, height: h } = await ff.mediaInfo(imagePaths[0]);
  const scaleFactor = Math.min(1, 1920 / Math.max(w, h));
  const W = Math.max(2, Math.floor((w * scaleFactor) / 2) * 2);
  const H = Math.max(2, Math.floor((h * scaleFactor) / 2) * 2);

  // Normalize every image to a uniform PNG frame (mixed formats and
  // dimensions are the norm for user uploads; the sequence demuxer
  // needs identical frames).
  const framesDir = path.join(workDir, "frames");
  await fs.mkdir(framesDir, { recursive: true });
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
  }

  const framerate = (1 / frameDuration).toString();
  const pattern = path.join(framesDir, "norm_%04d.png");

  if (format === "gif") {
    // Quality drives the palette size; at high quality use a fresh
    // palette per frame (much better color, larger file).
    const colors = Math.max(
      16,
      Math.min(256, Math.round((quality / 100) * 256)),
    );
    const perFrame = quality >= 80;
    const vf = perFrame
      ? `split[a][b];[a]palettegen=stats_mode=single:max_colors=${colors}[p];[b][p]paletteuse=new=1:dither=sierra2_4a`
      : `split[a][b];[a]palettegen=stats_mode=diff:max_colors=${colors}[p];[b][p]paletteuse=dither=sierra2_4a`;
    await ff.runFFmpeg([
      "-y",
      "-framerate",
      framerate,
      "-i",
      pattern,
      "-vf",
      vf,
      "-loop",
      "0",
      outputFile,
    ]);
  } else if (format === "avif") {
    if (quality >= 100) {
      // Truly lossless: planar RGB (gbrp) skips the RGB→YUV rounding and
      // chroma subsampling, and aom's lossless mode skips quantization.
      // Verified bit-exact against the source frames (PSNR = inf).
      await ff.runFFmpeg([
        "-y",
        "-framerate",
        framerate,
        "-i",
        pattern,
        "-c:v",
        "libaom-av1",
        "-crf",
        "0",
        "-b:v",
        "0",
        "-aom-params",
        "lossless=1",
        "-cpu-used",
        "6",
        "-row-mt",
        "1",
        "-threads",
        "0",
        "-pix_fmt",
        "gbrp",
        "-f",
        "avif",
        outputFile,
      ]);
    } else {
      // libaom crf: 0 best – 63 worst; quality 99 → 1, quality 1 → 62.
      // Slow the encoder down a notch and keep full chroma resolution at
      // high quality (yuv420p halves color detail regardless of crf).
      const crf = Math.round(63 * (1 - quality / 100));
      const cpuUsed = quality >= 80 ? "6" : "8";
      const pixFmt = quality >= 90 ? "yuv444p" : "yuv420p";
      await ff.runFFmpeg([
        "-y",
        "-framerate",
        framerate,
        "-i",
        pattern,
        "-c:v",
        "libaom-av1",
        "-crf",
        String(crf),
        "-b:v",
        "0",
        "-cpu-used",
        cpuUsed,
        "-row-mt",
        "1",
        "-threads",
        "0",
        "-pix_fmt",
        pixFmt,
        "-f",
        "avif",
        outputFile,
      ]);
    }
  } else {
    // mp4: constant 30fps output (frames duplicated by the fps filter)
    // so every player handles very low source frame rates.
    await ff.runFFmpeg([
      "-y",
      "-framerate",
      framerate,
      "-i",
      pattern,
      "-vf",
      "fps=30,format=yuv420p",
      ...h264(x264Crf(quality)),
      "-movflags",
      "+faststart",
      outputFile,
    ]);
  }

  return outputFile;
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
    const format = pick(options.format, VALID_FORMATS, "mp4");
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

    const outputPath = await createImageSequenceVideo(
      ff,
      imagePaths,
      workDir,
      frameDuration,
      format,
      quality,
    );
    return { outputPath, suffix: "video", ext: format };
  },
};
