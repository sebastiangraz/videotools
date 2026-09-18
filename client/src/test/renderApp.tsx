import { render, screen } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { upload } from "@vercel/blob/client";
import type { Mock } from "vitest";
import { createAppRouter } from "../App";

// Mocked for every test file in setup.ts. Loosely typed on purpose: tests
// resolve it with just the fields the app reads ({ url }).
export const uploadMock = upload as unknown as Mock;

// Mounts the full app (router + tabs + tool page) at the given URL and
// waits for the tool page to render (pages have several buttons now that
// Base UI menus and number-field steppers render as buttons).
export const renderApp = async (initialPath = "/loop") => {
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [initialPath] }),
  );
  render(<RouterProvider router={router} />);
  await screen.findAllByRole("button");
  return router;
};
