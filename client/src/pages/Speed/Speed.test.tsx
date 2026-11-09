import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect, describe } from "vitest";
import { engineRun, renderApp, stubEngine } from "@src/test/renderApp";
import { file } from "@src/test/media";

vi.mock("@src/engine", async (original) => ({
  ...(await original<typeof import("@src/engine")>()),
  runEngine: vi.fn(),
}));

describe("Speed", () => {
  it("requests a speed change with the slider value", async () => {
    const user = userEvent.setup();
    stubEngine();

    await renderApp("/speed");
    await user.upload(screen.getByLabelText(/choose video/i), file("clip.mp4", "video/mp4"));
    // No userEvent slider support; jsdom has no layout, so Base UI keeps the
    // thumb visibility:hidden.
    fireEvent.change(screen.getByRole("slider", { hidden: true }), {
      target: { value: "1" },
    });
    await user.click(screen.getByRole("button", { name: /change speed/i }));

    expect(await engineRun()).toMatchObject({
      tool: "speed",
      filename: "clip.mp4",
      body: { options: { speed: 1 } },
    });
  });
});
