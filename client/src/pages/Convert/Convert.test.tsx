import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, describe } from "vitest";
import {
  renderApp,
  uploadMock, blobUrl, postedBody, runFinished, stubProcessFetch,
} from "../../test/renderApp";

describe("Convert", () => {
  it("offers convert targets minus the source format and requests a GIF conversion", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "clip.mov", { type: "video/quicktime" });

    uploadMock.mockResolvedValue({
      url: blobUrl("clip-abc.mov"),
    });
    const fetchMock = stubProcessFetch(blobUrl("results/clip_converted-xyz.gif"));

    await renderApp("/convert");
    expect(screen.queryByText(/convert to/i)).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText(/choose video/i), file);
    await user.click(screen.getByLabelText(/convert to/i));
    expect(
      await screen.findByRole("option", { name: /mp4/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /mov/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /gif/i }));

    expect(screen.getByLabelText(/fps/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/width/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^convert$/i }));

    await runFinished(fetchMock);
    const processBody = postedBody(fetchMock);
    expect(processBody).toMatchObject({
      tool: "convert",
      blobUrl: blobUrl("clip-abc.mov"),
      filename: "clip.mov",
    });
    // Empty fps is omitted: the server matches the source framerate
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
      url: blobUrl("tiny-abc.mp4"),
    });
    const fetchMock = stubProcessFetch(blobUrl("results/tiny_converted-xyz.webm"));

    await renderApp("/convert");
    await user.upload(screen.getByLabelText(/choose video/i), file);
    // The default target mp4 is the source format, so WebM takes over
    await user.click(screen.getByRole("button", { name: /^convert$/i }));

    await runFinished(fetchMock);
    const processBody = postedBody(fetchMock);
    expect(processBody.tool).toBe("convert");
    expect(processBody.options).toEqual({ target: "webm", quality: 100 });
  });

  it("accepts a format the app does not write, with no blocker and every target", async () => {
    const user = userEvent.setup();

    await renderApp("/convert");
    await user.upload(
      screen.getByLabelText(/choose video/i),
      new File(["00"], "clip.avi", { type: "video/x-msvideo" }),
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^convert$/i })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await user.click(screen.getByLabelText(/convert to/i));
    expect(await screen.findAllByRole("option")).toHaveLength(6);
  });
});
