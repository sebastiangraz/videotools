import type { Encoder } from "./index.js";

// libaom is slow enough that long clips would blow the 300s function
// timeout, so animated AVIF gets a duration ceiling.
export const MAX_AVIF_SECONDS = 60;

export const encodeAvif: Encoder = async (
  ff,
  inputFile,
  outputFile,
  { quality },
) => {
  const duration = await ff.duration(inputFile);
  if (duration > MAX_AVIF_SECONDS) {
    throw new Error(
      `Video too long for AVIF: ${Math.round(duration)}s exceeds the ` +
        `${MAX_AVIF_SECONDS}s limit (AVIF encoding is ` +
        `slow). Trim the video or pick another format.`,
    );
  }
  // AV1 crf mapped like the webm encoder: quality 100 → 10, quality 1 → 50.
  // (The sequence tool's 63·(1−q) curve reaches crf 0 at quality 100 —
  // near-lossless, which balloons video conversions.) Width caps at 800 like
  // the other animated-image targets; the trunc keeps odd sub-800 sources
  // even for yuv420p.
  const crf = Math.round(50 - (quality / 100) * 40);
  const fps = Math.min(await ff.fps(inputFile), 30);
  await ff.runFFmpeg([
    "-y",
    "-i",
    inputFile,
    "-vf",
    `fps=${fps},scale='trunc(min(800,iw)/2)*2':-2:flags=lanczos`,
    "-c:v",
    "libaom-av1",
    "-crf",
    String(crf),
    "-b:v",
    "0",
    "-cpu-used",
    "8",
    "-row-mt",
    "1",
    "-threads",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-f",
    "avif",
    outputFile,
  ]);
};
