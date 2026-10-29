import { useEffect, useRef, useState } from "react";
import { openFrameSource, type Frame, type FrameSource } from "@src/frameSource";
import { runEngine } from "@src/engine";
import {
  MARK,
  MARK_POSITIONS,
  type MARK_TUNING,
  type MarkFilter,
  type MarkPosition,
  type MarkSize,
  type MarkView,
} from "@api/tools/mark-config";

export type MarkTuning = Record<keyof typeof MARK_TUNING, number>;
const POSITIONS = Object.keys(MARK_POSITIONS) as MarkPosition[];
// Where the mark is `progress` (0 to 1) through a clip of `stays`.
const stopAt = (route: MarkPosition[], stays: number, progress: number) =>
  route[Math.floor(progress * stays) % route.length];

// Four bags of every position from `start`, each spent before the next, never
// the same twice running, looping back to `start` included.
export const shuffleRoute = (start: MarkPosition): MarkPosition[] => {
  const route = [start];
  let bag = POSITIONS.filter((at) => at !== start);
  while (route.length < 4 * POSITIONS.length) {
    if (bag.length === 0) bag = [...POSITIONS];
    const draws = bag.filter((at) => at !== route.at(-1));
    const next = draws[Math.floor(Math.random() * draws.length)];
    bag.splice(bag.indexOf(next), 1);
    route.push(next);
  }
  const end = route.length - 1;
  if (route[end] === start) [route[end - 1], route[end]] = [route[end], route[end - 1]];
  return route;
};

// The engine renders the preview with the real ffmpeg graph. Mark geometry is
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

export function useMarkPreview(
  source: File | null,
  watermark: File | null,
  filterMode: MarkFilter,
  size: MarkSize,
  position: MarkPosition,
  route: MarkPosition[] | null,
  view: MarkView,
  tuning: MarkTuning,
) {
  const [frameBlobs, setFrameBlobs] = useState<Blob[]>([]);
  const [duration, setDuration] = useState(0);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [scrubIndex, setScrubIndex] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  // Inputs of the last finished round (landed or failed); drives `loading`.
  const [settled, setSettled] = useState<{
    frameBlobs: Blob[];
    watermark: File;
    filterMode: MarkFilter;
    size: MarkSize;
    position: MarkPosition;
    route: MarkPosition[] | null;
    stays: number;
    view: MarkView;
    tuning: MarkTuning;
  } | null>(null);
  const [failedSource, setFailedSource] = useState<File | null>(null);

  // Mirrors watermarkGraph's rotation: the clip in equal stays (as many as the
  // cadence fits, two at least), each at the route's next stop, looping it.
  const stays = route ? Math.max(2, Math.floor(duration / MARK.rotateCadence)) : 1;

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
  // ends the renders' workers.
  useEffect(() => {
    if (frameBlobs.length === 0 || !watermark) return;
    const controller = new AbortController();
    (async () => {
      setPreviewError(false);
      const renders = await Promise.all(
        frameBlobs.map((frame, n) =>
          runEngine(
            {
              preview: {
                frame,
                logo: watermark,
                filter: filterMode,
                size,
                position: stopAt(route ?? [position], stays, n / frameBlobs.length),
                view,
                tuning,
              },
            },
            controller.signal,
          ),
        ),
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
        setSettled({
          frameBlobs,
          watermark,
          filterMode,
          size,
          position,
          route,
          stays,
          view,
          tuning,
        });
      });
    return () => controller.abort();
  }, [frameBlobs, watermark, filterMode, size, position, route, stays, view, tuning]);

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
      setDuration(duration);
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
      settled.position === position &&
      settled.route === route &&
      settled.stays === stays &&
      settled.view === view &&
      settled.tuning === tuning
    );

  return {
    frameCount: frameBlobs.length,
    duration,
    previewUrls,
    shownRender,
    shownSecond: (duration * Math.max(0, shownRender)) / (frameBlobs.length || 1),
    shownPosition:
      shownRender < 0
        ? position
        : stopAt(route ?? [position], stays, shownRender / frameBlobs.length),
    loading,
    previewError,
    setScrubIndex,
    reset,
  };
}
