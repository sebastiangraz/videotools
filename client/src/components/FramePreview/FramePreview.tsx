import { useEffect, useRef, useState } from "react";
import { openFrameSource, type FrameSource } from "../../frameSource";
import styles from "./FramePreview.module.css";

// The frame of a picked file showing at `second`, drawn on a canvas: shown
// while choosing the loop's "Start at" (usually the frame that becomes a
// social post's thumbnail) and as the mark preview's bare first frame. Video
// and animated images (GIF, AVIF) alike come through a frame source (see
// frameSource.ts), so there is one element and one set of states for both.
// The accept list is broader than what browsers can decode (server-side
// ffmpeg handles the rest), so a file the source can't open or seek swaps the
// frame for a short note. Tracking the failed file rather than a boolean
// resets the error when a new file is picked. `className` swaps the default
// card look for the caller's own (the mark preview lays it out as a frame
// under its renders) and `label` names the frame.
export const FramePreview = ({
  file,
  second,
  label = "start frame preview",
  className = styles.framePreview,
}: {
  file: File;
  second: number;
  label?: string;
  className?: string;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  // Kept with its file, so a frame is never asked of the previous source.
  const [opened, setOpened] = useState<{
    file: File;
    frames: FrameSource;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let frames: FrameSource | undefined;
    openFrameSource(file)
      .then((source) => {
        if (cancelled) return source.close();
        frames = source;
        setOpened({ file, frames: source });
      })
      .catch(() => {
        if (!cancelled) setFailedFile(file);
      });
    return () => {
      cancelled = true;
      frames?.close();
    };
  }, [file]);

  useEffect(() => {
    if (opened?.file !== file) return;
    let cancelled = false;
    opened.frames
      .frameAt(second)
      .then((frame) => {
        const canvas = canvasRef.current;
        if (canvas && !cancelled) {
          canvas.width = frame.width;
          canvas.height = frame.height;
          canvas.getContext("2d")?.drawImage(frame.image, 0, 0);
        }
        frame.close();
      })
      .catch(() => {
        if (!cancelled) setFailedFile(file);
      });
    return () => {
      cancelled = true;
    };
  }, [opened, file, second]);

  if (failedFile === file) {
    return (
      <p className={`${className} ${styles.framePreviewError}`}>
        Can&rsquo;t preview this format.
      </p>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={className}
    />
  );
};
