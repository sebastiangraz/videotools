import { render, screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { expect, vi } from "vitest";
import { createAppRouter } from "@src/App";
import { runEngine } from "@src/engine";
import type { EngineRequest } from "@src/engine/worker";

export const renderApp = async (initialPath = "/loop") => {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [initialPath] }));
  render(<RouterProvider router={router} />);
  await screen.findAllByRole("button");
  return router;
};

export const enableVerboseNames = async (user: UserEvent) => {
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(await screen.findByRole("button", { name: "Enabled" }));
};

// The result is saved through a clicked link (setup.ts stubs the click).
export const downloadedName = () =>
  (vi.spyOn(HTMLAnchorElement.prototype, "click").mock.contexts.at(-1) as HTMLAnchorElement)
    .download;

// The engine (mocked in setup.ts) answers with a file called `name`.
export const stubEngine = (name = "out.mp4") =>
  vi.mocked(runEngine).mockResolvedValue(new File(["result"], name));

// The tool run the engine got, once its result is saved (Mark's previews go
// through the engine too).
export const engineRun = async () => {
  await waitFor(() => expect(downloadedName()).toBeTruthy());
  const requests = vi.mocked(runEngine).mock.calls.map(([request]) => request);
  return requests.find((request) => "tool" in request) as Extract<EngineRequest, { tool: unknown }>;
};

// NumberField parses with the runtime locale: type its decimal separator
export const decimal = (whole: number, tenths: number) =>
  `${whole}${(1.1).toLocaleString().charAt(1)}${tenths}`;
