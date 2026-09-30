import { render, screen } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { upload } from "@vercel/blob/client";
import type { Mock } from "vitest";
import { createAppRouter } from "../App";

// Loosely typed: tests resolve it with just the fields the app reads ({ url }).
export const uploadMock = upload as unknown as Mock;

export const renderApp = async (initialPath = "/loop") => {
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [initialPath] }),
  );
  render(<RouterProvider router={router} />);
  await screen.findAllByRole("button");
  return router;
};
