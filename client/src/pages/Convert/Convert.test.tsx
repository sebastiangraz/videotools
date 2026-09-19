import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import { renderApp, uploadMock } from "../../test/renderApp";

describe("Convert", () => {
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
});
