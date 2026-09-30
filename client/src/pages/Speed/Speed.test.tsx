import { screen, fireEvent } from "@testing-library/react";
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

describe("Speed", () => {
  it("requests a speed change with the slider value", async () => {
    const user = userEvent.setup();
    uploadMock.mockResolvedValue({ url: blobUrl("clip-abc.mp4") });
    const fetchMock = stubProcessFetch();

    await renderApp("/speed");
    await user.upload(screen.getByLabelText(/choose video/i), file("clip.mp4", "video/mp4"));
    // No userEvent slider support; jsdom has no layout, so Base UI keeps the
    // thumb visibility:hidden.
    fireEvent.change(screen.getByRole("slider", { hidden: true }), {
      target: { value: "1" },
    });
    await user.click(screen.getByRole("button", { name: /change speed/i }));

    await runFinished(fetchMock);
    expect(postedBody(fetchMock)).toMatchObject({
      tool: "speed",
      blobUrl: blobUrl("clip-abc.mp4"),
      filename: "clip.mp4",
      options: { speed: 1 },
    });
  });
});
