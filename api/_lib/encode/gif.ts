import fs from "node:fs/promises";
import path from "node:path";
import type { Encoder } from "./index.js";

// Frame budget for video→GIF: PNG frames land on the function's ~500MB
// ephemeral disk, and at ≤800px they average well under 1MB each.
export const MAX_GIF_FRAMES = 600;

// video→GIF goes through the vendored gifski binary rather than ffmpeg's own
// GIF encoder: ffmpeg extracts the frames, gifski brings pngquant palettes
// and temporal dithering.
export const encodeGif: Encoder = async (
  ff,
  inputFile,
  outputFile,
  { quality, fps = null, width = 640 },
) => {
  // No explicit fps → match the source, capped at GIF's practical ceiling
  // (delays are centiseconds; browsers clamp anything ≥50fps).
  if (fps == null) {
    fps = Math.max(1, Math.min(Math.round(await ff.fps(inputFile)), 30));
  }
  console.log(
    `Converting to GIF via gifski (quality ${quality}, ${fps} fps, ${width}px)...`,
  );

  const duration = await ff.duration(inputFile);
  if (duration * fps > MAX_GIF_FRAMES) {
    throw new Error(
      `Video too long for GIF: ${Math.round(duration)}s at ${fps} fps ` +
        `exceeds ${MAX_GIF_FRAMES} frames. Lower the FPS or trim the video to ` +
        `${Math.floor(MAX_GIF_FRAMES / fps)}s or less.`,
    );
  }

  const framesDir = path.join(path.dirname(outputFile), "gif_frames");
  await fs.mkdir(framesDir, { recursive: true });

  try {
    await ff.runFFmpeg([
      "-y",
      "-i",
      inputFile,
      "-vf",
      `fps=${fps},scale='min(${width},iw)':-2:flags=lanczos`,
      path.join(framesDir, "frame_%05d.png"),
    ]);

    const frames = (await fs.readdir(framesDir))
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => path.join(framesDir, f));
    if (!frames.length) {
      throw new Error("No frames extracted from video");
    }

    // spawn uses no shell, so the frame list is passed as explicit args
    // (600 paths ≈ 40KB, far under the platform arg limit).
    await ff.runGifski([
      "--fps",
      String(fps),
      "--quality",
      String(quality),
      "-o",
      outputFile,
      ...frames,
    ]);
  } finally {
    await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});
  }
};
