import type { Encoder } from "./index.js";
import type { RateCap } from "./rate.js";
import { audioArgs, graphArgs } from "./render.js";

// x264 crf: 0 best – 51 worst; quality 100 → 1 (visually lossless — true
// lossless x264 forces the High 4:4:4 profile most players reject),
// quality 1 → 35. On its own crf 1 is many times the size of any delivered
// source; next to the source's bitrate as a ceiling (x264Cap) it means
// "spend all of it", which is what matching the source takes.
export function x264Crf(quality: number): string {
  return String(Math.max(1, Math.round(35 - (quality / 100) * 34)));
}

// The video output options of every H.264 encode in the app. Pixel format
// and audio follow in the encoder below.
export function h264(crf: string): string[] {
  return ["-c:v", "libx264", "-preset", "fast", "-crf", crf];
}

// yuv420p needs even dimensions and odd-sized sources exist.
export const EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

// x264's ceiling on top of its crf (rate.ts): crf decides up to the rate the
// source spent, and the VBV buffer holds it there.
export function x264Cap(cap: RateCap | null): string[] {
  return cap
    ? ["-maxrate", `${cap.maxrate}k`, "-bufsize", `${cap.bufsize}k`]
    : [];
}

// mp4 / mov: H.264 + AAC.
const encodeH264 =
  (faststart: boolean): Encoder =>
  async (ff, render, outputFile, { quality }, cap) => {
    const args = [
      ...graphArgs(render, [EVEN_SCALE], "yuv420p"),
      ...h264(x264Crf(quality)),
      ...x264Cap(cap),
      "-pix_fmt",
      "yuv420p",
      ...audioArgs(render, ["aac"], ["-c:a", "aac", "-b:a", "192k"]),
    ];
    if (faststart) {
      args.push("-movflags", "+faststart");
    }
    args.push(outputFile);
    await ff.runFFmpeg(args);
  };

export const encodeMp4 = encodeH264(true);
export const encodeMov = encodeH264(false);
