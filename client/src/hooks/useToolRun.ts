import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ToolId } from "@src/tools";
import { extensionOf, splitExtension } from "@src/helpers";
import { runEngine } from "@src/engine";
import { InputError } from "@videotools/core/errors";
import { verboseName } from "@videotools/core/formats";
import { useMessage } from "./useMessage";

// `extras`: further inputs after the sources (mark's logo).
// `onDone`: once the result is saved.
interface RunRequest {
  files: File[];
  extras?: File[];
  options: Record<string, unknown>;
  onDone?: () => void;
}

// A failed run's message names what kind of InputError stopped it; its text
// is the body. Any other failure says what it is in one line.
const ERROR_EXCERPTS: Record<InputError["code"], string> = {
  "unsupported-source": "Unsupported file",
  "unreadable-source": "Unreadable file",
  "too-long": "Video too long",
  "too-large": "Too large to encode",
  "invalid-option": "Invalid setting",
  "invalid-watermark": "Unusable watermark",
};

// Temporary: the "verbose" setting names downloads after their settings.
export const VerboseNames = createContext(false);

// The "command line" setting shows each page's settings as the CLI's command
// (ToolPanel).
export const CommandLine = createContext(false);

export function useToolRun(tool: ToolId) {
  const verbose = useContext(VerboseNames);
  const [busy, setBusy] = useState(false);
  // How far (0–1) the run's encode has got.
  const [progress, setProgress] = useState(0);
  // Why the last run failed, posted as an error message until the next run
  // or pick.
  const [error, setError] = useState<Error | null>(null);
  useMessage({
    kind: "error",
    excerpt: error && (error instanceof InputError ? ERROR_EXCERPTS[error.code] : error.message),
    body: error instanceof InputError && error.message,
  });

  // Also aborted on unmount: a tab switch unmounts the page.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async ({ files, extras = [], options, onDone }: RunRequest) => {
    if (abortRef.current) return;
    setBusy(true);
    setProgress(0);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      const [result] = await runEngine(
        { tool, files: [...files, ...extras], options },
        signal,
        setProgress,
      );
      const objectUrl = URL.createObjectURL(result);
      const a = Object.assign(document.createElement("a"), {
        href: objectUrl,
        download: verbose
          ? verboseName(
              splitExtension(files[0].name)[0].slice(0, 6),
              extras.map((file) => file.name),
              options,
              extensionOf(result.name),
            )
          : result.name,
      });
      a.click();
      URL.revokeObjectURL(objectUrl);

      onDone?.();
    } catch (err: unknown) {
      // Aborted = cancelled on purpose: no error message.
      if (!signal.aborted) {
        console.error(err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  // Never rejects: a failure ends up in error.
  const start = (request: RunRequest) => void run(request);

  const cancel = () => abortRef.current?.abort();

  const clearError = () => setError(null);

  return { busy, progress, clearError, start, cancel };
}

export type ToolRun = ReturnType<typeof useToolRun>;
