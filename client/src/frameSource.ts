// The sources an <img> shows and a <video> doesn't.
export const isAnimatedImage = (file: File) =>
  file.type === "image/gif" || file.type === "image/avif";

// Whether the browser may have frames of a picked file to show, going by the
// type it reports. The accept list is broader than what browsers can decode
// (server-side ffmpeg handles the rest), so opening one can still fail.
export const hasFrames = (file: File) =>
  file.type.startsWith("video/") || isAnimatedImage(file);

// A frame to draw on a canvas, and its size. `close` frees a decoded one.
export interface Frame {
  image: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

// The frames of a picked file, by time, whatever it takes to decode them.
export interface FrameSource {
  // Seconds; 0 = the source can't tell (or is a still).
  duration(): Promise<number>;
  // The frame on screen at `second`; past the end, the last one.
  frameAt(second: number): Promise<Frame>;
  close(): void;
}

// Settles once the element has something to draw, or can't decode its source.
const loaded = (element: HTMLElement, ready: string) =>
  new Promise<void>((resolve, reject) => {
    element.addEventListener(ready, () => resolve(), { once: true });
    element.addEventListener(
      "error",
      () => reject(new Error("The browser can't decode this file")),
      { once: true },
    );
  });

// A <video> that is never in the page: seeked to the frame, which is then
// drawn off it. The browser clamps out-of-range times to the clip length.
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
      // Also true for a seek an earlier call started: the frame isn't there
      // to draw until it lands.
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
    close,
  };
};

// An animated image (GIF, AVIF): the browser's ImageDecoder takes it apart
// into frames with timestamps.
const openAnimation = async (file: File): Promise<FrameSource> => {
  const decoder = new ImageDecoder({ data: file.stream(), type: file.type });
  // `completed` = every byte is in, so the frame count is final; the track
  // (and that count) only exists once `tracks.ready` is.
  await Promise.all([decoder.completed, decoder.tracks.ready]);
  const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
  if (!count) {
    decoder.close();
    throw new Error("No frames");
  }

  // When each frame stops showing (seconds). GIF delays vary by frame, so
  // they cannot be computed from a rate: it takes a pass over every frame,
  // put off until something past the first one is asked for.
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

// An animated image where there is no ImageDecoder (or it can't read the
// file): an <img> is all there is, and a canvas always draws an animated
// image's first frame, so that one frame is the whole source.
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

// Rejects when the browser can't decode the file.
export const openFrameSource = (file: File): Promise<FrameSource> => {
  if (!isAnimatedImage(file)) return openVideo(file);
  return typeof ImageDecoder !== "undefined"
    ? openAnimation(file).catch(() => openStill(file))
    : openStill(file);
};
