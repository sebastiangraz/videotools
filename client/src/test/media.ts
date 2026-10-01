import { vi, onTestFinished } from "vitest";

// jsdom never loads media, and frame sources use detached elements, so there
// is nothing to fire events at. These stubs last until the test ends.

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

// Hooks the `src` property setter; React-rendered elements set the attribute,
// so they are left alone.
export const stubMediaLoading = (outcome: "decodes" | "fails") => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const ok = outcome === "decodes";
  answerSrc(HTMLMediaElement.prototype, ok ? "loadeddata" : "error");
};

export const stubProperties = (proto: object, stubs: Record<string, PropertyDescriptor>) => {
  for (const [name, descriptor] of Object.entries(stubs)) {
    const original = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, ...descriptor });
    onTestFinished(() => {
      if (original) Object.defineProperty(proto, name, original);
      else Reflect.deleteProperty(proto, name);
    });
  }
};

// Returns the context's `drawImage`.
export const stubCanvas = () => {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) {
    callback(new Blob(["jpg"], { type: "image/jpeg" }));
  });
  return drawImage;
};

export interface FakeFrame {
  frameIndex: number;
}

// Like the real one, the track isn't there until `tracks.ready`, even after
// `completed`. Whole-ms frames keep the times exact.
export const stubImageDecoder = (
  frameCount: number,
  frameMs: number,
  [width, height] = [480, 270],
) => {
  class FakeImageDecoder {
    completed = Promise.resolve();
    tracks: { ready: Promise<void>; selectedTrack: unknown } = {
      selectedTrack: null,
      ready: new Promise<void>((resolve) =>
        setTimeout(() => {
          this.tracks.selectedTrack = { frameCount, animated: frameCount > 1 };
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
          displayWidth: width,
          displayHeight: height,
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

// Coded size, independent of the element's display size.
export const stubVideoFrame = (width: number, height: number) => {
  vi.stubGlobal(
    "VideoFrame",
    class {
      visibleRect = { width, height };
      close() {}
    },
  );
  onTestFinished(() => {
    Reflect.deleteProperty(globalThis, "VideoFrame");
  });
};

// Content is never read, bar a WebP's header.
export const file = (name: string, type = "") => new File(["00"], name, { type });

// Just the header up to the VP8X flags, all that is read (animation is bit
// 0x02). A plain lossy file has "VP8 " where VP8X would be.
export const webpFile = (name: string, flags: number, chunk = "VP8X") =>
  new File(
    [new Uint8Array([...new TextEncoder().encode(`RIFF\0\0\0\0WEBP${chunk}`), 10, 0, 0, 0, flags])],
    name,
    { type: "image/webp" },
  );

const bytes = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};

// Big-endian, as MP4 boxes are.
export const u32 = (n: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
};
export const u64 = (n: number) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n));
  return out;
};

// An MP4 box: size, type, body. `large`: size 1 and a 64-bit size after the
// type, as a >4 GB mdat is written.
export const box = (type: string, ...body: Uint8Array[]) =>
  bytes([u32(8 + body.reduce((n, p) => n + p.length, 0)), new TextEncoder().encode(type), ...body]);
export const largeBox = (type: string, ...body: Uint8Array[]) =>
  bytes([
    u32(1),
    new TextEncoder().encode(type),
    u64(16 + body.reduce((n, p) => n + p.length, 0)),
    ...body,
  ]);

// jsdom's File has no stream().
export const imageFile = (name: string, type = "image/gif") => {
  const file = new File(["00"], name, { type });
  file.stream = () => new ReadableStream();
  return file;
};
