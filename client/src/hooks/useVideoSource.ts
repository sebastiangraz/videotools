import { useEffect, useRef, useState } from "react";
import {
  hasFrames,
  isAnimatedImage,
  isStillImage,
  openFrameSource,
} from "../frameSource";

export interface Dims {
  w: number;
  h: number;
}

// The picked source of a single-video tool, plus what the browser can tell
// about it: the duration and the frame size, probed off an object URL. An
// animated image (GIF, AVIF) is probed through an <img>, since <video> won't
// decode it; an <img> has no duration, so that comes off a frame source's
// pass over the frames (frameSource.ts). A still (the mark tool's PNG, JPEG
// or WebP) has none, and its size is the one it is shown at, turned by EXIF.
export function useVideoSource() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>("");
  // Seconds; 0 = not known (yet, or for good: a still, a file the browser
  // can't decode, a stream without a length).
  const [duration, setDuration] = useState<number>(0);
  // Null until metadata loads, or for good if the browser can't decode it.
  const [dims, setDims] = useState<Dims | null>(null);

  // Revoked when replaced or on unmount.
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  // A probe answers late, and must not answer for a file since replaced.
  const latest = useRef<File | null>(null);

  const pick = ([picked]: File[]) => {
    latest.current = picked;
    setFile(picked);
    setDuration(0);
    setDims(null);
    setUrl("");

    if (!hasFrames(picked)) return;
    const next = URL.createObjectURL(picked);
    setUrl(next);
    if (isAnimatedImage(picked) || isStillImage(picked)) {
      const img = new Image();
      img.onload = () => {
        if (latest.current !== picked) return;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setDims({ w: img.naturalWidth, h: img.naturalHeight });
        }
      };
      img.src = next;
      if (isAnimatedImage(picked)) {
        openFrameSource(picked)
          .then(async (frames) => {
            try {
              const seconds = await frames.duration();
              if (latest.current === picked) setDuration(seconds);
            } finally {
              frames.close();
            }
          })
          // Undecodable here: the length stays unknown.
          .catch(() => {});
      }
      return;
    }
    // Get video duration and frame size
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      if (latest.current !== picked) return;
      // Infinity for a stream without a length (a MediaRecorder WebM).
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setDims({ w: video.videoWidth, h: video.videoHeight });
      }
    };
    video.src = next;
  };

  return { file, duration, dims, pick };
}
