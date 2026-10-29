import { createContext, useContext, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import type { ToolId } from "@src/tools";
import { sendJson, shortenFilename, splitExtension, verboseName } from "@src/helpers";
import { ENGINE_TOOLS, runEngine, uploadUrl } from "@src/engine";

// Best effort: the server sweeps leftovers anyway.
function deleteBlobs(urls: string[]) {
  if (!urls.length) return;
  sendJson("/api/process", "DELETE", { urls }).catch(() => {});
}

// `extras`: further uploads with their own status line (mark's logo).
// `onDone`: once the result has downloaded.
interface RunRequest {
  files: File[];
  extras?: { file: File; status: string }[];
  payload: (urls: { blobUrls: string[]; extraUrls: string[] }) => {
    options: Record<string, unknown>;
  } & Record<string, unknown>;
  onDone?: () => void;
}

// Temporary: the "verbose" setting names downloads after their settings.
export const VerboseNames = createContext(false);

export function useToolRun(tool: ToolId) {
  const verbose = useContext(VerboseNames);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Also aborted on unmount: a tab switch unmounts the page.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async ({ files, extras = [], payload, onDone }: RunRequest) => {
    if (busy) return;
    setBusy(true);
    setErrorDetail(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const blobUrls: string[] = [];
    const extraUrls: string[] = [];
    let resultUrl: string | null = null;

    try {
      let body: ReturnType<RunRequest["payload"]>;
      let result: Blob;
      let resultName: string;
      if (ENGINE_TOOLS.includes(tool)) {
        const all = [...files, ...extras.map(({ file }) => file)];
        const urls = all.map(uploadUrl);
        body = payload({
          blobUrls: urls.slice(0, files.length),
          extraUrls: urls.slice(files.length),
        });
        setStatus("Processing");
        const uploads = Object.fromEntries(urls.map((url, i) => [url, all[i]]));
        const file = await runEngine({ tool, filename: files[0].name, body, uploads }, signal);
        result = file;
        resultName = file.name;
      } else {
        const send = (file: File) =>
          upload(file.name, file, {
            access: "public",
            handleUploadUrl: "/api/upload",
            // Some systems report no type for .avi/.mkv; an empty one gets the
            // upload token refused.
            contentType: file.type || "application/octet-stream",
            abortSignal: signal,
          });

        for (let i = 0; i < files.length; i++) {
          setStatus(files.length > 1 ? `Uploading ${i + 1}/${files.length}` : "Uploading");
          blobUrls.push((await send(files[i])).url);
        }

        for (const extra of extras) {
          setStatus(extra.status);
          extraUrls.push((await send(extra.file)).url);
        }

        setStatus("Processing");
        body = payload({ blobUrls, extraUrls });
        const res = await sendJson(
          "/api/process",
          "POST",
          { tool, filename: files[0].name, ...body },
          signal,
        );
        if (!res.ok) {
          const errorData = await res.json().catch(() => null);
          throw new Error(errorData?.error || `Server error (${res.status}): Unable to process`);
        }
        const { url, filename } = await res.json();
        resultUrl = url;
        resultName = filename;

        setStatus(`Downloading ${shortenFilename(files[0])}`);
        // Blob storage is cross-origin, where `download` is ignored.
        const fileRes = await fetch(url, { signal });
        if (!fileRes.ok) throw new Error(`Failed to download result (${fileRes.status})`);
        result = await fileRes.blob();
        deleteBlobs([url]);
      }
      const [base, ext] = splitExtension(files[0].name);
      const downloadName = verbose
        ? verboseName(
            base,
            extras.map(({ file }) => file.name),
            body.options,
            resultName,
          )
        : resultName || `${base}_${tool}${ext}`;
      const objectUrl = URL.createObjectURL(result);
      const a = Object.assign(document.createElement("a"), {
        href: objectUrl,
        download: downloadName,
      });
      a.click();
      URL.revokeObjectURL(objectUrl);

      onDone?.();
    } catch (err: unknown) {
      // The server only deletes inputs once it runs; double deletes are harmless.
      const uploaded = [...blobUrls, ...extraUrls];
      deleteBlobs(resultUrl ? [...uploaded, resultUrl] : uploaded);
      // Aborted = stopped on purpose: no error box.
      if (!signal.aborted) {
        console.error(err);
        setErrorDetail(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  // Never rejects: a failure ends up in errorDetail.
  const start = (request: RunRequest) => void run(request);

  const stop = () => abortRef.current?.abort();

  const clearError = () => setErrorDetail(null);

  return { busy, status, errorDetail, clearError, start, stop };
}

export type ToolRun = ReturnType<typeof useToolRun>;
