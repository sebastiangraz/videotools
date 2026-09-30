import { isAnimation, isStillImage } from "./sourceFormat";

export interface Frame {
  image: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

export interface FrameSource {
  // Seconds; 0 = unknown (or a still).
  duration(): Promise<number>;
  // Past the end: the last frame.
  frameAt(second: number): Promise<Frame>;
  // Videos only (VideoFrame can tell).
  nonSquare?(): boolean;
  close(): void;
}

const loaded = (element: HTMLElement, ready: string) =>
  new Promise<void>((resolve, reject) => {
    element.addEventListener(ready, () => resolve(), { once: true });
    element.addEventListener(
      "error",
      () => reject(new Error("The browser can't decode this file")),
      { once: true },
    );
  });

// Detached <video>; the browser clamps out-of-range seeks to the clip length.
const openVideo = async (file: File): Promise<FrameSource> => {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const close = () => {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };
  try {
    const ready = loaded(video, "loadeddata");
    video.src = url;
    await ready;
  } catch (err) {
    close();
    throw err;
  }
  return {
    duration: async () =>
      Number.isFinite(video.duration) ? video.duration : 0,
    frameAt: async (second) => {
      if (video.currentTime !== second) video.currentTime = second;
      // May be an earlier call's seek; nothing to draw until it lands.
      if (video.seeking) {
        await new Promise((resolve) =>
          video.addEventListener("seeked", resolve, { once: true }),
        );
      }
      return {
        image: video,
        width: video.videoWidth,
        height: video.videoHeight,
        close: () => {},
      };
    },
    nonSquare: () => {
      try {
        const frame = new VideoFrame(video);
        const stored = frame.visibleRect;
        frame.close();
        return (
          !!stored &&
          stored.width * video.videoHeight !== video.videoWidth * stored.height
        );
      } catch {
        return false;
      }
    },
    close,
  };
};

const openAnimation = async (file: File): Promise<FrameSource> => {
  const decoder = new ImageDecoder({ data: file.stream(), type: file.type });
  // The frame count is final only after `completed`, and exists only after
  // `tracks.ready`.
  await Promise.all([decoder.completed, decoder.tracks.ready]);
  const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
  if (!count) {
    decoder.close();
    throw new Error("No frames");
  }

  // Frame end times (s). GIF delays vary per frame, so this needs a lazy pass
  // over every frame.
  let ends: Promise<number[]> | undefined;
  const frameEnds = () =>
    (ends ??= (async () => {
      const times: number[] = [];
      for (let i = 0; i < count; i++) {
        const { image } = await decoder.decode({ frameIndex: i });
        times.push(((image.timestamp ?? 0) + (image.duration ?? 0)) / 1e6);
        image.close();
      }
      return times;
    })());

  return {
    duration: async () => (await frameEnds())[count - 1],
    frameAt: async (second) => {
      let frameIndex = 0;
      if (second > 0) {
        const found = (await frameEnds()).findIndex((end) => end > second);
        frameIndex = found < 0 ? count - 1 : found;
      }
      const { image } = await decoder.decode({ frameIndex });
      return {
        image,
        width: image.displayWidth,
        height: image.displayHeight,
        close: () => image.close(),
      };
    },
    close: () => decoder.close(),
  };
};

// Stills, and animations without ImageDecoder (a canvas only draws an <img>'s
// first frame). An <img> honours EXIF orientation, as the server does.
const openStill = async (file: File): Promise<FrameSource> => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    const ready = loaded(img, "load");
    img.src = url;
    await ready;
  } finally {
    URL.revokeObjectURL(url);
  }
  return {
    duration: async () => 0,
    frameAt: async (second) => {
      if (second > 0) throw new Error("Only the first frame can be drawn");
      return {
        image: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => {},
      };
    },
    close: () => {},
  };
};

export const openFrameSource = async (file: File): Promise<FrameSource> => {
  if (await isAnimation(file)) {
    return typeof ImageDecoder !== "undefined"
      ? openAnimation(file).catch(() => openStill(file))
      : openStill(file);
  }
  return isStillImage(file) ? openStill(file) : openVideo(file);
};
