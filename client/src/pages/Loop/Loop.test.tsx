import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, describe } from "vitest";
import {
  blobUrl,
  postedBody,
  renderApp,
  runFinished,
  stubProcessFetch,
  uploadMock,
} from "../../test/renderApp";
import {
  file,
  stubCanvas,
  stubMediaLoading,
  stubProperties,
  stubVideoFrame,
  webpFile,
} from "../../test/media";

const pick = (user: ReturnType<typeof userEvent.setup>, picked: File) =>
  user.upload(screen.getByLabelText(/choose video/i), picked);
const loopButton = () => screen.getByRole("button", { name: /^loop$/i });

// NumberField parses with the runtime locale: type its decimal separator
const decimal = (whole: number, tenths: number) =>
  `${whole}${(1.1).toLocaleString().charAt(1)}${tenths}`;

describe("Loop", () => {
  it("accepts decimal values in number fields", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ url: blobUrl("tiny-abc.mp4") });
    const fetchMock = stubProcessFetch();

    await renderApp();
    await pick(user, file("tiny.mp4", "video/mp4"));
    fireEvent.change(screen.getByLabelText(/fade duration/i), {
      target: { value: decimal(0, 7) },
    });
    fireEvent.change(screen.getByLabelText(/start at/i), {
      target: { value: decimal(1, 5) },
    });
    await user.click(loopButton());

    await runFinished(fetchMock);
    expect(postedBody(fetchMock).options).toMatchObject({
      fadeDuration: 0.7,
      startSecond: 1.5,
    });
  });

  it("shows a start-frame preview card when hovering the Start at input", async () => {
    const user = userEvent.setup();
    const seeks: number[] = [];
    stubMediaLoading("decodes");
    stubProperties(HTMLVideoElement.prototype, {
      videoWidth: { get: () => 1280 },
      videoHeight: { get: () => 720 },
      currentTime: {
        get: () => 0,
        set: (time: number) => seeks.push(time),
      },
    });
    const drawImage = stubCanvas();
    await renderApp();
    await pick(user, file("tiny.mp4", "video/mp4"));

    expect(
      screen.queryByLabelText(/start frame preview/i),
    ).not.toBeInTheDocument();

    await user.hover(screen.getByLabelText(/start at/i));
    const preview = await screen.findByLabelText(/start frame preview/i);
    expect(preview.tagName).toBe("CANVAS");
    await waitFor(() =>
      expect(drawImage).toHaveBeenCalledWith(
        expect.any(HTMLVideoElement),
        0,
        0,
      ),
    );
    expect(preview).toHaveProperty("width", 1280);
    expect(document.querySelector("video")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/start at/i), {
      target: { value: decimal(1, 5) },
    });
    await waitFor(() => expect(seeks).toEqual([1.5]));
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2));
  });

  it("shows an error in the preview card when the browser can't decode the video", async () => {
    const user = userEvent.setup();
    // What browsers report for containers <video> can't play (AVI, WMV, …)
    stubMediaLoading("fails");
    await renderApp();
    await pick(user, file("clip.avi", "video/x-msvideo"));

    await user.hover(screen.getByLabelText(/start at/i));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/start frame preview/i),
    ).not.toBeInTheDocument();
  });

  it("refuses a video with non-square pixels before any upload, and takes a square one", async () => {
    stubMediaLoading("decodes");
    // Played at 1710×1710, stored at whatever VideoFrame says
    stubProperties(HTMLVideoElement.prototype, {
      videoWidth: { get: () => 1710 },
      videoHeight: { get: () => 1710 },
    });
    stubVideoFrame(1710, 1080);
    const user = userEvent.setup();
    await renderApp();
    await pick(user, file("clip.mp4", "video/mp4"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(loopButton()).toHaveAttribute("aria-disabled", "true");
    await user.click(loopButton());
    expect(uploadMock).not.toHaveBeenCalled();

    stubVideoFrame(1710, 1710);
    await pick(user, file("square.mp4", "video/mp4"));
    await waitFor(() =>
      expect(loopButton()).toHaveAttribute("aria-disabled", "false"),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends a format the app doesn't write through convert, before any upload", async () => {
    const user = userEvent.setup();
    await renderApp();
    await pick(user, file("clip.avi", "video/x-msvideo"));

    const message = screen.getByRole("alert");
    expect(screen.getByRole("main")).not.toContainElement(message);
    expect(
      within(message).getByRole("link", { name: /converted/i }),
    ).toHaveAttribute("href", "/convert");

    expect(loopButton()).toHaveAttribute("aria-disabled", "true");
    await user.click(loopButton());
    expect(uploadMock).not.toHaveBeenCalled();
  });

  // A .webp may be either kind; a still one is refused once its header says so.
  it("takes an animated WebP and sends a still one through convert", async () => {
    const user = userEvent.setup();
    await renderApp();

    await pick(user, webpFile("sticker.webp", 0x02));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(loopButton()).toHaveAttribute("aria-disabled", "false");

    await pick(user, webpFile("photo.webp", 0x10));
    const message = await screen.findByRole("alert");
    expect(
      within(message).getByRole("link", { name: /converted/i }),
    ).toHaveAttribute("href", "/convert");
    expect(loopButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("takes the message down when the tab is left", async () => {
    const user = userEvent.setup();
    await renderApp();
    await pick(user, file("clip.avi", "video/x-msvideo"));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /converted/i }));
    await screen.findByRole("button", { name: /^convert$/i });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
