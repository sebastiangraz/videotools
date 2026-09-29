import { useSyncExternalStore } from "react";

// Debug mode exists on the local dev server only: Vite sets DEV for `vite`
// (which `vercel dev` runs) and clears it for `vite build`, so no deployment
// can ever switch it on, and everything behind it drops out of the bundle.
const AVAILABLE = import.meta.env.DEV;

// One mode for the whole app, however many components ask after it.
let debug = false;
const listeners = new Set<() => void>();

const toggle = () => {
  debug = !debug;
  document.body.toggleAttribute("data-debug", debug);
  listeners.forEach((listener) => listener());
};

// Shift+D, but not while typing (it is a capital D there) nor as part of
// another shortcut.
const onKeyDown = (event: KeyboardEvent) => {
  if (
    event.code !== "KeyD" ||
    !event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.repeat
  ) {
    return;
  }
  const target = event.target as HTMLElement | null;
  if (
    target?.isContentEditable ||
    target?.closest("input, textarea, select")
  ) {
    return;
  }
  toggle();
};

// The shortcut listens for as long as anyone is subscribed.
const subscribe = (listener: () => void) => {
  if (!AVAILABLE) return () => {};
  if (listeners.size === 0) window.addEventListener("keydown", onKeyDown);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("keydown", onKeyDown);
  };
};

const getSnapshot = () => AVAILABLE && debug;

// Whether debug mode is on; Shift+D flips it and `[data-debug]` on <body>
// follows. Only the mode itself: what a page shows for it is the page's call.
export const useDebugMode = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => false);
