import { useEffect, useRef, useState } from "react";
import { openFrameSource, type Frame, type FrameSource } from "../../frameSource";

// Mirror the API's MARK_SIZES / MARK_FILTERS / MARK_VIEWS.
export type MarkSize = "small" | "large" | "dev";
export type MarkFilter = "plain" | "glass" | "blur";
export type MarkView = "render" | "displacement" | "clear";

// The server renders the preview with the real ffmpeg graph. Mark geometry is
// relative to the frame, so a downscaled frame previews the same.
const PREVIEW_MAX_WIDTH = 1280;

export const SCRUB_FRAMES = 7;

// 0, 1/n, 2/n… of the clip: the end itself rarely seeks to a drawable frame.
export const scrubTimes = (duration: number): number[] => {
  const count = duration > 0 ? SCRUB_FRAMES : 1;
  return Array.from({ length: count }, (_, i) => (duration * i) / count);
};

const grabFrame = ({ image, width, height }: Frame) =>
  new Promise<Blob | null>((resolve) => {
    if (!width || !height) return resolve(null);
    const scale = Math.min(1, PREVIEW_MAX_WIDTH / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return resolve(null);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(resolve, "image/jpeg", 0.9);
  });

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export function useMarkPreview(
  source: File | null,
  watermark: File | null,
  filterMode: MarkFilter,
  size: MarkSize,
  view: MarkView = "render",
) {
  const [frameBlobs, setFrameBlobs] = useState<Blob[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [scrubIndex, setScrubIndex] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  // Inputs of the last finished round (landed or failed); drives `loading`.
  const [settled, setSettled] = useState<{
    frameBlobs: Blob[];
    watermark: File;
    filterMode: MarkFilter;
    size: MarkSize;
    view: MarkView;
  } | null>(null);
  const [failedSource, setFailedSource] = useState<File | null>(null);

  const liveUrls = useRef<string[]>([]);
  useEffect(() => {
    for (const url of liveUrls.current) {
      if (url && !previewUrls.includes(url)) URL.revokeObjectURL(url);
    }
    liveUrls.current = previewUrls;
  }, [previewUrls]);
  useEffect(
    () => () => {
      for (const url of liveUrls.current) if (url) URL.revokeObjectURL(url);
    },
    [],
  );

  // Swap in all renders at once so scrubbing never mixes old and new. Aborting
  // disconnects, which makes the function stop encoding.
  useEffect(() => {
    if (frameBlobs.length === 0 || !watermark) return;
    const controller = new AbortController();
    (async () => {
      setPreviewError(false);
      const logo = await toDataUrl(watermark);
      const renders = await Promise.all(
        frameBlobs.map(async (blob) => {
          const res = await fetch("/api/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              frame: await toDataUrl(blob),
              logo,
              filter: filterMode,
              size,
              view,
            }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`Preview failed (${res.status})`);
          return res.blob();
        }),
      );
      if (controller.signal.aborted) return;
      setPreviewUrls(renders.map((render) => URL.createObjectURL(render)));
    })()
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error(err);
        setPreviewError(true);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setSettled({ frameBlobs, watermark, filterMode, size, view });
      });
    return () => controller.abort();
  }, [frameBlobs, watermark, filterMode, size, view]);

  // Its own frame source, so its seeking never shows in the bare frame.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    let frames: FrameSource | undefined;
    (async () => {
      frames = await openFrameSource(source);
      if (cancelled) return;
      const duration = await frames.duration();
      const blobs: Blob[] = [];
      for (const second of scrubTimes(duration)) {
        const frame = await frames.frameAt(second);
        const blob = await grabFrame(frame);
        frame.close();
        if (cancelled) return;
        if (blob) blobs.push(blob);
      }
      if (blobs.length === 0) throw new Error("No frame to grab");
      setFrameBlobs(blobs);
    })()
      .catch(() => {
        if (!cancelled) setFailedSource(source);
      })
      .finally(() => frames?.close());
    return () => {
      cancelled = true;
    };
  }, [source]);

  const reset = () => {
    setFrameBlobs([]);
    setPreviewUrls([]);
    setScrubIndex(0);
  };

  // -1 = no set yet (the bare frame shows).
  const shownRender = previewUrls[scrubIndex] ? scrubIndex : previewUrls.findIndex(Boolean);

  const loading =
    source !== null &&
    watermark !== null &&
    failedSource !== source &&
    !(
      settled?.frameBlobs === frameBlobs &&
      settled.watermark === watermark &&
      settled.filterMode === filterMode &&
      settled.size === size &&
      settled.view === view
    );

  return {
    frameCount: frameBlobs.length,
    previewUrls,
    shownRender,
    loading,
    previewError,
    setScrubIndex,
    reset,
  };
}
