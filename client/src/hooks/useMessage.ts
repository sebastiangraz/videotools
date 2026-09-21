import { useEffect, useId, type ReactNode } from "react";
import { messages, type MessageKind } from "../components/Message/messageStore";

// Says `content` in the app's message area (components/Message) for as long
// as there is any: nothing (null, false) takes the message down, and so does
// unmounting. For messages that come out of logic; <Message> is the same
// thing for markup.
export const useMessage = (
  content: ReactNode,
  kind: MessageKind = "default",
) => {
  const id = useId();
  const silent = content == null || content === false;
  // Every render, so the content follows its props. The area is no ancestor
  // of the caller, so telling it can't come back round as another render.
  useEffect(() => {
    if (silent) messages.remove(id);
    else messages.set(id, { kind, content });
  });
  useEffect(() => () => messages.remove(id), [id]);
};
