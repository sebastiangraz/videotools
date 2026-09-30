import type { FormatId } from "../../../shared/formats.js";
import { encodePreserved } from "../encode/index.js";
import { DEFAULT_FPS } from "../ffmpeg.js";
import { MAX_AVIF_FPS } from "../encode/avif.js";
import { MAX_GIF_FPS } from "../encode/gif.js";
import { MAX_WEBP_FPS } from "../encode/webp.js";
import {
  frameRate,
  sourceRender,
  videoPad,
  type Render,
} from "../encode/render.js";
import { clamp, singleVideo } from "../request.js";
import { openSource, preservedFormat, type Source } from "../source.js";
import type { Tool } from "./types.js";

// Frame-list formats (frames with delays) and their max fps.
const MAX_FPS: Partial<Record<FormatId, number>> = {
  gif: MAX_GIF_FPS,
  webp: MAX_WEBP_FPS,
  avif: MAX_AVIF_FPS,
};

export function changeSpeed(source: Source, multiplier: number): Render {
  const sourceFps = source.profile.fps ?? DEFAULT_FPS;
  // Video keeps its rate (drops/repeats frames); frame-list formats change
  // their delays and keep every frame, up to the format's max fps.
  const maxFps = source.format && MAX_FPS[source.format];
  const fps = maxFps ? Math.min(sourceFps * multiplier, maxFps) : sourceFps;
  return sourceRender(source, {
    filter: `${videoPad(source)}setpts=PTS/${multiplier},fps=${frameRate(fps)}[out]`,
    keepAudio: false,
    duration: source.profile.duration / multiplier,
    fps,
    pace: fps / sourceFps,
  });
}

export const speed: Tool = {
  inputs: singleVideo,
  async run(job) {
    const { inputs, options } = job;
    // Signed ratio: ±1 → 2× faster/slower, ±3 → 4×. Mirrored in
    // client/src/pages/Speed/Speed.tsx.
    const ratio = clamp(options.speed, -3, 3, 0);
    const multiplier = ratio >= 0 ? 1 + ratio : 1 / (1 - ratio);

    const source = await openSource(job, inputs[0]);
    // No quality slider: spend what keeping the source's look takes (rate.ts).
    const format = preservedFormat(source);
    console.log(`Changing playback speed of ${format} by ${multiplier}x...`);

    const render = changeSpeed(source, multiplier);
    const outputPath = await encodePreserved(job, render, {
      format,
      quality: 100,
    });
    return { outputPath, suffix: "speed", ext: format };
  },
};
