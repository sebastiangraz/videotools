import { encodePreserved } from "../encode/index.js";
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

// setpts rescales the frame timestamps; the fps filter then settles what is
// shown at the new pace.
export function changeSpeed(source: Source, multiplier: number): Render {
  const sourceFps = source.profile.fps ?? 30;
  // Video keeps its frame rate: speed-ups drop frames (rather than raising
  // the rate past what screens show) and slow-downs repeat them. A GIF or
  // WebP is a list of frames with delays, so there the delays change and
  // every frame stays, up to the 50 a second either can show.
  const maxFps =
    source.format === "gif"
      ? MAX_GIF_FPS
      : source.format === "webp"
        ? MAX_WEBP_FPS
        : null;
  const fps =
    maxFps === null ? sourceFps : Math.min(sourceFps * multiplier, maxFps);
  return sourceRender(source, {
    filter: `${videoPad(source)}setpts=PTS/${multiplier},fps=${frameRate(fps)}[out]`,
    // Like the other tools that change a clip's timing, without its audio.
    keepAudio: false,
    duration: source.profile.duration / multiplier,
    fps,
  });
}

export const speed: Tool = {
  inputs: singleVideo,
  async run(job) {
    const { ff, workDir, inputs, options } = job;
    // Signed ratio: ±1 → 2× faster/slower, ±3 → 4×. Mirrored in
    // client/src/pages/Speed/Speed.tsx.
    const ratio = clamp(options.speed, -3, 3, 0);
    const multiplier = ratio >= 0 ? 1 + ratio : 1 / (1 - ratio);

    const source = await openSource(job, inputs[0]);
    // Comes back in the format it came in, and at the quality: the tool has
    // no slider, so it spends what the source spends.
    const format = preservedFormat(source);
    console.log(`Changing playback speed of ${format} by ${multiplier}x...`);

    const render = changeSpeed(source, multiplier);
    const outputPath = await encodePreserved(ff, render, workDir, format, 100);
    return { outputPath, suffix: "speed", ext: format };
  },
};
