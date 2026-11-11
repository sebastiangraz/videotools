// The browser engine: a tool run or a round of Mark previews in a worker of
// its own (worker.ts), so stopping a job is terminating its worker.
import { PROGRAMS, WASM_URL } from "./exec";
import type { EngineProgress, EngineRequest, EngineResult } from "./worker";

// Kept across visits by the Cache API; a new build gets a new URL, and
// replaces the build it follows.
async function compile(url: string): Promise<WebAssembly.Module> {
  const cache = await caches.open("engine");
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    // A missing file can come back as the app's index page, with a 200.
    const type = response.headers.get("content-type");
    if (!response.ok || type !== "application/wasm")
      throw new Error(`Engine download failed (${response.status} ${type})`);
    const name = url.slice(url.lastIndexOf("/"));
    for (const old of await cache.keys()) if (old.url.endsWith(name)) await cache.delete(old);
    await cache.put(url, response.clone());
  }
  return WebAssembly.compileStreaming(response);
}

let compiled: Promise<Record<string, WebAssembly.Module>> | undefined;

// Jobs take turns. A page is granted only a few dozen WebAssembly memories,
// each ffmpeg run takes one, and a worker hands its runs' back when it ends:
// the next job starts once the last one's worker has.
let last = Promise.resolve();

// A finished worker is still closing its last run's threads, and Chrome
// strands one terminated in the middle of that. A stopped worker's threads
// are ended by Chrome, some time after it is terminated.
const ENDS_MS = { finished: 250, stopped: 2500 };

export async function runEngine(
  request: EngineRequest,
  signal?: AbortSignal,
  onProgress?: (done: number) => void,
): Promise<File[]> {
  signal?.throwIfAborted();
  // Rejects on abort, whichever stage the job is at.
  const stopped = new Promise<never>((_, reject) =>
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
  );
  compiled ??= Promise.all(
    PROGRAMS.map(async (name) => [name, await compile(`${WASM_URL}/${name}.wasm`)] as const),
  )
    .then(Object.fromEntries)
    // A failed download is tried again by the next run.
    .catch((err: unknown) => {
      compiled = undefined;
      throw err;
    });
  const modules = await Promise.race([compiled, stopped]);
  const turn = last;
  const { promise, resolve: ended } = Promise.withResolvers<void>();
  last = promise;
  // Stopped while queued, it starts no worker: it hands the turn on once it gets it.
  await Promise.race([turn, stopped]).catch((err: unknown) => {
    void turn.then(ended);
    throw err;
  });
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<File[]>((resolve, reject) => {
      void stopped.catch(reject);
      worker.onmessage = ({ data }: MessageEvent<EngineResult | EngineProgress>) => {
        if ("progress" in data) onProgress?.(data.progress);
        else if ("files" in data) resolve(data.files);
        else reject(new Error(data.error));
      };
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage({ ...request, modules });
    });
  } finally {
    if (signal?.aborted) worker.terminate();
    setTimeout(
      () => {
        worker.terminate();
        ended();
      },
      signal?.aborted ? ENDS_MS.stopped : ENDS_MS.finished,
    );
  }
}
