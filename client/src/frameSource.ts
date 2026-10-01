import { fileFormat, isAnimatedImage, isStillImage, mp4Fps, stillFormat } from "./sourceFormat";

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
  // Average; null = unknown (a still, or a container other than MP4/MOV).
  fps?(): Promise<number | null>;
  close(): void;
}

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
    const ready = new Promise<void>((resolve, reject) => {
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener(
        "error",
        () => reject(new Error("The browser can't decode this file")),
        { once: true },
      );
    });
    video.src = url;
    await ready;
  } catch (err) {
    close();
    throw err;
  }
  return {
    duration: async () => (Number.isFinite(video.duration) ? video.duration : 0),
    frameAt: async (second) => {
      if (video.currentTime !== second) video.currentTime = second;
      // May be an earlier call's seek; nothing to draw until it lands.
      if (video.seeking) {
        await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
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
        return !!stored && stored.width * video.videoHeight !== video.videoWidth * stored.height;
      } catch {
        return false;
      }
    },
    fps: () => mp4Fps(file),
    close,
  };
};

// Stills and animations alike. A frame carries the EXIF orientation, which
// drawImage applies (and displayWidth/Height include), as the server does.
const openImage = async (file: File): Promise<FrameSource> => {
  // Dropped files can come without a type.
  const type = (stillFormat(file) ?? fileFormat(file))?.mime ?? file.type;
  const decoder = new ImageDecoder({ data: file.stream(), type });
  // The frame count is final only after `completed`, and exists only after
  // `tracks.ready`.
  await Promise.all([decoder.completed, decoder.tracks.ready]);
  const track = decoder.tracks.selectedTrack;
  const count = track?.frameCount ?? 0;
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

  const duration = async () => (track?.animated ? (await frameEnds())[count - 1] : 0);

  return {
    duration,
    fps: async () => {
      const seconds = await duration();
      return seconds ? count / seconds : null;
    },
    frameAt: async (second) => {
      let frameIndex = 0;
      if (second > 0 && count > 1) {
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

// Rejects when the browser can't decode the file (or has no ImageDecoder).
export const openFrameSource = async (file: File): Promise<FrameSource> =>
  isStillImage(file) || isAnimatedImage(file) ? openImage(file) : openVideo(file);
