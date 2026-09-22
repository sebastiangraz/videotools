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
  type FakeFrame,
} from "../../test/media";

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

  // The server's side of the preview: a JPEG for every frame posted
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
    expect(screen.getByRole("switch", { name: /glass/i })).toBeInTheDocument();
  });

  it("takes a GIF as the mark source and, where there is no ImageDecoder, previews its first frame off an image", async () => {
    const user = userEvent.setup();
    // jsdom never decodes images: answer the load, give the <img> a size and
    // stand in for the canvas the frame is drawn on and grabbed through
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

    // The same canvas as for a video carries the first frame, drawn off an
    // <img> that is never in the page, and the box takes the image's shape
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
    // The size the <img> reports is the one the photo is shown at, turned by
    // EXIF: a phone's upright shot
    stubProperties(HTMLImageElement.prototype, {
      naturalWidth: { get: () => 1080 },
      naturalHeight: { get: () => 1920 },
    });
    // There to be passed over: an <img> is what draws a photo as EXIF holds it
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
    // A still is the tool's to take: nothing to say, nothing in the way
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
    // One picture, so one render and nothing to scrub through
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const [image] of drawImage.mock.calls) {
      expect(image).toBeInstanceOf(HTMLImageElement);
    }
    // A JPEG has a quality to ask for
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

  it("turns an animated WebP away once its header is read, and lets a still one through", async () => {
    const user = userEvent.setup();
    // "RIFF" size "WEBP" "VP8X" size flags: animation is bit 1 of the flags
    const webp = (name: string, flags: number) =>
      new File(
        [
          new Uint8Array([
            ...[..."RIFF\0\0\0\0WEBPVP8X"].map((c) => c.charCodeAt(0)),
            ...[10, 0, 0, 0],
            flags,
          ]),
        ],
        name,
        { type: "image/webp" },
      );

    await renderApp("/mark");
    await user.upload(
      screen.getByLabelText(/choose video/i),
      webp("sticker.webp", 0x02),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /animated webp format not supported/i,
    );
    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.png", { type: "image/png" }),
    );
    const button = screen.getByRole("button", { name: /^mark$/i });
    expect(button).toHaveAttribute("aria-disabled", "true");

    await user.upload(
      screen.getByLabelText(/choose video/i),
      webp("photo.webp", 0x10),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    // Its header is in by now, and said nothing against it
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-disabled", "false");
  });

  it("previews the first frame through the server once both are picked, and again when filter mode changes", async () => {
    const user = userEvent.setup();
    // jsdom neither decodes video nor draws: answer the load, give the
    // <video> a size and stand in for the canvas the frame is grabbed through
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
    expect(screen.getByLabelText(/first frame/i).tagName).toBe("CANVAS");

    // Once the browser has a decoded frame it is grabbed (off a <video> of
    // its own, never in the page) and sent, with the logo, to be composited
    // by the real graph. jsdom's video has no duration, so one frame is all
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
    // Nothing is on its way, so nothing says loading
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
    // A grab is drawn at the grab's size (five arguments), the bare frame as
    // it is (three)
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
    // jsdom neither decodes nor seeks: answer the load, give the <video> a
    // size and a length, take every seek, and stand in for the canvas
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
    // The server answers when the test says so
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
    await user.click(screen.getByRole("switch", { name: /glass/i }));
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
