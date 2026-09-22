import { useRef, useState } from "react";
import { hasFrames } from "../sourceFormat";
import { openFrameSource } from "../frameSource";

export interface Dims {
  w: number;
  h: number;
}

// The picked source of a single-video tool, plus what the browser can tell
// about it: the duration and the frame size, read off a frame source
// (frameSource.ts), which opens a video, an animated image or a still each
// the way the browser can. A still has no duration, and its size is the one
// it is shown at, turned by EXIF.
export function useVideoSource() {
  const [file, setFile] = useState<File | null>(null);
  // Seconds; 0 = not known (yet, or for good: a still, a file the browser
  // can't decode, a stream without a length).
  const [duration, setDuration] = useState<number>(0);
  // Null until the source opens, or for good if the browser can't decode it.
  const [dims, setDims] = useState<Dims | null>(null);

  // A probe answers late, and must not answer for a file since replaced.
  const latest = useRef<File | null>(null);

  const pick = ([picked]: File[]) => {
    latest.current = picked;
    setFile(picked);
    setDuration(0);
    setDims(null);

    if (!hasFrames(picked)) return;
    openFrameSource(picked)
      .then(async (frames) => {
        try {
          const [seconds, frame] = await Promise.all([
            frames.duration(),
            frames.frameAt(0),
          ]);
          const { width, height } = frame;
          frame.close();
          if (latest.current !== picked) return;
          setDuration(seconds);
          if (width > 0 && height > 0) setDims({ w: width, h: height });
        } finally {
          frames.close();
        }
      })
      // Undecodable here: the length and size stay unknown.
      .catch(() => {});
  };

  return { file, duration, dims, pick };
}
