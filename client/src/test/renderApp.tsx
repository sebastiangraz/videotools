import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { upload } from "@vercel/blob/client";
import { expect, vi, type Mock } from "vitest";
import { createAppRouter } from "../App";

// Loosely typed: tests resolve it with just the fields the app reads ({ url }).
export const uploadMock = upload as unknown as Mock;

export const blobUrl = (name: string) =>
  `https://store.public.blob.vercel-storage.com/${name}`;

export const renderApp = async (initialPath = "/loop") => {
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [initialPath] }),
  );
  render(<RouterProvider router={router} />);
  await screen.findAllByRole("button");
  return router;
};

export type FetchMock = Mock<typeof fetch>;

// A run that succeeds: /api/process answers with `resultUrl`, the result
// downloads, and the cleanup DELETE goes through.
export const stubProcessFetch = (resultUrl = blobUrl("results/out-xyz")) => {
  const fetchMock: FetchMock = vi.fn(async (input, init) => {
    if (input === "/api/process" && init?.method === "POST") {
      return Response.json({ url: resultUrl, filename: "out" });
    }
    if (input === resultUrl) return new Response(new Blob(["result"]));
    if (input === "/api/process" && init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

// The cleanup DELETE is the last request a run makes.
export const runFinished = (fetchMock: FetchMock) =>
  waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/process",
      expect.objectContaining({ method: "DELETE" }),
    ),
  );

// The JSON body of the nth POST.
export const postedBody = (fetchMock: FetchMock, nth = 0) => {
  const posts = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "POST",
  );
  return JSON.parse(posts[nth][1]!.body as string);
};
