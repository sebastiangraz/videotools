import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import { renderApp, uploadMock } from "../../test/renderApp";

describe("Mark", () => {
  // Uploads keyed by filename, so the video and the watermark can be told
  // apart in the process request
  const blobFor = (name: string) =>
    `https://store.public.blob.vercel-storage.com/${name}`;

  const markFetchMock = (resultUrl: string) =>
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (input === "/api/process" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ url: resultUrl, filename: "clip_marked.mp4" }),
          { status: 200 },
        );
      }
      if (input === resultUrl) {
        return new Response(new Blob(["video"], { type: "video/mp4" }), {
          status: 200,
        });
      }
      if (input === "/api/process" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });

  it("waits for a video and a PNG watermark on the mark tool, then offers filter mode", async () => {
    const user = userEvent.setup();
    await renderApp("/mark");

    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "clip.mp4", { type: "video/mp4" }),
    );
    const button = screen.getByRole("button", { name: /^mark$/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.hover(button);
    expect(await screen.findByText(/upload a watermark/i)).toBeInTheDocument();
    await user.unhover(button);

    // Only PNG logos are taken; the picker's accept list filters the rest
    const picker = screen.getByLabelText(/choose watermark/i);
    expect(picker).toHaveAttribute("accept", "image/png");
    await user.upload(
      picker,
      new File(["00"], "logo.gif", { type: "image/gif" }),
    );
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("logo.gif")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /glass/i }),
    ).not.toBeInTheDocument();

    await user.upload(
      picker,
      new File(["00"], "logo.png", { type: "image/png" }),
    );
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByText("logo.png")).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: /glass/i }),
    ).toBeInTheDocument();
  });

  it("takes a GIF as the mark source and previews it through an image instead of a video", async () => {
    const user = userEvent.setup();
    // jsdom never decodes images: give the <img> a size and stand in for
    // the canvas the frame is grabbed through
    const sizes = ["naturalWidth", "naturalHeight"].map((name) => {
      const original = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        name,
      );
      Object.defineProperty(HTMLImageElement.prototype, name, {
        configurable: true,
        get: () => (name === "naturalWidth" ? 480 : 270),
      });
      return () =>
        Object.defineProperty(HTMLImageElement.prototype, name, original!);
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (callback) {
        callback(new Blob(["jpg"], { type: "image/jpeg" }));
      },
    );
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/preview" && init?.method === "POST") {
          return new Response(new Blob(["jpg"], { type: "image/jpeg" }), {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch: ${input}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await renderApp("/mark");
      await user.upload(
        screen.getByLabelText(/choose video/i),
        new File(["00"], "anim.gif", { type: "image/gif" }),
      );
      expect(screen.getByText("anim.gif")).toBeInTheDocument();
      await user.upload(
        screen.getByLabelText(/choose watermark/i),
        new File(["00"], "logo.png", { type: "image/png" }),
      );

      // An <img>, not a <video>, carries the first frame
      const frame = screen.getByAltText(/first frame/i);
      expect(frame.tagName).toBe("IMG");
      expect(frame).toHaveAttribute("src", "blob:mock");
      fireEvent.load(frame);

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/preview",
          expect.objectContaining({ method: "POST" }),
        ),
      );
      expect(
        JSON.parse(fetchMock.mock.calls[0][1]?.body as string).frame,
      ).toMatch(/^data:image\/jpeg;base64,/);
      await waitFor(() =>
        expect(screen.getByAltText(/watermarked frame/i)).toHaveAttribute(
          "src",
          "blob:mock",
        ),
      );
    } finally {
      sizes.forEach((restore) => restore());
    }
  });

  it("previews the first frame through the server once both are picked, and again when filter mode changes", async () => {
    const user = userEvent.setup();
    // jsdom neither decodes video nor draws: give the <video> a size and
    // stand in for the canvas the frame is grabbed through
    const sizes = ["videoWidth", "videoHeight"].map((name) => {
      const original = Object.getOwnPropertyDescriptor(
        HTMLVideoElement.prototype,
        name,
      );
      Object.defineProperty(HTMLVideoElement.prototype, name, {
        configurable: true,
        get: () => (name === "videoWidth" ? 1280 : 720),
      });
      return () =>
        Object.defineProperty(HTMLVideoElement.prototype, name, original!);
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (callback) {
        callback(new Blob(["jpg"], { type: "image/jpeg" }));
      },
    );
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/preview" && init?.method === "POST") {
          return new Response(new Blob(["jpg"], { type: "image/jpeg" }), {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch: ${input}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await renderApp("/mark");
      await user.upload(
        screen.getByLabelText(/choose video/i),
        new File(["00"], "clip.mp4", { type: "video/mp4" }),
      );
      // Nothing to render until the logo is there too
      expect(
        screen.queryByLabelText(/watermark preview/i),
      ).not.toBeInTheDocument();

      await user.upload(
        screen.getByLabelText(/choose watermark/i),
        new File(["00"], "logo.png", { type: "image/png" }),
      );
      const preview = screen.getByLabelText(/watermark preview/i);
      // Inline, not a popup: the bare frame is in the page right away
      const frame = screen.getByLabelText(/first frame/i);
      expect(frame).toHaveAttribute("src", "blob:mock");

      // Once the browser has a decoded frame it is grabbed (off a second,
      // undisplayed video) and sent, with the logo, to be composited by the
      // real graph. jsdom's video has no duration, so one frame is all
      fireEvent(
        screen.getByLabelText(/frame grab source/i),
        new Event("loadeddata"),
      );
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/preview",
          expect.objectContaining({ method: "POST" }),
        ),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
      expect(body).toMatchObject({ filter: false });
      expect(body.frame).toMatch(/^data:image\/jpeg;base64,/);
      expect(body.logo).toMatch(/^data:image\/png;base64,/);
      await waitFor(() =>
        expect(
          within(preview).getByAltText(/watermarked frame/i),
        ).toHaveAttribute("src", "blob:mock"),
      );

      // Filter mode is the server's business too, so it re-renders
      await user.click(screen.getByRole("switch", { name: /glass/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(
        JSON.parse(fetchMock.mock.calls[1][1]?.body as string),
      ).toMatchObject({ filter: true });
    } finally {
      sizes.forEach((restore) => restore());
    }
  });

  it("grabs five evenly spaced frames of a GIF source through ImageDecoder", async () => {
    const user = userEvent.setup();
    // Like the real one, the track (and its frame count) isn't there until
    // `tracks.ready` resolves, even with `completed` already resolved
    const decoded: number[] = [];
    class FakeImageDecoder {
      completed = Promise.resolve();
      tracks: { ready: Promise<void>; selectedTrack: unknown } = {
        selectedTrack: null,
        ready: new Promise<void>((resolve) =>
          setTimeout(() => {
            this.tracks.selectedTrack = { frameCount: 100 };
            resolve();
          }),
        ),
      };
      async decode({ frameIndex }: { frameIndex: number }) {
        decoded.push(frameIndex);
        return {
          image: { displayWidth: 480, displayHeight: 270, close: vi.fn() },
        };
      }
      close() {}
    }
    vi.stubGlobal("ImageDecoder", FakeImageDecoder);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (callback) {
        callback(new Blob(["jpg"], { type: "image/jpeg" }));
      },
    );
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/preview" && init?.method === "POST") {
          return new Response(new Blob(["jpg"], { type: "image/jpeg" }), {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch: ${input}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await renderApp("/mark");
      const gif = new File(["00"], "anim.gif", { type: "image/gif" });
      // jsdom's File can't hand over its bytes
      gif.arrayBuffer = async () => new ArrayBuffer(2);
      await user.upload(screen.getByLabelText(/choose video/i), gif);
      await user.upload(
        screen.getByLabelText(/choose watermark/i),
        new File(["00"], "logo.png", { type: "image/png" }),
      );
      fireEvent.load(screen.getByAltText(/first frame/i));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
      expect(decoded).toEqual([0, 20, 40, 60, 80]);
      const preview = screen.getByLabelText(/watermark preview/i);
      expect(preview.parentElement!.lastElementChild!.children).toHaveLength(
        5,
      );
    } finally {
      // Not unstubAllGlobals: the PointerEvent stand-in has to stay
      Reflect.deleteProperty(globalThis, "ImageDecoder");
    }
  });

  it("grabs five evenly spaced frames and scrubs through their renders as the pointer crosses the preview", async () => {
    const user = userEvent.setup();
    // jsdom neither decodes nor seeks: give the <video> a size and a length,
    // answer every seek, and stand in for the canvas
    const seeks: number[] = [];
    const stubs: Record<string, PropertyDescriptor> = {
      videoWidth: { get: () => 1280 },
      videoHeight: { get: () => 720 },
      duration: { get: () => 10 },
      currentTime: {
        get: () => 0,
        set(this: HTMLVideoElement, time: number) {
          seeks.push(time);
          queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
        },
      },
    };
    const restores = Object.entries(stubs).map(([name, descriptor]) => {
      const original = Object.getOwnPropertyDescriptor(
        HTMLVideoElement.prototype,
        name,
      );
      Object.defineProperty(HTMLVideoElement.prototype, name, {
        configurable: true,
        ...descriptor,
      });
      return () => {
        if (original) {
          Object.defineProperty(HTMLVideoElement.prototype, name, original);
        } else {
          delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)[
            name
          ];
        }
      };
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (callback) {
        callback(new Blob(["jpg"], { type: "image/jpeg" }));
      },
    );
    // A URL per render, to tell the slots apart
    let renders = 0;
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) =>
      blob instanceof Blob && blob.type === "image/jpeg"
        ? `blob:render-${renders++}`
        : "blob:mock",
    );
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/preview" && init?.method === "POST") {
          return new Response(new Blob(["jpg"], { type: "image/jpeg" }), {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch: ${input}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await renderApp("/mark");
      await user.upload(
        screen.getByLabelText(/choose video/i),
        new File(["00"], "clip.mp4", { type: "video/mp4" }),
      );
      await user.upload(
        screen.getByLabelText(/choose watermark/i),
        new File(["00"], "logo.png", { type: "image/png" }),
      );
      fireEvent(
        screen.getByLabelText(/frame grab source/i),
        new Event("loadeddata"),
      );

      // The loaded frame, then four seeks a fifth of the clip apart
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
      expect(seeks).toEqual([2, 4, 6, 8]);

      const preview = screen.getByLabelText(/watermark preview/i);
      await waitFor(() =>
        expect(preview.querySelectorAll("img")).toHaveLength(5),
      );
      // The first frame's render shows until the pointer says otherwise
      const first = within(preview).getByAltText(/watermarked frame/i);

      // One strip per frame, side by side over the box
      const strips = preview.parentElement!.lastElementChild!.children;
      expect(strips).toHaveLength(5);
      fireEvent.pointerEnter(strips[3]);
      const scrubbed = within(preview).getByAltText(/watermarked frame/i);
      expect(scrubbed).not.toBe(first);

      fireEvent.pointerEnter(strips[0]);
      expect(within(preview).getByAltText(/watermarked frame/i)).toBe(first);
    } finally {
      restores.forEach((restore) => restore());
    }
  });

  it("uploads the video then the watermark and requests a glass watermark", async () => {
    const user = userEvent.setup();
    const video = new File(["00"], "clip.mp4", { type: "video/mp4" });
    const logo = new File(["00"], "logo.png", { type: "image/png" });

    uploadMock.mockImplementation(async (name: string) => ({
      url: blobFor(name),
    }));
    const resultUrl = blobFor("results/clip_marked-xyz.mp4");
    const fetchMock = markFetchMock(resultUrl);
    vi.stubGlobal("fetch", fetchMock);

    await renderApp("/mark");
    await user.upload(screen.getByLabelText(/choose video/i), video);
    await user.upload(screen.getByLabelText(/choose watermark/i), logo);
    await user.click(screen.getByRole("switch", { name: /glass/i }));
    await user.click(screen.getByRole("button", { name: /^mark$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/process",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(uploadMock).toHaveBeenNthCalledWith(
      1,
      "clip.mp4",
      video,
      expect.anything(),
    );
    expect(uploadMock).toHaveBeenNthCalledWith(
      2,
      "logo.png",
      logo,
      expect.anything(),
    );
    const processBody = JSON.parse(
      (fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]
        ?.body as string) ?? "{}",
    );
    expect(processBody).toEqual({
      tool: "mark",
      filename: "clip.mp4",
      blobUrl: blobFor("clip.mp4"),
      watermarkUrl: blobFor("logo.png"),
      options: { filter: true, quality: 100 },
    });
  });
});
