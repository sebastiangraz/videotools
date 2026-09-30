import { screen } from "@testing-library/react";
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
import { file } from "../../test/media";

const createButton = () =>
  screen.getByRole("button", { name: /create video/i });

describe("Sequence", () => {
  it("uploads the images and requests an image sequence", async () => {
    const user = userEvent.setup();
    uploadMock.mockImplementation(async (name: string) => ({
      url: blobUrl(name),
    }));
    const fetchMock = stubProcessFetch();

    await renderApp("/sequence");
    await user.upload(screen.getByLabelText(/choose images/i), [
      file("a.png", "image/png"),
      file("b.png", "image/png"),
    ]);
    await user.click(screen.getByLabelText(/output format/i));
    await user.click(await screen.findByRole("option", { name: /gif/i }));
    await user.click(createButton());

    await runFinished(fetchMock);
    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(postedBody(fetchMock)).toMatchObject({
      tool: "sequence",
      filename: "a.png",
      blobUrls: [blobUrl("a.png"), blobUrl("b.png")],
      options: { frameDuration: 1, format: "gif", quality: 100 },
    });
  });

  it("turns a pick of mixed formats away", async () => {
    const user = userEvent.setup();
    await renderApp("/sequence");
    await user.upload(screen.getByLabelText(/choose images/i), [
      file("a.png", "image/png"),
      file("b.jpg", "image/jpeg"),
    ]);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(createButton()).toHaveAttribute("aria-disabled", "true");
  });
});
