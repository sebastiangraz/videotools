import { screen, waitFor, fireEvent } from "@testing-library/react";
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

describe("Loop", () => {
  // NumberField parses typed values with the runtime locale, so type the
  // locale's own decimal separator ("." in en-US, "," in sv-SE, …).
  it("accepts decimal values in number fields", async () => {
    const sep = (1.1).toLocaleString().charAt(1);
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });

    uploadMock.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/tiny-abc.mp4",
    });
    const resultUrl =
      "https://store.public.blob.vercel-storage.com/results/tiny_loop-xyz.mp4";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/process" && init?.method === "POST") {
          return new Response(
            JSON.stringify({ url: resultUrl, filename: "tiny_loop.mp4" }),
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
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);
    fireEvent.change(screen.getByLabelText(/fade duration/i), {
      target: { value: `0${sep}7` },
    });
    fireEvent.change(screen.getByLabelText(/start at/i), {
      target: { value: `1${sep}5` },
    });
    await user.click(screen.getByRole("button", { name: /^loop$/i }));

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
    expect(processBody.options).toMatchObject({
      fadeDuration: 0.7,
      startSecond: 1.5,
    });
  });

  it("shows a start-frame preview card when hovering the Start at input", async () => {
    const user = userEvent.setup();
    // jsdom neither decodes nor seeks: answer the load and every seek, and
    // stand in for the canvas
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
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);

    // Hidden until the user reaches for the field
    expect(
      screen.queryByLabelText(/start frame preview/i),
    ).not.toBeInTheDocument();

    // The preview lives in a Base UI PreviewCard triggered from the input
    await user.hover(screen.getByLabelText(/start at/i));
    // One canvas, whatever the source: the frame is drawn off a <video>
    // that is never in the page
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

    // The frame follows the field
    const sep = (1.1).toLocaleString().charAt(1);
    fireEvent.change(screen.getByLabelText(/start at/i), {
      target: { value: `1${sep}5` },
    });
    await waitFor(() => expect(seeks).toEqual([1.5]));
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2));
  });

  it("draws the frame of a GIF showing at the start second, through ImageDecoder", async () => {
    const user = userEvent.setup();
    // 20 frames of 0.1 s
    stubImageDecoder(20, 100);
    const drawImage = stubCanvas();
    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), gifFile("a.gif"));

    await user.hover(screen.getByLabelText(/start at/i));
    const preview = await screen.findByLabelText(/start frame preview/i);
    expect(preview.tagName).toBe("CANVAS");
    const drawn = () =>
      drawImage.mock.calls.map(([image]) => (image as FakeFrame).frameIndex);
    await waitFor(() => expect(drawn()).toEqual([0]));

    const sep = (1.1).toLocaleString().charAt(1);
    fireEvent.change(screen.getByLabelText(/start at/i), {
      target: { value: `1${sep}5` },
    });
    await waitFor(() => expect(drawn()).toEqual([0, 15]));

    // Past the end, the last frame (a <video> clamps the same way)
    fireEvent.change(screen.getByLabelText(/start at/i), {
      target: { value: "9" },
    });
    await waitFor(() => expect(drawn()).toEqual([0, 15, 19]));
  });

  it("wheel-scrubs the preview-wrapped Start at field after picking a video", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);

    // Wheel scrub requires the input to be focused; one wheel tick steps by
    // `step` (0.1). The listener is a native one NumberField.Root attaches to
    // the input node, so it must survive the preview card appearing around
    // the input when a video is picked.
    const start = screen.getByLabelText(/start at/i) as HTMLInputElement;
    start.focus();
    fireEvent.wheel(start, { deltaY: -1 });
    expect(start.value).toMatch(/0[.,]1/);

    const fade = screen.getByLabelText(/fade duration/i) as HTMLInputElement;
    fade.focus();
    fireEvent.wheel(fade, { deltaY: -1 });
    expect(fade.value).toMatch(/0[.,]6/);
  });

  it("shows an error in the preview card when the browser can't decode the video", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "clip.avi", { type: "video/x-msvideo" });
    // jsdom never decodes media; simulate the failure browsers report for
    // containers <video> can't play (AVI, WMV, …)
    stubMediaLoading("fails");
    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);

    await user.hover(screen.getByLabelText(/start at/i));
    expect(
      await screen.findByText(/can.t preview this format/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/start frame preview/i),
    ).not.toBeInTheDocument();
  });

  it("says nothing about a file that comes back in its own format", async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "anim.gif", { type: "image/gif" }),
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^loop$/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("sends a format the app doesn't write through convert, before any upload", async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "clip.avi", { type: "video/x-msvideo" }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      /AVI files can be read but not written/i,
    );
    expect(
      screen.getByRole("link", { name: /convert it first/i }),
    ).toHaveAttribute("href", "/convert");

    const button = screen.getByRole("button", { name: /^loop$/i });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.click(button);
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
