import { useSyncExternalStore } from "react";

let debug = false;
const listeners = new Set<() => void>();

const toggle = () => {
  debug = !debug;
  document.body.toggleAttribute("data-debug", debug);
  listeners.forEach((listener) => listener());
};

// Not while typing (a capital D there) nor as part of another shortcut.
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
  if (target?.isContentEditable || target?.closest("input, textarea, select")) {
    return;
  }
  toggle();
};

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) window.addEventListener("keydown", onKeyDown);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("keydown", onKeyDown);
  };
};

const getSnapshot = () => debug;

// Shift+D flips it; `[data-debug]` on <body> follows.
export const useDebugMode = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => false);
