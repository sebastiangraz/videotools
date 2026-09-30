import fs from "node:fs/promises";
import path from "node:path";
import { InputError } from "../errors.js";
import type { Encoder } from "./index.js";
import {
  conversionFps,
  fitWidth,
  graphArgs,
  hasAlpha,
  outOfTime,
  scaledSize,
  sourceBytesBudget,
} from "./render.js";

// Frames go on gifski's command line (Windows: 32k chars); pixels land on the
// function's ~500MB ephemeral disk.
const MAX_GIF_FRAMES = 1500;
const MAX_GIF_PIXELS = 600 * 800 * 800;

// Delays are whole centiseconds; browsers slow anything under 2cs.
export const MAX_GIF_FPS = 50;

async function pngSize(file: string): Promise<[number, number]> {
  const handle = await fs.open(file, "r");
  try {
    const header = new Uint8Array(24);
    await handle.read(header, 0, 24, 0);
    const view = new DataView(header.buffer);
    return [view.getUint32(16), view.getUint32(20)];
  } finally {
    await handle.close();
  }
}

// gifski over ffmpeg's GIF encoder for pngquant palettes and temporal dithering.
export const encodeGif: Encoder = async (
  ff,
  render,
  { outputFile, quality, fps = null, width = 640, everyFrame = false },
) => {
  // Capped at 30 (gifski alternates 3cs/4cs); more only adds weight.
  if (fps == null) {
    fps = Math.max(1, Math.round(conversionFps(render)));
  }
  fps = Math.min(fps, MAX_GIF_FPS);
  console.log(
    `Encoding GIF via gifski (quality ${quality}, ${fps} fps, ` +
      `${width == null ? "source size" : `${width}px`})...`,
  );

  // A palindrome reuses the first half's files backwards.
  const total = Math.ceil(render.duration * fps);
  const rendered = render.palindrome ? Math.ceil(total / 2) : total;
  const size = scaledSize(render, width);
  if (total > MAX_GIF_FRAMES || rendered * size.width * size.height > MAX_GIF_PIXELS) {
    const seconds = Math.round(render.duration);
    throw new InputError(
      `Video too long for GIF: ${seconds}s at ${fps} fps comes to ${total} ` +
        `frames of ${Math.round(size.width)}×` +
        `${Math.round(size.height)}, more than the app can hold. ` +
        `Use a shorter clip, a lower FPS or a smaller size.`,
      "too-long",
    );
  }

  const given = render.frames?.length && width == null ? render.frames : null;
  const framesDir = given
    ? path.dirname(given[0])
    : path.join(path.dirname(outputFile), "gif_frames");
  await fs.mkdir(framesDir, { recursive: true });

  try {
    const chain = everyFrame ? [] : [`fps=${fps}`];
    if (width != null) chain.push(fitWidth(width));
    // Otherwise negotiation may pick an opaque format and drop transparency.
    if (render.source && hasAlpha(render.source.profile.pixFmt)) {
      chain.push("format=rgba");
    }
    if (!given) {
      await ff.runFFmpeg([
        ...graphArgs({ ...render, palindrome: false }, chain, "rgba"),
        ...(everyFrame ? ["-fps_mode", "passthrough"] : []),
        path.join(framesDir, "frame_%05d.png"),
      ]);
    }

    const forward = given
      ? given.map((f) => path.basename(f))
      : (await fs.readdir(framesDir)).filter((f) => f.endsWith(".png")).sort();
    if (!forward.length) {
      throw new Error("No frames extracted from video");
    }
    const frames = render.palindrome ? [...forward, ...[...forward].reverse()] : forward;

    // Without an explicit size gifski downscales past ~800×600.
    const [w, h] = await pngSize(path.join(framesDir, forward[0]));

    // gifski quality moves size in steps (100→90 and →50; little between
    // 90 and 70), so over-budget retries use those.
    const budget = await sourceBytesBudget(render, "gif", frames.length);
    const ladder = [...new Set([quality, Math.min(quality, 90), Math.min(quality, 50)])];
    for (const [i, step] of ladder.entries()) {
      const started = Date.now();
      // No shell globbing: bare names from cwd keep under Windows' 32k limit.
      await ff.runGifski(
        [
          "--fps",
          String(fps),
          "--quality",
          String(step),
          "--width",
          String(w),
          "--height",
          String(h),
          ...(render.palindrome || given ? ["--no-sort"] : []),
          "-o",
          outputFile,
          ...frames,
        ],
        { cwd: framesDir },
      );
      if (budget == null || i === ladder.length - 1) break;
      const { size } = await fs.stat(outputFile);
      if (size <= budget) break;
      if (outOfTime(ff, started)) break;
      console.log(
        `GIF is ${size} bytes, over the ${Math.round(budget)} its source ` +
          `allows: encoding again at quality ${ladder[i + 1]}`,
      );
    }
  } finally {
    if (!given) {
      await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});
    }
  }
};
