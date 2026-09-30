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
import { targetsFor } from "../../sourceFormat";

const convertButton = () => screen.getByRole("button", { name: /^convert$/i });

describe("Convert", () => {
  it("requests a GIF conversion with the GIF options", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ url: blobUrl("clip-abc.mov") });
    const fetchMock = stubProcessFetch();

    await renderApp("/convert");
    expect(screen.queryByLabelText(/convert to/i)).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText(/choose video/i), file("clip.mov", "video/quicktime"));
    await user.click(screen.getByLabelText(/convert to/i));
    await user.click(await screen.findByRole("option", { name: /gif/i }));
    expect(screen.getByLabelText(/fps/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/width/i)).toBeInTheDocument();
    await user.click(convertButton());

    await runFinished(fetchMock);
    const body = postedBody(fetchMock);
    expect(body).toMatchObject({
      tool: "convert",
      blobUrl: blobUrl("clip-abc.mov"),
      filename: "clip.mov",
    });
    // Empty fps is omitted: the server matches the source framerate
    expect(body.options).toEqual({ target: "gif", quality: 100, width: 640 });
  });

  it("falls to the first other target when the source claims the default", async () => {
    const user = userEvent.setup();
    const mp4 = file("tiny.mp4", "video/mp4");
    uploadMock.mockResolvedValue({ url: blobUrl("tiny-abc.mp4") });
    const fetchMock = stubProcessFetch();

    await renderApp("/convert");
    await user.upload(screen.getByLabelText(/choose video/i), mp4);
    await user.click(convertButton());

    await runFinished(fetchMock);
    expect(postedBody(fetchMock).options).toEqual({
      target: targetsFor(mp4)[0].value,
      quality: 100,
    });
  });

  it("accepts a format the app does not write, with no blocker and every target", async () => {
    const user = userEvent.setup();
    await renderApp("/convert");
    await user.upload(screen.getByLabelText(/choose video/i), file("clip.avi", "video/x-msvideo"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(convertButton()).toHaveAttribute("aria-disabled", "false");
    await user.click(screen.getByLabelText(/convert to/i));
    expect(await screen.findAllByRole("option")).toHaveLength(targetsFor(null).length);
  });
});
