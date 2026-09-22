import { vi, beforeEach } from "vitest";
import { upload } from "@vercel/blob/client";
import "@testing-library/jest-dom/vitest";

// Uploads never leave the test run; tests reach the mock as `uploadMock`
// (see renderApp.tsx).
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));

// The footer's version label asks GitHub for the branch tip the moment the
// app mounts, and every test that mounts the app stubs `fetch` and counts
// what it is asked for. That call is nothing a test is about, and whether it
// shows up at all comes down to the network: the answer is cached in
// sessionStorage for the rest of the file, so one machine sees it once and
// another (offline, or rate-limited by GitHub) sees it in every test. The
// label renders nothing until the version lands, so tests lose nothing by
// standing it down.
vi.mock("../components/VersionLabel/VersionLabel", () => ({
  VersionLabel: () => null,
}));

// jsdom has no PointerEvent; Base UI's Switch dispatches one on click. (The
// api tests run under node, where there is no window to patch.)
if (typeof window !== "undefined" && !("PointerEvent" in window)) {
  vi.stubGlobal("PointerEvent", class PointerEvent extends MouseEvent {});
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(upload).mockReset();
  // jsdom implements neither of these
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});
