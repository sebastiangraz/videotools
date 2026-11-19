import { useEffect, useId } from "react";
import { messages, type MessageEntry } from "@src/components/Message/messageStore";

// Shows `message` in the message area until its excerpt is empty or the
// caller unmounts. The hook form of <Message>.
export const useMessage = (message: MessageEntry) => {
  const id = useId();
  const silent = message.excerpt == null || message.excerpt === false;
  // Every render, so the message follows props; the area is no ancestor of
  // the caller, so this can't loop.
  useEffect(() => {
    if (silent) messages.remove(id);
    else messages.set(id, message);
  });
  useEffect(() => () => messages.remove(id), [id]);
};
