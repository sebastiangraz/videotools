import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, describe } from "vitest";
import {
  renderApp,
  uploadMock, blobUrl, postedBody, runFinished, stubProcessFetch,
} from "../../test/renderApp";

describe("Speed", () => {
  it("requests a speed change with the slider value", async () => {
    const user = userEvent.setup();
    const file = new File(["00"], "clip.mp4", { type: "video/mp4" });

    uploadMock.mockResolvedValue({
      url: blobUrl("clip-abc.mp4"),
    });
    const fetchMock = stubProcessFetch(blobUrl("results/clip_speed-xyz.mp4"));

    await renderApp("/speed");
    await user.upload(screen.getByLabelText(/choose video/i), file);
    // No userEvent slider support; jsdom has no layout, so Base UI keeps the
    // thumb visibility:hidden.
    fireEvent.change(screen.getByRole("slider", { hidden: true }), {
      target: { value: "1" },
    });
    await user.click(screen.getByRole("button", { name: /change speed/i }));

    await runFinished(fetchMock);
    const processBody = postedBody(fetchMock);
    expect(processBody).toMatchObject({
      tool: "speed",
      blobUrl: blobUrl("clip-abc.mp4"),
      filename: "clip.mp4",
      options: { speed: 1 },
    });
  });
});
