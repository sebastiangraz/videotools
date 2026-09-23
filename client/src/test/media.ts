import { vi, onTestFinished } from "vitest";

// jsdom never loads media, and frame sources (frameSource.ts) work off
// elements that are never in the page, so there is nothing to fire an event
// at. These stand in for the browser until the test is over.

const answerSrc = (proto: object, event: string) => {
  const original = Object.getOwnPropertyDescriptor(proto, "src")!;
  Object.defineProperty(proto, "src", {
    ...original,
    set(this: HTMLElement, value: string) {
      original.set!.call(this, value);
      queueMicrotask(() => this.dispatchEvent(new Event(event)));
    },
  });
  onTestFinished(() => {
    Object.defineProperty(proto, "src", original);
  });
};

// Answers every `src` set on a <video> or an <img> as a browser that can
// (`loadeddata` / `load`) or can't (`error`) decode it. Elements React
// renders are left alone: it sets the attribute, not the property.
export const stubMediaLoading = (outcome: "decodes" | "fails") => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const ok = outcome === "decodes";
  answerSrc(HTMLMediaElement.prototype, ok ? "loadeddata" : "error");
  answerSrc(HTMLImageElement.prototype, ok ? "load" : "error");
};

// Overrides getters (sizes, duration, …) on an element prototype.
export const stubProperties = (
  proto: object,
  stubs: Record<string, PropertyDescriptor>,
) => {
  for (const [name, descriptor] of Object.entries(stubs)) {
    const original = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, ...descriptor });
    onTestFinished(() => {
      if (original) Object.defineProperty(proto, name, original);
      else Reflect.deleteProperty(proto, name);
    });
  }
};

// The 2D context every canvas hands out, and a JPEG for every `toBlob`.
// Returns the context's `drawImage`.
export const stubCanvas = () => {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    function (callback) {
      callback(new Blob(["jpg"], { type: "image/jpeg" }));
    },
  );
  return drawImage;
};

// What the fake decoder hands to `drawImage`: tagged with its index.
export interface FakeFrame {
  frameIndex: number;
}

// An ImageDecoder for an animation of `frameCount` frames, each showing for
// `frameMs` (whole numbers, so the times add up exactly). Like the real one,
// the track (and its frame count) isn't there until `tracks.ready` resolves,
// even with `completed` resolved.
export const stubImageDecoder = (frameCount: number, frameMs: number) => {
  class FakeImageDecoder {
    completed = Promise.resolve();
    tracks: { ready: Promise<void>; selectedTrack: unknown } = {
      selectedTrack: null,
      ready: new Promise<void>((resolve) =>
        setTimeout(() => {
          this.tracks.selectedTrack = { frameCount };
          resolve();
        }),
      ),
    };
    async decode({ frameIndex }: { frameIndex: number }) {
      return {
        image: {
          frameIndex,
          timestamp: frameIndex * frameMs * 1000,
          duration: frameMs * 1000,
          displayWidth: 480,
          displayHeight: 270,
          close: vi.fn(),
        },
      };
    }
    close() {}
  }
  vi.stubGlobal("ImageDecoder", FakeImageDecoder);
  // Not unstubAllGlobals: the PointerEvent stand-in has to stay
  onTestFinished(() => {
    Reflect.deleteProperty(globalThis, "ImageDecoder");
  });
};

// A picked WebP: its header as far as the animation flag, which is all that
// is read of it ("RIFF" size "WEBP" "VP8X" size flags; animation is bit 1).
export const webpFile = (name: string, animated: boolean) =>
  new File(
    [
      new Uint8Array([
        ...[..."RIFF\0\0\0\0WEBPVP8X"].map((c) => c.charCodeAt(0)),
        ...[10, 0, 0, 0],
        animated ? 0x02 : 0x10,
      ]),
    ],
    name,
    { type: "image/webp" },
  );

// A picked GIF. jsdom's File can't hand over its bytes.
export const gifFile = (name: string) => {
  const file = new File(["00"], name, { type: "image/gif" });
  file.stream = () => new ReadableStream();
  return file;
};
