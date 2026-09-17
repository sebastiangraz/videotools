import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { createAppRouter } from "./App";
import { vi, it, expect, describe, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob/client", () => ({ upload: uploadMock }));

// jsdom has no PointerEvent; Base UI's Switch dispatches one on click
if (!("PointerEvent" in window)) {
  vi.stubGlobal("PointerEvent", class PointerEvent extends MouseEvent {});
}

beforeEach(() => {
  vi.restoreAllMocks();
  uploadMock.mockReset();
  // jsdom implements neither of these
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

// Mounts the full app (router + tabs + uploader) at the given URL and
// waits for the tool page to render (pages have several buttons now that
// Base UI menus and number-field steppers render as buttons).
const renderApp = async (initialPath = "/loop") => {
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [initialPath] }),
  );
  render(<RouterProvider router={router} />);
  await screen.findAllByRole("button");
  return router;
};

describe("VideoToolUploader", () => {
  // The button is aria-disabled rather than natively disabled, so that a
  // tooltip can explain the state on hover
  it("disables the button until a file is chosen", async () => {
    await renderApp();
    const btn = screen.getByRole("button", { name: /^loop$/i });
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });

  it("enables the button after picking a file", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    await renderApp();

    const input = screen.getByLabelText(/choose video/i);
    await user.upload(input, file);

    expect(screen.getByRole("button", { name: /^loop$/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("explains the disabled button in a tooltip, until a file is picked", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    await renderApp();

    await user.hover(screen.getByRole("button", { name: /^loop$/i }));
    expect(await screen.findByText(/upload a file/i)).toBeInTheDocument();

    await user.unhover(screen.getByRole("button", { name: /^loop$/i }));
    await user.upload(screen.getByLabelText(/choose video/i), file);

    await user.hover(screen.getByRole("button", { name: /^loop$/i }));
    await waitFor(() =>
      expect(screen.queryByText(/upload a file/i)).not.toBeInTheDocument(),
    );
  });

  // The drop zone is the <label> wrapping the aria-labelled file input
  const getDropZone = (pickerLabel: RegExp) =>
    screen.getByLabelText(pickerLabel).closest("label")!;

  it("accepts a dropped file and enables the button", async () => {
    const file = new File(["00"], "dropped.mp4", { type: "video/mp4" });
    await renderApp();

    fireEvent.drop(getDropZone(/choose video/i), {
      dataTransfer: { files: [file] },
    });

    expect(screen.getByText("dropped.mp4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^loop$/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("ignores dropped files that don't match the tool's accept list", async () => {
    const file = new File(["00"], "photo.png", { type: "image/png" });
    await renderApp();

    fireEvent.drop(getDropZone(/choose video/i), {
      dataTransfer: { files: [file] },
    });

    expect(screen.queryByText("photo.png")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^loop$/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("keeps only the first dropped file on single-file tools", async () => {
    const first = new File(["00"], "first.mp4", { type: "video/mp4" });
    const second = new File(["00"], "second.mp4", { type: "video/mp4" });
    await renderApp();

    fireEvent.drop(getDropZone(/choose video/i), {
      dataTransfer: { files: [first, second] },
    });

    expect(screen.getByText("first.mp4")).toBeInTheDocument();
    expect(screen.queryByText(/2 files/i)).not.toBeInTheDocument();
  });

  it("accepts multiple dropped images on the sequence tool", async () => {
    const fileA = new File(["00"], "a.png", { type: "image/png" });
    const fileB = new File(["00"], "b.png", { type: "image/png" });
    await renderApp("/sequence");

    fireEvent.drop(getDropZone(/choose images/i), {
      dataTransfer: { files: [fileA, fileB] },
    });

    expect(screen.getByText(/2 files/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create video/i }),
    ).toHaveAttribute("aria-disabled", "false");
  });

  it("switches tool and clears the picked file when a tab is clicked", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    const router = await renderApp();

    await user.upload(screen.getByLabelText(/choose video/i), file);
    expect(screen.getByRole("button", { name: /^loop$/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );

    await user.click(screen.getByRole("tab", { name: /sequence/i }));
    expect(
      await screen.findByRole("button", { name: /create video/i }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(router.state.location.pathname).toBe("/sequence");
  });

  it("redirects / to /loop", async () => {
    const router = await renderApp("/");
    expect(router.state.location.pathname).toBe("/loop");
  });

  it("redirects unknown tools to /loop", async () => {
    const router = await renderApp("/does-not-exist");
    expect(router.state.location.pathname).toBe("/loop");
  });

  it("uploads to blob storage, requests processing, and downloads the result", async () => {
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
    await user.click(screen.getByRole("button", { name: /^loop$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/process",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(uploadMock).toHaveBeenCalledWith(
      "tiny.mp4",
      file,
      expect.objectContaining({ handleUploadUrl: "/api/upload" }),
    );
    const processBody = JSON.parse(
      (fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]
        ?.body as string) ?? "{}",
    );
    expect(processBody).toMatchObject({
      blobUrl: "https://store.public.blob.vercel-storage.com/tiny-abc.mp4",
      tool: "loop",
      filename: "tiny.mp4",
      options: {
        technique: "crossfade",
        fadeDuration: 0.5,
        startSecond: 0,
        quality: 100,
      },
    });
  });

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
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);

    // Hidden until the user reaches for the field
    expect(
      screen.queryByLabelText(/start frame preview/i),
    ).not.toBeInTheDocument();

    // The preview lives in a Base UI PreviewCard triggered from the input
    await user.hover(screen.getByLabelText(/start at/i));
    const preview = await screen.findByLabelText(/start frame preview/i);
    expect(preview).toHaveAttribute("src", "blob:mock");
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
    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);

    await user.hover(screen.getByLabelText(/start at/i));
    const preview = await screen.findByLabelText(/start frame preview/i);
    // jsdom never decodes media; simulate the failure browsers report for
    // containers <video> can't play (AVI, WMV, …)
    fireEvent.error(preview);

    expect(
      await screen.findByText(/can.t preview this format/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/start frame preview/i),
    ).not.toBeInTheDocument();
  });

  it("shows an expandable error box when processing fails", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "anim.gif", { type: "image/gif" });

    uploadMock.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/anim-abc.gif",
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response(JSON.stringify({ error: "ffmpeg exited with 1" }), {
          status: 500,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderApp("/sequence");
    await user.upload(screen.getByLabelText(/choose images/i), file);
    await user.click(screen.getByRole("button", { name: /create video/i }));

    // Generic message first; the underlying error hides behind the disclosure
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/you broke it my dude/i);
    expect(screen.getByText(/ffmpeg exited with 1/i)).not.toBeVisible();
    // The upload is of no use after a failure, so it is released
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/process",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({
          urls: ["https://store.public.blob.vercel-storage.com/anim-abc.gif"],
        }),
      }),
    );

    await user.click(screen.getByText(/you broke it my dude/i));
    expect(screen.getByText(/ffmpeg exited with 1/i)).toBeVisible();

    // A fresh attempt clears the stale error
    fetchMock.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/process" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              url: "https://store.public.blob.vercel-storage.com/results/anim-xyz.mp4",
              filename: "anim.mp4",
            }),
            { status: 200 },
          );
        }
        return new Response(new Blob(["video"], { type: "video/mp4" }), {
          status: 200,
        });
      },
    );
    await user.click(screen.getByRole("button", { name: /create video/i }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("uploads images in filename order and requests an image sequence", async () => {
    const user = userEvent.setup();
    const fileB = new File(["00"], "b.png", { type: "image/png" });
    const fileA = new File(["00"], "a.png", { type: "image/png" });

    uploadMock.mockImplementation(async (name: string) => ({
      url: `https://store.public.blob.vercel-storage.com/${name}`,
    }));
    const resultUrl =
      "https://store.public.blob.vercel-storage.com/results/a_video-xyz.gif";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/process" && init?.method === "POST") {
          return new Response(
            JSON.stringify({ url: resultUrl, filename: "a_video.gif" }),
            { status: 200 },
          );
        }
        if (input === resultUrl) {
          return new Response(new Blob(["gif"], { type: "image/gif" }), {
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

    await renderApp("/sequence");
    await user.upload(screen.getByLabelText(/choose images/i), [fileB, fileA]);
    // Format dropdown is a Base UI Select: open the trigger, pick an option
    await user.click(screen.getByLabelText(/output format/i));
    await user.click(await screen.findByRole("option", { name: /gif/i }));
    await user.click(screen.getByRole("button", { name: /create video/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/process",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(uploadMock).toHaveBeenNthCalledWith(
      1,
      "a.png",
      fileA,
      expect.anything(),
    );
    expect(uploadMock).toHaveBeenNthCalledWith(
      2,
      "b.png",
      fileB,
      expect.anything(),
    );
    const processBody = JSON.parse(
      (fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]
        ?.body as string) ?? "{}",
    );
    expect(processBody).toMatchObject({
      tool: "sequence",
      filename: "a.png",
      blobUrls: [
        "https://store.public.blob.vercel-storage.com/a.png",
        "https://store.public.blob.vercel-storage.com/b.png",
      ],
      options: { frameDuration: 1, format: "gif", quality: 100 },
    });
  });

  it("requests a speed change with the slider value", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "clip.mp4", { type: "video/mp4" });

    uploadMock.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/clip-abc.mp4",
    });
    const resultUrl =
      "https://store.public.blob.vercel-storage.com/results/clip_speed-xyz.mp4";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/process" && init?.method === "POST") {
          return new Response(
            JSON.stringify({ url: resultUrl, filename: "clip_speed.mp4" }),
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

    await renderApp("/speed");
    await user.upload(screen.getByLabelText(/choose video/i), file);
    // userEvent has no slider support — set the thumb's range input directly.
    // jsdom has no layout, so Base UI keeps the thumb visibility:hidden
    // (edge alignment needs measurements); include hidden elements.
    fireEvent.change(screen.getByRole("slider", { hidden: true }), {
      target: { value: "1" },
    });
    await user.click(screen.getByRole("button", { name: /change speed/i }));

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
      tool: "speed",
      blobUrl: "https://store.public.blob.vercel-storage.com/clip-abc.mp4",
      filename: "clip.mp4",
      options: { speed: 1 },
    });
  });

  it("offers convert targets minus the source format and requests a GIF conversion", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "clip.mov", { type: "video/quicktime" });

    uploadMock.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/clip-abc.mov",
    });
    const resultUrl =
      "https://store.public.blob.vercel-storage.com/results/clip_converted-xyz.gif";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/process" && init?.method === "POST") {
          return new Response(
            JSON.stringify({ url: resultUrl, filename: "clip_converted.gif" }),
            { status: 200 },
          );
        }
        if (input === resultUrl) {
          return new Response(new Blob(["gif"], { type: "image/gif" }), {
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

    await renderApp("/convert");
    // The dropdown depends on the picked file's format, so it waits for one
    expect(screen.queryByText(/convert to/i)).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText(/choose video/i), file);
    // Open the target menu: the source's own format is not offered
    await user.click(screen.getByLabelText(/convert to/i));
    expect(
      await screen.findByRole("option", { name: /mp4/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /mov/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /gif/i }));

    // GIF-only controls appear with the target
    expect(screen.getByLabelText(/fps/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/width/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^convert$/i }));

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
      tool: "convert",
      blobUrl: "https://store.public.blob.vercel-storage.com/clip-abc.mov",
      filename: "clip.mov",
    });
    // fps is absent when the field is left empty — the server then matches
    // the source framerate
    expect(processBody.options).toEqual({
      target: "gif",
      quality: 100,
      width: 640,
    });
  });

  it("defaults to the first non-source target and omits GIF options", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });

    uploadMock.mockResolvedValue({
      url: "https://store.public.blob.vercel-storage.com/tiny-abc.mp4",
    });
    const resultUrl =
      "https://store.public.blob.vercel-storage.com/results/tiny_converted-xyz.webm";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/process" && init?.method === "POST") {
          return new Response(
            JSON.stringify({ url: resultUrl, filename: "tiny_converted.webm" }),
            { status: 200 },
          );
        }
        if (input === resultUrl) {
          return new Response(new Blob(["video"], { type: "video/webm" }), {
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

    await renderApp("/convert");
    await user.upload(screen.getByLabelText(/choose video/i), file);
    // MP4 source: the default target "mp4" is excluded, so WebM takes over
    await user.click(screen.getByRole("button", { name: /^convert$/i }));

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
    expect(processBody.tool).toBe("convert");
    // Exact match: fps/width must not tag along for non-GIF targets
    expect(processBody.options).toEqual({ target: "webm", quality: 100 });
  });

  // A request that never settles on its own, only rejecting once its signal
  // is aborted — the shape of an upload or encode the user wants out of.
  const hangUntilAborted = <T,>(signal?: AbortSignal | null) =>
    new Promise<T>((_, reject) => {
      signal?.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    });

  it("fades in a Stop button while a run is in flight and cancels it on click", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });
    const uploadedUrl =
      "https://store.public.blob.vercel-storage.com/tiny-abc.mp4";

    uploadMock.mockResolvedValue({ url: uploadedUrl });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (input === "/api/process" && init?.method === "POST") {
          return hangUntilAborted<Response>(init.signal);
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
    // Hidden (and so out of the accessibility tree) until a run starts
    expect(
      screen.queryByRole("button", { name: /^stop$/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^loop$/i }));
    const stop = await screen.findByRole("button", { name: /^stop$/i });
    expect(stop).toBeVisible();
    expect(screen.getByRole("button", { name: /processing/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.click(stop);

    // Back to the idle state: action button usable again, no error box,
    // and the request itself was aborted
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^loop$/i })).toHaveAttribute(
        "aria-disabled",
        "false",
      ),
    );
    expect(
      screen.queryByRole("button", { name: /^stop$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const postInit = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    )?.[1];
    expect(postInit?.signal?.aborted).toBe(true);
    // The upload it had already made is swept up
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/process",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ urls: [uploadedUrl] }),
        }),
      ),
    );
  });

  it("aborts an in-flight upload when the tool is switched", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "tiny.mp4", { type: "video/mp4" });

    let uploadSignal: AbortSignal | undefined;
    uploadMock.mockImplementation(
      (_name: string, _file: File, opts: { abortSignal?: AbortSignal }) => {
        uploadSignal = opts.abortSignal;
        return hangUntilAborted(opts.abortSignal);
      },
    );

    await renderApp();
    await user.upload(screen.getByLabelText(/choose video/i), file);
    await user.click(screen.getByRole("button", { name: /^loop$/i }));
    expect(uploadSignal?.aborted).toBe(false);

    // The route remounts the uploader per tool, so leaving the tab must not
    // leave the request running
    await user.click(screen.getByRole("tab", { name: /sequence/i }));
    await screen.findByRole("button", { name: /create video/i });
    expect(uploadSignal?.aborted).toBe(true);
  });

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

  it("waits for a video and a watermark on the mark tool, offering filter mode only for alpha formats", async () => {
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

    // JPEG can't carry transparency, so there is no shape for the glass
    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.jpg", { type: "image/jpeg" }),
    );
    expect(button).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByText("logo.jpg")).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /filter mode/i }),
    ).not.toBeInTheDocument();

    await user.upload(
      screen.getByLabelText(/choose watermark/i),
      new File(["00"], "logo.png", { type: "image/png" }),
    );
    expect(
      screen.getByRole("switch", { name: /filter mode/i }),
    ).toBeInTheDocument();
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

      // Once the browser has a decoded frame it is grabbed and sent, with
      // the logo, to be composited by the real graph
      fireEvent(frame, new Event("loadeddata"));
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
      await user.click(screen.getByRole("switch", { name: /filter mode/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(
        JSON.parse(fetchMock.mock.calls[1][1]?.body as string),
      ).toMatchObject({ filter: true });
    } finally {
      sizes.forEach((restore) => restore());
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
    await user.click(screen.getByRole("switch", { name: /filter mode/i }));
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
