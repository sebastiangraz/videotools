import { useEffect, useRef, useState } from "react";

// The mark preview is rendered by the server with the real ffmpeg graph, so
// it always matches the encode. The browser sends frames of the video
// (grabbed off a <video>, downscaled: the geometry is relative to the
// frame, so a smaller one previews the same) and the logo inline.
const PREVIEW_MAX_WIDTH = 1280;

// How many frames the mark preview grabs, evenly spaced from the start of
// the clip, so hovering across it scrubs through time.
const SCRUB_FRAMES = 5;

// Draws `source` onto a canvas and encodes it as a JPEG. Null when there is
// nothing to draw (no size yet) or the canvas is unavailable.
const grabFrame = (source: CanvasImageSource, w: number, h: number) =>
  new Promise<Blob | null>((resolve) => {
    if (!w || !h) return resolve(null);
    const scale = Math.min(1, PREVIEW_MAX_WIDTH / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return resolve(null);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(resolve, "image/jpeg", 0.9);
  });

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// The mark preview: the grabbed frames, and the server's render of each
// (object URLs, slot for slot; "" until one lands), refreshed whenever the
// frames, logo or filter change. `scrubIndex` is the slot the pointer's
// horizontal position picks.
export function useMarkPreview(watermark: File | null, filterMode: boolean) {
  const [frameBlobs, setFrameBlobs] = useState<Blob[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [scrubIndex, setScrubIndex] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  // Bumped per grab (and per picked file), so a grab still seeking through
  // the previous source drops its frames instead of landing them.
  const grabRun = useRef(0);

  // A slot's URL is revoked once a newer render (or a reset) has pushed it
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

  // Asks the server for the composited frames. The first goes alone, so the
  // preview is up as fast as a single render allows; the rest follow
  // together. A change while renders are in flight abandons them (the
  // function stops encoding when the disconnect reaches it) and starts over.
  useEffect(() => {
    if (frameBlobs.length === 0 || !watermark) return;
    const controller = new AbortController();
    (async () => {
      setPreviewError(false);
      const logo = await toDataUrl(watermark);
      const render = async (blob: Blob, slot: number) => {
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
        const rendered = await res.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(rendered);
        // The slot's last render stays up until this one replaces it.
        setPreviewUrls((prev) =>
          frameBlobs.map((_, i) => (i === slot ? url : (prev[i] ?? ""))),
        );
      };
      await render(frameBlobs[0], 0);
      await Promise.all(
        frameBlobs.slice(1).map((blob, i) => render(blob, i + 1)),
      );
    })().catch((err: unknown) => {
      if (controller.signal.aborted) return;
      console.error(err);
      setPreviewError(true);
    });
    return () => controller.abort();
  }, [frameBlobs, watermark, filterMode]);

  // Grabs SCRUB_FRAMES frames off the grab <video>, evenly spaced from the
  // start (0, 1/5, 2/5… of the clip: the end itself rarely seeks to a
  // drawable frame). A source without a usable duration gives just the
  // frame it has loaded.
  const grabVideoFrames = async (video: HTMLVideoElement) => {
    const run = ++grabRun.current;
    const count =
      Number.isFinite(video.duration) && video.duration > 0 ? SCRUB_FRAMES : 1;
    const blobs: Blob[] = [];
    for (let i = 0; i < count; i++) {
      if (i > 0) {
        const seeked = new Promise((resolve) =>
          video.addEventListener("seeked", resolve, { once: true }),
        );
        video.currentTime = (video.duration * i) / count;
        await seeked;
      }
      const blob = await grabFrame(video, video.videoWidth, video.videoHeight);
      if (run !== grabRun.current) return;
      if (blob) blobs.push(blob);
    }
    setFrameBlobs(blobs);
  };

  // Same for a GIF source. ImageDecoder reaches any frame of it; without it
  // the <img> is all there is, and a canvas always draws an animated
  // image's first frame, so that one frame is the whole preview.
  const grabGifFrames = async (file: File, img: HTMLImageElement) => {
    const run = ++grabRun.current;
    const blobs: Blob[] = [];
    if ("ImageDecoder" in window) {
      try {
        const decoder = new ImageDecoder({
          data: await file.arrayBuffer(),
          type: file.type,
        });
        // `completed` = every byte is in, so the frame count is final;
        // the track (and that count) only exists once `tracks.ready` is.
        await Promise.all([decoder.completed, decoder.tracks.ready]);
        const total = decoder.tracks.selectedTrack?.frameCount ?? 1;
        const count = Math.min(SCRUB_FRAMES, total);
        for (let i = 0; i < count; i++) {
          const { image } = await decoder.decode({
            frameIndex: Math.floor((total * i) / count),
          });
          const blob = await grabFrame(
            image,
            image.displayWidth,
            image.displayHeight,
          );
          image.close();
          if (blob) blobs.push(blob);
        }
        decoder.close();
      } catch (err) {
        console.error(err);
        blobs.length = 0;
      }
    }
    if (blobs.length === 0) {
      const blob = await grabFrame(img, img.naturalWidth, img.naturalHeight);
      if (blob) blobs.push(blob);
    }
    if (run !== grabRun.current) return;
    setFrameBlobs(blobs);
  };

  // For a newly picked source: drops the frames and renders of the last one,
  // and any grab still under way.
  const reset = () => {
    grabRun.current++;
    setFrameBlobs([]);
    setPreviewUrls([]);
    setScrubIndex(0);
  };

  // The render on show: the scrubbed slot's, or while that one is still on
  // its way, the first that has landed. -1 = none yet (the bare frame shows).
  const shownRender = previewUrls[scrubIndex]
    ? scrubIndex
    : previewUrls.findIndex(Boolean);

  return {
    frameCount: frameBlobs.length,
    previewUrls,
    shownRender,
    previewError,
    setScrubIndex,
    grabVideoFrames,
    grabGifFrames,
    reset,
  };
}
