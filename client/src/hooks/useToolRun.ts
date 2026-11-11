import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ToolId } from "@src/tools";
import { engineFetch, sendJson, shortenFilename, splitExtension, verboseName } from "@src/helpers";

// Best effort: the engine clears leftovers when it starts.
function deleteUploads(uploads: string[]) {
  if (!uploads.length) return;
  sendJson("/process", "DELETE", { uploads }).catch(() => {});
}

// `extras`: further uploads with their own status line (mark's logo).
// `onDone`: once the result has downloaded.
interface RunRequest {
  files: File[];
  extras?: { file: File; status: string }[];
  payload: (uploads: { uploads: string[]; extraUploads: string[] }) => {
    options: Record<string, unknown>;
  } & Record<string, unknown>;
  onDone?: () => void;
}

// Temporary: the "verbose" setting names downloads after their settings.
export const VerboseNames = createContext(false);

// The progress bar's transition takes as long (ToolPanel.module.css), so it
// glides from one answer to the next.
const PROGRESS_MS = 500;

export function useToolRun(tool: ToolId) {
  const verbose = useContext(VerboseNames);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // How far (0–1) the run's encode has got.
  const [progress, setProgress] = useState(0);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Also aborted on unmount: a tab switch unmounts the page.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async ({ files, extras = [], payload, onDone }: RunRequest) => {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    setErrorDetail(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const uploads: string[] = [];
    const extraUploads: string[] = [];

    try {
      // The engine names the file by its id; the extension tells ffmpeg nothing
      // it can't sniff, but keeps the work files readable.
      const send = async (file: File) => {
        const [, ext] = splitExtension(file.name);
        const id = `${crypto.randomUUID()}${/^\.\w{1,10}$/.test(ext) ? ext.toLowerCase() : ""}`;
        const res = await engineFetch(`/upload/${id}`, { method: "PUT", body: file, signal });
        if (!res.ok) throw new Error(`Engine error (${res.status}): Unable to read the file`);
        return id;
      };

      for (let i = 0; i < files.length; i++) {
        setStatus(files.length > 1 ? `Uploading ${i + 1}/${files.length}` : "Uploading");
        uploads.push(await send(files[i]));
      }

      for (const extra of extras) {
        setStatus(extra.status);
        extraUploads.push(await send(extra.file));
      }

      setStatus("Processing");
      const body = payload({ uploads, extraUploads });
      // Named here, so the engine can be asked how far the job has got while
      // the POST is held open.
      const job = crypto.randomUUID();
      const poll = setInterval(async () => {
        const done = await engineFetch(`/progress/${job}`, { signal })
          .then((res) => res.json())
          .catch(() => null);
        if (typeof done === "number") setProgress(done);
      }, PROGRESS_MS);
      const res = await sendJson(
        "/process",
        "POST",
        { tool, filename: files[0].name, job, ...body },
        signal,
      ).finally(() => clearInterval(poll));
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || `Engine error (${res.status}): Unable to process`);
      }
      const resultName = decodeURIComponent(res.headers.get("X-Filename") ?? "");
      const [base, ext] = splitExtension(files[0].name);
      const downloadName = verbose
        ? verboseName(
            base,
            extras.map(({ file }) => file.name),
            body.options,
            resultName,
          )
        : resultName || `${base}_${tool}${ext}`;

      setStatus(`Downloading ${shortenFilename(files[0])}`);
      // Encoded, whatever the last answer said.
      setProgress(1);
      const objectUrl = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), {
        href: objectUrl,
        download: downloadName,
      });
      a.click();
      URL.revokeObjectURL(objectUrl);

      onDone?.();
    } catch (err: unknown) {
      // The engine deletes what a job was given; double deletes are harmless.
      deleteUploads([...uploads, ...extraUploads]);
      // Aborted = cancelled on purpose: no error box.
      if (!signal.aborted) {
        console.error(err);
        setErrorDetail(
          err instanceof TypeError
            ? "Can't reach the videotools engine. Is it still running?"
            : err instanceof Error
              ? err.message
              : String(err),
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  // Never rejects: a failure ends up in errorDetail.
  const start = (request: RunRequest) => void run(request);

  const cancel = () => abortRef.current?.abort();

  const clearError = () => setErrorDetail(null);

  return { busy, status, progress, errorDetail, clearError, start, cancel };
}

export type ToolRun = ReturnType<typeof useToolRun>;
