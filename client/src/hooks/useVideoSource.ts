import { useEffect, useState } from "react";
import { hasFrames, isAnimatedImage } from "../frameSource";

export interface Dims {
  w: number;
  h: number;
}

// The picked source of a single-video tool, plus what the browser can tell
// about it: the duration and the frame size, probed off an object URL. An
// animated image (GIF, AVIF) is probed through an <img>, since <video> won't
// decode it, and has a size but no duration.
export function useVideoSource() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>("");
  const [duration, setDuration] = useState<number>(0);
  // Null until metadata loads, or for good if the browser can't decode it.
  const [dims, setDims] = useState<Dims | null>(null);

  // Revoked when replaced or on unmount.
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  const pick = ([picked]: File[]) => {
    setFile(picked);
    setDuration(0);
    setDims(null);
    setUrl("");

    if (!hasFrames(picked)) return;
    const next = URL.createObjectURL(picked);
    setUrl(next);
    if (isAnimatedImage(picked)) {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setDims({ w: img.naturalWidth, h: img.naturalHeight });
        }
      };
      img.src = next;
      return;
    }
    // Get video duration and frame size
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      setDuration(Math.floor(video.duration));
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setDims({ w: video.videoWidth, h: video.videoHeight });
      }
    };
    video.src = next;
  };

  return { file, duration, dims, pick };
}
