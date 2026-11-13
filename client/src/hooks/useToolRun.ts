import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ToolId } from "@src/tools";
import { extensionOf } from "@src/helpers";
import { runEngine } from "@src/engine";
import { verboseName } from "@videotools/core/formats";

// `extras`: further inputs after the sources (mark's logo).
// `onDone`: once the result is saved.
interface RunRequest {
  files: File[];
  extras?: File[];
  options: Record<string, unknown>;
  onDone?: () => void;
}

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
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Also aborted on unmount: a tab switch unmounts the page.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async ({ files, extras = [], options, onDone }: RunRequest) => {
    if (abortRef.current) return;
    setBusy(true);
    setProgress(0);
    setErrorDetail(null);

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
              files[0].name,
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
      // Aborted = cancelled on purpose: no error box.
      if (!signal.aborted) {
        console.error(err);
        setErrorDetail(err instanceof Error ? err.message : String(err));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  // Never rejects: a failure ends up in errorDetail.
  const start = (request: RunRequest) => void run(request);

  const cancel = () => abortRef.current?.abort();

  const clearError = () => setErrorDetail(null);

  return { busy, progress, errorDetail, clearError, start, cancel };
}

export type ToolRun = ReturnType<typeof useToolRun>;
