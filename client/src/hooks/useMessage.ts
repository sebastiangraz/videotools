import { useEffect, useId } from "react";
import { InputError } from "@videotools/core/errors";
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

// Says the browser can't decode a picked file, so its page shows no preview.
export const useUndecodableMessage = (undecodable: boolean) =>
  useMessage({ excerpt: undecodable && "Can’t preview this format." });

// An InputError's message names its kind; its text is the body. Any other
// error says what it is in one line.
const INPUT_ERROR_EXCERPTS: Record<InputError["code"], string> = {
  "unsupported-source": "Unsupported file",
  "unreadable-source": "Unreadable file",
  "too-long": "Video too long",
  "too-large": "Too large to encode",
  "invalid-option": "Invalid setting",
  "invalid-watermark": "Unusable watermark",
};

// Shows `error` as an error message while it is set.
export const useErrorMessage = (error: Error | null) =>
  useMessage({
    kind: "error",
    excerpt:
      error && (error instanceof InputError ? INPUT_ERROR_EXCERPTS[error.code] : error.message),
    body: error instanceof InputError && error.message,
  });
