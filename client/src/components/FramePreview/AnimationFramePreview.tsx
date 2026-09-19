import { useEffect, useRef, useState } from "react";
import styles from "./FramePreview.module.css";

// FramePreview for the sources a <video> won't play: animated images (GIF,
// AVIF). The browser's ImageDecoder takes them apart into frames with
// timestamps, and the one showing at `second` is drawn on a canvas. Where
// there is no ImageDecoder (or it can't read the file), the same short note
// stands in as for a video the browser can't decode.
export const AnimationFramePreview = ({
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
  const supported = typeof ImageDecoder !== "undefined";
  const [failedFile, setFailedFile] = useState<File | null>(null);
  // The decoder, and when each of its frames stops showing (seconds).
  const [frames, setFrames] = useState<{
    file: File;
    decoder: ImageDecoder;
    ends: number[];
  } | null>(null);

  // One pass over the file for the frame times; GIF delays vary by frame,
  // so they cannot be computed from a rate.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    let decoder: ImageDecoder | null = null;
    (async () => {
      decoder = new ImageDecoder({ data: file.stream(), type: file.type });
      await decoder.completed;
      const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
      const ends: number[] = [];
      for (let i = 0; i < count && !cancelled; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        ends.push(((image.timestamp ?? 0) + (image.duration ?? 0)) / 1e6);
        image.close();
      }
      if (cancelled) return;
      if (!ends.length) throw new Error("no frames");
      setFrames({ file, decoder, ends });
    })().catch(() => {
      if (!cancelled) setFailedFile(file);
    });
    return () => {
      cancelled = true;
      decoder?.close();
    };
  }, [file, supported]);

  useEffect(() => {
    if (!frames || frames.file !== file) return;
    let cancelled = false;
    // The frame on screen at `second`; past the end, the last one (a <video>
    // clamps the same way).
    const found = frames.ends.findIndex((end) => end > second);
    const frameIndex = found < 0 ? frames.ends.length - 1 : found;
    frames.decoder
      .decode({ frameIndex })
      .then(({ image }) => {
        const canvas = canvasRef.current;
        if (canvas && !cancelled) {
          canvas.width = image.displayWidth;
          canvas.height = image.displayHeight;
          canvas.getContext("2d")?.drawImage(image, 0, 0);
        }
        image.close();
      })
      .catch(() => {
        if (!cancelled) setFailedFile(file);
      });
    return () => {
      cancelled = true;
    };
  }, [frames, file, second]);

  if (!supported || failedFile === file) {
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
      className={`${className} ${styles.framePreviewCanvas}`}
    />
  );
};
