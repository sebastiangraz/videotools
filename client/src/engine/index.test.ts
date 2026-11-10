import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { runEngine } from "@src/engine";
import { GLUE_URL } from "@src/engine/exec";

vi.unmock("@src/engine");

// Browsers keep an engine for good under its address: a rebuild gets a new one.
it("names the engine folder after its files", async () => {
  const folder = `${import.meta.dirname}/../../public${GLUE_URL}/`;
  const hash = createHash("sha256");
  for (const file of (await readdir(folder)).sort()) hash.update(await readFile(folder + file));
  expect(GLUE_URL).toBe(`/engine/${hash.digest("hex").slice(0, 8)}`);
});

it("stops a queued job at once and hands its turn on in order", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("caches", { open: async () => ({ match: async () => ({}) }) });
  vi.spyOn(WebAssembly, "compileStreaming").mockResolvedValue({} as WebAssembly.Module);
  const workers: Worker[] = [];
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        workers.push(this as never);
      }
      postMessage() {}
      terminate() {}
    },
  );
  const request = { tool: "loop" as const, files: [], options: {} };

  const first = runEngine(request);
  const stop = new AbortController();
  const stopped = runEngine(request, stop.signal);
  await vi.advanceTimersByTimeAsync(0);
  stop.abort();
  await expect(stopped).rejects.toBe(stop.signal.reason);

  void runEngine(request);
  workers[0].onmessage!(new MessageEvent("message", { data: { files: [] } }));
  await first;
  await vi.advanceTimersByTimeAsync(249);
  expect(workers).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(workers).toHaveLength(2);
});
