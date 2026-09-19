import { useEffect, useState } from "react";

// The sources an <img> shows and a <video> doesn't.
export const isAnimatedImage = (file: File) =>
  file.type === "image/gif" || file.type === "image/avif";

export interface Dims {
  w: number;
  h: number;
}

// The picked source of a single-video tool, plus what the browser can tell
// about it: an object URL (shared by the probe and any preview), the
// duration and the frame size. `gif` also gives an animated image (GIF,
// AVIF) a URL, for the mark tool's preview, but no probe, since <video>
// won't decode it — its size is read from the preview's <img> when that
// loads, hence `setDims`.
export function useVideoSource({ gif = false }: { gif?: boolean } = {}) {
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

    const isGif = gif && isAnimatedImage(picked);
    if (!picked.type.startsWith("video/") && !isGif) return;
    const next = URL.createObjectURL(picked);
    setUrl(next);
    if (isGif) return;
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

  return { file, url, duration, dims, setDims, pick };
}
