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
});
