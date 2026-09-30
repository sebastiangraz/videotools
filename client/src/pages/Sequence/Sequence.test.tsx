import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, describe } from "vitest";
import {
  renderApp,
  uploadMock, blobUrl, postedBody, runFinished, stubProcessFetch,
} from "../../test/renderApp";
import { webpFile } from "../../test/media";

describe("Sequence", () => {
  it("uploads images in filename order and requests an image sequence", async () => {
    const user = userEvent.setup();
    const fileB = new File(["00"], "b.png", { type: "image/png" });
    const fileA = new File(["00"], "a.png", { type: "image/png" });

    uploadMock.mockImplementation(async (name: string) => ({
      url: `https://store.public.blob.vercel-storage.com/${name}`,
    }));
    const fetchMock = stubProcessFetch(blobUrl("results/a_video-xyz.gif"));

    await renderApp("/sequence");
    await user.upload(screen.getByLabelText(/choose images/i), [fileB, fileA]);
    await user.click(screen.getByLabelText(/output format/i));
    await user.click(await screen.findByRole("option", { name: /gif/i }));
    await user.click(screen.getByRole("button", { name: /create video/i }));

    await runFinished(fetchMock);
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
    const processBody = postedBody(fetchMock);
    expect(processBody).toMatchObject({
      tool: "sequence",
      filename: "a.png",
      blobUrls: [
        blobUrl("a.png"),
        blobUrl("b.png"),
      ],
      options: { frameDuration: 1, format: "gif", quality: 100 },
    });
  });

  it("takes WebP images whichever kind they are", async () => {
    const user = userEvent.setup();
    await renderApp("/sequence");
    await user.upload(screen.getByLabelText(/choose images/i), [
      webpFile("a.webp", 0x10),
      webpFile("b.webp", 0x02),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create video/i }),
    ).toHaveAttribute("aria-disabled", "false");
  });

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
