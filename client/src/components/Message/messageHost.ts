import { createContext, useCallback, useMemo, useState } from "react";

// The app's one spot for in-app messages: a slot over the header's title,
// where the tab descriptions also show. A <Message> anywhere below the layout
// renders into the slot through a portal, so what it says stays live (links,
// state) and stays up for exactly as long as it is mounted: the page that has
// something to say renders it, and stops when the problem is gone.
//
// Lives in its own module (not next to the component) so Vite Fast Refresh
// can hot-swap the components that import it.
export type MessageHost = {
  // The slot's element; null until the layout has mounted it.
  slot: HTMLElement | null;
  // Counts a message in for as long as it is up; returns its way out.
  register: () => () => void;
};

export const MessageContext = createContext<MessageHost | null>(null);

// The layout's side: `host` goes to MessageContext.Provider, `setSlot` is the
// slot element's ref, and `active` says a message is up — it overrides the
// tab descriptions, which share the spot.
export const useMessageHost = () => {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [count, setCount] = useState(0);

  const register = useCallback(() => {
    setCount((c) => c + 1);
    return () => setCount((c) => c - 1);
  }, []);

  const host = useMemo(() => ({ slot, register }), [slot, register]);
  return { host, setSlot, active: count > 0 };
};
