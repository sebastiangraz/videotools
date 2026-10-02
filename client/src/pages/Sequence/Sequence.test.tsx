import { fireEvent, screen, waitFor } from "@testing-library/react";
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
import { file, imageFile, stubCanvas, stubImageDecoder } from "../../test/media";

const createButton = () => screen.getByRole("button", { name: /create video/i });

// NumberField parses with the runtime locale: type its decimal separator
const decimal = (whole: number, tenths: number) =>
  `${whole}${(1.1).toLocaleString().charAt(1)}${tenths}`;

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

  it("plays the pick at the time per frame in a preview card", async () => {
    const user = userEvent.setup();
    stubImageDecoder(1, 0);
    const drawImage = stubCanvas();
    await renderApp("/sequence");
    await user.upload(screen.getByLabelText(/choose images/i), [
      imageFile("a.png", "image/png"),
      imageFile("b.png", "image/png"),
    ]);
    expect(screen.queryByLabelText(/sequence preview/i)).not.toBeInTheDocument();
    // The first image, small, is the upload's thumbnail
    await waitFor(() =>
      expect(drawImage).toHaveBeenCalledWith(
        expect.objectContaining({ frameIndex: 0 }),
        0,
        0,
        128,
        72,
      ),
    );

    fireEvent.change(screen.getByLabelText(/time per frame/i), {
      target: { value: decimal(0, 1) },
    });
    await user.hover(screen.getByLabelText(/time per frame/i));
    const preview = await screen.findByLabelText(/sequence preview/i);
    expect(preview.tagName).toBe("CANVAS");
    // The card is shaped like the first image; one still after another in it
    expect(preview.parentElement).toHaveStyle({ aspectRatio: "16 / 9" });
    await waitFor(() => expect(drawImage.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(preview).toHaveProperty("width", 480);
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
