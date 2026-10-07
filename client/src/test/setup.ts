import { vi, beforeEach } from "vitest";
import { upload } from "@vercel/blob/client";
import "@testing-library/jest-dom/vitest";

// Tests reach this as `uploadMock` (renderApp.tsx).
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));

// VersionLabel's GitHub fetch on mount would show up in tests' fetch counts, depending
// on network and a sessionStorage cache.
vi.mock("../components/VersionLabel/VersionLabel", () => ({
  VersionLabel: () => null,
}));

// jsdom has no PointerEvent; Base UI's Switch dispatches one on click.
if (!("PointerEvent" in window)) {
  vi.stubGlobal("PointerEvent", class PointerEvent extends MouseEvent {});
}

// jsdom has no matchMedia; Layout reads the system colour scheme.
window.matchMedia ??= (query) => ({ matches: false, media: query }) as MediaQueryList;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(upload).mockReset();
  // jsdom implements neither of these
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  // Nor scrolling (the router always scrolls to top) or anchor navigation
  // (the download click); jsdom logs both as stderr errors.
  window.scrollTo = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
