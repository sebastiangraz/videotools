import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import type { ToolId } from "../tools";

// Best-effort removal of blobs this client created (uploads, or a result
// that was already downloaded). Failures are ignored: Blob storage is only
// a transfer buffer here, and the server sweeps leftovers on its own.
function deleteBlobs(urls: string[]) {
  if (!urls.length) return;
  fetch("/api/process", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  }).catch(() => {});
}

// What a page hands over to start a run. `files` are the tool's source(s),
// uploaded in order; `extras` are further uploads with their own status line
// (the mark tool's logo). `payload` builds the tool's part of the
// /api/process body from the uploaded URLs; `tool` and `filename` are added
// here.
export interface RunRequest {
  files: File[];
  extras?: { file: File; status: string }[];
  payload: (urls: {
    blobUrls: string[];
    extraUrls: string[];
  }) => Record<string, unknown>;
}

// One run of a tool: upload -> process -> download, shared by every page.
export function useToolRun(tool: ToolId) {
  const [status, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  // Underlying failure text, shown inside the expandable error box below the
  // CTA. Null = no box.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Controller for the in-flight run (upload -> process -> download). Stop
  // aborts it; so does unmounting, since a tab switch unmounts the page and
  // would otherwise leave the request running against dead state.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async ({ files, extras = [], payload }: RunRequest) => {
    if (busy) return;
    setBusy(true);
    setErrorDetail(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    // Blobs this run has created, so Stop can clean up whatever the server
    // never got to delete itself.
    const blobUrls: string[] = [];
    const extraUrls: string[] = [];
    let resultUrl: string | null = null;

    try {
      const send = (file: File) =>
        upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          // Browsers report no type for some containers (.avi, .mkv on
          // certain systems); fall back so the upload token isn't refused.
          contentType: file.type || "application/octet-stream",
          abortSignal: signal,
        });

      for (let i = 0; i < files.length; i++) {
        setMsg(
          files.length > 1 ? `Uploading ${i + 1}/${files.length}` : "Uploading",
        );
        blobUrls.push((await send(files[i])).url);
      }

      for (const extra of extras) {
        setMsg(extra.status);
        extraUrls.push((await send(extra.file)).url);
      }

      setMsg("Processing");
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool,
          filename: files[0].name,
          ...payload({ blobUrls, extraUrls }),
        }),
        signal,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(
          errorData?.error || `Server error (${res.status}): Unable to process`,
        );
      }
      const { url, filename: resultName } = await res.json();
      resultUrl = url;
      // The server names the result; the stand-in keeps the source's name
      // and extension, which is the format every tool hands back unless it
      // was asked for another.
      const [, base, ext = ""] = /^(.*?)(\.[^.]+)?$/.exec(files[0].name) ?? [];
      const downloadName = resultName || `${base}_${tool}${ext}`;

      setMsg(`Downloading ${downloadName.slice(0, 28)}`);
      // Result lives on Blob storage (cross-origin), where the anchor
      // `download` attribute is ignored — fetch to an object URL instead.
      const fileRes = await fetch(url, { signal });
      if (!fileRes.ok)
        throw new Error(`Failed to download result (${fileRes.status})`);
      const objectUrl = URL.createObjectURL(await fileRes.blob());
      const a = Object.assign(document.createElement("a"), {
        href: objectUrl,
        download: downloadName,
      });
      a.click();
      URL.revokeObjectURL(objectUrl);

      deleteBlobs([url]);
    } catch (err: unknown) {
      // Whatever went wrong, nothing this run uploaded is of use any more:
      // the server only deletes inputs when it gets to run, an upload cut
      // short never reaches it, and a result nobody downloaded is just
      // storage. Deleting again what the server already removed is harmless.
      const uploaded = [...blobUrls, ...extraUrls];
      deleteBlobs(resultUrl ? [...uploaded, resultUrl] : uploaded);
      if (signal.aborted) {
        // Stopped on purpose: no error box.
      } else {
        console.error(err);
        // The status message only renders inside the button while busy, so
        // failures surface through the error box instead.
        setErrorDetail(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  };

  const stop = () => abortRef.current?.abort();

  // Picking a new file dismisses the last run's error.
  const clearError = () => setErrorDetail(null);

  return { busy, status, errorDetail, clearError, start, stop };
}

export type ToolRun = ReturnType<typeof useToolRun>;
