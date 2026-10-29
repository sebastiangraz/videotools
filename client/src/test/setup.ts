import { vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// VersionLabel's GitHub fetch on mount would show up in tests' fetch counts, depending
// on network and a sessionStorage cache.
vi.mock("@src/components/VersionLabel/VersionLabel", () => ({
  VersionLabel: () => null,
}));

// Likewise the engine's health probe, which retries until the engine answers.
vi.mock("@src/hooks/useEngine", () => ({
  useEngine: () => ({ health: undefined, uninstall: async () => {} }),
}));

// jsdom has no PointerEvent; Base UI's Switch dispatches one on click.
if (!("PointerEvent" in window)) {
  vi.stubGlobal("PointerEvent", class PointerEvent extends MouseEvent {});
}

// jsdom has no matchMedia; Layout reads the system colour scheme.
window.matchMedia ??= (query) => ({ matches: false, media: query }) as MediaQueryList;

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  // jsdom implements neither of these
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
  // Nor scrolling (the router always scrolls to top) or anchor navigation
  // (the download click); jsdom logs both as stderr errors.
  window.scrollTo = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
