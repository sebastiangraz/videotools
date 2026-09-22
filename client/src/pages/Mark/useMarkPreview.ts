import { useEffect, useRef, useState } from "react";
import {
  openFrameSource,
  type Frame,
  type FrameSource,
} from "../../frameSource";

// The mark preview is rendered by the server with the real ffmpeg graph, so
// it always matches the encode. The browser sends frames of the source
// (grabbed through a frame source, downscaled: the geometry is relative to
// the frame, so a smaller one previews the same) and the logo inline.
const PREVIEW_MAX_WIDTH = 1280;

// How many frames the mark preview grabs, evenly spaced from the start of
// the clip, so hovering across it scrubs through time.
const SCRUB_FRAMES = 5;

// Draws a frame onto a canvas and encodes it as a JPEG. Null when there is
// nothing to draw (no size) or the canvas is unavailable.
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

// The mark preview: frames grabbed off `source`, and the server's render of
// each (object URLs, slot for slot; none until the first set lands),
// refreshed as a set whenever the frames, logo or filter change, with
// `loading` up in between. `scrubIndex` is the slot the pointer's horizontal
// position picks.
export function useMarkPreview(
  source: File | null,
  watermark: File | null,
  filterMode: boolean,
) {
  const [frameBlobs, setFrameBlobs] = useState<Blob[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [scrubIndex, setScrubIndex] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  // What the last finished round of renders (landed or failed) was asked
  // for; anything else on the table is still on its way.
  const [settled, setSettled] = useState<{
    frameBlobs: Blob[];
    watermark: File;
    filterMode: boolean;
  } | null>(null);
  // The source no frame could be grabbed off, so there is nothing to wait for.
  const [failedSource, setFailedSource] = useState<File | null>(null);

  // A set's URLs are revoked once a newer set (or a reset) has pushed them
  // out, and whatever is left goes on unmount.
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

  // Asks the server for the composited frames, all at once, and puts them up
  // as one set when the last has landed: scrubbing never crosses a mix of
  // new renders and ones from before the change. Until then the previous set
  // stays up (`loading` says so); if one fails, it stays for good. A change
  // while renders are in flight abandons them (the function stops encoding
  // when the disconnect reaches it) and starts over.
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
        setSettled({ frameBlobs, watermark, filterMode });
      });
    return () => controller.abort();
  }, [frameBlobs, watermark, filterMode]);

  // Grabs SCRUB_FRAMES frames of the source, evenly spaced from the start
  // (0, 1/5, 2/5… of the clip: the end itself rarely seeks to a drawable
  // frame), through a frame source of its own, so its seeking never shows
  // in the bare frame. A source without a usable duration (or an animated
  // image where there is no ImageDecoder) gives just its first frame. A
  // source picked meanwhile drops the grab instead of landing its frames; one
  // the browser can't decode gives none, and the bare frame's note says so.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    let frames: FrameSource | undefined;
    (async () => {
      frames = await openFrameSource(source);
      if (cancelled) return;
      const duration = await frames.duration();
      const count = duration > 0 ? SCRUB_FRAMES : 1;
      const blobs: Blob[] = [];
      for (let i = 0; i < count; i++) {
        const frame = await frames.frameAt((duration * i) / count);
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

  // For a newly picked source: drops the frames and renders of the last one.
  const reset = () => {
    setFrameBlobs([]);
    setPreviewUrls([]);
    setScrubIndex(0);
  };

  // The render on show: the scrubbed slot's, or the first where the set up
  // has no such slot. -1 = no set yet (the bare frame shows).
  const shownRender = previewUrls[scrubIndex]
    ? scrubIndex
    : previewUrls.findIndex(Boolean);

  // Frames are being grabbed or rendered for what is picked now: from the
  // moment there is a source and a logo until a set of renders for exactly
  // these frames, this logo and this filter has landed (or failed).
  const loading =
    source !== null &&
    watermark !== null &&
    failedSource !== source &&
    !(
      settled?.frameBlobs === frameBlobs &&
      settled.watermark === watermark &&
      settled.filterMode === filterMode
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
