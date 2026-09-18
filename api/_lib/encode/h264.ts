import type { Encoder } from "./index.js";

// x264 crf: 0 best – 51 worst; quality 100 → 1 (visually lossless — true
// lossless x264 forces the High 4:4:4 profile most players reject),
// quality 1 → 35.
export function x264Crf(quality: number): string {
  return String(Math.max(1, Math.round(35 - (quality / 100) * 34)));
}

// For clips that get encoded again further down a tool's pipeline: near-
// lossless, so quality is only spent once, on the final encode.
export const INTERMEDIATE_CRF = "6";

// The video output options of every H.264 encode in the app, the tools'
// intermediates included. Pixel format, frame rate and audio stay with the
// caller.
export function h264(crf: string): string[] {
  return ["-c:v", "libx264", "-preset", "fast", "-crf", crf];
}

// yuv420p needs even dimensions and odd-sized sources exist.
export const EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

// mp4 / mov: H.264 + AAC.
const encodeH264 =
  (faststart: boolean): Encoder =>
  async (ff, inputFile, outputFile, { quality }) => {
    const args = [
      "-y",
      "-i",
      inputFile,
      "-vf",
      EVEN_SCALE,
      ...h264(x264Crf(quality)),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
    ];
    if (faststart) {
      args.push("-movflags", "+faststart");
    }
    args.push(outputFile);
    await ff.runFFmpeg(args);
  };

export const encodeMp4 = encodeH264(true);
export const encodeMov = encodeH264(false);
