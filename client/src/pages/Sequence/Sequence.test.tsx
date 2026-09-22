import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import { renderApp, uploadMock } from "../../test/renderApp";

describe("Sequence", () => {
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

  // The zone takes any image, and an animated WebP is one to the browser:
  // only its header tells it apart, and ffmpeg has no decoder for it.
  it("turns a pick with an animated WebP in it away once its header is read", async () => {
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

    await renderApp("/sequence");
    const picker = screen.getByLabelText(/choose images/i);
    await user.upload(picker, [
      new File(["00"], "a.png", { type: "image/png" }),
      webp("b.webp", 0x02),
    ]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /animated webp format not supported/i,
    );
    expect(
      screen.getByRole("button", { name: /create video/i }),
    ).toHaveAttribute("aria-disabled", "true");

    // A still WebP is an image like any other
    await user.upload(picker, [webp("c.webp", 0x10)]);
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /create video/i }),
    ).toHaveAttribute("aria-disabled", "false");
  });

  // ffmpeg reads a sequence through one image demuxer, so a pick that mixes
  // formats comes back with frames blank or missing: it is turned away.
  it("turns a pick of mixed formats away", async () => {
    const user = userEvent.setup();
    await renderApp("/sequence");
    const picker = screen.getByLabelText(/choose images/i);
    await user.upload(picker, [
      new File(["00"], "a.png", { type: "image/png" }),
      new File(["00"], "b.jpg", { type: "image/jpeg" }),
    ]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /mixed formats are not supported/i,
    );
    expect(
      screen.getByRole("button", { name: /create video/i }),
    ).toHaveAttribute("aria-disabled", "true");

    // Files of one format go through
    await user.upload(picker, [
      new File(["00"], "c.jpg", { type: "image/jpeg" }),
      new File(["00"], "d.jpeg", { type: "image/jpeg" }),
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /create video/i }),
    ).toHaveAttribute("aria-disabled", "false");
  });
});
