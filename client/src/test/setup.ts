import { vi, beforeEach } from "vitest";
import { upload } from "@vercel/blob/client";
import "@testing-library/jest-dom/vitest";

// Uploads never leave the test run; tests reach the mock as `uploadMock`
// (see renderApp.tsx).
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));

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
