import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import {
  blobUrl,
  postedBody,
  renderApp,
  runFinished,
  stubProcessFetch,
  uploadMock,
  type FetchMock,
} from "../../test/renderApp";
import {
  file,
  stubCanvas,
  stubImageDecoder,
  stubMediaLoading,
  stubProperties,
} from "../../test/media";

type User = ReturnType<typeof userEvent.setup>;
const markButton = () => screen.getByRole("button", { name: /^mark$/i });
const pickSource = (user: User, picked: File) =>
  user.upload(screen.getByLabelText(/choose video/i), picked);
const pickLogo = (user: User, picked = file("logo.png", "image/png")) =>
  user.upload(screen.getByLabelText(/choose watermark/i), picked);

const stubPreviewFetch = () => {
  const fetchMock: FetchMock = vi.fn(async (input, init) => {
    if (input === "/api/preview" && init?.method === "POST") {
      return new Response(new Blob(["jpg"], { type: "image/jpeg" }));
    }
    throw new Error(`Unexpected fetch: ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

// 1280×720, and `duration` long (jsdom's has none: one frame is grabbed).
const stubVideo = (duration?: number) => {
  stubMediaLoading("decodes");
  stubProperties(HTMLVideoElement.prototype, {
    videoWidth: { get: () => 1280 },
    videoHeight: { get: () => 720 },
    ...(duration && {
      duration: { get: () => duration },
      currentTime: { get: () => 0, set: () => {} },
    }),
  });
  stubCanvas();
};

describe("Mark", () => {
  it("waits for a video and a PNG or SVG watermark on the mark tool, then offers filter mode", async () => {
    const user = userEvent.setup();
    await renderApp("/mark");

    await pickSource(user, file("clip.mp4", "video/mp4"));
    expect(markButton()).toHaveAttribute("aria-disabled", "true");
    await user.hover(markButton());
    await waitFor(() =>
      expect(markButton()).toHaveAttribute("data-popup-open"),
    );
    await user.unhover(markButton());

    // Outside the picker's accept list
    await pickLogo(user, file("logo.gif", "image/gif"));
    expect(markButton()).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("logo.gif")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /glass/i }),
    ).not.toBeInTheDocument();

    await pickLogo(user, file("logo.svg", "image/svg+xml"));
    expect(markButton()).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByText("logo.svg")).toBeInTheDocument();

    await pickLogo(user);
    expect(markButton()).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByText("logo.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /glass/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /plain/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /blur/i })).toBeInTheDocument();
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
    await pickSource(user, file("photo.jpg", "image/jpeg"));
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await pickLogo(user);
    expect(markButton()).toHaveAttribute("aria-disabled", "false");

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
    expect(postedBody(fetchMock).frame).toMatch(/^data:image\/jpeg;base64,/);
    for (const [image] of drawImage.mock.calls) {
      expect(image).toBeInstanceOf(HTMLImageElement);
    }
    expect(screen.getByRole("slider", { hidden: true })).toBeInTheDocument();
  });

  it("asks no quality of a PNG, which comes back lossless, and sends it like any source", async () => {
    const user = userEvent.setup();
    uploadMock.mockImplementation(async (name: string) => ({
      url: blobUrl(name),
    }));
    const fetchMock = stubProcessFetch();

    await renderApp("/mark");
    expect(screen.getByRole("slider", { hidden: true })).toBeInTheDocument();
    await pickSource(user, file("shot.png", "image/png"));
    expect(
      screen.queryByRole("slider", { hidden: true }),
    ).not.toBeInTheDocument();

    await pickLogo(user);
    await user.click(markButton());
    await runFinished(fetchMock);
    expect(postedBody(fetchMock)).toMatchObject({
      tool: "mark",
      filename: "shot.png",
      blobUrl: blobUrl("shot.png"),
      watermarkUrl: blobUrl("logo.png"),
    });
  });

  it("previews the first frame through the server once both are picked, and again when filter mode changes", async () => {
    const user = userEvent.setup();
    stubVideo();
    const fetchMock = stubPreviewFetch();

    await renderApp("/mark");
    await pickSource(user, file("clip.mp4", "video/mp4"));
    expect(
      screen.queryByLabelText(/watermark preview/i),
    ).not.toBeInTheDocument();

    await pickLogo(user);
    const preview = screen.getByLabelText(/watermark preview/i);
    expect(screen.getByLabelText(/first frame/i).tagName).toBe("CANVAS");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/preview",
      expect.objectContaining({ method: "POST" }),
    );
    const body = postedBody(fetchMock);
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
    expect(postedBody(fetchMock, 1)).toMatchObject({
      filter: "blur",
      size: "large",
    });

    await user.click(screen.getByRole("button", { name: /small/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(postedBody(fetchMock, 2)).toMatchObject({
      filter: "blur",
      size: "small",
    });
  });

  it("previews the displacement map or the clear glass from debug mode, one at a time, and the mark again once debug mode is left", async () => {
    const user = userEvent.setup();
    stubVideo();
    const fetchMock = stubPreviewFetch();
    const view = (nth: number) => postedBody(fetchMock, nth).view;

    await renderApp("/mark");
    await pickSource(user, file("clip.mp4", "video/mp4"));
    await pickLogo(user);
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
    await pickSource(user, file("clip.avi", "video/x-msvideo"));
    await pickLogo(user);

    const preview = screen.getByLabelText(/watermark preview/i);
    expect(await within(preview).findByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(preview).toHaveAttribute("aria-busy", "false"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("grabs five frames and scrubs through their renders as the pointer crosses the preview", async () => {
    const user = userEvent.setup();
    stubVideo(10);
    // A URL per render, to tell the slots apart
    let renders = 0;
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) =>
      blob instanceof Blob && blob.type === "image/jpeg"
        ? `blob:render-${renders++}`
        : "blob:mock",
    );
    stubPreviewFetch();

    await renderApp("/mark");
    await pickSource(user, file("clip.mp4", "video/mp4"));
    await pickLogo(user);

    const preview = screen.getByLabelText(/watermark preview/i);
    await waitFor(() =>
      expect(preview.querySelectorAll("img")).toHaveLength(5),
    );
    const first = within(preview).getByAltText(/watermarked frame/i);

    const strips = preview.parentElement!.lastElementChild!.children;
    expect(strips).toHaveLength(5);
    fireEvent.pointerEnter(strips[3]);
    expect(within(preview).getByAltText(/watermarked frame/i)).not.toBe(first);

    fireEvent.pointerEnter(strips[0]);
    expect(within(preview).getByAltText(/watermarked frame/i)).toBe(first);
  });

  it("says it is loading until every render of a set has landed, and keeps the last set up meanwhile", async () => {
    const user = userEvent.setup();
    stubVideo(10);
    // A URL of its own per blob, to tell the sets apart
    let urls = 0;
    URL.createObjectURL = vi.fn(() => `blob:url-${urls++}`);
    const answers: Array<() => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (input !== "/api/preview")
          throw new Error(`Unexpected fetch: ${input}`);
        return new Promise<Response>((resolve) =>
          answers.push(() =>
            resolve(new Response(new Blob(["jpg"], { type: "image/jpeg" }))),
          ),
        );
      }),
    );
    const answer = (count: number) =>
      answers.splice(0, count).forEach((respond) => respond());
    const sources = (preview: HTMLElement) =>
      [...preview.querySelectorAll("img")].map((img) => img.src);

    await renderApp("/mark");
    await pickSource(user, file("clip.mp4", "video/mp4"));
    await pickLogo(user);

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
    const video = file("clip.mp4", "video/mp4");
    const logo = file("logo.png", "image/png");
    uploadMock.mockImplementation(async (name: string) => ({
      url: blobUrl(name),
    }));
    const fetchMock = stubProcessFetch();

    await renderApp("/mark");
    await pickSource(user, video);
    await pickLogo(user, logo);
    await user.click(screen.getByRole("button", { name: /blur/i }));
    await user.click(screen.getByRole("button", { name: /small/i }));
    await user.click(markButton());

    await runFinished(fetchMock);
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
    expect(postedBody(fetchMock)).toEqual({
      tool: "mark",
      filename: "clip.mp4",
      blobUrl: blobUrl("clip.mp4"),
      watermarkUrl: blobUrl("logo.png"),
      options: { filter: "blur", size: "small", quality: 100 },
    });
  });
});
