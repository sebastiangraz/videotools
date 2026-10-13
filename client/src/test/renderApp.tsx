import { render, screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { upload } from "@vercel/blob/client";
import { expect, vi, type Mock } from "vitest";
import { createAppRouter } from "@src/App";

// Loosely typed: tests resolve it with just the fields the app reads ({ url }).
export const uploadMock = upload as unknown as Mock;

export const blobUrl = (name: string) => `https://store.public.blob.vercel-storage.com/${name}`;

export const renderApp = async (initialPath = "/loop") => {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [initialPath] }));
  render(<RouterProvider router={router} />);
  await screen.findAllByRole("button");
  return router;
};

export type FetchMock = Mock<typeof fetch>;

export const unexpectedFetch = (input: RequestInfo | URL) =>
  new Error(`Unexpected fetch: ${input instanceof Request ? input.url : input.toString()}`);

// A run that succeeds: /api/process answers with `resultUrl`, the result
// downloads, and the cleanup DELETE goes through.
export const stubProcessFetch = (resultUrl = blobUrl("results/out-xyz")) => {
  const fetchMock: FetchMock = vi.fn(async (input, init) => {
    if (input === "/api/process" && init?.method === "POST") {
      return Response.json({ url: resultUrl, filename: "out.mp4" });
    }
    if (input === resultUrl) return new Response(new Blob(["result"]));
    if (input === "/api/process" && init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    throw unexpectedFetch(input);
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

export const enableVerboseNames = async (user: UserEvent) => {
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(await screen.findByRole("button", { name: "Enabled" }));
};

// The result is saved through a clicked link (setup.ts stubs the click).
export const downloadedName = () =>
  (vi.spyOn(HTMLAnchorElement.prototype, "click").mock.contexts.at(-1) as HTMLAnchorElement)
    .download;

// The JSON body of the nth POST.
export const postedBody = (fetchMock: FetchMock, nth = 0) => {
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  return JSON.parse(posts[nth][1]!.body as string);
};

// NumberField parses with the runtime locale: type its decimal separator
export const decimal = (whole: number, tenths: number) =>
  `${whole}${(1.1).toLocaleString().charAt(1)}${tenths}`;
