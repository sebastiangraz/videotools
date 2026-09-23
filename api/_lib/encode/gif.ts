import fs from "node:fs/promises";
import path from "node:path";
import { InputError } from "../errors.js";
import type { Encoder } from "./index.js";
import { graphArgs, hasAlpha, type Render } from "./render.js";

// Two budgets for a GIF, both about the PNG frames gifski reads: their
// number (the list is gifski's command line, and Windows ends those at 32k
// characters) and their pixels (they land on the function's ~500MB ephemeral
// disk; this many is what 600 frames at 800×800 come to, which is what the
// converter has always allowed).
export const MAX_GIF_FRAMES = 1500;
export const MAX_GIF_PIXELS = 600 * 800 * 800;

// GIF delays are whole centiseconds and browsers slow anything under 2cs
// down, so 50 is the most frames a second it can show.
export const MAX_GIF_FPS = 50;

// Keeps the run inside the function's 300s (vercel.json), with room to
// upload the result.
export const TIME_BUDGET_MS = 240_000;

// Width and height of a PNG, from its IHDR chunk.
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

// What a GIF that went in as a GIF may weigh: what it weighed, by the frame.
// (Frames rather than seconds: a sped-up GIF keeps all of its frames.) Null
// for every other source — a GIF of a video is never the video's size.
async function gifBudget(render: Render, frames: number): Promise<number | null> {
  const { source } = render;
  if (source?.format !== "gif") return null;
  const { duration, fps } = source.profile;
  const sourceFrames = Math.round(duration * (fps ?? 0));
  if (sourceFrames < 1) return null;
  const { size } = await fs.stat(source.path);
  return size * (frames / sourceFrames) * 1.1;
}

// Every GIF goes through the vendored gifski binary rather than ffmpeg's own
// GIF encoder: ffmpeg renders the frames, gifski brings pngquant palettes
// and temporal dithering.
export const encodeGif: Encoder = async (
  ff,
  render,
  outputFile,
  { quality, fps = null, width = 640, everyFrame = false },
) => {
  // No explicit fps → match the pictures, capped at 30: gifski alternates
  // 3cs and 4cs delays for it, and past that a converted video only gets
  // heavier. (A tool that hands a GIF back asks for the GIF's own rate.)
  if (fps == null) {
    fps = Math.max(1, Math.min(Math.round(render.fps), 30));
  }
  fps = Math.min(fps, MAX_GIF_FPS);
  console.log(
    `Encoding GIF via gifski (quality ${quality}, ${fps} fps, ` +
      `${width == null ? "source size" : `${width}px`})...`,
  );

  // A palindrome's second half is the first half's files again, backwards.
  const total = Math.ceil(render.duration * fps);
  const rendered = render.palindrome ? Math.ceil(total / 2) : total;
  const scale = width == null ? 1 : Math.min(1, width / render.width);
  const pixels = rendered * render.width * scale * render.height * scale;
  if (total > MAX_GIF_FRAMES || pixels > MAX_GIF_PIXELS) {
    const seconds = Math.round(render.duration);
    throw new InputError(
      `Video too long for GIF: ${seconds}s at ${fps} fps comes to ${total} ` +
        `frames of ${Math.round(render.width * scale)}×` +
        `${Math.round(render.height * scale)}, more than the app can hold. ` +
        `Use a shorter clip, a lower FPS or a smaller size.`,
      "too-long",
    );
  }

  // Frames the tool already has as files are read where they are.
  const given = render.frames?.length && width == null ? render.frames : null;
  const framesDir = given
    ? path.dirname(given[0])
    : path.join(path.dirname(outputFile), "gif_frames");
  await fs.mkdir(framesDir, { recursive: true });

  try {
    const chain = everyFrame ? [] : [`fps=${fps}`];
    if (width != null) chain.push(`scale='min(${width},iw)':-2:flags=lanczos`);
    // Transparency survives the PNG frames only if nothing on the way picks
    // an opaque format for them.
    if (render.source && hasAlpha(render.source.profile.pixFmt)) {
      chain.push("format=rgba");
    }
    if (!given) {
      await ff.runFFmpeg([
        ...graphArgs({ ...render, palindrome: false }, chain, "rgba"),
        // One file per picture, whatever their timestamps say.
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
    const frames = render.palindrome
      ? [...forward, ...[...forward].reverse()]
      : forward;

    // Without a size gifski scales anything beyond about 800×600 down on
    // its own, so it is always told the size the frames already have.
    const [w, h] = await pngSize(path.join(framesDir, forward[0]));

    // gifski has no rate control, only its 1–100 quality, and that moves
    // size in steps (hardly anything between 90 and 70, a lot at 100 → 90
    // and again at 50). So a GIF that outgrows its source is encoded again
    // one step down, from the frames already on disk — while there is time.
    const budget = await gifBudget(render, frames.length);
    const ladder = [...new Set([quality, Math.min(quality, 90), Math.min(quality, 50)])];
    for (const [i, step] of ladder.entries()) {
      const started = Date.now();
      // spawn uses no shell, so the frames are explicit arguments: bare
      // names, from inside their folder, to stay under the platform's
      // command line limit (Windows: 32k characters).
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
      const took = Date.now() - started;
      if (Date.now() - ff.startedAt + took > TIME_BUDGET_MS) break;
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
