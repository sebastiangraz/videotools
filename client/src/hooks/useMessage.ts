import { useEffect, useId, type ReactNode } from "react";
import { messages, type MessageKind } from "../components/Message/messageStore";

// Shows `content` in the message area until it is empty or the caller
// unmounts. The hook form of <Message>.
export const useMessage = (
  content: ReactNode,
  kind: MessageKind = "default",
) => {
  const id = useId();
  const silent = content == null || content === false;
  // Every render, so content follows props; the area is no ancestor of the
  // caller, so this can't loop.
  useEffect(() => {
    if (silent) messages.remove(id);
    else messages.set(id, { kind, content });
  });
  useEffect(() => () => messages.remove(id), [id]);
};
