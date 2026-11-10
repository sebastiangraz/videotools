import { useState } from "react";
import { hasFrames } from "@src/sourceFormat";
import { openFrameSource } from "@src/frameSource";

// In tenths (the start field step); undefined while the length is unknown (0).
export const maxStart = (duration: number): number | undefined =>
  duration > 0 ? Math.floor(duration * 10) / 10 : undefined;

export const clampStart = (startSecond: number | null, duration: number): number | null =>
  startSecond === null ? null : Math.min(startSecond, maxStart(duration) ?? Infinity);

export interface SourceMeta {
  w: number;
  h: number;
  fps?: number | null;
}

// duration: seconds; 0 = unknown (a still, undecodable, or no length).
type VideoSource = {
  file: File | null;
  duration: number;
  meta: SourceMeta | null;
  nonSquare: boolean;
};

const NO_SOURCE: VideoSource = { file: null, duration: 0, meta: null, nonSquare: false };

// A still has no duration, and its size is the EXIF-rotated one. nonSquare:
// the browser saw non-square pixels, which no tool takes.
export function useVideoSource() {
  const [source, setSource] = useState(NO_SOURCE);

  const pick = ([file]: File[]) => {
    setSource({ ...NO_SOURCE, file });

    if (!hasFrames(file)) return;
    openFrameSource(file)
      .then(async (frames) => {
        try {
          const [duration, frame, count] = await Promise.all([
            frames.duration(),
            frames.frameAt(0),
            frames.frameCount?.().catch(() => null),
          ]);
          const { width, height } = frame;
          frame.close();
          const fps = count && duration ? count / duration : null;
          const meta = width > 0 && height > 0 ? { w: width, h: height, fps } : null;
          const nonSquare = frames.nonSquare?.() ?? false;
          // A probe answers late, and must not answer for a file since replaced.
          setSource((picked) =>
            picked.file === file ? { file, duration, meta, nonSquare } : picked,
          );
        } finally {
          frames.close();
        }
      })
      // Undecodable here: the length and size stay unknown.
      .catch(() => {});
  };

  return { ...source, pick };
}
