// The browser engine: a tool run or a Mark preview in a worker of its own
// (worker.ts), so stopping a job is terminating its worker.
import type { ToolId } from "@api/formats";
import { PROGRAMS, WASM_URL } from "./exec";
import type { EngineRequest, EngineResult } from "./worker";

// Tools the browser runs; the rest still go to /api/process.
export const ENGINE_TOOLS: readonly ToolId[] = ["loop"];

// Kept across visits by the Cache API; a new build gets a new URL.
async function compile(url: string): Promise<WebAssembly.Module> {
  const cache = await caches.open("engine");
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error(`Engine download failed (${response.status})`);
    await cache.put(url, response.clone());
  }
  return WebAssembly.compileStreaming(response);
}

let compiled: Promise<Record<string, WebAssembly.Module>> | undefined;
const engineModules = () =>
  (compiled ??= Promise.all(PROGRAMS.map((name) => compile(`${WASM_URL}/${name}.wasm`))).then(
    (list) => Object.fromEntries(PROGRAMS.map((name, i) => [name, list[i]])),
  ));

// Stands in for an upload's Blob URL: the tools take their inputs by URL.
export const uploadUrl = (file: File, index: number) =>
  `https://engine.public.blob.vercel-storage.com/${index}/${encodeURIComponent(file.name)}`;

export async function runEngine(request: EngineRequest, signal?: AbortSignal): Promise<File> {
  const modules = await engineModules();
  signal?.throwIfAborted();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<File>((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      worker.onmessage = ({ data }: MessageEvent<EngineResult>) =>
        "file" in data ? resolve(data.file) : reject(new Error(data.error));
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({ ...request, modules });
    });
  } finally {
    worker.terminate();
  }
}
