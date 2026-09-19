import { useEffect, useRef, useState } from "react";
import styles from "./FramePreview.module.css";

// Paused <video> seeked to the loop start, shown while choosing "Start at" —
// usually the frame that becomes a social post's thumbnail. The seek waits
// for metadata so it lands on a decodable frame; the browser clamps
// out-of-range times to the clip length. The accept list is broader than
// what browsers can decode (server-side ffmpeg handles the rest), so a
// decode error swaps the frame for a short note. Tracking the failed src
// rather than a boolean resets the error when a new file is picked.
// `className` swaps the default card look for the caller's own (the mark
// preview lays it out as a frame to draw on) and `label` names the video.
// `onFrame` fires once a frame is decoded and drawable (the mark preview
// grabs it for the server-side render).
export const FramePreview = ({
  src,
  second,
  label = "start frame preview",
  className = styles.framePreview,
  onFrame,
}: {
  src: string;
  second: number;
  label?: string;
  className?: string;
  onFrame?: (video: HTMLVideoElement) => void;
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const seek = () => {
      video.currentTime = second;
    };
    if (video.readyState >= video.HAVE_METADATA) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    return () => video.removeEventListener("loadedmetadata", seek);
  }, [second]);

  // The latest callback without re-subscribing on every render.
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  });
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const handle = () => onFrameRef.current?.(video);
    video.addEventListener("loadeddata", handle);
    if (video.readyState >= video.HAVE_CURRENT_DATA) handle();
    return () => video.removeEventListener("loadeddata", handle);
  }, [src]);

  if (failedSrc === src) {
    return (
      <p className={`${className} ${styles.framePreviewError}`}>
        Can&rsquo;t preview this format.
      </p>
    );
  }

  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="auto"
      aria-label={label}
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
};
