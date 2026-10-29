import { render, screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { expect, vi, type Mock } from "vitest";
import { createAppRouter } from "@src/App";
import { ENGINE_URL } from "@src/helpers";

export const engineUrl = (path: string) => `${ENGINE_URL}${path}`;

export const renderApp = async (initialPath = "/loop") => {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [initialPath] }));
  render(<RouterProvider router={router} />);
  await screen.findAllByRole("button");
  return router;
};

export type FetchMock = Mock<typeof fetch>;

export const unexpectedFetch = (input: RequestInfo | URL) =>
  new Error(`Unexpected fetch: ${input instanceof Request ? input.url : input.toString()}`);

const isUpload = (input: RequestInfo | URL, init?: RequestInit) =>
  typeof input === "string" && input.startsWith(engineUrl("/upload/")) && init?.method === "PUT";

// A run that succeeds: the engine takes the uploads and answers /process
// with the result, named out.mp4.
export const stubProcessFetch = () => {
  const fetchMock: FetchMock = vi.fn(async (input, init) => {
    if (isUpload(input, init)) return new Response(null, { status: 204 });
    if (input === engineUrl("/process") && init?.method === "POST") {
      return new Response("result", { headers: { "X-Filename": "out.mp4" } });
    }
    throw unexpectedFetch(input);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

// Each upload in order: the id it went under and the file sent.
export const uploads = (fetchMock: FetchMock) =>
  fetchMock.mock.calls
    .filter(([input, init]) => isUpload(input, init))
    .map(([input, init]) => ({ id: (input as string).split("/").at(-1), file: init?.body }));

// The download is the last thing a run does.
export const runFinished = () => waitFor(() => expect(downloadedName()).toBeDefined());

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
