import { useRef, useState } from "react";
import { hasFrames } from "../sourceFormat";
import { openFrameSource } from "../frameSource";

// In tenths (the start field step); undefined while the length is unknown (0).
export const maxStart = (duration: number): number | undefined =>
  duration > 0 ? Math.floor(duration * 10) / 10 : undefined;

export const clampStart = (startSecond: number | null, duration: number): number | null =>
  startSecond === null ? null : Math.min(startSecond, maxStart(duration) ?? Infinity);

// What the probe learned about a source. fps: MP4/MOV and animated images;
// null = unknown.
export interface SourceMeta {
  w: number;
  h: number;
  fps?: number | null;
}

// A still has no duration, and its size is the EXIF-rotated one. nonSquare:
// the browser saw non-square pixels, which no tool takes.
export function useVideoSource() {
  const [file, setFile] = useState<File | null>(null);
  // Seconds; 0 = unknown (a still, undecodable, or no length).
  const [duration, setDuration] = useState<number>(0);
  const [meta, setMeta] = useState<SourceMeta | null>(null);
  const [nonSquare, setNonSquare] = useState(false);

  // A probe answers late, and must not answer for a file since replaced.
  const latest = useRef<File | null>(null);

  const pick = ([picked]: File[]) => {
    latest.current = picked;
    setFile(picked);
    setDuration(0);
    setMeta(null);
    setNonSquare(false);

    if (!hasFrames(picked)) return;
    openFrameSource(picked)
      .then(async (frames) => {
        try {
          const [seconds, frame, fps] = await Promise.all([
            frames.duration(),
            frames.frameAt(0),
            frames.fps?.().catch(() => null),
          ]);
          const { width, height } = frame;
          frame.close();
          if (latest.current !== picked) return;
          setDuration(seconds);
          if (width > 0 && height > 0) setMeta({ w: width, h: height, fps });
          setNonSquare(frames.nonSquare?.() ?? false);
        } finally {
          frames.close();
        }
      })
      // Undecodable here: the length and size stay unknown.
      .catch(() => {});
  };

  return { file, duration, meta, nonSquare, pick };
}
