import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import { renderApp, uploadMock } from "../../test/renderApp";

describe("Speed", () => {
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
});
