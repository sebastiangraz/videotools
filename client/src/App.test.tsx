import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import { renderApp, uploadMock } from "./test/renderApp";

describe("App", () => {
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
});
