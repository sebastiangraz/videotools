import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import { renderApp, uploadMock } from "../../test/renderApp";
import {
  gifFile,
  stubCanvas,
  stubImageDecoder,
  stubMediaLoading,
  stubProperties,
  webpFile,
  type FakeFrame,
} from "../../test/media";

describe("Mark", () => {
  // Keyed by filename to tell video and watermark apart in the request
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

  const stubPreviewFetch = () => {
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
    return fetchMock;
  };

  it("waits for a video and a PNG or SVG watermark on the mark tool, then offers filter mode", async () => {
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

    const picker = screen.getByLabelText(/choose watermark/i);
    expect(picker).toHaveAttribute("accept", "image/png,image/svg+xml,.svg");
    await user.upload(
      picker,
      new File(["00"], "logo.gif", { type: "image/gif" }),
    );
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("logo.gif")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /glass/i }),
    ).not.toBeInTheDocument();

    await user.upload(
      picker,
      new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }),
    );
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByText("logo.svg")).toBeInTheDocument();

    await user.upload(
      picker,
      new File(["00"], "logo.png", { type: "image/png" }),
    );
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByText("logo.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /glass/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /plain/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /blur/i })).toBeInTheDocument();
  });

  it("takes a GIF as the mark source and, where there is no ImageDecoder, previews its first frame off an image", async () => {
    const user = userEvent.setup();
    stubMediaLoading("decodes");
    stubProperties(HTMLImageElement.prototype, {
      naturalWidth: { get: () => 480 },
      naturalHeight: { get: () => 270 },
    });
    const drawImage = stubCanvas();
    const fetchMock = stubPreviewFetch();

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

    const frame = screen.getByLabelText(/first frame/i);
    expect(frame.tagName).toBe("CANVAS");
    await waitFor(() =>
      expect(drawImage).toHaveBeenCalledWith(
        expect.any(HTMLImageElement),
        0,
        0,
      ),
    );
    expect(screen.getByLabelText(/watermark preview/i)).toHaveStyle({
      aspectRatio: "480 / 270",
    });

    await waitFor(() =>
      expect(screen.getByAltText(/watermarked frame/i)).toHaveAttribute(
        "src",
        "blob:mock",
      ),
    );
    // A canvas always draws an animated image's first frame, so one is all
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/preview",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]?.body as string).frame,
    ).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("takes a photo as the mark source and previews it off an image, whatever decoders the browser has", async () => {
    const user = userEvent.setup();
    stubMediaLoading("decodes");
    // An <img> reports its EXIF-rotated size: a phone's upright shot
    stubProperties(HTMLImageElement.prototype, {
      naturalWidth: { get: () => 1080 },
      naturalHeight: { get: () => 1920 },
    });
    // Must be passed over: only an <img> honours EXIF orientation
    stubImageDecoder(1, 0);
    const drawImage = stubCanvas();
    const fetchMock = stubPreviewFetch();

    await renderApp("/mark");
    const picker = screen.getByLabelText(/choose video or image/i);
    expect(picker.getAttribute("accept")).toMatch(/image\/jpeg.*\.webp/);
    await user.upload(
      picker,
      new File(["00"], "photo.jpg", { type: "image/jpeg" }),
    );
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.png", { type: "image/png" }),
    );
    expect(screen.getByRole("button", { name: /^mark$/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );

    await waitFor(() =>
      expect(screen.getByAltText(/watermarked frame/i)).toHaveAttribute(
        "src",
        "blob:mock",
      ),
    );
    expect(screen.getByLabelText(/watermark preview/i)).toHaveStyle({
      aspectRatio: "1080 / 1920",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const [image] of drawImage.mock.calls) {
      expect(image).toBeInstanceOf(HTMLImageElement);
    }
    expect(screen.getByRole("slider", { hidden: true })).toBeInTheDocument();
  });

  it("asks no quality of a PNG, which comes back lossless, and sends it like any source", async () => {
    const user = userEvent.setup();
    const image = new File(["00"], "shot.png", { type: "image/png" });
    const logo = new File(["00"], "logo.png", { type: "image/png" });
    uploadMock.mockImplementation(async (name: string) => ({
      url: blobFor(name),
    }));
    const fetchMock = markFetchMock(blobFor("results/shot_marked-xyz.png"));
    vi.stubGlobal("fetch", fetchMock);

    await renderApp("/mark");
    expect(screen.getByRole("slider", { hidden: true })).toBeInTheDocument();
    await user.upload(screen.getByLabelText(/choose video/i), image);
    expect(
      screen.queryByRole("slider", { hidden: true }),
    ).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText(/choose watermark/i), logo);
    await user.click(screen.getByRole("button", { name: /^mark$/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/process",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    const processBody = JSON.parse(
      (fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]
        ?.body as string) ?? "{}",
    );
    expect(processBody).toMatchObject({
      tool: "mark",
      filename: "shot.png",
      blobUrl: blobFor("shot.png"),
      watermarkUrl: blobFor("logo.png"),
    });
  });

  it("takes a WebP whichever kind it is", async () => {
    const user = userEvent.setup();
    await renderApp("/mark");
    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.png", { type: "image/png" }),
    );
    const button = screen.getByRole("button", { name: /^mark$/i });

    for (const [name, animated] of [
      ["sticker.webp", true],
      ["photo.webp", false],
    ] as const) {
      await user.upload(
        screen.getByLabelText(/choose video/i),
        webpFile(name, animated),
      );
      // Its header is in by now, and said nothing against it
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(button).toHaveAttribute("aria-disabled", "false");
    }
  });

  it("previews the first frame through the server once both are picked, and again when filter mode changes", async () => {
    const user = userEvent.setup();
    stubMediaLoading("decodes");
    stubProperties(HTMLVideoElement.prototype, {
      videoWidth: { get: () => 1280 },
      videoHeight: { get: () => 720 },
    });
    stubCanvas();
    const fetchMock = stubPreviewFetch();

    await renderApp("/mark");
    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "clip.mp4", { type: "video/mp4" }),
    );
    expect(
      screen.queryByLabelText(/watermark preview/i),
    ).not.toBeInTheDocument();

    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.png", { type: "image/png" }),
    );
    const preview = screen.getByLabelText(/watermark preview/i);
    expect(screen.getByLabelText(/first frame/i).tagName).toBe("CANVAS");

    // jsdom's video has no duration, so only one frame is grabbed
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/preview",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ filter: "glass", size: "large" });
    expect(body.frame).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.logo).toMatch(/^data:image\/png;base64,/);
    await waitFor(() =>
      expect(
        within(preview).getByAltText(/watermarked frame/i),
      ).toHaveAttribute("src", "blob:mock"),
    );

    await user.click(screen.getByRole("button", { name: /blur/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      JSON.parse(fetchMock.mock.calls[1][1]?.body as string),
    ).toMatchObject({ filter: "blur", size: "large" });

    await user.click(screen.getByRole("button", { name: /small/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(
      JSON.parse(fetchMock.mock.calls[2][1]?.body as string),
    ).toMatchObject({ filter: "blur", size: "small" });
  });

  it("previews the displacement map or the clear glass from debug mode, one at a time, and the mark again once debug mode is left", async () => {
    const user = userEvent.setup();
    stubMediaLoading("decodes");
    stubProperties(HTMLVideoElement.prototype, {
      videoWidth: { get: () => 1280 },
      videoHeight: { get: () => 720 },
    });
    stubCanvas();
    const fetchMock = stubPreviewFetch();
    const view = (call: number) =>
      JSON.parse(fetchMock.mock.calls[call][1]?.body as string).view;

    await renderApp("/mark");
    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "clip.mp4", { type: "video/mp4" }),
    );
    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.png", { type: "image/png" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(view(0)).toBe("render");

    // Shift+D, off the file input where it would type a capital D
    await user.click(document.body);
    await user.keyboard("{Shift>}D{/Shift}");
    const displacement = await screen.findByRole("switch", {
      name: /depth map/i,
    });
    await user.click(displacement);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(view(1)).toBe("displacement");

    const clear = screen.getByRole("switch", { name: /pure glass/i });
    await user.click(clear);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(view(2)).toBe("clear");
    expect(clear).toBeChecked();
    expect(displacement).not.toBeChecked();

    await user.keyboard("{Shift>}D{/Shift}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(view(3)).toBe("render");
  });

  it("shows the frame's own note, and asks the server for nothing, when the browser can't decode the source", async () => {
    const user = userEvent.setup();
    stubMediaLoading("fails");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await renderApp("/mark");
    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "clip.avi", { type: "video/x-msvideo" }),
    );
    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.png", { type: "image/png" }),
    );

    const preview = screen.getByLabelText(/watermark preview/i);
    expect(
      await within(preview).findByText(/can.t preview this format/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(preview).toHaveAttribute("aria-busy", "false"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("grabs five evenly spaced frames of a GIF source through ImageDecoder", async () => {
    const user = userEvent.setup();
    // 100 frames of 0.1 s
    stubImageDecoder(100, 100);
    const drawImage = stubCanvas();
    const fetchMock = stubPreviewFetch();

    await renderApp("/mark");
    await user.upload(
      screen.getByLabelText(/choose video/i),
      gifFile("anim.gif"),
    );
    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.png", { type: "image/png" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    // Grabs are drawn scaled (five args), the bare frame unscaled (three)
    const drawn = (args: number) =>
      drawImage.mock.calls
        .filter((call) => call.length === args)
        .map(([image]) => (image as FakeFrame).frameIndex);
    expect(drawn(5)).toEqual([0, 20, 40, 60, 80]);
    await waitFor(() => expect(drawn(3)).toEqual([0]));
    const preview = screen.getByLabelText(/watermark preview/i);
    expect(preview.parentElement!.lastElementChild!.children).toHaveLength(5);
  });

  it("grabs five evenly spaced frames and scrubs through their renders as the pointer crosses the preview", async () => {
    const user = userEvent.setup();
    const seeks: number[] = [];
    stubMediaLoading("decodes");
    stubProperties(HTMLVideoElement.prototype, {
      videoWidth: { get: () => 1280 },
      videoHeight: { get: () => 720 },
      duration: { get: () => 10 },
      currentTime: {
        get: () => 0,
        set: (time: number) => seeks.push(time),
      },
    });
    stubCanvas();
    // A URL per render, to tell the slots apart
    let renders = 0;
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) =>
      blob instanceof Blob && blob.type === "image/jpeg"
        ? `blob:render-${renders++}`
        : "blob:mock",
    );
    const fetchMock = stubPreviewFetch();

    await renderApp("/mark");
    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "clip.mp4", { type: "video/mp4" }),
    );
    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.png", { type: "image/png" }),
    );

    // The loaded frame, then four seeks a fifth of the clip apart
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(seeks).toEqual([2, 4, 6, 8]);

    const preview = screen.getByLabelText(/watermark preview/i);
    await waitFor(() =>
      expect(preview.querySelectorAll("img")).toHaveLength(5),
    );
    const first = within(preview).getByAltText(/watermarked frame/i);

    const strips = preview.parentElement!.lastElementChild!.children;
    expect(strips).toHaveLength(5);
    fireEvent.pointerEnter(strips[3]);
    const scrubbed = within(preview).getByAltText(/watermarked frame/i);
    expect(scrubbed).not.toBe(first);

    fireEvent.pointerEnter(strips[0]);
    expect(within(preview).getByAltText(/watermarked frame/i)).toBe(first);
  });

  it("says it is loading until every render of a set has landed, and keeps the last set up meanwhile", async () => {
    const user = userEvent.setup();
    stubMediaLoading("decodes");
    stubProperties(HTMLVideoElement.prototype, {
      videoWidth: { get: () => 1280 },
      videoHeight: { get: () => 720 },
      duration: { get: () => 10 },
      currentTime: { get: () => 0, set: () => {} },
    });
    stubCanvas();
    // A URL of its own per blob, to tell the sets apart
    let urls = 0;
    URL.createObjectURL = vi.fn(() => `blob:url-${urls++}`);
    const answers: Array<() => void> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (input !== "/api/preview")
        throw new Error(`Unexpected fetch: ${input}`);
      return new Promise<Response>((resolve) =>
        answers.push(() =>
          resolve(
            new Response(new Blob(["jpg"], { type: "image/jpeg" }), {
              status: 200,
            }),
          ),
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const answer = (count: number) =>
      answers.splice(0, count).forEach((respond) => respond());
    const sources = (preview: HTMLElement) =>
      [...preview.querySelectorAll("img")].map((img) => img.src);

    await renderApp("/mark");
    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "clip.mp4", { type: "video/mp4" }),
    );
    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.png", { type: "image/png" }),
    );

    // Loading from the first logo on; four renders of five put nothing up
    const preview = screen.getByLabelText(/watermark preview/i);
    expect(preview).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(answers).toHaveLength(5));
    answer(4);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sources(preview)).toEqual([]);
    expect(preview).toHaveAttribute("aria-busy", "true");

    answer(1);
    await waitFor(() => expect(sources(preview)).toHaveLength(5));
    expect(preview).toHaveAttribute("aria-busy", "false");
    const firstSet = sources(preview);

    // A change asks for a new set: the last one stays whole until then
    await user.click(screen.getByRole("button", { name: /plain/i }));
    expect(preview).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(answers).toHaveLength(5));
    answer(4);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sources(preview)).toEqual(firstSet);
    expect(preview).toHaveAttribute("aria-busy", "true");

    answer(1);
    await waitFor(() => expect(preview).toHaveAttribute("aria-busy", "false"));
    const secondSet = sources(preview);
    expect(secondSet).toHaveLength(5);
    expect(secondSet.filter((src) => firstSet.includes(src))).toEqual([]);
  });

  it("uploads the video then the watermark and requests a blurred watermark", async () => {
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
    await user.click(screen.getByRole("button", { name: /blur/i }));
    await user.click(screen.getByRole("button", { name: /small/i }));
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
      options: { filter: "blur", size: "small", quality: 100 },
    });
  });
});
