import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, describe } from "vitest";
import { postedBody, renderApp, runFinished, stubProcessFetch, uploads } from "@src/test/renderApp";
import { file } from "@src/test/media";
import { targetsFor } from "@src/sourceFormat";

const convertButton = () => screen.getByRole("button", { name: /^convert$/i });

describe("Convert", () => {
  it("requests a GIF conversion with the GIF options", async () => {
    const user = userEvent.setup();
    const fetchMock = stubProcessFetch();

    await renderApp("/convert");
    expect(screen.queryByLabelText(/convert to/i)).not.toBeInTheDocument();

    await user.upload(screen.getByLabelText(/choose video/i), file("clip.mov", "video/quicktime"));
    await user.click(screen.getByLabelText(/convert to/i));
    await user.click(await screen.findByRole("option", { name: /gif/i }));
    expect(screen.getByLabelText(/fps/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/width/i)).toBeInTheDocument();
    await user.click(convertButton());

    await runFinished();
    const body = postedBody(fetchMock);
    expect(body).toMatchObject({
      tool: "convert",
      upload: uploads(fetchMock)[0].id,
      filename: "clip.mov",
    });
    // Empty fps is omitted: the server matches the source framerate
    expect(body.options).toEqual({ target: "gif", quality: 100, width: 640 });
  });

  it("falls to the first other target when the source claims the default", async () => {
    const user = userEvent.setup();
    const mp4 = file("tiny.mp4", "video/mp4");
    const fetchMock = stubProcessFetch();

    await renderApp("/convert");
    await user.upload(screen.getByLabelText(/choose video/i), mp4);
    await user.click(convertButton());

    await runFinished();
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
