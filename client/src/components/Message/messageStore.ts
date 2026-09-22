import type { ReactNode } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";

// The app's one spot for in-app messages: a card over the header's title
// (MessageArea). Two things speak through it. A MessageTrigger says something
// for as long as it is hovered or focused — the tabs' descriptions — and a
// <Message> anywhere in the app says something for as long as it is mounted,
// which overrides the former: the page that has a problem to report renders
// one, and stops when the problem is gone.
//
// There is one title, so both halves are module singletons rather than
// context. Lives in its own module (not next to the components) so Vite Fast
// Refresh can hot-swap the components that import it.

// `default` just says something; `error` names a problem the user has to fix
// and gets the warning mark in front.
export type MessageKind = "default" | "error";
export type MessageEntry = { kind: MessageKind; content: ReactNode };

// Ties the MessageTriggers to the area's card; a trigger's payload is what it
// has to say.
export const messageHandle = PreviewCard.createHandle<ReactNode>();

type Snapshot = {
  // A <Message> is up.
  active: boolean;
  // The newest one. It outlives `active` so the card still has something to
  // show while it animates out; the area forgets it once the card is closed.
  message: MessageEntry | null;
};

// The mounted <Message>s by id, in the order they mounted.
const entries = new Map<string, MessageEntry>();
const listeners = new Set<() => void>();
let snapshot: Snapshot = { active: false, message: null };

const publish = (next: Snapshot) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

const update = () => {
  const newest = [...entries.values()].pop() ?? null;
  publish({ active: newest !== null, message: newest ?? snapshot.message });
};

export const messages = {
  set(id: string, entry: MessageEntry) {
    entries.set(id, entry);
    update();
  },
  remove(id: string) {
    if (entries.delete(id)) update();
  },
  forget() {
    if (!snapshot.active && snapshot.message) {
      publish({ active: false, message: null });
    }
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => snapshot,
};
